import { describe, expect, it, vi } from 'vitest';
import { ToolExecutionService } from '@agent-native/tool-runtime';
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
  runId: 'run-1', owner: 'worker-1', leaseToken: 'token-1',
  leaseExpiresAt: new Date(Date.now() + 30_000), attempts: 0, request, state: 'IN_PROGRESS',
};

function storeMock(): RecoveryCandidateStore {
  return {
    findRecoverableCandidates: vi.fn().mockResolvedValue([{ runId: lease.runId, attempts: lease.attempts }]),
    claimRecoveryCandidate: vi.fn().mockResolvedValue(lease),
    renewRecoveryLease: vi.fn().mockResolvedValue(true),
    reclaimExpiredRecoveryCandidates: vi.fn().mockResolvedValue(0),
    completeRecovery: vi.fn().mockResolvedValue(true),
    recordRecoveryFailure: vi.fn().mockResolvedValue({ state: 'FAILED_RETRYABLE', attempts: 1, nextAttemptAt: new Date('2026-09-11T00:00:01.000Z') }),
    migrate: vi.fn().mockResolvedValue(undefined),
  } as unknown as RecoveryCandidateStore;
}

describe('RecoveryWorker', () => {
  it('recovers only candidates it successfully claims and acknowledges completion', async () => {
    const store = storeMock();
    const execute = vi.fn().mockResolvedValue({ reservationId: 'res-1' });
    const service = new ToolExecutionService({
      authorize: async () => true,
      execute,
      store: { reserve: vi.fn().mockResolvedValue({ kind: 'RESERVED', state: 'IN_PROGRESS' }), get: vi.fn(), commit: vi.fn().mockResolvedValue(undefined), fail: vi.fn().mockResolvedValue(undefined) },
    });
    const coordinator = new RecoveryCoordinator(service);
    const worker = new RecoveryWorker(store, coordinator, 'worker-1');

    const result = await worker.runOnce(new Date('2026-09-11T00:00:00.000Z'));

    expect(result).toMatchObject({ recovered: 1, skipped: 0, failed: 0 });
    expect(result.outcomes).toEqual([{
      candidateId: 'run-1', attempt: 1, owner: 'worker-1', classification: 'SUCCEEDED', nextAttemptAt: null,
    }]);
    expect(store.claimRecoveryCandidate).toHaveBeenCalledWith('run-1', 'worker-1', expect.any(String), expect.any(Number), expect.any(Date));
    expect(store.completeRecovery).toHaveBeenCalledWith('run-1', 'worker-1', 'token-1');
    expect(execute).toHaveBeenCalledWith(request);
  });

  it('replays a prior idempotent effect after restart without invoking the business effect twice', async () => {
    const store = storeMock();
    const execute = vi.fn().mockResolvedValue({ reservationId: 'should-not-run' });
    const service = new ToolExecutionService({
      authorize: async () => true,
      execute,
      store: {
        reserve: vi.fn().mockResolvedValue({ kind: 'REPLAY', state: 'SUCCEEDED', output: { reservationId: 'res-existing' } }),
        get: vi.fn(),
        commit: vi.fn(),
        fail: vi.fn(),
      },
    });
    const worker = new RecoveryWorker(store, new RecoveryCoordinator(service), 'worker-restarted');

    const result = await worker.runOnce(new Date('2026-09-11T00:00:00.000Z'));

    expect(result.outcomes[0]).toEqual({
      candidateId: 'run-1', attempt: 1, owner: 'worker-restarted', classification: 'SUCCEEDED', nextAttemptAt: null,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(store.completeRecovery).toHaveBeenCalledWith('run-1', 'worker-1', 'token-1');
  });

  it('does not execute when another worker owns the candidate', async () => {
    const store = storeMock();
    vi.mocked(store.claimRecoveryCandidate).mockResolvedValue(null);
    const coordinator = { recover: vi.fn() } as unknown as RecoveryCoordinator;
    const worker = new RecoveryWorker(store, coordinator, 'worker-2');

    const result = await worker.runOnce(new Date('2026-09-11T00:00:00.000Z'));

    expect(result).toMatchObject({ recovered: 0, skipped: 1, failed: 0 });
    expect(result.outcomes).toEqual([{
      candidateId: 'run-1', attempt: 1, owner: 'worker-2', classification: 'SKIPPED', nextAttemptAt: null,
    }]);
    expect(coordinator.recover).not.toHaveBeenCalled();
  });

  it('records retryable failures and emits the durable retry schedule', async () => {
    const store = storeMock();
    const error = new Error('temporary upstream failure');
    const nextAttemptAt = new Date('2026-09-11T00:00:01.000Z');
    vi.mocked(store.recordRecoveryFailure).mockResolvedValue({ state: 'FAILED_RETRYABLE', attempts: 1, nextAttemptAt });
    const coordinator = { recover: vi.fn().mockRejectedValue(error) } as unknown as RecoveryCoordinator;
    const worker = new RecoveryWorker(store, coordinator, 'worker-1');

    const result = await worker.runOnce(new Date('2026-09-11T00:00:00.000Z'));

    expect(result).toMatchObject({ recovered: 0, skipped: 0, failed: 1 });
    expect(result.outcomes).toEqual([{
      candidateId: 'run-1', attempt: 1, owner: 'worker-1', classification: 'FAILED_RETRYABLE', nextAttemptAt,
    }]);
    expect(store.recordRecoveryFailure).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1', owner: 'worker-1', leaseToken: 'token-1', retryable: true, error }));
  });

  it('treats a completion race as recoverable work instead of acknowledging a lost lease', async () => {
    const store = storeMock();
    vi.mocked(store.completeRecovery).mockResolvedValue(false);
    const coordinator = { recover: vi.fn().mockResolvedValue(undefined) } as unknown as RecoveryCoordinator;
    const worker = new RecoveryWorker(store, coordinator, 'worker-1');

    const result = await worker.runOnce(new Date('2026-09-11T00:00:00.000Z'));

    expect(result).toMatchObject({ recovered: 0, skipped: 0, failed: 1 });
    expect(coordinator.recover).toHaveBeenCalledWith({ request, state: 'IN_PROGRESS' });
    expect(store.recordRecoveryFailure).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1', owner: 'worker-1', leaseToken: 'token-1', retryable: true }));
    expect(result.outcomes[0]?.classification).toBe('FAILED_RETRYABLE');
  });
});
