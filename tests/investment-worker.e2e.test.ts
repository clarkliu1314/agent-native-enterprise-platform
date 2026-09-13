import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresDatabase, PostgresOutboxRepository, PostgresRuntimeRepositories, DurableRuntimeService, DurableWorker } from '../packages/runtime/src';
import { OutboxPublisher } from '../packages/runtime/src/outbox-publisher';
import type { QueueConsumer, QueuePublisher } from '../packages/runtime/src/ports';
import { InvestmentApiApplicationAdapter } from '../apps/api/src/investment-application';
import { createInvestmentHandler } from '../apps/api/src/investment-handler';
import { InvestmentWorkflowRuntimeAdapter } from '../packages/investment-domain/src/postgres-workflow-runtime';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

describeIfDatabase('investment workflow durable worker e2e', () => {
  const database = new PostgresDatabase(databaseUrl);
  const runtimeRepositories = new PostgresRuntimeRepositories(database);
  const adapter = new InvestmentWorkflowRuntimeAdapter(database, runtimeRepositories);
  const runtime = new DurableRuntimeService(runtimeRepositories, { adapter, leaseMs: 30_000, heartbeatMs: 1_000 });

  const published: Array<{ topic: string; payload: unknown }> = [];
  const queuePublisher: QueuePublisher = {
    async publish(topic, payload) { published.push({ topic, payload }); },
  };
  const consumer: QueueConsumer = {
    async consume(handler) {
      for (const message of published.splice(0)) await handler(message);
    },
  };
  const worker = new DurableWorker(runtime, consumer, { owner: 'investment-worker', executionSliceMs: 5_000 });
  const outbox = new OutboxPublisher(new PostgresOutboxRepository(database), queuePublisher);
  const handler = createInvestmentHandler(new InvestmentApiApplicationAdapter(database));
  let runId = '';

  beforeAll(async () => {
    const response = await handler(new Request('https://example.test/investment-workflows', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': 'tenant-e2e',
        'idempotency-key': `investment-worker-e2e-${Date.now()}`,
      },
      body: JSON.stringify({ opportunityId: 'opportunity-e2e' }),
    }));
    expect(response.status).toBe(202);
    const body = await response.json() as { runId: string; opportunityId: string };
    runId = body.runId;
    expect(body.opportunityId).toBe('opportunity-e2e');
  });

  afterAll(async () => {
    await database.query('DELETE FROM outbox_events WHERE event_id IN (SELECT event_id FROM agent_events WHERE run_id=$1)', [runId]);
    await database.query('DELETE FROM checkpoints WHERE run_id=$1', [runId]);
    await database.query('DELETE FROM agent_events WHERE run_id=$1', [runId]);
    await database.query('DELETE FROM idempotency_keys WHERE run_id=$1', [runId]);
    await database.query('DELETE FROM agent_runs WHERE run_id=$1', [runId]);
    await database.pool.end();
  });

  it('executes admitted investment work through outbox and durable worker, then resumes from WAITING', async () => {
    const admitted = await runtime.getRun(runId);
    expect(admitted.state).toBe('QUEUED');
    expect(admitted.fencingToken).toBe(0n);

    const firstPublish = await outbox.publishBatch(10);
    expect(firstPublish.published).toBe(1);
    expect(published[0]).toMatchObject({ topic: 'agent.run' });

    await worker.start();

    const waiting = await runtime.getRun(runId);
    expect(waiting.state).toBe('WAITING');
    expect(waiting.fencingToken).toBe(1n);
    expect(Number(waiting.metadata.nextStep)).toBe(4);
    expect((await runtime.getRunCheckpoint(runId))?.fencingToken).toBe(1n);

    const resume = await handler(new Request(`https://example.test/investment-workflows/${encodeURIComponent(runId)}/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 'tenant-e2e' },
      body: JSON.stringify({ approval: 'APPROVE' }),
    }));
    expect(resume.status).toBe(202);

    const secondPublish = await outbox.publishBatch(10);
    expect(secondPublish.published).toBe(1);
    await worker.start();

    const completed = await runtime.getRun(runId);
    expect(completed.state).toBe('SUCCEEDED');
    expect(completed.fencingToken).toBe(2n);
  });

  it('rejects a stale worker checkpoint after lease reclaim', async () => {
    const stale = await runtime.resumeRun(runId, 'stale-worker');
    expect(stale.fencingToken).toBe(3n);
    await database.query("UPDATE agent_runs SET lease_expires_at = NOW() - interval '1 second' WHERE run_id=$1", [runId]);
    const reclaimed = await runtime.executeRunBounded(runId, 'investment-worker', new Date(Date.now() + 5_000));
    expect(reclaimed.run.fencingToken).toBe(4n);
    expect(reclaimed.run.state).toBe('SUCCEEDED');

    await expect(runtimeRepositories.saveCheckpoint({
      checkpointId: `${runId}:stale`,
      runId,
      sequence: 999n,
      fencingToken: stale.fencingToken,
      adapter: adapter.name,
      adapterVersion: adapter.version,
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      payload: adapter.serializeCheckpoint({ stale: true }),
    })).rejects.toThrow(/Fenced checkpoint write rejected/);
  });
});
