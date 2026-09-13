import { describe, expect, it } from 'vitest';
import { sanitizeAttributes } from './sanitizer.js';

describe('observability sanitizer', () => {
  it('drops prompt, credential, authorization, and payload fields', () => {
    const result = sanitizeAttributes({
      state: 'RUNNING',
      durationMs: 12,
      prompt: 'do not log this',
      completion: 'do not log this',
      password: 'secret',
      apiKey: 'secret-key',
      authorization: 'Bearer secret',
      input: { name: 'private payload' },
      output: { companyId: 'private result' },
    });

    expect(result).toEqual({ state: 'RUNNING', durationMs: 12 });
  });

  it('never serializes arbitrary nested objects or arrays', () => {
    const result = sanitizeAttributes({
      state: 'RUNNING',
      nested: { safe: 'still not allowed' },
      list: ['not', 'telemetry'],
    });

    expect(result).toEqual({ state: 'RUNNING' });
  });

  it('preserves safe scalar operational attributes', () => {
    expect(
      sanitizeAttributes({
        state: 'WAITING',
        attempts: 2,
        retryable: true,
        errorCode: null,
      }),
    ).toEqual({
      state: 'WAITING',
      attempts: 2,
      retryable: true,
      errorCode: null,
    });
  });
});
