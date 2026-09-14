import { describe, expect, it } from 'vitest';
import { sanitizeAttributes } from './sanitizer.js';

describe('sanitizeAttributes hardening', () => {
  it('drops secret-like keys case-insensitively and with common separators', () => {
    const result = sanitizeAttributes({
      Password: 'p',
      'api-key': 'k',
      'access_token': 't',
      Authorization: 'Bearer x',
      normal: 'ok',
    });

    expect(result).toEqual({ normal: 'ok' });
  });

  it('does not allow nested objects, arrays, or Error objects to bypass sanitization', () => {
    const result = sanitizeAttributes({
      nested: { password: 'p', safe: 'still-secret' },
      array: ['secret', 'value'],
      error: new Error('sensitive failure'),
      safe: 'ok',
    });

    expect(result).toEqual({ safe: 'ok' });
  });

  it('bounds oversized string attributes', () => {
    const result = sanitizeAttributes({ safe: 'a'.repeat(5000) });

    expect(result.safe).toBe('a'.repeat(1024));
  });
});
