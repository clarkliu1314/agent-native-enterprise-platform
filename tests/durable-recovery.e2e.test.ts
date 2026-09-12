import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeApi } from '../apps/api/src/composition';
import { composeRecovery } from '../apps/recovery/src/index';
import { composeWorker } from '../apps/worker/src/index';
import type { QueueConsumer, QueuePublisher, RuntimeAdapter } from '../packages/runtime/src/ports';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

describeIfDatabase('durable runtime crash recovery', () => {
  const adapter: RuntimeAdapter = {
    name: 'recovery-reference',
    version: '1.0.0',
    async run() { return { kind: 'SUCCEEDED', output: { recovered: true } }; },
    serializeCheckpoint(state) { return new TextEncoder().encode(JSON.stringify(state)); },
    deserializeCheckpoint(payload) { return JSON.parse(new TextDecoder().decode(payload)); },
  };

  const recoveredMessages: Array<{ topic: string; payload: unknown }> = [];
  const queue: QueuePublisher = {
    async publish(topic, payload) { recoveredMessages.push({ topic, payload }); },
  };
  const consumer: QueueConsumer = {
    async consume(handler) {
      for (const message of recoveredMessages.splice(0)) await handler(message);
    },
  };

  const api = composeApi(adapter);
  const recovery = composeRecovery(adapter, queue, 30_000);
  const worker = composeWorker(adapter, consumer, { owner: 'recovery-worker', executionSliceMs: 5_000, heartbeatMs: 1_000 });
  let runId = '';

  beforeAll(async () => {
    const response = await api.handler(new Request('https://example.test/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `recovery-e2e-${Date.now()}` },
      body: JSON.stringify({ agentId: 'recovery-agent', input: { task: 'crash' } }),
    }));
    expect(response.status).toBe(202);
    runId = (await response.json() as { runId: string }).runId;
    const claimed = await api.runtime.resumeRun(runId, 'crashed-worker');
    expect(claimed.fencingToken).toBe(1n);
  });

  afterAll(async () => {
    await api.database.query('DELETE FROM outbox_events WHERE event_id IN (SELECT event_id FROM agent_events WHERE run_id=$1)', [runId]);
    await api.database.query('DELETE FROM agent_events WHERE run_id=$1', [runId]);
    await api.database.query('DELETE FROM idempotency_keys WHERE run_id=$1', [runId]);
    await api.database.query('DELETE FROM agent_runs WHERE run_id=$1', [runId]);
    await api.database.pool.end();
    await recovery.database.pool.end();
    await worker.database.pool.end();
  });

  it('reclaims an expired lease with a new fencing token and resumes without stale ownership', async () => {
    await api.database.query("UPDATE agent_runs SET lease_expires_at = NOW() - interval '1 second' WHERE run_id=$1", [runId]);

    const outcomes = await recovery.coordinator.recoverExpired(10);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ runId, recovered: true, action: 'RECLAIMED', fencingToken: 2n });
    expect(recoveredMessages[0]).toMatchObject({ topic: 'agent.run', payload: { runId, owner: expect.any(String), fencingToken: '2', recovered: true } });

    await worker.worker.start();

    const response = await api.handler(new Request(`https://example.test/runs/${encodeURIComponent(runId)}`, { method: 'GET' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ runId, state: 'SUCCEEDED', fencingToken: '2' });
  });
});
