export enum TimeoutKind {
  API_HANDOFF = 'API_HANDOFF',
  WORKER_EXECUTION = 'WORKER_EXECUTION',
  TOOL = 'TOOL',
  RECOVERY = 'RECOVERY',
}

export interface TimeoutSignal {
  kind: TimeoutKind;
  durableAccepted: boolean;
  effectUncertain: boolean;
  commandOutcome: 'PENDING' | 'ACCEPTED';
  idempotencyKey?: string;
}

export interface TimeoutOptions {
  durableAccepted?: boolean;
  effectUncertain?: boolean;
  idempotencyKey?: string;
}

export function createTimeoutSignal(kind: TimeoutKind, options: TimeoutOptions = {}): TimeoutSignal {
  const durableAccepted = options.durableAccepted ?? kind !== TimeoutKind.API_HANDOFF;
  const effectUncertain = options.effectUncertain ?? kind === TimeoutKind.TOOL;
  return {
    kind,
    durableAccepted,
    effectUncertain,
    commandOutcome: durableAccepted ? 'ACCEPTED' : 'PENDING',
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
  };
}

export function isTimeoutRetryable(signal: TimeoutSignal): boolean {
  if (signal.kind === TimeoutKind.API_HANDOFF) return false;
  if (signal.kind === TimeoutKind.TOOL && signal.effectUncertain) return Boolean(signal.idempotencyKey);
  return true;
}
