import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeApi } from '../apps/api/src/composition';
import { createDurableHandler } from '../apps/api/src/durable-handler';
import type { RuntimeAdapter } from '../packages/runtime/src/ports';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

describeIfDatabase('durable runtime sync deadline', () => {
  const adapter: RuntimeAdapter = {
    name: 'e2e-deadline', version: '1.0.0',
    async run({ signal }) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 50);
        if (signal?.aborted) { clearTimeout(timer); reject(signal.reason); return; }
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      });
      return { kind: 'SUCCEEDED', output: { completed: true } };
    },
    serializeCheckpoint(state) { return new TextEncoder().encode(JSON.stringify(state)); },
    deserializeCheckpoint(payload) { return JSON.parse(new TextDecoder().decode(payload)); },
  };

  const api = composeApi(adapter);
  const handler = createDurableHandler(api.runtime, { syncBudgetMs: 1, owner: 'e2e-deadline' });
  let runId = '';

  beforeAll(async () => {
    const response = await handler(new Request('https://example.test/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `deadline-${Date.now()}` },
      body: JSON.stringify({ agentId: 'deadline-agent', input: { task: 'slow' }, executionMode: 'sync' }),
    }));
    expect(response.status).toBe(202);
    const body = await response.json() as { runId: string; state: string };
    runId = body.runId;
    expect(body.state).toBe('RUNNING');
  });

  afterAll(async () => {
    if (runId) {
      await api.database.query('DELETE FROM outbox_events WHERE event_id IN (SELECT event_id FROM agent_events WHERE run_id=$1)', [runId]);
      await api.database.query('DELETE FROM agent_events WHERE run_id=$1', [runId]);
      await api.database.query('DELETE FROM idempotency_keys WHERE run_id=$1', [runId]);
      await api.database.query('DELETE FROM agent_runs WHERE run_id=$1', [runId]);
    }
    await api.database.pool.end();
  });

  it('leaves durable execution running after the request deadline expires', async () => {
    const response = await handler(new Request(`https://example.test/runs/${encodeURIComponent(runId)}`, { method: 'GET' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ runId, state: 'RUNNING' });
  });
});
