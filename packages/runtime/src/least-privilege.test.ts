import { describe, expect, it } from 'vitest';
import { createSecurityContext, SecurityContextError } from './security-context';
import { authorizeComponent, createSecuredToolPermission } from './least-privilege';

describe('least privilege security boundary', () => {
  it('requires the component-specific permission and fails closed', () => {
    const api = createSecurityContext({ tenantId: 'tenant-a', actorId: 'actor-a', permissions: ['run:write'] });
    expect(() => authorizeComponent(api, 'api', 'run:write')).not.toThrow();
    expect(() => authorizeComponent(api, 'worker', 'run:execute')).toThrow(SecurityContextError);
    expect(() => authorizeComponent(undefined, 'api', 'run:write')).toThrow(SecurityContextError);
  });

  it('prevents a caller from borrowing worker, recovery, or outbox privileges', () => {
    const worker = createSecurityContext({ tenantId: 'tenant-a', actorId: 'worker-a', permissions: ['run:execute'] });
    expect(() => authorizeComponent(worker, 'worker', 'run:execute')).not.toThrow();
    expect(() => authorizeComponent(worker, 'recovery', 'run:reclaim')).toThrow(SecurityContextError);
    expect(() => authorizeComponent(worker, 'outbox', 'outbox:publish')).toThrow(SecurityContextError);
  });

  it('extends the existing ToolPermission port without bypassing authorization', async () => {
    const context = createSecurityContext({ tenantId: 'tenant-a', actorId: 'actor-a', permissions: ['tool:invoke'] });
    const calls: unknown[] = [];
    const secured = createSecuredToolPermission({
      context,
      delegate: {
        authorize: async (input) => {
          calls.push(input);
          return true;
        },
      },
    });

    await expect(secured.authorize({ runId: 'run-a', agentId: 'agent-a', toolName: 'lookup', input: {} })).resolves.toBe(true);
    expect(calls).toHaveLength(1);

    const denied = createSecuredToolPermission({
      context: createSecurityContext({ tenantId: 'tenant-a', actorId: 'actor-a', permissions: [] }),
      delegate: { authorize: async () => true },
    });
    await expect(denied.authorize({ runId: 'run-a', agentId: 'agent-a', toolName: 'lookup', input: {} })).rejects.toThrow(SecurityContextError);
  });
});
