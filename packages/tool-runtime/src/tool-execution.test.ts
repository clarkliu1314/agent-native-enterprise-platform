import { describe, expect, it, vi } from 'vitest';
import {
  IdempotencyInProgressError,
  ToolExecutionService,
  ToolPermissionDeniedError,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolExecutionStore,
} from './tool-execution';

describe('ToolExecutionService', () => {
  const tool: ToolDefinition = {
    name: 'crm.create_company',
    description: 'Create a company record in the CRM.',
    sideEffect: true,
  };

  const context: ToolExecutionContext = {
    actorId: 'user-1',
    tenantId: 'fund-1',
    permissions: ['crm.company:create'],
  };

  it('denies an unauthorized side-effect before invoking the tool', async () => {
    const execute = vi.fn().mockResolvedValue({ companyId: 'company-1' });
    const service = new ToolExecutionService({
      authorize: async () => false,
      execute,
    });

    await expect(
      service.execute({
        tool,
        input: { name: 'Acme Capital' },
        context: { ...context, permissions: [] },
        idempotencyKey: 'idem-denied-1',
      }),
    ).rejects.toBeInstanceOf(ToolPermissionDeniedError);

    expect(execute).not.toHaveBeenCalled();
  });

  it('returns the same logical result for a retry with the same idempotency key', async () => {
    let externalCalls = 0;
    const execute = vi.fn().mockImplementation(async () => {
      externalCalls += 1;
      return { companyId: `company-${externalCalls}` };
    });

    const service = new ToolExecutionService({
      authorize: async () => true,
      execute,
      persistResultAndPublishOutbox: async () => undefined,
    });

    const request = {
      tool,
      input: { name: 'Acme Capital' },
      context,
      idempotencyKey: 'idem-company-1',
    };

    const first = await service.execute(request);
    const retry = await service.execute(request);

    expect(first.output).toEqual(retry.output);
    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    expect(externalCalls).toBe(1);
  });

  it('persists one result and one outbox event for one successful side effect', async () => {
    const commits: unknown[] = [];
    const service = new ToolExecutionService({
      authorize: async () => true,
      execute: async () => ({ companyId: 'company-1' }),
      persistResultAndPublishOutbox: async (commit) => {
        commits.push(commit);
      },
    });

    await service.execute({
      tool,
      input: { name: 'Acme Capital' },
      context,
      idempotencyKey: 'idem-outbox-1',
    });

    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      idempotencyKey: 'idem-outbox-1',
      toolName: 'crm.create_company',
      outboxEvent: {
        type: 'tool.execution.completed',
      },
    });
  });

  it('does not persist a success result or publish an outbox event when the external effect fails', async () => {
    const persistResultAndPublishOutbox = vi.fn();
    const service = new ToolExecutionService({
      authorize: async () => true,
      execute: async () => {
        throw new Error('CRM unavailable');
      },
      persistResultAndPublishOutbox,
    });

    await expect(
      service.execute({
        tool,
        input: { name: 'Acme Capital' },
        context,
        idempotencyKey: 'idem-failure-1',
      }),
    ).rejects.toThrow('CRM unavailable');

    expect(persistResultAndPublishOutbox).not.toHaveBeenCalled();
  });

  it('C1: after a worker crash before the external effect, a reclaimed reservation safely retries', async () => {
    let reservations = 0;
    let externalCalls = 0;
    const store: ToolExecutionStore = {
      reserve: vi.fn(async () => {
        reservations += 1;
        return reservations === 1
          ? { kind: 'RESERVED', state: 'IN_PROGRESS' }
          : { kind: 'RETRY', state: 'FAILED_RETRYABLE' };
      }),
      get: vi.fn(async () => null),
      commit: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
    };
    const execute = vi.fn(async () => {
      externalCalls += 1;
      return { companyId: 'company-c1' };
    });

    const service = new ToolExecutionService({ authorize: async () => true, execute, store });
    const request = { tool, input: { name: 'Acme Capital' }, context, idempotencyKey: 'idem-c1' };

    // First worker dies immediately after reserving; the second worker reuses the same key.
    const firstReservation = await store.reserve({
      idempotencyKey: request.idempotencyKey,
      tenantId: context.tenantId,
      toolName: tool.name,
      actorId: context.actorId,
      input: request.input,
    });
    expect(firstReservation.kind).toBe('RESERVED');

    const recovered = await service.execute(request);
    expect(recovered.output).toEqual({ companyId: 'company-c1' });
    expect(externalCalls).toBe(1);
    expect(store.commit).toHaveBeenCalledTimes(1);
  });

  it('C2: retry after an ambiguous external outcome uses the same idempotency key', async () => {
    const downstreamResults = new Map<string, { companyId: string }>();
    const execute = vi.fn(async (request) => {
      const existing = downstreamResults.get(request.idempotencyKey);
      if (existing) return existing;
      const result = { companyId: 'company-c2' };
      downstreamResults.set(request.idempotencyKey, result);
      return result;
    });
    const store: ToolExecutionStore = {
      reserve: vi.fn()
        .mockResolvedValueOnce({ kind: 'RESERVED', state: 'IN_PROGRESS' })
        .mockResolvedValueOnce({ kind: 'RETRY', state: 'FAILED_RETRYABLE' }),
      get: vi.fn(async () => null),
      commit: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
    };
    const service = new ToolExecutionService({ authorize: async () => true, execute, store });
    const request = { tool, input: { name: 'Acme Capital' }, context, idempotencyKey: 'idem-c2' };

    // Model the downstream operation having succeeded, while the first worker crashed before commit.
    const firstExternalResult = await execute(request);
    const recovered = await service.execute(request);

    expect(firstExternalResult).toEqual(recovered.output);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0].idempotencyKey).toBe('idem-c2');
    expect(execute.mock.calls[1][0].idempotencyKey).toBe('idem-c2');
  });

  it('C3: after the durable commit, a restarted worker replays without invoking the external effect', async () => {
    const execute = vi.fn().mockResolvedValue({ companyId: 'company-c3' });
    const store: ToolExecutionStore = {
      reserve: vi.fn().mockResolvedValue({ kind: 'REPLAY', state: 'SUCCEEDED', output: { companyId: 'company-c3' } }),
      get: vi.fn().mockResolvedValue({ companyId: 'company-c3' }),
      commit: vi.fn(),
      fail: vi.fn(),
    };
    const service = new ToolExecutionService({ authorize: async () => true, execute, store });

    const result = await service.execute({
      tool,
      input: { name: 'Acme Capital' },
      context,
      idempotencyKey: 'idem-c3',
    });

    expect(result).toEqual({ output: { companyId: 'company-c3' }, replayed: true });
    expect(execute).not.toHaveBeenCalled();
    expect(store.commit).not.toHaveBeenCalled();
  });

  it('does not let an active reservation be stolen by another worker', async () => {
    const store: ToolExecutionStore = {
      reserve: vi.fn().mockResolvedValue({ kind: 'CONFLICT', state: 'IN_PROGRESS' }),
      get: vi.fn(async () => null),
      commit: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
    };
    const execute = vi.fn();
    const service = new ToolExecutionService({ authorize: async () => true, execute, store });

    await expect(
      service.execute({ tool, input: { name: 'Acme Capital' }, context, idempotencyKey: 'idem-active' }),
    ).rejects.toBeInstanceOf(IdempotencyInProgressError);
    expect(execute).not.toHaveBeenCalled();
  });
});
