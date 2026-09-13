import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresDatabase, PostgresRuntimeRepositories } from '../packages/runtime/src';
import { InvestmentWorkflowRuntimeAdapter } from '../packages/investment-domain/src/postgres-workflow-runtime';
import { InvestmentApiApplicationAdapter } from '../apps/api/src/investment-application';
import { createInvestmentHandler } from '../apps/api/src/investment-handler';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

describeIfDatabase('investment worker crash consistency', () => {
  const database = new PostgresDatabase(databaseUrl!);
  const repositories = new PostgresRuntimeRepositories(database);
  const adapter = new InvestmentWorkflowRuntimeAdapter(database, repositories);
  const handler = createInvestmentHandler(new InvestmentApiApplicationAdapter(database));
  const runIds: string[] = [];

  beforeEach(async () => {
    const response = await handler(new Request('https://example.test/investment-workflows', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': 'tenant-h3',
        'idempotency-key': `investment-h3-${Date.now()}-${Math.random()}`,
      },
      body: JSON.stringify({ opportunityId: `opportunity-h3-${Date.now()}` }),
    }));
    expect(response.status).toBe(202);
    const body = await response.json() as { runId: string };
    runIds.push(body.runId);
  });

  afterAll(async () => {
    for (const runId of runIds) {
      await database.query('DELETE FROM outbox_events WHERE event_id IN (SELECT event_id FROM agent_events WHERE run_id=$1)', [runId]);
      await database.query('DELETE FROM checkpoints WHERE run_id=$1', [runId]);
      await database.query('DELETE FROM agent_events WHERE run_id=$1', [runId]);
      await database.query('DELETE FROM idempotency_keys WHERE run_id=$1', [runId]);
      await database.query('DELETE FROM agent_runs WHERE run_id=$1', [runId]);
    }
    await database.pool.end();
  });

  it('commits workflow cursor and checkpoint as one durable unit', async () => {
    const runId = runIds.at(-1)!;
    const claimed = await repositories.claimRun(runId, 'worker-h3', 30_000);
    expect(claimed?.fencingToken).toBe(1n);

    const checkpoint = {
      checkpointId: `${runId}:checkpoint:1`,
      runId,
      sequence: 1n,
      fencingToken: claimed!.fencingToken,
      adapter: adapter.name,
      adapterVersion: adapter.version,
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      payload: adapter.serializeCheckpoint({ tenantId: 'tenant-h3', opportunityId: 'opportunity-h3', nextStep: 1 }),
    };

    await repositories.saveRunProgress({
      runId,
      owner: 'worker-h3',
      fencingToken: claimed!.fencingToken,
      metadata: { tenantId: 'tenant-h3', opportunityId: 'opportunity-h3', nextStep: 1 },
      checkpoint,
    });

    const persisted = await repositories.getRun(runId);
    expect(persisted?.metadata.nextStep).toBe(1);
    expect((await repositories.getLatestCheckpoint(runId))?.sequence).toBe(1n);
  });

  it('rolls back the workflow cursor when checkpoint persistence fails', async () => {
    const runId = runIds.at(-1)!;
    const claimed = await repositories.claimRun(runId, 'worker-h3', 30_000);
    expect(claimed?.fencingToken).toBe(1n);

    const checkpoint = {
      checkpointId: `${runId}:checkpoint:1`,
      runId,
      sequence: 1n,
      fencingToken: claimed!.fencingToken,
      adapter: adapter.name,
      adapterVersion: adapter.version,
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      payload: adapter.serializeCheckpoint({ tenantId: 'tenant-h3', opportunityId: 'opportunity-h3', nextStep: 1 }),
    };

    await repositories.saveCheckpoint(checkpoint);

    await expect(repositories.saveRunProgress({
      runId,
      owner: 'worker-h3',
      fencingToken: claimed!.fencingToken,
      metadata: { tenantId: 'tenant-h3', opportunityId: 'opportunity-h3', nextStep: 2 },
      checkpoint,
    })).rejects.toThrow();

    const persisted = await repositories.getRun(runId);
    expect(persisted?.metadata.nextStep).toBe(0);
    expect((await repositories.getLatestCheckpoint(runId))?.sequence).toBe(1n);
  });
});
