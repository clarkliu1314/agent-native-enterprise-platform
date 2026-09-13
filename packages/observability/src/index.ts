import { sanitizeAttributes } from './sanitizer.js';

export type CorrelationContext = {
  requestId: string;
  traceId: string;
  tenantId: string;
  runId?: string;
  workflowId?: string;
  agentId?: string;
  actorId?: string;
};

export type ObservabilityEventName =
  | 'api.accepted' | 'api.rejected'
  | 'run.started' | 'run.waiting' | 'run.succeeded' | 'run.failed' | 'run.cancelled'
  | 'tool.started' | 'tool.succeeded' | 'tool.failed' | 'tool.replayed' | 'tool.rejected'
  | 'recovery.claimed' | 'recovery.reclaimed' | 'recovery.retry_scheduled' | 'recovery.failed_final' | 'recovery.completed'
  | 'outbox.published' | 'outbox.failed' | 'outbox.retried';

export type ObservabilityLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
export type ObservabilityOutcome = 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'REJECTED' | 'RETRYING';

export type StructuredLogEvent = {
  timestamp: string;
  event: ObservabilityEventName;
  level: ObservabilityLogLevel;
  context: CorrelationContext;
  outcome?: ObservabilityOutcome;
  durationMs?: number;
  errorCode?: string;
  attributes?: Record<string, string | number | boolean | null>;
};

export type ObservabilityLogger = { emit: (event: StructuredLogEvent) => void };

export type ObservabilityMetrics = {
  increment(name: string, value?: number, attributes?: Record<string, string>): void;
  observe(name: string, value: number, attributes?: Record<string, string>): void;
  gauge(name: string, value: number, attributes?: Record<string, string>): void;
};

const EVENT_NAMES = new Set<ObservabilityEventName>([
  'api.accepted', 'api.rejected',
  'run.started', 'run.waiting', 'run.succeeded', 'run.failed', 'run.cancelled',
  'tool.started', 'tool.succeeded', 'tool.failed', 'tool.replayed', 'tool.rejected',
  'recovery.claimed', 'recovery.reclaimed', 'recovery.retry_scheduled', 'recovery.failed_final', 'recovery.completed',
  'outbox.published', 'outbox.failed', 'outbox.retried',
]);

function assertCorrelation(context: CorrelationContext): void {
  if (!context.requestId || !context.traceId || !context.tenantId) throw new Error('observability event requires requestId, traceId, and tenantId');
}

export function createStructuredLogEvent(input: {
  context: CorrelationContext;
  event: string;
  level: ObservabilityLogLevel;
  outcome?: ObservabilityOutcome;
  durationMs?: number;
  errorCode?: string;
  attributes?: Record<string, unknown>;
}): StructuredLogEvent {
  assertCorrelation(input.context);
  if (!EVENT_NAMES.has(input.event as ObservabilityEventName)) throw new Error(`Unknown observability event: ${input.event}`);
  const attributes = sanitizeAttributes(input.attributes ?? {});
  return {
    timestamp: new Date().toISOString(),
    event: input.event as ObservabilityEventName,
    level: input.level,
    context: { ...input.context },
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    ...(Object.keys(attributes).length === 0 ? {} : { attributes }),
  };
}

export function safeEmit(logger: ObservabilityLogger, event: StructuredLogEvent): void {
  try { logger.emit(event); } catch { /* telemetry must never make the business path fail */ }
}

export function safeMetric(operation: () => void): void {
  try { operation(); } catch { /* telemetry must never make the business path fail */ }
}
