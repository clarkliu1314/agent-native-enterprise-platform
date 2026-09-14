import { describe, expect, it } from 'vitest';
import { classifyError } from './index.js';

describe('stable error codes', () => {
  it('prefers explicit stable error code metadata over mutable Error.name', () => {
    const error = new Error('permission denied');
    error.name = 'Error';
    Object.assign(error, { code: 'AUTHORIZATION_DENIED' });
    expect(classifyError(error)).toBe('AUTHORIZATION_DENIED');
  });

  it('rejects unknown explicit codes instead of leaking arbitrary values', () => {
    const error = new Error('unexpected');
    Object.assign(error, { code: 'SECRET_INTERNAL_CODE' });
    expect(classifyError(error)).toBe('INTERNAL_ERROR');
  });

  it('keeps unknown non-Error failures on the stable internal code', () => {
    expect(classifyError({ code: 'RUN_NOT_FOUND' })).toBe('INTERNAL_ERROR');
  });
});
