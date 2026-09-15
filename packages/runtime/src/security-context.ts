export interface SecurityContextInput {
  tenantId: string;
  actorId: string;
  permissions: readonly string[];
}

export interface SecurityContext {
  readonly tenantId: string;
  readonly actorId: string;
  readonly permissions: readonly string[];
}

export class SecurityContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityContextError';
  }
}

function requireNonBlank(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SecurityContextError(`${field} is required`);
  }
}

export function createSecurityContext(input: SecurityContextInput): SecurityContext {
  requireNonBlank(input?.tenantId, 'tenantId');
  requireNonBlank(input?.actorId, 'actorId');

  if (!Array.isArray(input?.permissions)) {
    throw new SecurityContextError('permissions are required');
  }

  const permissions = input.permissions.map((permission) => {
    requireNonBlank(permission, 'permission');
    return permission;
  });

  return Object.freeze({
    tenantId: input.tenantId,
    actorId: input.actorId,
    permissions: Object.freeze([...permissions]),
  });
}

export function requireSecurityContext(
  context: SecurityContext | null | undefined,
  permission: string,
): SecurityContext {
  if (!context) {
    throw new SecurityContextError('security context is required');
  }

  requireNonBlank(permission, 'permission');

  if (!context.tenantId || !context.actorId) {
    throw new SecurityContextError('tenantId and actorId are required');
  }

  if (!context.permissions.includes(permission)) {
    throw new SecurityContextError(`permission denied: ${permission}`);
  }

  return context;
}
