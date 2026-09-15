import { requireSecurityContext, SecurityContextError, type SecurityContext } from './security-context';
import type { ToolPermission } from './ports';

export type SecurityComponent = 'api' | 'worker' | 'recovery' | 'outbox' | 'tool';

const COMPONENT_PERMISSIONS: Record<SecurityComponent, string> = {
  api: 'run:write',
  worker: 'run:execute',
  recovery: 'run:reclaim',
  outbox: 'outbox:publish',
  tool: 'tool:invoke',
};

export function authorizeComponent(
  context: SecurityContext | null | undefined,
  component: SecurityComponent,
  permission = COMPONENT_PERMISSIONS[component],
): SecurityContext {
  if (permission !== COMPONENT_PERMISSIONS[component]) {
    throw new SecurityContextError(`invalid permission for ${component}`);
  }
  return requireSecurityContext(context, permission);
}

export function createSecuredToolPermission(input: {
  context: SecurityContext;
  delegate: ToolPermission;
}): ToolPermission {
  return {
    async authorize(toolInput) {
      authorizeComponent(input.context, 'tool');
      return input.delegate.authorize(toolInput);
    },
  };
}
