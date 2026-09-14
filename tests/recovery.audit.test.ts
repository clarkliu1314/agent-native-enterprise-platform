import { describe, expect, it, vi } from 'vitest';
import { InMemoryAuditRepository } from '../packages/runtime/src/auditability';
import { RecoveryCoordinator } from '../packages/durability/src/recovery';
import { ToolExecutionService, type ToolExecutionRequest, type ToolExecutionStore } from '../packages/tool-runtime/src/tool-execution';

const request: ToolExecutionRequest = {
  tool: { name: 'reserve', description: 'reserve a resource', sideEffect: true },
  input: { resourceId: 'r-1' },
  context: { actorId: 'actor-1', tenantId: 'tenant-a', permissions: ['reserve:write'] },
  idempotencyKey: 'idem-recovery-1',
};

function storeFor(state: 'IN_PROGRESS' | 'FAILED_FINAL' | 'SUCCEEDED'): ToolExecutionStore {
  return {
    reserve: vi.fn().mockResolvedValue(state === 'SUCCEEDED' ? { kind: 'REPLAY', state: 'SUCCEEDED', output: { reservationId: 'res-1' } } : state === 'FAILED_FINAL' ? { kind: 'CONFLICT', state: 'FAILED_FINAL' } : { kind: 'RETRY', state: 'FAILED_RETRYABLE' }),
    get: vi.fn().mockResolvedValue(null),
    commit: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  };
}

describe('durable recovery auditability', () => {
  it('records a successful recovery outcome as a SYSTEM audit fact', async () => {
    const audit = new InMemoryAuditRepository();
    const execute = vi.fn().mockResolvedValue({ reservationId: 'res-1' });
    const service = new ToolExecutionService({ authorize: async () => true, execute, store: storeFor('IN_PROGRESS') });
    const coordinator = new RecoveryCoordinator(service, { audit });

    await coordinator.recover({ request, state: 'IN_PROGRESS', correlation: { requestId: 'req-1', traceId: 'trace-1', tenantId: 'tenant-a', runId: 'run-1' } });
    const result = await audit.query({ tenantId: 'tenant-a', from: '2026-09-14T00:00:00.000Z', to: '2026-09-15T00:00:00.000Z', limit: 100 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ actorId: 'system', actorType: 'SYSTEM', action: 'RECOVERY_SUCCEEDED', resourceType: 'RUN', resourceId: 'run-1', outcome: 'SUCCEEDED', reasonClass: 'SYSTEM', correlation: { requestId: 'req-1', traceId: 'trace-1', runId: 'run-1' } });
  });

  it('records a terminal recovery outcome as a FAILED SYSTEM audit fact', async () => {
    const audit = new InMemoryAuditRepository();
    const service = new ToolExecutionService({ authorize: async () => true, execute: vi.fn(), store: storeFor('FAILED_FINAL') });
    const coordinator = new RecoveryCoordinator(service, { audit });

    await expect(coordinator.recover({ request, state: 'FAILED_FINAL', correlation: { requestId: 'req-2', traceId: 'trace-2', tenantId: 'tenant-a', runId: 'run-2' } })).rejects.toThrow();
    const result = await audit.query({ tenantId: 'tenant-a', from: '2026-09-14T00:00:00.000Z', to: '2026-09-15T00:00:00.000Z', limit: 100 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ action: 'RECOVERY_FAILED_FINAL', resourceType: 'RUN', resourceId: 'run-2', outcome: 'FAILED', reasonClass: 'SYSTEM' });
  });
});
