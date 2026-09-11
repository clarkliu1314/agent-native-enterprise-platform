import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('durable schema', () => {
  it('declares all durable runtime ownership tables and fencing primitives', async () => {
    const schema = await readFile(new URL('./durable-schema.sql', import.meta.url), 'utf8');
    for (const table of [
      'agent_runs',
      'agent_turns',
      'model_calls',
      'model_call_attempts',
      'tool_calls',
      'agent_events',
      'outbox_events',
      'idempotency_keys',
      'checkpoints',
      'wait_conditions',
    ]) {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(schema).toContain('fencing_token BIGINT NOT NULL DEFAULT 0');
    expect(schema).toContain("state TEXT NOT NULL CHECK (state IN ('QUEUED','RUNNING','WAITING','SUCCEEDED','FAILED','CANCELLED'))");
    expect(schema).toContain('UNIQUE (run_id, sequence)');
  });
});
