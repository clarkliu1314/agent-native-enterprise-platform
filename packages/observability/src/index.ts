import { sanitizeAttributes } from './sanitizer.js';
export { sanitizeAttributes, type SafeScalar } from './sanitizer.js';
export { MemoryObservabilityMetrics, assertBoundedMetricLabels, assertCanonicalMetricName, type MetricEntry, type MetricLabels } from './testing.js';
export { SLO_TARGETS, calculateErrorBudget, classifyBurnRate, type BurnRateClass } from './slo-policy.js';
export { calculateRatio, calculateBurnRate, calculateErrorBudgetRemaining } from './slo-measurements.js';
export { emitSloSnapshot, type SloMeasurement, type SloName, type SloSnapshot } from './slo-metrics.js';

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
export type ObservabilityOutcome = 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'REJECTED' | 'RETRYING' | 'PUBLISHED';

export type StableErrorCode =
  | 'AUTHORIZATION_DENIED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'STALE_FENCING_TOKEN'
  | 'RUN_NOT_FOUND'
  | 'INVALID_STATE_TRANSITION'
  | 'RECOVERY_LEASE_LOST'
  | 'RECOVERY_RETRYABLE'
  | 'RECOVERY_FINAL'
  | 'OUTBOX_PUBLISH_FAILED'
  | 'INTERNAL_ERROR';

export type StructuredLogEvent = {
  timestamp: string;
  event: ObservabilityEventName;
  level: ObservabilityLogLevel;
  context: CorrelationContext;
  outcome?: ObservabilityOutcome;
  durationMs?: number;
  errorCode?: StableErrorCode;
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

const STABLE_ERROR_CODES = new Set<StableErrorCode>([
  'AUTHORIZATION_DENIED',
  'IDEMPOTENCY_CONFLICT',
  'STALE_FENCING_TOKEN',
  'RUN_NOT_FOUND',
  'INVALID_STATE_TRANSITION',
  'RECOVERY_LEASE_LOST',
  'RECOVERY_RETRYABLE',
  'RECOVERY_FINAL',
  'OUTBOX_PUBLISH_FAILED',
  'INTERNAL_ERROR',
]);

function assertCorrelation(context: CorrelationContext): void {
  if (!context.requestId || !context.traceId || !context.tenantId) throw new Error('observability event requires requestId, traceId, and tenantId');
}

export function classifyError(error: unknown): StableErrorCode {
  if (!(error instanceof Error)) return 'INTERNAL_ERROR';
  const explicitCode = (error as Error & { code?: unknown }).code;
  if (typeof explicitCode === 'string' && STABLE_ERROR_CODES.has(explicitCode as StableErrorCode)) {
    return explicitCode as StableErrorCode;
  }
  switch (error.name) {
    case 'ToolPermissionDeniedError': return 'AUTHORIZATION_DENIED';
    case 'IdempotencyConflictError':
    case 'IdempotencyInProgressError':
    case 'IdempotencyFinalFailureError': return 'IDEMPOTENCY_CONFLICT';
    case 'StaleFencingTokenError': return 'STALE_FENCING_TOKEN';
    case 'RunNotFoundError': return 'RUN_NOT_FOUND';
    case 'InvalidStateTransitionError': return 'INVALID_STATE_TRANSITION';
    case 'RecoveryLeaseLostError': return 'RECOVERY_LEASE_LOST';
    case 'NonRetryableToolError': return 'RECOVERY_FINAL';
    case 'OutboxPublishError': return 'OUTBOX_PUBLISH_FAILED';
    default: return 'INTERNAL_ERROR';
  }
}

export function createStructuredLogEvent(input: {
  context: CorrelationContext;
  event: string;
  level: ObservabilityLogLevel;
  outcome?: ObservabilityOutcome;
  durationMs?: number;
  errorCode?: StableErrorCode;
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
