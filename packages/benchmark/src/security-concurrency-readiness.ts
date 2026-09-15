export interface DuplicateRequestProbeInput {
  idempotencyKey: string;
  attempts: number;
  execute: () => void | Promise<void>;
}

export interface DuplicateRequestProbeResult {
  idempotencyKey: string;
  accepted: number;
  duplicates: number;
  executions: number;
  firstError?: string;
  failedAttempts: number;
}

export type SensitiveDataBoundary = ReadonlySet<string>;

export function buildSensitiveDataBoundary(fields: readonly string[]): SensitiveDataBoundary {
  const normalized = fields.map((field) => field.trim()).filter(Boolean);
  return new Set(normalized);
}

export function sanitizeBoundaryPayload<T>(boundary: SensitiveDataBoundary, value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeBoundaryPayload(boundary, item)) as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      result[key] = boundary.has(key) ? '[REDACTED]' : sanitizeBoundaryPayload(boundary, child);
    }
    return result as T;
  }
  return value;
}

export async function executeDuplicateRequestProbe(input: DuplicateRequestProbeInput): Promise<DuplicateRequestProbeResult> {
  if (!input || input.idempotencyKey.trim().length === 0) throw new TypeError('idempotencyKey is required');
  if (!Number.isInteger(input.attempts) || input.attempts < 1) throw new RangeError('attempts must be a positive integer');

  let executionPromise: Promise<void> | undefined;
  let firstError: string | undefined;
  const invoke = (): Promise<void> => {
    if (!executionPromise) {
      executionPromise = Promise.resolve().then(input.execute).catch((error: unknown) => {
        firstError = error instanceof Error ? error.message : String(error);
        throw error;
      });
    }
    return executionPromise;
  };

  const results = await Promise.allSettled(Array.from({ length: input.attempts }, invoke));
  return {
    idempotencyKey: input.idempotencyKey,
    accepted: 1,
    duplicates: input.attempts - 1,
    executions: 1,
    firstError,
    failedAttempts: results.filter((result) => result.status === 'rejected').length,
  };
}
