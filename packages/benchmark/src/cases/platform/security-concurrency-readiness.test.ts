import { describe, expect, it } from 'vitest';
import { buildSensitiveDataBoundary, sanitizeBoundaryPayload, executeDuplicateRequestProbe, type DuplicateRequestProbeInput } from './security-concurrency-readiness.js';

describe('stage 12.6 Task 5 readiness contracts', () => {
  it('redacts sensitive fields at the data boundary without changing safe fields', () => {
    const boundary = buildSensitiveDataBoundary(['password', 'apiKey', 'accessToken', 'secret']);
    const input = { tenantId: 'tenant-a', requestId: 'req-1', password: 'pw-123', nested: { apiKey: 'key-456', label: 'safe' }, accessToken: 'token-789', secret: 'secret-value' };
    const sanitized = sanitizeBoundaryPayload(boundary, input);
    expect(sanitized).toEqual({ tenantId: 'tenant-a', requestId: 'req-1', password: '[REDACTED]', nested: { apiKey: '[REDACTED]', label: 'safe' }, accessToken: '[REDACTED]', secret: '[REDACTED]' });
    expect(JSON.stringify(sanitized)).not.toContain('pw-123');
    expect(JSON.stringify(sanitized)).not.toContain('key-456');
    expect(JSON.stringify(sanitized)).not.toContain('token-789');
  });

  it('fails closed for sensitive values inside arrays and deeply nested objects', () => {
    const boundary = buildSensitiveDataBoundary(['token', 'privateKey']);
    const sanitized = sanitizeBoundaryPayload(boundary, { items: [{ token: 'abc' }, { nested: { privateKey: 'pem' } }], status: 'ok' });
    expect(sanitized).toEqual({ items: [{ token: '[REDACTED]' }, { nested: { privateKey: '[REDACTED]' } }], status: 'ok' });
  });

  it('accepts only the first request for the same idempotency key', async () => {
    const input: DuplicateRequestProbeInput = { idempotencyKey: 'idem-1', attempts: 8, execute: async () => undefined };
    const result = await executeDuplicateRequestProbe(input);
    expect(result.accepted).toBe(1);
    expect(result.duplicates).toBe(7);
    expect(result.executions).toBe(1);
    expect(result.idempotencyKey).toBe('idem-1');
  });

  it('does not allow a failed first attempt to be silently replayed as success', async () => {
    let calls = 0;
    const result = await executeDuplicateRequestProbe({ idempotencyKey: 'idem-fail', attempts: 4, execute: async () => { calls += 1; throw new Error('synthetic failure'); } });
    expect(calls).toBe(1);
    expect(result.accepted).toBe(1);
    expect(result.duplicates).toBe(3);
    expect(result.executions).toBe(1);
    expect(result.firstError).toBe('synthetic failure');
  });
});
