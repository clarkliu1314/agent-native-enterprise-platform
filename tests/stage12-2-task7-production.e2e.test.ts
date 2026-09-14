import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeApi } from '../apps/api/src/composition';
import { composeWorker } from '../apps/worker/src/index';
import { composeOutboxPublisher } from '../apps/outbox-publisher/src/index';
import type { QueueConsumer, QueuePublisher, RuntimeAdapter } from '../packages/runtime/src/ports';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

const adapter: RuntimeAdapter = {
  name: 'stage12-2-production-e2e',
  version: '1.0.0',
  async run() { return { kind: 'SUCCEEDED', output: { completed: true } }; },
  serializeCheckpoint(state) { return new TextEncoder().encode(JSON.stringify(state)); },
  deserializeCheckpoint(payload) { return JSON.parse(new TextDecoder().decode(payload)); },
};

const payloadRunId = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as { runId?: unknown }).runId;
  return typeof value === 'string' ? value : undefined;
};

const json = async (response: Response) => await response.json() as Record<string, unknown>;

describeIfDatabase('Stage 12.2 Task 7 production-composition E2E', () => {
  const published: Array<{ topic: string; payload: unknown }> = [];
  const queue: QueuePublisher = {
    async publish(topic, payload) { published.push({ topic, payload }); },
  };
  let runCounter = 0;
  const runIds: string[] = [];
  const consumer: QueueConsumer = {
    async consume(handler) {
      const messages = published.splice(0);
      for (const message of messages) {
        const messageRunId = payloadRunId(message.payload);
        if (messageRunId && runIds.includes(messageRunId)) {
          await handler(message);
          if (message.topic === 'agent.run') {
            const current = await api.runtime.getRun(messageRunId);
            if (current.state !== 'SUCCEEDED' && current.state !== 'FAILED' && current.state !== 'CANCELLED') {
              published.push(message);
            }
          }
        } else {
          published.push(message);
        }
      }
    },
  };

  const api = composeApi(adapter);
  const publisher = composeOutboxPublisher(queue);
  const worker = composeWorker(adapter, consumer, {
    owner: 'stage12-2-task7-worker',
    executionSliceMs: 5_000,
    heartbeatMs: 1_000,
  });

  const createRun = async (tenantId: string) => {
    const response = await api.handler(new Request('https://example.test/runs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': tenantId,
        'x-request-id': `task7-create-${runCounter}`,
        'x-trace-id': `task7-trace-${runCounter}`,
        'idempotency-key': `task7-create-${tenantId}-${runCounter}`,
      },
      body: JSON.stringify({ agentId: 'task7-agent', input: { task: `task7-${runCounter}` } }),
    }));
    expect(response.status).toBe(202);
    const body = await json(response);
    const runId = body.runId as string;
    runCounter += 1;
    runIds.push(runId);
    return runId;
  };

  const control = async (runId: string, tenantId: string, action: string, key: string, commandId: string) => {
    return api.vercelHandler(new Request(`https://example.test/api/runs/${encodeURIComponent(runId)}/${action.toLowerCase()}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': tenantId,
        'x-actor-id': 'task7-operator',
        'x-request-id': `task7-${commandId}`,
        'x-trace-id': `task7-trace-${commandId}`,
        'idempotency-key': key,
      },
      body: JSON.stringify({ commandId }),
    }));
  };

  beforeAll(async () => {
    expect(databaseUrl).toBeTruthy();
  });

  afterAll(async () => {
    if (runIds.length) {
      for (const runId of runIds) {
        await api.database.query('DELETE FROM outbox_events WHERE event_id IN (SELECT event_id FROM agent_events WHERE run_id=$1)', [runId]);
        await api.database.query('DELETE FROM agent_events WHERE run_id=$1', [runId]);
        await api.database.query('DELETE FROM idempotency_keys WHERE run_id=$1', [runId]);
        await api.database.query('DELETE FROM agent_runs WHERE run_id=$1', [runId]);
      }
    }
    await api.database.pool.end();
    await publisher.database.pool.end();
    await worker.database.pool.end();
  });

  it('pauses durably before worker execution, then resumes through the same production worker', async () => {
    const tenantId = `task7-pause-${Date.now()}`;
    const runId = await createRun(tenantId);

    const pauseResponse = await control(runId, tenantId, 'PAUSE', `task7-pause-${runId}`, `task7-pause-${runId}`);
    expect(pauseResponse.status).toBe(202);
    await expect(pauseResponse.json()).resolves.toMatchObject({ action: 'PAUSE', runId, outcome: 'SUCCEEDED' });

    const publishResult = await publisher.publisher.publishBatch(10);
    expect(publishResult.published).toBeGreaterThanOrEqual(1);
    await expect(worker.worker.start()).resolves.toBeUndefined();

    const pausedRun = await api.runtime.getRun(runId);
    expect(pausedRun?.state).toBe('QUEUED');

    const resumeResponse = await control(runId, tenantId, 'RESUME', `task7-resume-${runId}`, `task7-resume-${runId}`);
    expect(resumeResponse.status).toBe(202);
    await expect(resumeResponse.json()).resolves.toMatchObject({ action: 'RESUME', runId, outcome: 'SUCCEEDED' });

    await worker.worker.start();
    const resumedRun = await api.runtime.getRun(runId);
    expect(resumedRun?.state).toBe('SUCCEEDED');
  });

  it('cancels durably and fences a stale worker before effectful continuation', async () => {
    const tenantId = `task7-cancel-${Date.now()}`;
    const runId = await createRun(tenantId);

    const publishResult = await publisher.publisher.publishBatch(10);
    expect(publishResult.published).toBeGreaterThanOrEqual(1);

    const before = await api.runtime.getRun(runId);
    expect(before?.fencingToken).toBe(0n);

    const cancelResponse = await control(runId, tenantId, 'CANCEL', `task7-cancel-${runId}`, `task7-cancel-${runId}`);
    expect(cancelResponse.status).toBe(202);
    await expect(cancelResponse.json()).resolves.toMatchObject({ action: 'CANCEL', runId, outcome: 'SUCCEEDED' });

    const cancelled = await api.runtime.getRun(runId);
    expect(cancelled?.state).toBe('CANCELLED');
    expect(cancelled?.fencingToken).toBe(1n);

    await expect(worker.worker.start()).rejects.toThrow();
    const afterWorker = await api.runtime.getRun(runId);
    expect(afterWorker?.state).toBe('CANCELLED');
  });

  it('replays duplicate operator commands without creating a second durable control event', async () => {
    const tenantId = `task7-idempotency-${Date.now()}`;
    const runId = await createRun(tenantId);
    const key = `task7-idempotency-${runId}`;
    const commandId = `task7-command-${runId}`;

    const first = await control(runId, tenantId, 'PAUSE', key, commandId);
    expect(first.status).toBe(202);
    const second = await control(runId, tenantId, 'PAUSE', key, commandId);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ action: 'PAUSE', runId, outcome: 'SUCCEEDED', replayed: true });

    const rows = await api.database.query<{ type: string }>(
      "SELECT type FROM agent_events WHERE run_id=$1 AND type='OPERATIONAL_CONTROL_APPLIED'",
      [runId],
    );
    expect(rows.rows).toHaveLength(1);

    const outbox = await api.database.query(
      'SELECT event_id FROM outbox_events WHERE event_id IN (SELECT event_id FROM agent_events WHERE run_id=$1) AND event_id LIKE $2',
      [runId, `${runId}:control:%`],
    );
    expect(outbox.rows).toHaveLength(1);
  });

  it('enforces tenant isolation through the real HTTP-to-PostgreSQL composition', async () => {
    const ownerTenant = `task7-owner-${Date.now()}`;
    const otherTenant = `task7-other-${Date.now()}`;
    const runId = await createRun(ownerTenant);

    const response = await control(runId, otherTenant, 'PAUSE', `task7-cross-${runId}`, `task7-cross-${runId}`);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ errorCode: 'RUN_NOT_FOUND' });

    const ownerRun = await api.runtime.getRun(runId);
    expect(ownerRun?.state).toBe('QUEUED');
  });
});
