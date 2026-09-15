import { describe, expect, it } from 'vitest';
import { createSecurityContext } from './security-context';
import { assertCommandTenant, assertRunTenant, TenantIsolationError } from './tenant-scope';

describe('tenant isolation durable ownership boundary', () => {
  it('permits only the authenticated tenant for command admission and run access', () => {
    const tenantA = createSecurityContext({ tenantId: 'tenant-a', actorId: 'actor-a', permissions: ['run:read', 'run:write'] });
    const tenantB = createSecurityContext({ tenantId: 'tenant-b', actorId: 'actor-b', permissions: ['run:read', 'run:write'] });
    const runA = { metadata: { tenantId: 'tenant-a' } };

    expect(() => assertCommandTenant(tenantA, { metadata: { tenantId: 'tenant-a' } })).not.toThrow();
    expect(() => assertCommandTenant(tenantA, { metadata: { tenantId: 'tenant-b' } })).toThrow(TenantIsolationError);
    expect(() => assertRunTenant(tenantA, runA)).not.toThrow();
    expect(() => assertRunTenant(tenantB, runA)).toThrow(TenantIsolationError);
  });
});
