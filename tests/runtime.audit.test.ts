import { describe, expect, it } from 'vitest';
import type { RunView } from '@agent-native/runtime-contract/durable';

describe('runtime auditability RED gate', () => {
  it('builds a material run-transition audit fact from durable runtime state', async () => {
    const { buildRunAuditRecord } = await import('../packages/runtime/src/auditability');
    const run: RunView = { runId: 'run-1', tenantId: 'tenant-a', state: 'SUCCEEDED', version: 3, fencingToken: 3n, metadata: { workflowId: 'workflow-1', agentId: 'agent-1' } };
    const record = buildRunAuditRecord({ run, from: 'RUNNING', action: 'RUN_SUCCEEDED', actorId: 'system', occurredAt: '2026-09-14T10:00:00.000Z', correlation: { requestId: 'req-1', traceId: 'trace-1' } });
    expect(record).toMatchObject({ tenantId: 'tenant-a', actorId: 'system', actorType: 'SYSTEM', action: 'RUN_SUCCEEDED', resourceType: 'RUN', resourceId: 'run-1', outcome: 'SUCCEEDED', version: 3, correlation: { requestId: 'req-1', traceId: 'trace-1', runId: 'run-1', workflowId: 'workflow-1', agentId: 'agent-1' }, metadata: { fromState: 'RUNNING', resultingState: 'SUCCEEDED' } });
  });
});
