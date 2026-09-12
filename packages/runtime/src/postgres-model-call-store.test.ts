import { describe, expect, it } from 'vitest';
import { PostgresModelCallStore } from './postgres-model-call-store';
import type { SqlClient, SqlResult } from './ports';

class FakeSql implements SqlClient {
  queries: Array<{ sql: string; params: readonly unknown[] }> = [];
  async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<SqlResult<T>> {
    this.queries.push({ sql, params });
    return { rows: [], rowCount: 1 } as SqlResult<T>;
  }
}

describe('PostgresModelCallStore', () => {
  it('persists logical model calls and provider attempts', async () => {
    const db = new FakeSql();
    const store = new PostgresModelCallStore(db);

    await store.createCall({ callId: 'call-1', runId: 'run-1', model: 'model-x', requestHash: 'hash', replayPolicy: 'REPLAYABLE' });
    await store.createAttempt({ attemptId: 'call-1:attempt:1', callId: 'call-1', attemptNumber: 1, requestHash: 'hash', providerRequestId: 'provider-1' });
    await store.completeAttempt({ attemptId: 'call-1:attempt:1', outcome: 'SUCCEEDED', providerRequestId: 'provider-1' });
    await store.completeCall({ callId: 'call-1', response: { ok: true } });

    expect(db.queries).toHaveLength(4);
    expect(db.queries[0].sql).toContain('INSERT INTO model_calls');
    expect(db.queries[1].sql).toContain('INSERT INTO model_call_attempts');
    expect(db.queries[2].sql).toContain('UPDATE model_call_attempts');
    expect(db.queries[3].sql).toContain('UPDATE model_calls');
  });
});
