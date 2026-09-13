import type { SafeScalar } from './sanitizer.js';

export type MetricLabels = Record<string, SafeScalar>;

const UNBOUNDED_LABELS = new Set(['runId', 'traceId', 'requestId', 'workflowId', 'actorId', 'tenantId']);
const BOUNDED_LABELS = new Set(['agent', 'state', 'outcome', 'error_code']);

export function assertBoundedMetricLabels(labels: MetricLabels): void {
  for (const key of Object.keys(labels)) {
    if (UNBOUNDED_LABELS.has(key) || !BOUNDED_LABELS.has(key)) {
      throw new Error(`Unbounded metric label: ${key}`);
    }
  }
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
    assertBoundedMetricLabels(labels);
    this.recorded.push({ kind: 'counter', name, value, labels: { ...labels } });
  }

  observe(name: string, value: number, labels: MetricLabels = {}): void {
    assertBoundedMetricLabels(labels);
    this.recorded.push({ kind: 'observation', name, value, labels: { ...labels } });
  }

  gauge(name: string, value: number, labels: MetricLabels = {}): void {
    assertBoundedMetricLabels(labels);
    this.recorded.push({ kind: 'gauge', name, value, labels: { ...labels } });
  }

  entries(): MetricEntry[] {
    return this.recorded.map((entry) => ({ ...entry, labels: { ...entry.labels } }));
  }
}
