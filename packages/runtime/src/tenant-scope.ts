import type { CreateRunCommand, RunView } from '@agent-native/runtime-contract/durable';
import type { SecurityContext } from './security-context';

export class TenantIsolationError extends Error {
  constructor(message = 'Tenant ownership check failed') {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

function tenantOf(value: { metadata?: Record<string, unknown> }): string | undefined {
  const tenantId = value.metadata?.tenantId;
  return typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : undefined;
}

export function assertTenantOwnership(context: SecurityContext, tenantId: string | undefined): void {
  if (!tenantId || tenantId !== context.tenantId) {
    throw new TenantIsolationError('Cross-tenant access denied');
  }
}

export function assertCommandTenant(context: SecurityContext, command: Pick<CreateRunCommand, 'metadata'>): void {
  assertTenantOwnership(context, tenantOf(command));
}

export function assertRunTenant(context: SecurityContext, run: Pick<RunView, 'metadata'>): void {
  assertTenantOwnership(context, tenantOf(run));
}
