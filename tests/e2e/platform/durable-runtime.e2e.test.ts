import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeApi } from '../../../apps/api/src/composition';
import { composeWorker } from '../../../apps/worker/src/index';
import { composeOutboxPublisher } from '../../../apps/outbox-publisher/src/index';
import type { QueueConsumer, QueuePublisher, RuntimeAdapter } from '../../../packages/runtime/src/ports';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

const runIdFromResponse = async (response: Response): Promise<string> => {
  const body = await response.json() as { runId: string };
  return body.runId;
};

const payloadRunId = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as { runId?: unknown }).runId;
  return typeof value === 'string' ? value : undefined;
};

describeIfDatabase('durable runtime API → outbox → worker', () => {
  const adapter: RuntimeAdapter = {
    name: 'e2e-reference',
    version: '1.0.0',
    async run() { return { kind: 'SUCCEEDED', output: { completed: true } }; },
    serializeCheckpoint(state) { return new TextEncoder().encode(JSON.stringify(state)); },
    deserializeCheckpoint(payload) { return JSON.parse(new TextDecoder().decode(payload)); },
  };

  const published: Array<{ topic: string; payload: unknown }> = [];
  const queue: QueuePublisher = {
    async publish(topic, payload) { published.push({ topic, payload }); },
  };
  let runId = '';
  const consumer: QueueConsumer = {
    async consume(handler) {
      const messages = published.splice(0);
      for (const message of messages) {
        if (payloadRunId(message.payload) === runId) await handler(message);
        else published.push(message);
      }
    },
  };

  const api = composeApi(adapter);
  const publisher = composeOutboxPublisher(queue);
  const worker = composeWorker(adapter, consumer, { owner: 'e2e-worker', executionSliceMs: 5_000, heartbeatMs: 1_000 });

  beforeAll(async () => {
    const response = await api.handler(new Request('https://example.test/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}` },
      body: JSON.stringify({ agentId: 'e2e-agent', input: { task: 'complete' } }),
    }));
    expect(response.status).toBe(202);
    runId = await runIdFromResponse(response);
  });

  afterAll(async () => {
    await api.database.query('DELETE FROM outbox_events WHERE event_id IN (SELECT event_id FROM agent_events WHERE run_id=$1)', [runId]);
    await api.database.query('DELETE FROM agent_events WHERE run_id=$1', [runId]);
    await api.database.query('DELETE FROM idempotency_keys WHERE run_id=$1', [runId]);
    await api.database.query('DELETE FROM agent_runs WHERE run_id=$1', [runId]);
    await api.database.pool.end();
    await publisher.database.pool.end();
    await worker.database.pool.end();
  });

  it('publishes a durable run envelope and completes it through the Worker', async () => {
    const publishedResult = await publisher.publisher.publishBatch(10);
    expect(publishedResult.published).toBeGreaterThanOrEqual(1);
    expect(publishedResult.retried).toBe(0);

    const createdMessage = published.find(
      (message) => message.topic === 'agent.run' && payloadRunId(message.payload) === runId,
    );
    expect(createdMessage).toBeDefined();
    expect(createdMessage?.payload).toMatchObject({ runId, type: 'RUN_CREATED', sequence: '1' });

    await worker.worker.start();

    const response = await api.handler(new Request(`https://example.test/runs/${encodeURIComponent(runId)}`, { method: 'GET' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ runId, state: 'SUCCEEDED', fencingToken: '1' });

    const events = await api.runtime.listRunEvents(runId);
    expect(events.map((event) => event.type)).toEqual(['RUN_CREATED', 'RUN_SUCCEEDED']);

    const outbox = await api.database.query<{ published_at: string | null; topic: string }>(
      'SELECT published_at, topic FROM outbox_events WHERE event_id IN (SELECT event_id FROM agent_events WHERE run_id=$1) ORDER BY created_at',
      [runId],
    );
    expect(outbox.rows).toHaveLength(2);
    expect(outbox.rows[0].published_at).not.toBeNull();
    expect(outbox.rows[1].topic).toBe('agent.run');
  });
});
