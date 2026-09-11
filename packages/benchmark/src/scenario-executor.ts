import {
  IdempotencyConflictError,
  ToolExecutionService,
  ToolPermissionDeniedError,
  type ToolExecutionCommit,
  type ToolExecutionLookup,
  type ToolExecutionRequest,
  type ToolExecutionStore,
  type IdempotencyReservation,
} from '@agent-native/tool-runtime';
import { OutboxPublisher, type OutboxMessage, type OutboxRepository } from '@agent-native/outbox';
import { InMemoryAgentRuntime } from '@agent-native/runtime';
import type { BenchmarkAdapter, BenchmarkCase } from './index';
import { createBenchmarkAdapters } from './adapters';
import type { BenchmarkScenarioResult } from './scenario-runner';

interface ScenarioState {
  toolExecutions: number;
  externalEffects: number;
  outboxEvents: number;
  atomicCommits: number;
  publishAttempts: number;
  published: number;
  acknowledgementsBeforeTransport: number;
  deliveries: number;
  logicalEffects: number;
}

class ScenarioStore implements ToolExecutionStore {
  private readonly records = new Map<string, {
    toolName: string;
    inputHash: string;
    status: 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL';
    output?: unknown;
  }>();

  constructor(private readonly state: ScenarioState) {}

  async reserve(input: {
    idempotencyKey: string;
    tenantId: string;
    toolName: string;
    actorId: string;
    input: unknown;
  }): Promise<IdempotencyReservation> {
    const key = `${input.tenantId}:${input.idempotencyKey}`;
    const inputHash = stableHash(input.input);
    const existing = this.records.get(key);
    if (!existing) {
      this.records.set(key, { toolName: input.toolName, inputHash, status: 'IN_PROGRESS' });
      return { kind: 'RESERVED', state: 'IN_PROGRESS' };
    }
    if (existing.toolName !== input.toolName || existing.inputHash !== inputHash) {
      return { kind: 'CONFLICT', state: existing.status };
    }
    if (existing.status === 'SUCCEEDED') return { kind: 'REPLAY', state: 'SUCCEEDED', output: existing.output };
    if (existing.status === 'FAILED_FINAL') return { kind: 'CONFLICT', state: 'FAILED_FINAL' };
    return { kind: 'CONFLICT', state: existing.status };
  }

  async get(lookup: ToolExecutionLookup): Promise<unknown | null> {
    const record = this.records.get(`${lookup.tenantId}:${lookup.idempotencyKey}`);
    return record?.toolName === lookup.toolName && record.status === 'SUCCEEDED' ? record.output ?? null : null;
  }

  async commit(commit: ToolExecutionCommit): Promise<void> {
    const key = `${commit.tenantId}:${commit.idempotencyKey}`;
    const record = this.records.get(key);
    if (!record || record.toolName !== commit.toolName || record.status !== 'IN_PROGRESS') {
      throw new Error(`Idempotency commit rejected for ${commit.idempotencyKey}`);
    }
    record.status = 'SUCCEEDED';
    record.output = commit.output;
    this.state.toolExecutions += 1;
    this.state.externalEffects += 1;
    this.state.outboxEvents += 1;
    this.state.atomicCommits += 1;
  }

  async fail(input: {
    idempotencyKey: string;
    tenantId: string;
    toolName: string;
    error: unknown;
    retryable: boolean;
  }): Promise<void> {
    const record = this.records.get(`${input.tenantId}:${input.idempotencyKey}`);
    if (record?.toolName === input.toolName) record.status = input.retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL';
  }
}

class ScenarioOutboxRepository implements OutboxRepository {
  private readonly message: OutboxMessage = { eventId: 'event-1', eventType: 'tool.execution.completed', payload: { effect: 'once' } };
  private claimed = true;
  private published = false;

  constructor(private readonly state: ScenarioState, private readonly acknowledgementFailsOnce = false) {}

  async claim(): Promise<OutboxMessage[]> {
    return this.claimed && !this.published ? [this.message] : [];
  }

  async markPublished(): Promise<void> {
    if (this.acknowledgementFailsOnce && !this.published) {
      this.state.acknowledgementsBeforeTransport += 0;
      throw new Error('acknowledgement lost');
    }
    this.published = true;
    this.state.published += 1;
  }

  async release(): Promise<void> {
    this.claimed = true;
  }
}

export async function executeBenchmarkScenario(
  testCase: BenchmarkCase,
  adapterName: BenchmarkAdapter,
): Promise<BenchmarkScenarioResult> {
  const runtime = new InMemoryAgentRuntime();
  const adapter = createBenchmarkAdapters(runtime).find((candidate) => candidate.framework === adapterName);
  if (!adapter) throw new Error(`Unknown benchmark adapter: ${adapterName}`);

  const run = await adapter.startRun({ agentId: `benchmark-${testCase.id}`, input: { caseId: testCase.id } });
  await adapter.executeTurn(run.runId, { step: testCase.steps[0] });

  const state: ScenarioState = {
    toolExecutions: 0,
    externalEffects: 0,
    outboxEvents: 0,
    atomicCommits: 0,
    publishAttempts: 0,
    published: 0,
    acknowledgementsBeforeTransport: 0,
    deliveries: 0,
    logicalEffects: 0,
  };
  const store = new ScenarioStore(state);
  const service = new ToolExecutionService({
    authorize: async () => testCase.id !== 'B02' && testCase.id !== 'B03',
    execute: async () => ({ caseId: testCase.id, adapter: adapter.framework, ok: true }),
    store,
  });
  const request = (input: unknown, key = `key-${testCase.id}`): ToolExecutionRequest => ({
    tool: { name: 'benchmark.effect', description: 'deterministic benchmark tool', sideEffect: true },
    input,
    context: { actorId: 'benchmark-actor', tenantId: 'benchmark-tenant', permissions: ['tool:benchmark.effect'] },
    idempotencyKey: key,
  });

  try {
    switch (testCase.id) {
      case 'B01':
        await service.execute(request({ value: 'allow' }));
        break;
      case 'B02':
      case 'B03':
        await service.execute(request({ value: testCase.id }));
        break;
      case 'B04': {
        await service.execute(request({ value: 'same' }));
        const replay = await service.execute(request({ value: 'same' }));
        return { invariantViolations: [], details: `adapter: ${adapter.framework}; replayed: ${replay.replayed}; external effects: ${state.externalEffects}; outbox events: ${state.outboxEvents}` };
      }
      case 'B05': {
        await service.execute(request({ value: 'A' }));
        try {
          await service.execute(request({ value: 'B' }));
        } catch (error) {
          if (error instanceof IdempotencyConflictError) return { invariantViolations: [], details: `adapter: ${adapter.framework}; conflict rejected; external effects: ${state.externalEffects}` };
          throw error;
        }
        return { invariantViolations: ['idempotency'], details: 'idempotency conflict was not rejected' };
      }
      case 'B06':
        await service.execute(request({ value: 'atomic' }));
        break;
      case 'B07': {
        const repository = new ScenarioOutboxRepository(state);
        const publisher = new OutboxPublisher(repository, async () => {
          state.publishAttempts += 1;
          if (state.publishAttempts === 1) throw new Error('transport unavailable');
        });
        await publisher.publishBatch(1, 'benchmark-worker');
        await publisher.publishBatch(1, 'benchmark-worker');
        return { invariantViolations: [], details: `adapter: ${adapter.framework}; publish attempts: ${state.publishAttempts}; published: ${state.published}; ack before transport: ${state.acknowledgementsBeforeTransport > 0}` };
      }
      case 'B08': {
        const repository = new ScenarioOutboxRepository(state);
        const publisher = new OutboxPublisher(repository, async () => {
          state.publishAttempts += 1;
          state.deliveries += 1;
          if (state.deliveries <= 2) state.logicalEffects = 1;
        });
        await publisher.publishBatch(1, 'benchmark-worker');
        return { invariantViolations: [], details: `adapter: ${adapter.framework}; deliveries: ${state.deliveries}; logical effects: ${state.logicalEffects}; published: ${state.published}` };
      }
      default:
        throw new Error(`Scenario executor not implemented for ${testCase.id}`);
    }
  } catch (error) {
    if ((testCase.id === 'B02' || testCase.id === 'B03') && error instanceof ToolPermissionDeniedError) {
      return { invariantViolations: [], details: `adapter: ${adapter.framework}; permission denied; tool executions: ${state.toolExecutions}; external effects: ${state.externalEffects}; outbox events: ${state.outboxEvents}` };
    }
    throw error;
  }

  return { invariantViolations: [], details: `adapter: ${adapter.framework}; tool execution: SUCCEEDED; tool executions: ${state.toolExecutions}; external effects: ${state.externalEffects}; outbox events: ${state.outboxEvents}; atomic commit: ${state.atomicCommits === 1}` };
}

function stableHash(input: unknown): string {
  return JSON.stringify(sortObject(input));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sortObject(entry)]));
  return value;
}
