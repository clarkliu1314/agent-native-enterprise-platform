// RED-gate declaration only. Remove when testing.ts implementation is introduced.
export declare function assertBoundedMetricLabels(labels: Record<string, string>): void;
export declare class MemoryObservabilityMetrics {
  increment(name: string, value: number, labels?: Record<string, string>): void;
  observe(name: string, value: number, labels?: Record<string, string>): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
  entries(): unknown[];
}
