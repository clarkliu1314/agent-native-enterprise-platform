import { describe, expect, it, vi } from 'vitest';
import {
  IdempotencyFinalFailureError,
  ToolExecutionService,
  type ToolExecutionRequest,
  type ToolExecutionStore,
} from '@agent-native/tool-runtime';
import { RecoveryCoordinator, type RecoveryCandidate } from './recovery';

const request: ToolExecutionRequest = {
  tool: { name: 'reserve', description: 'reserve a resource', sideEffect: true },
  input: { resourceId: 'r-1' },
  context: { actorId: 'actor-1', tenantId: 'tenant-1', permissions: ['reserve:write'] },
  idempotencyKey: 'idem-1',
};

function storeFor(state: RecoveryCandidate['state'], output?: unknown): ToolExecutionStore {
  return {
    reserve: vi.fn().mockResolvedValue(
      state === 'SUCCEEDED'
        ? { kind: 'REPLAY', state: 'SUCCEEDED', output }
        : state === 'FAILED_FINAL'
          ? { kind: 'CONFLICT', state: 'FAILED_FINAL' }
          : { kind: 'RETRY', state: 'FAILED_RETRYABLE' },
    ),
    get: vi.fn().mockResolvedValue(output ?? null),
    commit: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  };
}

describe('RecoveryCoordinator', () => {
  it('reclaims an abandoned reservation before external execution', async () => {
    const store = storeFor('IN_PROGRESS');
    const execute = vi.fn().mockResolvedValue({ reservationId: 'res-1' });
    const service = new ToolExecutionService({ authorize: async () => true, execute, store });
    const coordinator = new RecoveryCoordinator(service);

    const result = await coordinator.recover({ request, state: 'IN_PROGRESS' });

    expect(result.replayed).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(request);
  });

  it('retries an ambiguous external outcome with the same idempotency key', async () => {
    const store = storeFor('IN_PROGRESS');
    const seenKeys = new Set([request.idempotencyKey]);
    let effects = 1;
    const execute = vi.fn().mockImplementation(async (input: ToolExecutionRequest) => {
      if (!seenKeys.has(input.idempotencyKey)) {
        seenKeys.add(input.idempotencyKey);
        effects += 1;
      }
      return { reservationId: 'res-1' };
    });
    const service = new ToolExecutionService({ authorize: async () => true, execute, store });
    const coordinator = new RecoveryCoordinator(service);

    await coordinator.recover({ request, state: 'IN_PROGRESS' });

    expect(execute.mock.calls[0]?.[0]).toMatchObject({ idempotencyKey: 'idem-1' });
    expect(effects).toBe(1);
  });

  it('replays a committed result without invoking the external tool', async () => {
    const store = storeFor('SUCCEEDED', { reservationId: 'res-1' });
    const execute = vi.fn();
    const service = new ToolExecutionService({ authorize: async () => true, execute, store });
    const coordinator = new RecoveryCoordinator(service);

    const result = await coordinator.recover({ request, state: 'SUCCEEDED', output: { reservationId: 'res-1' } });

    expect(result).toEqual({ output: { reservationId: 'res-1' }, replayed: true });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not retry a terminally failed operation', async () => {
    const store = storeFor('FAILED_FINAL');
    const execute = vi.fn();
    const service = new ToolExecutionService({ authorize: async () => true, execute, store });
    const coordinator = new RecoveryCoordinator(service);

    await expect(coordinator.recover({ request, state: 'FAILED_FINAL' })).rejects.toBeInstanceOf(IdempotencyFinalFailureError);
    expect(execute).not.toHaveBeenCalled();
  });
});
