import { describe, expect, it } from 'vitest';
import { sanitizeSecurityError } from './security-errors';

describe('security-safe errors', () => {
  it('never exposes raw error messages or secret-bearing details', () => {
    const result = sanitizeSecurityError(new Error('provider token=super-secret prompt=confidential'));
    expect(result).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal error' });
    expect(JSON.stringify(result)).not.toContain('super-secret');
    expect(JSON.stringify(result)).not.toContain('confidential');
  });

  it('preserves stable error classes without exposing identifiers', () => {
    const error = new Error('Tool permission denied: secret-tool');
    error.name = 'ToolPermissionDeniedError';
    expect(sanitizeSecurityError(error)).toEqual({ code: 'AUTHORIZATION_DENIED', message: 'Authorization denied' });
  });
});
