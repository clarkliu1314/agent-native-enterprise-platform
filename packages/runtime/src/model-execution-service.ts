import { createHash } from 'node:crypto';
import type { ReplayPolicy } from '@agent-native/runtime-contract/durable';
import { NonReplayableExecutionError } from './errors';
import type { ModelProvider } from './ports';

export interface ModelCallRecord {
  status: 'REQUESTED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'WAITING';
  response?: unknown;
  error?: string;
  replayPolicy: ReplayPolicy;
  attemptCount: number;
}

export interface ModelCallStore {
  getCall?(callId: string): Promise<ModelCallRecord | null>;
  createCall(input: { callId: string; runId: string; turnId?: string; model: string; requestHash: string; replayPolicy: ReplayPolicy }): Promise<void>;
  createAttempt(input: { attemptId: string; callId: string; attemptNumber: number; requestHash: string; providerRequestId?: string }): Promise<void>;
  completeAttempt(input: { attemptId: string; outcome: 'SUCCEEDED' | 'FAILED'; providerRequestId?: string }): Promise<void>;
  completeCall(input: { callId: string; response?: unknown; error?: string }): Promise<void>;
}

export const hashModelRequest = (request: unknown): string =>
  createHash('sha256').update(JSON.stringify(request)).digest('hex');

export class ModelExecutionService {
  constructor(private readonly store: ModelCallStore, private readonly provider: ModelProvider) {}

  async execute(input: { callId: string; runId: string; turnId?: string; model: string; request: unknown; replayPolicy: ReplayPolicy }): Promise<unknown> {
    const requestHash = hashModelRequest(input.request);
    const existing = this.store.getCall ? await this.store.getCall(input.callId) : null;
    if (existing?.status === 'SUCCEEDED') return existing.response;
    if (existing?.status === 'WAITING' && existing.replayPolicy === 'NON_REPLAYABLE') {
      throw new NonReplayableExecutionError('model', input.callId);
    }
    await this.store.createCall({ callId: input.callId, runId: input.runId, turnId: input.turnId, model: input.model, requestHash, replayPolicy: input.replayPolicy });
    const attemptNumber = Math.max(1, (existing?.attemptCount ?? 0) + 1);
    const attemptId = `${input.callId}:attempt:${attemptNumber}`;
    await this.store.createAttempt({ attemptId, callId: input.callId, attemptNumber, requestHash });
    try {
      const result = await this.provider.invoke({ model: input.model, request: input.request, requestHash });
      await this.store.completeAttempt({ attemptId, outcome: 'SUCCEEDED', providerRequestId: result.providerRequestId });
      await this.store.completeCall({ callId: input.callId, response: result.response });
      return result.response;
    } catch (error) {
      await this.store.completeAttempt({ attemptId, outcome: 'FAILED' });
      await this.store.completeCall({ callId: input.callId, error: error instanceof Error ? error.message : String(error) });
      if (input.replayPolicy === 'NON_REPLAYABLE') throw new NonReplayableExecutionError('model', input.callId);
      throw error;
    }
  }
}
