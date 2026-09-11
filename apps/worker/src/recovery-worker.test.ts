import { describe, expect, it, vi } from 'vitest';
import type { RecoveryCandidateStore, RecoveryLease } from '@agent-native/durability';
import { RecoveryCoordinator } from '@agent-native/durability';
import { RecoveryWorker } from './recovery-worker';

const request = {
  tool: { name: 'reserve', description: 'reserve', sideEffect: true },
  input: { resourceId: 'r-1' },
  context: { actorId: 'a-1', tenantId: 't-1', permissions: ['reserve:write'] },
  idempotencyKey: 'idem-1',
};

const lease: RecoveryLease = {
  runId: 'run-1',
  owner: 'worker-1',
  leaseToken: 'token-1',
  leaseExpiresAt: new Date(Date.now() + 30_000),
  attempts: 0,
  request,
  state: 'IN_PROGRESS',
};

function storeMock(): RecoveryCandidateStore {
  return {
    findRecoverableCandidates: vi.fn().mockResolvedValue([{ runId: lease.runId }]),
    claimRecoveryCandidate: vi.fn().mockResolvedValue(lease),
    reclaimExpiredRecoveryCandidates: vi.fn().mockResolvedValue(0),
    completeRecovery: vi.fn().mockResolvedValue(true),
    recordRecoveryFailure: vi.fn(),
    migrate: vi.fn(),
  } as unknown as RecoveryCandidateStore;
}

describe('RecoveryWorker', () => {
  it('recovers only candidates it successfully claims and acknowledges completion', async () => {
    const store = storeMock();
    const execute = vi.fn().mockResolvedValue({ reservationId: 'res-1' });
    const coordinator = new RecoveryCoordinator({
      authorize: async () => true,
      execute,
      store: {
        reserve: vi.fn().mockResolvedValue({ kind: 'RESERVED', state: 'IN_PROGRESS' }),
        get: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn().mockResolvedValue(undefined),
      },
    });
    const worker = new RecoveryWorker(store, coordinator, 'worker-1');

    const result = await worker.runOnce();

    expect(result).toEqual({ recovered: 1, skipped: 0 });
    expect(store.claimRecoveryCandidate).toHaveBeenCalledWith('run-1', 'worker-1', expect.any(String), expect.any(Number), expect.any(Date));
    expect(store.completeRecovery).toHaveBeenCalledWith('run-1', 'worker-1', 'token-1');
    expect(execute).toHaveBeenCalledWith(request);
  });

  it('does not execute when another worker owns the candidate', async () => {
    const store = storeMock();
    vi.mocked(store.claimRecoveryCandidate).mockResolvedValue(null);
    const coordinator = { recover: vi.fn() } as unknown as RecoveryCoordinator;
    const worker = new RecoveryWorker(store, coordinator, 'worker-2');

    const result = await worker.runOnce();

    expect(result).toEqual({ recovered: 0, skipped: 1 });
    expect(coordinator.recover).not.toHaveBeenCalled();
  });

  it('records retryable failures and releases the lease', async () => {
    const store = storeMock();
    const error = new Error('temporary upstream failure');
    const coordinator = { recover: vi.fn().mockRejectedValue(error) } as unknown as RecoveryCoordinator;
    const worker = new RecoveryWorker(store, coordinator, 'worker-1');

    await expect(worker.runOnce()).rejects.toThrow('temporary upstream failure');

    expect(store.recordRecoveryFailure).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1', owner: 'worker-1', leaseToken: 'token-1', retryable: true, error,
    }));
  });
});
