import { describe, expect, it } from 'vitest';
import { createSecurityContext } from './security-context';
import {
  TenantIsolationError,
  assertCommandTenant,
  assertRunTenant,
  assertTenantOwnership,
} from './tenant-scope';

describe('tenant scope', () => {
  const context = createSecurityContext({
    tenantId: 'tenant-a',
    actorId: 'actor-1',
    permissions: ['run:read', 'run:write'],
  });

  it('rejects a command without a tenant or with a different tenant', () => {
    expect(() => assertCommandTenant(context, { metadata: {} })).toThrow(TenantIsolationError);
    expect(() =>
      assertCommandTenant(context, { metadata: { tenantId: 'tenant-b' } }),
    ).toThrow(TenantIsolationError);
    expect(() =>
      assertCommandTenant(context, { metadata: { tenantId: 'tenant-a' } }),
    ).not.toThrow();
  });

  it('rejects cross-tenant durable reads and mutations', () => {
    expect(() => assertRunTenant(context, { metadata: { tenantId: 'tenant-b' } })).toThrow(
      TenantIsolationError,
    );
    expect(() => assertRunTenant(context, { metadata: {} })).toThrow(TenantIsolationError);
    expect(() => assertRunTenant(context, { metadata: { tenantId: 'tenant-a' } })).not.toThrow();
  });

  it('requires explicit tenant ownership for worker substitution and recovery', () => {
    expect(() => assertTenantOwnership(context, 'tenant-b')).toThrow(TenantIsolationError);
    expect(() => assertTenantOwnership(context, undefined)).toThrow(TenantIsolationError);
    expect(() => assertTenantOwnership(context, 'tenant-a')).not.toThrow();
  });

  it('applies the same ownership rule to outbox delivery', () => {
    expect(() => assertTenantOwnership(context, 'tenant-b')).toThrow(TenantIsolationError);
    expect(() => assertTenantOwnership(context, 'tenant-a')).not.toThrow();
  });
});
