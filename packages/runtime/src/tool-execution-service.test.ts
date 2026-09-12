import { describe, expect, it, vi } from 'vitest';
import type { ToolKind } from '@agent-native/runtime-contract/durable';
import type { ToolInvoker, ToolPermission } from './ports';
import type { DurableRepositories, ToolCallRecord } from './repositories';
import { ToolExecutionService } from './tool-execution-service';

const input = {
  runId: 'run-1', agentId: 'agent-1', owner: 'worker-1', fencingToken: 4n,
  toolCallId: 'tool-call-1', toolName: 'transfer', kind: 'SIDE_EFFECTING' as ToolKind,
  input: { amount: 10 }, idempotencyKey: 'idem-1',
};

describe('ToolExecutionService', () => {
  it('checks permission before any durable tool record or external effect', async () => {
    const authorize = vi.fn<ToolPermission['authorize']>().mockResolvedValue(false);
    const createToolCall = vi.fn<NonNullable<DurableRepositories['createToolCall']>>().mockResolvedValue();
    const invoke = vi.fn<ToolInvoker['invoke']>();
    const service = new ToolExecutionService({ createToolCall } as unknown as DurableRepositories, { authorize }, { invoke });

    await expect(service.execute(input)).rejects.toMatchObject({ name: 'ToolPermissionDeniedError' });
    expect(authorize).toHaveBeenCalledOnce();
    expect(createToolCall).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('replays a successful logical tool call without invoking the side effect again', async () => {
    const existing: ToolCallRecord = { ...input, status: 'SUCCEEDED', output: { ok: true } };
    const authorize = vi.fn<ToolPermission['authorize']>().mockResolvedValue(true);
    const getToolCall = vi.fn<NonNullable<DurableRepositories['getToolCall']>>().mockResolvedValue(existing);
    const invoke = vi.fn<ToolInvoker['invoke']>();
    const service = new ToolExecutionService({ getToolCall } as unknown as DurableRepositories, { authorize }, { invoke });

    await expect(service.execute(input)).resolves.toEqual({ ok: true });
    expect(getToolCall).toHaveBeenCalledWith('tool-call-1');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects a successful external result when the fencing token is lost', async () => {
    const authorize = vi.fn<ToolPermission['authorize']>().mockResolvedValue(true);
    const getToolCall = vi.fn<NonNullable<DurableRepositories['getToolCall']>>().mockResolvedValue(null);
    const createToolCall = vi.fn<NonNullable<DurableRepositories['createToolCall']>>().mockResolvedValue();
    const completeToolCall = vi.fn<NonNullable<DurableRepositories['completeToolCall']>>()
      .mockResolvedValue(false);
    const invoke = vi.fn<ToolInvoker['invoke']>().mockResolvedValue({ ok: true });
    const service = new ToolExecutionService({ getToolCall, createToolCall, completeToolCall } as unknown as DurableRepositories, { authorize }, { invoke });

    await expect(service.execute(input)).rejects.toMatchObject({ name: 'LostFencingError' });
    expect(invoke).toHaveBeenCalledOnce();
    expect(completeToolCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUCCEEDED', fencingToken: 4n }));
  });
});
