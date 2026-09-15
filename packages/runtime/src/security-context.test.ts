import { describe, expect, it } from 'vitest';
import {
  createSecurityContext,
  requireSecurityContext,
  SecurityContextError,
} from './security-context';

describe('security context', () => {
  it('rejects a missing tenant context for tenant-scoped operations', () => {
    expect(() =>
      createSecurityContext({
        tenantId: undefined as unknown as string,
        actorId: 'actor-1',
        permissions: ['run:read'],
      }),
    ).toThrow(SecurityContextError);
  });

  it('rejects a missing actor or permission context for security-sensitive operations', () => {
    expect(() =>
      createSecurityContext({
        tenantId: 'tenant-1',
        actorId: undefined as unknown as string,
        permissions: ['run:read'],
      }),
    ).toThrow(SecurityContextError);

    const context = createSecurityContext({
      tenantId: 'tenant-1',
      actorId: 'actor-1',
      permissions: [],
    });

    expect(() => requireSecurityContext(context, 'run:read')).toThrow(SecurityContextError);
  });

  it('returns an immutable context that cannot be mutated after construction', () => {
    const permissions = ['run:read'];
    const context = createSecurityContext({
      tenantId: 'tenant-1',
      actorId: 'actor-1',
      permissions,
    });

    permissions.push('run:write');

    expect(context.permissions).toEqual(['run:read']);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.permissions)).toBe(true);

    expect(() => {
      (context as { tenantId: string }).tenantId = 'tenant-2';
    }).toThrow();
    expect(context.tenantId).toBe('tenant-1');
  });
});
