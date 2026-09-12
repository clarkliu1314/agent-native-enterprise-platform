import { describe, expect, it, vi } from 'vitest';
import type { ModelProvider } from './ports';
import type { ModelCallStore } from './model-execution-service';
import { ModelExecutionService, hashModelRequest } from './model-execution-service';

const request = { messages: [{ role: 'user', content: 'hello' }] };

describe('ModelExecutionService', () => {
  it('persists call intent and attempt before invoking the provider', async () => {
    const order: string[] = [];
    const store: ModelCallStore = {
      createCall: vi.fn(async () => { order.push('call'); }),
      createAttempt: vi.fn(async () => { order.push('attempt'); }),
      completeAttempt: vi.fn(async () => { order.push('attempt-complete'); }),
      completeCall: vi.fn(async () => { order.push('call-complete'); }),
    };
    const provider: ModelProvider = { invoke: vi.fn(async () => { order.push('provider'); return { providerRequestId: 'provider-1', response: { text: 'ok' } }; }) };
    const service = new ModelExecutionService(store, provider);

    await expect(service.execute({ callId: 'call-1', runId: 'run-1', model: 'test-model', request, replayPolicy: 'REPLAYABLE' })).resolves.toEqual({ text: 'ok' });

    expect(order).toEqual(['call', 'attempt', 'provider', 'attempt-complete', 'call-complete']);
    expect(store.createCall).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-1', requestHash: hashModelRequest(request), replayPolicy: 'REPLAYABLE' }));
  });

  it('replays a durable successful call without invoking the provider again', async () => {
    const store: ModelCallStore = {
      getCall: vi.fn().mockResolvedValue({ status: 'SUCCEEDED', response: { text: 'cached' }, replayPolicy: 'REPLAYABLE', attemptCount: 1 }),
      createCall: vi.fn().mockResolvedValue(),
      createAttempt: vi.fn().mockResolvedValue(),
      completeAttempt: vi.fn().mockResolvedValue(),
      completeCall: vi.fn().mockResolvedValue(),
    };
    const provider: ModelProvider = { invoke: vi.fn() };
    const service = new ModelExecutionService(store, provider);

    await expect(service.execute({ callId: 'call-replay', runId: 'run-1', model: 'test-model', request, replayPolicy: 'REPLAYABLE' })).resolves.toEqual({ text: 'cached' });
    expect(provider.invoke).not.toHaveBeenCalled();
    expect(store.createAttempt).not.toHaveBeenCalled();
  });

  it('records a failed non-replayable provider call and converts it to a durable non-replayable error', async () => {
    const store: ModelCallStore = {
      createCall: vi.fn().mockResolvedValue(),
      createAttempt: vi.fn().mockResolvedValue(),
      completeAttempt: vi.fn().mockResolvedValue(),
      completeCall: vi.fn().mockResolvedValue(),
    };
    const provider: ModelProvider = { invoke: vi.fn().mockRejectedValue(new Error('provider timeout')) };
    const service = new ModelExecutionService(store, provider);

    await expect(service.execute({ callId: 'call-2', runId: 'run-1', model: 'test-model', request, replayPolicy: 'NON_REPLAYABLE' }))
      .rejects.toMatchObject({ name: 'NonReplayableExecutionError' });
    expect(store.completeAttempt).toHaveBeenCalledWith(expect.objectContaining({ attemptId: 'call-2:attempt:1', outcome: 'FAILED' }));
    expect(store.completeCall).toHaveBeenCalledWith({ callId: 'call-2', error: 'provider timeout' });
  });
});
