import { describe, expect, it } from 'vitest';
import { MemoryObservabilityMetrics } from './testing.js';

describe('canonical observability metrics', () => {
  it('records the canonical run lifecycle metrics', () => {
    const metrics = new MemoryObservabilityMetrics();
    metrics.increment('agent_run_started_total', 1, { state: 'RUNNING' });
    metrics.increment('agent_run_completed_total', 1, { outcome: 'SUCCEEDED' });
    metrics.increment('agent_run_failed_total', 1, { error_code: 'INTERNAL_ERROR' });

    expect(metrics.entries()).toEqual([
      { kind: 'counter', name: 'agent_run_started_total', value: 1, labels: { state: 'RUNNING' } },
      { kind: 'counter', name: 'agent_run_completed_total', value: 1, labels: { outcome: 'SUCCEEDED' } },
      { kind: 'counter', name: 'agent_run_failed_total', value: 1, labels: { error_code: 'INTERNAL_ERROR' } },
    ]);
  });

  it('records tool, recovery, and outbox metrics using canonical names', () => {
    const metrics = new MemoryObservabilityMetrics();
    metrics.increment('agent_tool_execution_total', 1, { tool: 'crm.create_company', outcome: 'SUCCEEDED' });
    metrics.increment('agent_tool_execution_failed_total', 1, { tool: 'crm.create_company', error_code: 'INTERNAL_ERROR' });
    metrics.increment('agent_recovery_attempt_total', 1, { outcome: 'RETRYING' });
    metrics.increment('agent_recovery_retry_total', 1, { outcome: 'RETRYING' });
    metrics.increment('agent_recovery_terminal_failure_total', 1, { outcome: 'FAILED' });
    metrics.increment('agent_outbox_publish_total', 1, { outcome: 'PUBLISHED' });
    metrics.increment('agent_outbox_publish_failed_total', 1, { error_code: 'OUTBOX_PUBLISH_FAILED' });

    expect(metrics.entries()).toHaveLength(7);
  });

  it('keeps correlation identifiers out of metric labels', () => {
    const metrics = new MemoryObservabilityMetrics();
    expect(() => metrics.increment('agent_run_started_total', 1, { runId: 'run-1' })).toThrow(/unbounded metric label/i);
    expect(() => metrics.increment('agent_run_started_total', 1, { requestId: 'req-1' })).toThrow(/unbounded metric label/i);
    expect(() => metrics.increment('agent_run_started_total', 1, { traceId: 'trace-1' })).toThrow(/unbounded metric label/i);
  });
});
