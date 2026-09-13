import { describe, expect, it, vi } from 'vitest';
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
    const service = {
      execute: vi.fn().mockResolvedValue({ output: { ok: true }, replayed: true } satisfies ToolExecutionResult),
      logger,
      correlation: { requestId: 'req-1', traceId: 'trace-1', tenantId: 'tenant-1', runId: 'run-1', agentId: 'investment-worker' },
    } as unknown as ToolExecutionService;
    const candidate: RecoveryCandidate = { request, state: 'FAILED_RETRYABLE' };

    await new RecoveryCoordinator(service).recover(candidate);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'recovery.claimed' }),
      expect.objectContaining({ event: 'recovery.completed' }),
    ]));
    expect(JSON.stringify(events)).not.toContain('company-1');
  });
});
