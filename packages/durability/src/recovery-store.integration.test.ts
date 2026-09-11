import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { RecoveryCandidateStore } from './recovery-store';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/agent_native';
const request = {
  tool: { name: 'reserve', description: 'reserve', sideEffect: true },
  input: { resourceId: 'r-1' },
  context: { actorId: 'a-1', tenantId: 't-1', permissions: ['reserve:write'] },
  idempotencyKey: 'idem-recovery-1',
};

describe('RecoveryCandidateStore PostgreSQL contract', () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const store = new RecoveryCandidateStore(pool);
  const now = new Date('2026-09-11T00:00:00.000Z');

  beforeAll(() => store.migrate());
  beforeEach(async () => {
    await pool.query('DELETE FROM agent_runs WHERE run_id = $1', ['recovery-1']);
    await pool.query(
      `INSERT INTO agent_runs (run_id, agent_id, state, input, version, metadata, recovery_state, recovery_attempts, next_attempt_at)
       VALUES ('recovery-1', 'investment-agent', 'RUNNING', '{}', 0, $1::jsonb, 'IN_PROGRESS', 0, $2)`,
      [JSON.stringify({ recovery_request: request }), now],
    );
  });
  afterAll(() => pool.end());

  it('discovers only eligible candidates in deterministic order', async () => {
    const candidates = await store.findRecoverableCandidates(10, now);
    expect(candidates.map((candidate) => candidate.runId)).toEqual(['recovery-1']);
    expect(candidates[0]?.request.idempotencyKey).toBe('idem-recovery-1');
  });

  it('allows exactly one concurrent owner to claim a candidate', async () => {
    const [first, second] = await Promise.all([
      store.claimRecoveryCandidate('recovery-1', 'worker-a', 'token-a', 30_000, now),
      store.claimRecoveryCandidate('recovery-1', 'worker-b', 'token-b', 30_000, now),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    const row = await pool.query('SELECT recovery_owner, recovery_lease_token FROM agent_runs WHERE run_id = $1', ['recovery-1']);
    expect(row.rows[0].recovery_owner).toMatch(/^worker-[ab]$/);
  });

  it('renews an active lease only for its owner and token', async () => {
    const lease = await store.claimRecoveryCandidate('recovery-1', 'worker-a', 'token-a', 30_000, now);
    expect(lease).not.toBeNull();
    const renewed = await store.renewRecoveryLease('recovery-1', 'worker-a', 'token-a', 60_000, new Date(now.getTime() + 10_000));
    const rejected = await store.renewRecoveryLease('recovery-1', 'worker-b', 'token-a', 60_000, new Date(now.getTime() + 10_000));
    const row = await pool.query('SELECT recovery_owner, recovery_lease_token, recovery_lease_expires_at FROM agent_runs WHERE run_id = $1', ['recovery-1']);
    expect(renewed).toBe(true);
    expect(rejected).toBe(false);
    expect(row.rows[0]).toMatchObject({ recovery_owner: 'worker-a', recovery_lease_token: 'token-a' });
    expect(new Date(row.rows[0].recovery_lease_expires_at).getTime()).toBe(now.getTime() + 70_000);
  });

  it('reclaims an expired lease and allows a new owner to claim', async () => {
    const expired = new Date(now.getTime() - 1_000);
    await pool.query(
      `UPDATE agent_runs SET recovery_owner = 'dead-worker', recovery_lease_token = 'dead-token', recovery_lease_expires_at = $2 WHERE run_id = $1`,
      ['recovery-1', expired],
    );
    expect(await store.reclaimExpiredRecoveryCandidates(now)).toBe(1);
    const lease = await store.claimRecoveryCandidate('recovery-1', 'worker-live', 'live-token', 30_000, now);
    expect(lease?.owner).toBe('worker-live');
  });

  it('applies bounded exponential backoff and terminal classification', async () => {
    const lease = await store.claimRecoveryCandidate('recovery-1', 'worker-a', 'token-a', 30_000, now);
    expect(lease).not.toBeNull();
    expect(await store.recordRecoveryFailure({ runId: 'recovery-1', owner: 'worker-a', leaseToken: 'token-a', retryable: true, error: new Error('temporary'), now, maxAttempts: 3, baseBackoffMs: 1_000, maxBackoffMs: 2_000 })).toBe('FAILED_RETRYABLE');
    let row = await pool.query('SELECT recovery_attempts, recovery_state, next_attempt_at FROM agent_runs WHERE run_id = $1', ['recovery-1']);
    expect(row.rows[0].recovery_attempts).toBe(1);
    expect(new Date(row.rows[0].next_attempt_at).getTime()).toBe(now.getTime() + 1_000);

    const lease2 = await store.claimRecoveryCandidate('recovery-1', 'worker-a', 'token-b', 30_000, new Date(now.getTime() + 1_000));
    expect(lease2).not.toBeNull();
    expect(await store.recordRecoveryFailure({ runId: 'recovery-1', owner: 'worker-a', leaseToken: 'token-b', retryable: true, error: new Error('temporary'), now: new Date(now.getTime() + 1_000), maxAttempts: 2, baseBackoffMs: 1_000, maxBackoffMs: 1_500 })).toBe('FAILED_FINAL');
    row = await pool.query('SELECT recovery_attempts, recovery_state FROM agent_runs WHERE run_id = $1', ['recovery-1']);
    expect(row.rows[0]).toMatchObject({ recovery_attempts: 2, recovery_state: 'FAILED_FINAL' });
  });
});
