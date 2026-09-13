import { describe, expect, it } from 'vitest';
import {
  assertBoundedMetricLabels,
  MemoryObservabilityMetrics,
} from './testing.js';

describe('observability metrics contract', () => {
  it('rejects unbounded identifiers as metric labels', () => {
    expect(() => assertBoundedMetricLabels({ runId: 'run-1' })).toThrow(
      /unbounded metric label/i,
    );
    expect(() => assertBoundedMetricLabels({ traceId: 'trace-1' })).toThrow(
      /unbounded metric label/i,
    );
  });

  it('accepts bounded operational labels', () => {
    expect(() =>
      assertBoundedMetricLabels({
        agent: 'investment-worker',
        state: 'RUNNING',
        outcome: 'SUCCEEDED',
        error_code: 'INTERNAL_ERROR',
      }),
    ).not.toThrow();
  });

  it('records counters, observations, and gauges without requiring a vendor SDK', () => {
    const metrics = new MemoryObservabilityMetrics();
    metrics.increment('agent_run_started_total', 1, { state: 'QUEUED' });
    metrics.observe('agent_outbox_lag_ms', 25, { outcome: 'SUCCEEDED' });
    metrics.gauge('agent_run_waiting_ms', 50, { state: 'WAITING' });

    expect(metrics.entries()).toHaveLength(3);
  });
});
