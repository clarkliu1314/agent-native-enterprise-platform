import { describe, expect, it } from 'vitest';

/**
 * Stage 12.2 Task 6 RED gate.
 *
 * These tests intentionally describe the HTTP boundary before its implementation
 * is wired. The API must remain a stateless adapter over OperationalControlService.
 */
describe('Stage 12.2 Task 6 — stateless API control endpoints', () => {
  it('maps POST /api/runs/:runId/pause to the operational control command', async () => {
    const response = await postControl('/api/runs/run-1/pause', {
      tenantId: 'tenant-a',
      actorId: 'operator-1',
      commandId: 'cmd-pause-1',
      idempotencyKey: 'idem-pause-1',
      reason: 'operator requested pause',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      runId: 'run-1',
      action: 'PAUSE',
    });
  });

  it('maps all five control actions without executing long-running work in HTTP', async () => {
    const actions = [
      ['pause', 'PAUSE'],
      ['resume', 'RESUME'],
      ['retry', 'RETRY'],
      ['cancel', 'CANCEL'],
      ['recover', 'RECOVER'],
    ] as const;

    for (const [pathAction, action] of actions) {
      const response = await postControl(`/api/runs/run-${pathAction}/${pathAction}`, {
        tenantId: 'tenant-a',
        actorId: 'operator-1',
        commandId: `cmd-${pathAction}-2`,
        idempotencyKey: `idem-${pathAction}-2`,
      });

      expect(response.status).toBe(200);
      expect(response.body.action).toBe(action);
      expect(response.body).not.toHaveProperty('executionResult');
    }
  });

  it('returns authorization failures from the application boundary without leaking run state', async () => {
    const response = await postControl('/api/runs/secret-run/cancel', {
      tenantId: 'tenant-a',
      actorId: 'unauthorized-actor',
      commandId: 'cmd-auth-1',
      idempotencyKey: 'idem-auth-1',
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ errorCode: 'AUTHORIZATION_DENIED' });
    expect(JSON.stringify(response.body)).not.toContain('secret-run');
  });

  it('preserves idempotent replay semantics at the HTTP boundary', async () => {
    const command = {
      tenantId: 'tenant-a',
      actorId: 'operator-1',
      commandId: 'cmd-replay-1',
      idempotencyKey: 'idem-replay-1',
    };

    const first = await postControl('/api/runs/run-1/pause', command);
    const replay = await postControl('/api/runs/run-1/pause', command);

    expect(replay.status).toBe(first.status);
    expect(replay.body).toEqual(first.body);
  });

  it('returns optimistic-concurrency conflicts without mutating the run', async () => {
    const response = await postControl('/api/runs/run-1/cancel', {
      tenantId: 'tenant-a',
      actorId: 'operator-1',
      commandId: 'cmd-conflict-1',
      idempotencyKey: 'idem-conflict-1',
      expectedVersion: 1,
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ errorCode: 'CONCURRENCY_CONFLICT' });
  });
});

async function postControl(_path: string, _body: Record<string, unknown>): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  throw new Error('RED: Task 6 API control endpoints are not implemented yet');
}
