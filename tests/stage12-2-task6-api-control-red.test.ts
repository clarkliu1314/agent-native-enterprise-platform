import { describe, expect, it } from 'vitest';
import { createOperationalControlHandler } from '../apps/api/src/operational-control-handler';
import { OperationalControlError } from '@agent-native/runtime';

function makeResult(action: string, replayed = false) {
  return {
    outcome: 'SUCCEEDED', replayed,
    control: { tenantId: 'tenant-a', runId: 'run-1', version: 8, paused: action === 'PAUSE', cancelled: action === 'CANCEL', runState: action === 'CANCEL' ? 'CANCELLED' : 'RUNNING', fencingToken: 7n },
    eventsCreated: replayed ? 0 : 1, delegatedToRecovery: action === 'RETRY' || action === 'RECOVER', runStateMutation: action === 'CANCEL', executedInHttp: false,
  };
}

describe('Stage 12.2 Task 6 — stateless API control endpoints', () => {
  it('maps POST /api/runs/:runId/pause to the operational control command', async () => {
    const calls: Record<string, unknown>[] = [];
    const handler = createOperationalControlHandler({ service: { execute: async (command: Record<string, unknown>) => { calls.push(command); return makeResult('PAUSE'); } } as never });
    const response = await handler(request('/api/runs/run-1/pause', { commandId: 'cmd-pause-1', idempotencyKey: 'idem-pause-1', reason: 'operator requested pause' }));
    const body = await response.json();
    expect(response.status).toBe(202);
    expect(body).toMatchObject({ action: 'PAUSE', runId: 'run-1', outcome: 'SUCCEEDED' });
    expect(calls[0]).toMatchObject({ tenantId: 'tenant-a', actorId: 'operator-1', action: 'PAUSE', runId: 'run-1' });
  });

  it('maps all five control actions without executing long-running work in HTTP', async () => {
    const actions = [['pause', 'PAUSE'], ['resume', 'RESUME'], ['retry', 'RETRY'], ['cancel', 'CANCEL'], ['recover', 'RECOVER']] as const;
    const calls: string[] = [];
    const handler = createOperationalControlHandler({ service: { execute: async (command: Record<string, unknown>) => { calls.push(command.action as string); return makeResult(command.action as string); } } as never });
    for (const [pathAction, action] of actions) {
      const response = await handler(request(`/api/runs/run-${pathAction}/${pathAction}`, { commandId: `cmd-${pathAction}`, idempotencyKey: `idem-${pathAction}` }));
      const body = await response.json();
      expect(response.status).toBe(202); expect(body.action).toBe(action); expect(body.executedInHttp).toBe(false);
    }
    expect(calls).toEqual(['PAUSE', 'RESUME', 'RETRY', 'CANCEL', 'RECOVER']);
  });

  it('returns authorization failures without leaking run state', async () => {
    const handler = createOperationalControlHandler({ service: { execute: async () => { throw new OperationalControlError('AUTHORIZATION_DENIED', 'denied'); } } as never });
    const response = await handler(request('/api/runs/secret-run/cancel', { commandId: 'cmd-auth-1', idempotencyKey: 'idem-auth-1' }, 'unauthorized-actor'));
    const body = await response.json();
    expect(response.status).toBe(403); expect(body).toMatchObject({ errorCode: 'AUTHORIZATION_DENIED' }); expect(JSON.stringify(body)).not.toContain('secret-run');
  });

  it('preserves idempotent replay semantics at the HTTP boundary', async () => {
    let count = 0;
    const handler = createOperationalControlHandler({ service: { execute: async () => { count += 1; return makeResult('PAUSE', count > 1); } } as never });
    const init = { commandId: 'cmd-replay-1', idempotencyKey: 'idem-replay-1' };
    const first = await handler(request('/api/runs/run-1/pause', init)); const replay = await handler(request('/api/runs/run-1/pause', init));
    const firstBody = await first.json(); const replayBody = await replay.json();
    expect(first.status).toBe(202); expect(replay.status).toBe(200); expect(replayBody.replayed).toBe(true); expect(replayBody.action).toBe(firstBody.action);
  });

  it('returns optimistic-concurrency conflicts without mutating the run', async () => {
    const handler = createOperationalControlHandler({ service: { execute: async () => { throw new OperationalControlError('CONCURRENCY_CONFLICT', 'stale'); } } as never });
    const response = await handler(request('/api/runs/run-1/cancel', { commandId: 'cmd-conflict-1', idempotencyKey: 'idem-conflict-1', expectedVersion: 1 }));
    const body = await response.json();
    expect(response.status).toBe(409); expect(body).toMatchObject({ errorCode: 'CONCURRENCY_CONFLICT' });
  });
});

function request(path: string, body: Record<string, unknown>, actorId = 'operator-1') {
  return new Request(`https://example.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': 'tenant-a', 'x-actor-id': actorId, 'x-request-id': 'req-1', 'x-trace-id': 'trace-1' }, body: JSON.stringify(body) });
}
