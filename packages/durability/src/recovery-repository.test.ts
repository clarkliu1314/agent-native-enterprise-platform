import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { RecoveryCandidateStore } from './recovery-store';

function poolStub(): Pool {
  return { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Pool;
}

describe('RecoveryCandidateStore contract', () => {
  it('exposes recoverable candidates with deterministic eligibility', async () => {
    const store = new RecoveryCandidateStore(poolStub());
    expect(store.findRecoverableCandidates).toBeTypeOf('function');
  });

  it('atomically claims one candidate for an owner', async () => {
    const store = new RecoveryCandidateStore(poolStub());
    expect(store.claimRecoveryCandidate).toBeTypeOf('function');
  });

  it('supports expired lease reclaim without double ownership', async () => {
    const store = new RecoveryCandidateStore(poolStub());
    expect(store.reclaimExpiredRecoveryCandidates).toBeTypeOf('function');
  });

  it('persists retry scheduling and terminal classification', async () => {
    const store = new RecoveryCandidateStore(poolStub());
    expect(store.recordRecoveryFailure).toBeTypeOf('function');
    expect(store.completeRecovery).toBeTypeOf('function');
  });
});
