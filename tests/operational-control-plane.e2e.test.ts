import { describe, expect, it } from 'vitest';
import { InMemoryOperationalControlRepository, OperationalControlService, type OperationalControlAction, type OperationalControlCommand, type OperationalControlState } from '../packages/runtime/src/operational-control';

describe('Stage 12.2 operational control plane', () => {
  const baseCommand = (action: OperationalControlAction): OperationalControlCommand => ({
    commandId: `cmd-${action.toLowerCase()}`, tenantId: 'tenant-a', runId: 'run-1', actorId: 'operator-1', action,
    idempotencyKey: `idem-${action.toLowerCase()}`, expectedVersion: 7,
    correlation: { requestId: 'req-1', traceId: 'trace-1', tenantId: 'tenant-a', runId: 'run-1', workflowId: 'workflow-1', agentId: 'agent-1', actorId: 'operator-1' },
  });

  const state = (overrides: Partial<OperationalControlState> = {}): OperationalControlState => ({
    tenantId: 'tenant-a', runId: 'run-1', version: 7, paused: false, cancelled: false, runState: 'RUNNING', fencingToken: 7n, ...overrides,
  });

  it('authorized pause creates durable pause intent and one outbox event', async () => {
    const result = await new OperationalControlService().execute(baseCommand('PAUSE'));
    expect(result.outcome).toBe('SUCCEEDED'); expect(result.control.paused).toBe(true); expect(result.eventsCreated).toBe(1);
  });
  it('unauthorized or cross-tenant control is rejected without mutation', async () => {
    const service = new OperationalControlService();
    await expect(service.execute({ ...baseCommand('PAUSE'), actorId: 'unauthorized' })).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await expect(service.execute({ ...baseCommand('PAUSE'), tenantId: 'tenant-b', correlation: { ...baseCommand('PAUSE').correlation, tenantId: 'tenant-b' } })).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
  });
  it('duplicate command replay returns the original outcome without a duplicate event', async () => {
    const service = new OperationalControlService(); const command = baseCommand('PAUSE');
    const first = await service.execute(command); const replay = await service.execute(command);
    expect(replay.replayed).toBe(true); expect(replay.outcome).toBe(first.outcome); expect(replay.eventsCreated).toBe(0);
  });
  it('stale expected version is rejected without mutation', async () => {
    await expect(new OperationalControlService().execute({ ...baseCommand('PAUSE'), expectedVersion: 6 })).rejects.toMatchObject({ code: 'CONCURRENCY_CONFLICT' });
  });
  it('resume clears pause and permits normal continuation', async () => {
    const service = new OperationalControlService(); await service.execute(baseCommand('PAUSE'));
    const result = await service.execute({ ...baseCommand('RESUME'), expectedVersion: 8, idempotencyKey: 'idem-resume', commandId: 'cmd-resume' });
    expect(result.control.paused).toBe(false); expect(result.control.cancelled).toBe(false);
  });
  it('cancel is terminal and normal resume is rejected', async () => {
    const service = new OperationalControlService();
    const cancel = await service.execute({ ...baseCommand('CANCEL'), idempotencyKey: 'idem-cancel', commandId: 'cmd-cancel' });
    expect(cancel.control.cancelled).toBe(true);
    await expect(service.execute({ ...baseCommand('RESUME'), expectedVersion: undefined, idempotencyKey: 'idem-resume-after-cancel', commandId: 'cmd-resume-after-cancel' })).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });
  it('retry delegates to existing recovery semantics rather than manufacturing RUNNING', async () => {
    const recovery = { retry: async (runId: string) => ({ runId }), recover: async (runId: string) => ({ runId }) };
    const service = new OperationalControlService({ repository: new InMemoryOperationalControlRepository(state({ runState: 'FAILED' })), recovery });
    const result = await service.execute({ ...baseCommand('RETRY'), idempotencyKey: 'idem-retry', commandId: 'cmd-retry' });
    expect(result.delegatedToRecovery).toBe(true); expect(result.runStateMutation).toBe(false); expect(result.eventsCreated).toBe(1);
  });
  it('rejects retry while a run is not FAILED so the control plane cannot manufacture a retryable candidate', async () => {
    const recovery = { retry: async (runId: string) => ({ runId }), recover: async (runId: string) => ({ runId }) };
    const service = new OperationalControlService({ repository: new InMemoryOperationalControlRepository(state({ runState: 'RUNNING' })), recovery });
    await expect(service.execute({ ...baseCommand('RETRY'), idempotencyKey: 'idem-retry-running', commandId: 'cmd-retry-running' })).rejects.toMatchObject({ code: 'RECOVERY_REJECTED' });
  });
  it('rejects recover for terminal success instead of bypassing existing recovery candidate eligibility', async () => {
    const recovery = { retry: async (runId: string) => ({ runId }), recover: async (runId: string) => ({ runId }) };
    const service = new OperationalControlService({ repository: new InMemoryOperationalControlRepository(state({ runState: 'SUCCEEDED' })), recovery });
    await expect(service.execute({ ...baseCommand('RECOVER'), idempotencyKey: 'idem-recover-success', commandId: 'cmd-recover-success' })).rejects.toMatchObject({ code: 'RECOVERY_REJECTED' });
  });
  it('recover delegates to existing recovery candidate processing without running inside HTTP', async () => {
    let calls = 0; const recovery = { retry: async (runId: string) => ({ runId }), recover: async (runId: string) => { calls += 1; return { runId }; } };
    const service = new OperationalControlService({ repository: new InMemoryOperationalControlRepository(state({ runState: 'FAILED' })), recovery });
    const result = await service.execute({ ...baseCommand('RECOVER'), idempotencyKey: 'idem-recover', commandId: 'cmd-recover' });
    expect(result.delegatedToRecovery).toBe(true); expect(calls).toBe(1); expect(result.executedInHttp).toBe(false);
  });
  it('concurrent control commands serialize correctly', async () => {
    const service = new OperationalControlService();
    const [pause, resume] = await Promise.all([
      service.execute({ ...baseCommand('PAUSE'), expectedVersion: undefined }),
      service.execute({ ...baseCommand('RESUME'), expectedVersion: undefined, commandId: 'cmd-resume-concurrent', idempotencyKey: 'idem-resume-concurrent' }),
    ]);
    expect([pause.outcome, resume.outcome]).toEqual(['SUCCEEDED', 'SUCCEEDED']);
    expect((await service.getControl('tenant-a', 'run-1')).version).toBe(9);
  });
  it('telemetry failure does not change durable control outcome', async () => {
    const service = new OperationalControlService({ telemetry: { emit: async () => { throw new Error('telemetry down'); } } });
    const result = await service.execute(baseCommand('PAUSE')); expect(result.outcome).toBe('SUCCEEDED'); expect((await service.getControl('tenant-a', 'run-1')).paused).toBe(true);
  });
  it('control events preserve safe correlation and contain no sensitive payloads', async () => {
    const service = new OperationalControlService(); await service.execute({ ...baseCommand('PAUSE'), reason: 'operator initiated after review' });
    const event = (await service.listEvents('run-1'))[0];
    expect(event.payload).toMatchObject({ commandId: 'cmd-pause', tenantId: 'tenant-a', runId: 'run-1', actorId: 'operator-1' });
    expect(JSON.stringify(event.payload)).not.toMatch(/prompt|completion|password|token|apiKey|authorization|cookie|input|output|body|privateKey/i);
  });
  it('stale workers are prevented from effectful continuation after terminal control', async () => {
    const service = new OperationalControlService(); await service.execute(baseCommand('CANCEL'));
    await expect(service.authorizeContinuation({ tenantId: 'tenant-a', runId: 'run-1', fencingToken: 7n })).rejects.toMatchObject({ code: 'STALE_FENCING_TOKEN' });
  });
});
