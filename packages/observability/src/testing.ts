import type { SafeScalar } from './sanitizer.js';

export type MetricLabels = Record<string, string>;

const UNBOUNDED_LABELS = new Set(['runId', 'traceId', 'requestId', 'workflowId', 'actorId']);
const BOUNDED_LABELS = new Set(['tenant', 'agent', 'state', 'tool', 'outcome', 'error_code', 'slo']);
const CANONICAL_METRIC_NAMES = new Set([
  'agent_run_started_total',
  'agent_run_completed_total',
  'agent_run_failed_total',
  'agent_tool_execution_total',
  'agent_tool_execution_failed_total',
  'agent_recovery_attempt_total',
  'agent_recovery_retry_total',
  'agent_recovery_terminal_failure_total',
  'agent_outbox_publish_total',
  'agent_outbox_publish_failed_total',
  'agent_outbox_lag_ms',
  'agent_run_waiting_ms',
  'agent_slo_compliance_ratio',
  'agent_error_budget_remaining_ratio',
  'agent_slo_burn_rate',
]);

export function assertBoundedMetricLabels(labels: MetricLabels): void {
  for (const key of Object.keys(labels)) {
    if (UNBOUNDED_LABELS.has(key) || !BOUNDED_LABELS.has(key)) {
      throw new Error(`Unbounded metric label: ${key}`);
    }
  }
}

export function assertCanonicalMetricName(name: string): void {
  if (!CANONICAL_METRIC_NAMES.has(name)) throw new Error(`Non-canonical metric name: ${name}`);
}

export type MetricEntry = {
  kind: 'counter' | 'observation' | 'gauge';
  name: string;
  value: number;
  labels: MetricLabels;
};

export class MemoryObservabilityMetrics {
  private readonly recorded: MetricEntry[] = [];

  increment(name: string, value = 1, labels: MetricLabels = {}): void {
    assertCanonicalMetricName(name);
    assertBoundedMetricLabels(labels);
    this.recorded.push({ kind: 'counter', name, value, labels: { ...labels } });
  }

  observe(name: string, value: number, labels: MetricLabels = {}): void {
    assertCanonicalMetricName(name);
    assertBoundedMetricLabels(labels);
    this.recorded.push({ kind: 'observation', name, value, labels: { ...labels } });
  }

  gauge(name: string, value: number, labels: MetricLabels = {}): void {
    assertCanonicalMetricName(name);
    assertBoundedMetricLabels(labels);
    this.recorded.push({ kind: 'gauge', name, value, labels: { ...labels } });
  }

  entries(): MetricEntry[] {
    return this.recorded.map((entry) => ({ ...entry, labels: { ...entry.labels } }));
  }
}
