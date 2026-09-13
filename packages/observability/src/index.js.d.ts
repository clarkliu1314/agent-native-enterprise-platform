// RED-gate declaration only. Remove when index.ts implementation is introduced.
export type CorrelationContext = {
  requestId: string;
  traceId: string;
  tenantId: string;
  runId?: string;
  workflowId?: string;
  agentId?: string;
  actorId?: string;
};
export type ObservabilityLogger = { emit: (event: unknown) => void };
export declare function createStructuredLogEvent(input: {
  context: CorrelationContext;
  event: string;
  level: string;
  outcome?: string;
}): { context: CorrelationContext; event: string; timestamp: string };
export declare function safeEmit(logger: ObservabilityLogger, event: unknown): void;
