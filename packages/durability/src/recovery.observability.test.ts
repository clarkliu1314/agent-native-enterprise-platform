import { describe, expect, it, vi } from 'vitest';
import { MemoryObservabilityMetrics } from '@agent-native/observability';
import { RecoveryCoordinator, type RecoveryCandidate } from './recovery';
import type { ToolExecutionRequest, ToolExecutionResult, ToolExecutionService } from '@agent-native/tool-runtime';
import type { ObservabilityLogger } from '@agent-native/observability';

describe('RecoveryCoordinator observability', () => {
  it('emits recovery lifecycle events while preserving correlation context', async () => {
    const events: unknown[] = [];
    const logger: ObservabilityLogger = { emit: (event) => events.push(event) };
    const request: ToolExecutionRequest = {
      tool: { name: 'lookup-company', description: 'lookup', sideEffect: false },
      input: { companyId: 'company-1' },
      context: { actorId: 'actor-1', tenantId: 'tenant-1', permissions: ['tool:read'] },
      idempotencyKey: 'idem-recovery-1',
    };
    const service = { execute: vi.fn().mockResolvedValue({ output: { ok: true }, replayed: true } satisfies ToolExecutionResult) } as unknown as ToolExecutionService;
    const candidate: RecoveryCandidate = { request, state: 'FAILED_RETRYABLE' };

    await new RecoveryCoordinator(service, {
      logger,
      correlation: { requestId: 'req-1', traceId: 'trace-1', tenantId: 'tenant-1', runId: 'run-1', agentId: 'investment-worker' },
    }).recover(candidate);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'recovery.claimed' }),
      expect.objectContaining({ event: 'recovery.completed' }),
    ]));
    expect(JSON.stringify(events)).not.toContain('company-1');
  });

  it('records retry recovery metrics without high-cardinality labels', async () => {
    const metrics = new MemoryObservabilityMetrics();
    const request: ToolExecutionRequest = {
      tool: { name: 'lookup-company', description: 'lookup', sideEffect: false },
      input: {},
      context: { actorId: 'actor-1', tenantId: 'tenant-1', permissions: ['tool:read'] },
      idempotencyKey: 'idem-recovery-metrics',
    };
    const service = { execute: vi.fn().mockResolvedValue({ output: { ok: true }, replayed: true } satisfies ToolExecutionResult) } as unknown as ToolExecutionService;

    await new RecoveryCoordinator(service, {
      metrics,
      correlation: { requestId: 'req-1', traceId: 'trace-1', tenantId: 'tenant-1', runId: 'run-1' },
    }).recover({ request, state: 'FAILED_RETRYABLE' });

    expect(metrics.entries()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'agent_recovery_attempt_total', labels: expect.objectContaining({ outcome: 'RETRYING' }) }),
      expect.objectContaining({ name: 'agent_recovery_retry_total', labels: expect.objectContaining({ outcome: 'RETRYING' }) }),
    ]));
  });
});
