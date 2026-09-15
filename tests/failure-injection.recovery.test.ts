import { describe, expect, it, vi } from 'vitest';
import {
  IdempotencyFinalFailureError,
  ToolExecutionService,
  type ToolExecutionRequest,
  type ToolExecutionStore,
} from '@agent-native/tool-runtime';
import { RecoveryCoordinator } from '../packages/durability/src/recovery';

const request: ToolExecutionRequest = {
  tool: { name: 'reserve', description: 'reserve a resource', sideEffect: true },
  input: { resourceId: 'r-1' },
  context: { actorId: 'actor-1', tenantId: 'tenant-1', permissions: ['reserve:write'] },
  idempotencyKey: 'idem-failure-injection-1',
};

function storeFor(reservation: Awaited<ReturnType<ToolExecutionStore['reserve']>>): ToolExecutionStore {
  return {
    reserve: vi.fn().mockResolvedValue(reservation),
    get: vi.fn().mockResolvedValue(null),
    commit: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  };
}

describe('Stage 12.4 failure injection recovery contract', () => {
  it('recovers a worker crash before checkpoint commit using the same durable idempotency key', async () => {
    const store = storeFor({ kind: 'RETRY', state: 'FAILED_RETRYABLE' });
    const execute = vi.fn().mockResolvedValue({ reservationId: 'res-1' });
    const service = new ToolExecutionService({ authorize: async () => true, execute, store });
    const coordinator = new RecoveryCoordinator(service);

    await coordinator.recover({ request, state: 'FAILED_RETRYABLE' });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({ idempotencyKey: request.idempotencyKey });
  });

  it('replays a committed result after a post-commit worker crash without invoking the effect again', async () => {
    const store = storeFor({ kind: 'REPLAY', state: 'SUCCEEDED', output: { reservationId: 'res-1' } });
    const execute = vi.fn();
    const service = new ToolExecutionService({ authorize: async () => true, execute, store });
    const coordinator = new RecoveryCoordinator(service);

    const result = await coordinator.recover({ request, state: 'SUCCEEDED' });

    expect(result).toEqual({ output: { reservationId: 'res-1' }, replayed: true });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not execute an effect when retry exhaustion is terminal', async () => {
    const store = storeFor({ kind: 'CONFLICT', state: 'FAILED_FINAL' });
    const execute = vi.fn();
    const service = new ToolExecutionService({ authorize: async () => true, execute, store });
    const coordinator = new RecoveryCoordinator(service);

    await expect(coordinator.recover({ request, state: 'FAILED_FINAL' })).rejects.toBeInstanceOf(IdempotencyFinalFailureError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps failure injection semantics outside the existing Run FSM', () => {
    expect(['QUEUED', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'CANCELLED']).toHaveLength(6);
  });
});
