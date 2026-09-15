import { describe, expect, it } from 'vitest';
import { sanitizeSecurityData } from './security-data';

describe('security data boundary', () => {
  it('removes secrets and sensitive payload fields recursively', () => {
    const value = sanitizeSecurityData({
      tenantId: 'tenant-a',
      prompt: 'do not persist',
      nested: { completion: 'secret response', apiKey: 'abc', safe: 'ok' },
      authorization: 'Bearer abc',
    });

    expect(value).toEqual({ tenantId: 'tenant-a', nested: { safe: 'ok' } });
  });

  it('redacts sensitive keys even when separators or casing are used', () => {
    expect(sanitizeSecurityData({ 'client-secret': 'x', Access_Token: 'y', safe: 1 })).toEqual({ safe: 1 });
  });

  it('keeps telemetry and durable payloads bounded while preserving recursively sanitized scalar records', () => {
    const value = sanitizeSecurityData({ safe: 'x'.repeat(2048), bad: { deep: true }, list: ['secret'] });
    expect(value).toEqual({ safe: 'x'.repeat(1024), bad: { deep: true } });
  });
});
