import { describe, expect, it, vi } from 'vitest';
import type { RuntimeFacade, RunView } from '@agent-native/runtime-contract/durable';
import { DurableWorker } from '../packages/runtime/src/durable-worker';
import { InMemoryOperationalControlRepository, OperationalControlService, type OperationalControlState } from '../packages/runtime/src/operational-control';
import type { QueueConsumer } from '../packages/runtime/src/ports';

const run: RunView = {
  runId: 'run-1',
  agentId: 'agent-1',
  state: 'RUNNING',
  input: {},
  metadata: { tenantId: 'tenant-a', requestId: 'req-1', traceId: 'trace-1' },
  fencingToken: 7n,
  attempt: 1,
  createdAt: '2026-09-14T00:00:00.000Z',
};

const consumer: QueueConsumer = {
  consume: async () => undefined,
};

const runtime = (executeRunBounded = vi.fn(async () => ({ run, terminal: false }))): RuntimeFacade => ({
  createRun: vi.fn(),
  resumeRun: vi.fn(),
  cancelRun: vi.fn(),
  approveRun: vi.fn(),
  executeRunBounded,
  getRun: vi.fn(async () => run),
  listRunEvents: vi.fn(),
  getRunCheckpoint: vi.fn(),
  getToolCall: vi.fn(),
});

const control = (state: Partial<OperationalControlState> = {}) => new OperationalControlService({
  repository: new InMemoryOperationalControlRepository({
    tenantId: 'tenant-a',
    runId: 'run-1',
    version: 7,
    paused: false,
    cancelled: false,
    runState: 'RUNNING',
    fencingToken: 7n,
    ...state,
  }),
});

describe('DurableWorker operational control boundary', () => {
  it('does not start the next effectful unit while the durable pause intent is active', async () => {
    const execute = vi.fn(async () => ({ run, terminal: false }));
    const worker = new DurableWorker(runtime(execute), consumer, {
      owner: 'worker-1',
      operationalControl: control({ paused: true }),
    });

    await worker.process('run-1');

    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects stale effectful continuation after cancel fencing', async () => {
    const execute = vi.fn(async () => ({ run, terminal: false }));
    const service = control();
    const worker = new DurableWorker(runtime(execute), consumer, {
      owner: 'worker-1',
      operationalControl: service,
    });

    await service.execute({
      commandId: 'cmd-cancel',
      tenantId: 'tenant-a',
      runId: 'run-1',
      actorId: 'operator-1',
      action: 'CANCEL',
      idempotencyKey: 'idem-cancel',
      expectedVersion: 7,
      correlation: {
        requestId: 'req-1', traceId: 'trace-1', tenantId: 'tenant-a', runId: 'run-1', actorId: 'operator-1',
      },
    });

    await expect(worker.process('run-1')).rejects.toMatchObject({ code: 'STALE_FENCING_TOKEN' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('resumes execution after the durable pause intent is cleared', async () => {
    const execute = vi.fn(async () => ({ run, terminal: false }));
    const service = control({ paused: true });
    const worker = new DurableWorker(runtime(execute), consumer, {
      owner: 'worker-1',
      operationalControl: service,
    });

    await worker.process('run-1');
    expect(execute).not.toHaveBeenCalled();

    await service.execute({
      commandId: 'cmd-resume',
      tenantId: 'tenant-a',
      runId: 'run-1',
      actorId: 'operator-1',
      action: 'RESUME',
      idempotencyKey: 'idem-resume',
      expectedVersion: 7,
      correlation: {
        requestId: 'req-1', traceId: 'trace-1', tenantId: 'tenant-a', runId: 'run-1', actorId: 'operator-1',
      },
    });

    await worker.process('run-1');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
