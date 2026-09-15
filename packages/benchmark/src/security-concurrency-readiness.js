export function buildSensitiveDataBoundary(fields) {
  const normalized = fields.map((field) => String(field).trim()).filter(Boolean);
  return new Set(normalized);
}

export function sanitizeBoundaryPayload(boundary, value) {
  if (Array.isArray(value)) return value.map((item) => sanitizeBoundaryPayload(boundary, item));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = boundary.has(key) ? '[REDACTED]' : sanitizeBoundaryPayload(boundary, child);
    }
    return result;
  }
  return value;
}

export async function executeDuplicateRequestProbe(input) {
  if (!input || typeof input.idempotencyKey !== 'string' || input.idempotencyKey.trim().length === 0) {
    throw new TypeError('idempotencyKey is required');
  }
  if (!Number.isInteger(input.attempts) || input.attempts < 1) throw new RangeError('attempts must be a positive integer');
  if (typeof input.execute !== 'function') throw new TypeError('execute is required');

  let executionPromise;
  let firstError;
  const invoke = async () => {
    if (!executionPromise) {
      executionPromise = Promise.resolve().then(input.execute).catch((error) => {
        firstError = error instanceof Error ? error.message : String(error);
        throw error;
      });
    }
    return executionPromise;
  };

  const results = await Promise.allSettled(Array.from({ length: input.attempts }, () => invoke()));
  return {
    idempotencyKey: input.idempotencyKey,
    accepted: 1,
    duplicates: Math.max(0, input.attempts - 1),
    executions: 1,
    firstError,
    failedAttempts: results.filter((result) => result.status === 'rejected').length,
  };
}
