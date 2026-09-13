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
  | 'api.accepted'
  | 'run.started'
  | 'run.succeeded'
  | 'run.failed'
  | 'tool.started'
  | 'tool.succeeded'
  | 'tool.failed'
  | 'recovery.attempted'
  | 'outbox.published';

export type ObservabilityLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export type StructuredLogEvent = {
  timestamp: string;
  event: ObservabilityEventName;
  level: ObservabilityLogLevel;
  context: CorrelationContext;
  outcome?: string;
  attributes?: Record<string, string | number | boolean | null>;
};

export type ObservabilityLogger = {
  emit: (event: StructuredLogEvent) => void;
};

const EVENT_NAMES = new Set<ObservabilityEventName>([
  'api.accepted',
  'run.started',
  'run.succeeded',
  'run.failed',
  'tool.started',
  'tool.succeeded',
  'tool.failed',
  'recovery.attempted',
  'outbox.published',
]);

function assertCorrelation(context: CorrelationContext): void {
  if (!context.requestId || !context.traceId || !context.tenantId) {
    throw new Error('observability event requires requestId, traceId, and tenantId');
  }
}

export function createStructuredLogEvent(input: {
  context: CorrelationContext;
  event: string;
  level: ObservabilityLogLevel;
  outcome?: string;
  attributes?: Record<string, unknown>;
}): StructuredLogEvent {
  assertCorrelation(input.context);
  if (!EVENT_NAMES.has(input.event as ObservabilityEventName)) {
    throw new Error(`Unknown observability event: ${input.event}`);
  }
  const attributes = sanitizeAttributes(input.attributes ?? {});
  return {
    timestamp: new Date().toISOString(),
    event: input.event as ObservabilityEventName,
    level: input.level,
    context: { ...input.context },
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
    ...(Object.keys(attributes).length === 0 ? {} : { attributes }),
  };
}

export function safeEmit(logger: ObservabilityLogger, event: StructuredLogEvent): void {
  try {
    logger.emit(event);
  } catch {
    // Telemetry must never make the business path fail.
  }
}
