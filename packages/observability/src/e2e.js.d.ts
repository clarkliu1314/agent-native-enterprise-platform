// RED-gate declaration only. Remove when e2e.ts implementation is introduced.
import type { CorrelationContext } from './index.js';
export declare function runObservabilityScenario(input: CorrelationContext & {
  toolName?: string;
  toolInput?: unknown;
  failTelemetry?: boolean;
}): Promise<{
  events: Array<{ event: string; context: CorrelationContext }>;
  serializedTelemetry: string;
  businessResult: { status: string };
  telemetryErrors: number;
}>;
