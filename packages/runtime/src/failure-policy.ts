export enum FailureClass {
  VALIDATION = 'VALIDATION',
  AUTHORIZATION = 'AUTHORIZATION',
  CONFLICT = 'CONFLICT',
  DEPENDENCY_TRANSIENT = 'DEPENDENCY_TRANSIENT',
  WORKER_CRASH = 'WORKER_CRASH',
  EFFECT_UNCERTAIN = 'EFFECT_UNCERTAIN',
  TERMINAL = 'TERMINAL',
  OVERLOAD = 'OVERLOAD',
  TELEMETRY_ONLY = 'TELEMETRY_ONLY',
}

export interface FailureSignal {
  code: string;
  effectUncertain?: boolean;
  idempotencyKey?: string;
}

const RETRYABLE_CODES = new Set([
  'DEPENDENCY_UNAVAILABLE',
  'DEPENDENCY_TIMEOUT',
  'WORKER_CRASH',
  'OVERLOAD',
]);

export function classifyFailure(signal: FailureSignal): FailureClass {
  if (signal.effectUncertain) return FailureClass.EFFECT_UNCERTAIN;

  switch (signal.code) {
    case 'VALIDATION_ERROR':
      return FailureClass.VALIDATION;
    case 'AUTHORIZATION_DENIED':
      return FailureClass.AUTHORIZATION;
    case 'IDEMPOTENCY_CONFLICT':
      return FailureClass.CONFLICT;
    case 'WORKER_CRASH':
      return FailureClass.WORKER_CRASH;
    case 'OVERLOAD':
      return FailureClass.OVERLOAD;
    case 'TELEMETRY_FAILURE':
      return FailureClass.TELEMETRY_ONLY;
    case 'DEPENDENCY_UNAVAILABLE':
    case 'DEPENDENCY_TIMEOUT':
      return FailureClass.DEPENDENCY_TRANSIENT;
    default:
      return FailureClass.TERMINAL;
  }
}

export function isRetryableFailure(signal: FailureSignal): boolean {
  if (signal.effectUncertain) return Boolean(signal.idempotencyKey);
  return RETRYABLE_CODES.has(signal.code);
}

export function nextRetryDelayMs(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new RangeError('attempt must be a non-negative integer');
  }
  return Math.min(30_000, 1_000 * 2 ** attempt);
}
