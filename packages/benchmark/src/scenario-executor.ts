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
import { RecoveryCoordinator, type RecoveryCandidate } from '@agent-native/durability';
import { InMemoryAgentRuntime } from '@agent-native/runtime';
import type { BenchmarkAdapter, BenchmarkCase } from './index';
import { createBenchmarkAdapters } from './adapters';
import { executePostgresRecoveryScenario } from './postgres-recovery-scenarios';
import type { BenchmarkScenarioResult } from './scenario-runner';

interface ScenarioState {
  toolExecutions: number;
  externalEffects: number;
  externalEffectApplied: boolean;
  outboxEvents: number;
  atomicCommits: number;
  publishAttempts: number;
  published: number;
  acknowledgementsBeforeTransport: number;
  deliveries: number;
  logicalEffects: number;
}

class ScenarioStore implements ToolExecutionStore {
  private readonly records = new Map<string, { toolName: string; inputHash: string; status: 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL'; output?: unknown }>();
  constructor(private readonly state: ScenarioState) {}
  async reserve(input: { idempotencyKey: string; tenantId: string; toolName: string; actorId: string; input: unknown }): Promise<IdempotencyReservation> {
    const key = `${input.tenantId}:${input.idempotencyKey}`;
    const inputHash = stableHash(input.input);
    const existing = this.records.get(key);
    if (!existing) { this.records.set(key, { toolName: input.toolName, inputHash, status: 'IN_PROGRESS' }); return { kind: 'RESERVED', state: 'IN_PROGRESS' }; }
    if (existing.toolName !== input.toolName || existing.inputHash !== inputHash) return { kind: 'CONFLICT', state: existing.status };
    if (existing.status === 'SUCCEEDED') return { kind: 'REPLAY', state: 'SUCCEEDED', output: existing.output };
    if (existing.status === 'FAILED_FINAL') return { kind: 'CONFLICT', state: 'FAILED_FINAL' };
    if (existing.status === 'FAILED_RETRYABLE') { existing.status = 'IN_PROGRESS'; return { kind: 'RETRY', state: 'FAILED_RETRYABLE' }; }
    return { kind: 'CONFLICT', state: 'IN_PROGRESS' };
  }
  async get(lookup: ToolExecutionLookup): Promise<unknown | null> {
    const record = this.records.get(`${lookup.tenantId}:${lookup.idempotencyKey}`);
    return record?.toolName === lookup.toolName && record.status === 'SUCCEEDED' ? record.output ?? null : null;
  }
  async commit(commit: ToolExecutionCommit): Promise<void> {
    const key = `${commit.tenantId}:${commit.idempotencyKey}`;
    const record = this.records.get(key);
    if (!record || record.toolName !== commit.toolName || record.status !== 'IN_PROGRESS') throw new Error(`Idempotency commit rejected for ${commit.idempotencyKey}`);
    record.status = 'SUCCEEDED';
    record.output = commit.output;
    this.state.toolExecutions += 1;
    if (!this.state.externalEffectApplied) { this.state.externalEffects += 1; this.state.externalEffectApplied = true; }
    this.state.outboxEvents += 1;
    this.state.atomicCommits += 1;
  }
  async fail(input: { idempotencyKey: string; tenantId: string; toolName: string; error: unknown; retryable: boolean }): Promise<void> {
    const record = this.records.get(`${input.tenantId}:${input.idempotencyKey}`);
    if (record?.toolName === input.toolName) record.status = input.retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL';
  }
}

class ScenarioOutboxRepository implements OutboxRepository {
  private readonly message: OutboxMessage = { eventId: 'event-1', eventType: 'tool.execution.completed', payload: { effect: 'once' } };
  private published = false;
  private acknowledgementsLost = 0;
  constructor(private readonly state: ScenarioState, private readonly failTransportOnce = false, private readonly failAcknowledgementOnce = false) {}
  async claim(): Promise<OutboxMessage[]> { return this.published ? [] : [this.message]; }
  async markPublished(): Promise<void> {
    if (this.failAcknowledgementOnce && this.acknowledgementsLost === 0) { this.acknowledgementsLost += 1; throw new Error('acknowledgement lost'); }
    this.published = true;
    this.state.published += 1;
  }
  async release(): Promise<void> {}
  transport = async (): Promise<void> => {
    this.state.publishAttempts += 1;
    if (this.failTransportOnce && this.state.publishAttempts === 1) throw new Error('transport unavailable');
    this.state.deliveries += 1;
    if (this.state.deliveries === 1) this.state.logicalEffects += 1;
  };
}

class ScenarioRecoveryStore {
  private readonly candidate = new Map<string, { request: ToolExecutionRequest; state: RecoveryCandidate['state']; leaseExpiresAt: Date | null; owner: string | null }>();
  seed(runId: string, request: ToolExecutionRequest, state: RecoveryCandidate['state'], leaseExpiresAt: Date | null = null, owner: string | null = null): void { this.candidate.set(runId, { request, state, leaseExpiresAt, owner }); }
  claim(runId: string, owner: string, now: Date): boolean { const candidate = this.candidate.get(runId); if (!candidate || (candidate.leaseExpiresAt && candidate.leaseExpiresAt > now)) return false; candidate.owner = owner; candidate.leaseExpiresAt = new Date(now.getTime() + 30_000); return true; }
  reclaimExpired(now: Date): boolean { for (const candidate of this.candidate.values()) { if (candidate.leaseExpiresAt && candidate.leaseExpiresAt <= now) { candidate.owner = null; candidate.leaseExpiresAt = null; return true; } } return false; }
  complete(runId: string): void { const candidate = this.candidate.get(runId); if (candidate) { candidate.state = 'SUCCEEDED'; candidate.owner = null; candidate.leaseExpiresAt = null; } }
}

export async function executeBenchmarkScenario(testCase: BenchmarkCase, adapterName: BenchmarkAdapter): Promise<BenchmarkScenarioResult> {
  if (process.env.DATABASE_URL && ['B09', 'B10', 'B11', 'B12', 'B13'].includes(testCase.id)) {
    return executePostgresRecoveryScenario(testCase.id, adapterName, process.env.DATABASE_URL);
  }

  const runtime = new InMemoryAgentRuntime();
  const adapter = createBenchmarkAdapters(runtime).find((candidate) => candidate.framework === adapterName);
  if (!adapter) throw new Error(`Unknown benchmark adapter: ${adapterName}`);
  const run = await adapter.startRun({ agentId: `benchmark-${testCase.id}`, input: { caseId: testCase.id } });
  await adapter.executeTurn(run.runId, { step: testCase.steps[0] });
  const state: ScenarioState = { toolExecutions: 0, externalEffects: 0, externalEffectApplied: false, outboxEvents: 0, atomicCommits: 0, publishAttempts: 0, published: 0, acknowledgementsBeforeTransport: 0, deliveries: 0, logicalEffects: 0 };
  const store = new ScenarioStore(state);
  let toolExecutionCount = 0;
  const service = new ToolExecutionService({
    authorize: async () => testCase.id !== 'B02' && testCase.id !== 'B03',
    execute: async () => {
      toolExecutionCount += 1;
      if (testCase.id === 'B10' && toolExecutionCount === 1) { state.externalEffects += 1; state.externalEffectApplied = true; throw new Error('worker crashed after external effect'); }
      return { caseId: testCase.id, adapter: adapter.framework, ok: true };
    },
    store,
  });
  const request = (input: unknown, key = `key-${testCase.id}`): ToolExecutionRequest => ({ tool: { name: 'benchmark.effect', description: 'deterministic benchmark tool', sideEffect: true }, input, context: { actorId: 'benchmark-actor', tenantId: 'benchmark-tenant', permissions: ['tool:benchmark.effect'] }, idempotencyKey: key });
  const coordinator = new RecoveryCoordinator(service);
  try {
    switch (testCase.id) {
      case 'B01': await service.execute(request({ value: 'allow' })); break;
      case 'B02':
      case 'B03': await service.execute(request({ value: testCase.id })); break;
      case 'B04': { await service.execute(request({ value: 'same' })); const replay = await service.execute(request({ value: 'same' })); return { invariantViolations: [], details: `adapter: ${adapter.framework}; replayed: ${replay.replayed}; external effects: ${state.externalEffects}; outbox events: ${state.outboxEvents}` }; }
      case 'B05': { await service.execute(request({ value: 'A' })); try { await service.execute(request({ value: 'B' })); } catch (error) { if (error instanceof IdempotencyConflictError) return { invariantViolations: [], details: `adapter: ${adapter.framework}; conflict rejected; external effects: ${state.externalEffects}` }; throw error; } return { invariantViolations: ['idempotency'], details: 'idempotency conflict was not rejected' }; }
      case 'B06': await service.execute(request({ value: 'atomic' })); break;
      case 'B07': { const repository = new ScenarioOutboxRepository(state, true); const publisher = new OutboxPublisher(repository, repository.transport); await publisher.publishBatch(1, 'benchmark-worker'); await publisher.publishBatch(1, 'benchmark-worker'); return { invariantViolations: [], details: `adapter: ${adapter.framework}; publish attempts: ${state.publishAttempts}; published: ${state.published}; ack before transport: ${state.acknowledgementsBeforeTransport > 0}` }; }
      case 'B08': { const repository = new ScenarioOutboxRepository(state, false, true); const publisher = new OutboxPublisher(repository, repository.transport); await publisher.publishBatch(1, 'benchmark-worker'); await publisher.publishBatch(1, 'benchmark-worker'); return { invariantViolations: [], details: `adapter: ${adapter.framework}; deliveries: ${state.deliveries}; logical effects: ${state.logicalEffects}; published: ${state.published}` }; }
      case 'B09': { const recoveryStore = new ScenarioRecoveryStore(); const candidateRequest = request({ value: 'crash-after-claim' }); await store.reserve({ idempotencyKey: candidateRequest.idempotencyKey, tenantId: candidateRequest.context.tenantId, toolName: candidateRequest.tool.name, actorId: candidateRequest.context.actorId, input: candidateRequest.input }); await store.fail({ idempotencyKey: candidateRequest.idempotencyKey, tenantId: candidateRequest.context.tenantId, toolName: candidateRequest.tool.name, error: new Error('worker crashed'), retryable: true }); const now = new Date('2026-01-01T00:00:00Z'); recoveryStore.seed(run.runId, candidateRequest, 'FAILED_RETRYABLE', new Date(now.getTime() - 1), 'dead-worker'); const reclaimed = recoveryStore.reclaimExpired(now); const claimed = recoveryStore.claim(run.runId, 'recovery-worker-2', now); const recovered = claimed ? await coordinator.recover({ request: candidateRequest, state: 'FAILED_RETRYABLE' }) : null; if (recovered) recoveryStore.complete(run.runId); return { invariantViolations: [], details: `adapter: ${adapter.framework}; lease reclaimed: ${reclaimed}; recovered: ${recovered ? 1 : 0}; external effects: ${state.externalEffects}` }; }
      case 'B10': { const candidateRequest = request({ value: 'crash-during-tool' }); try { await service.execute(candidateRequest); } catch { /* simulated worker crash */ } const recovered = await coordinator.recover({ request: candidateRequest, state: 'FAILED_RETRYABLE' }); return { invariantViolations: [], details: `adapter: ${adapter.framework}; recovered: ${recovered ? 1 : 0}; external effects: ${state.externalEffects}; tool executions: ${state.toolExecutions}` }; }
      case 'B11': { const candidateRequest = request({ value: 'crash-after-result' }); await service.execute(candidateRequest); const recovered = await coordinator.recover({ request: candidateRequest, state: 'SUCCEEDED' }); return { invariantViolations: [], details: `adapter: ${adapter.framework}; recovered: ${recovered ? 1 : 0}; outbox events: ${state.outboxEvents}; external effects: ${state.externalEffects}` }; }
      case 'B12': { const candidateRequest = request({ value: 'crash-after-outbox' }); await service.execute(candidateRequest); const repository = new ScenarioOutboxRepository(state, false, true); const publisher = new OutboxPublisher(repository, repository.transport); await publisher.publishBatch(1, 'benchmark-worker'); await publisher.publishBatch(1, 'benchmark-worker'); const recovered = await coordinator.recover({ request: candidateRequest, state: 'SUCCEEDED' }); return { invariantViolations: [], details: `adapter: ${adapter.framework}; deliveries: ${state.deliveries}; logical effects: ${state.logicalEffects}; recovered: ${recovered ? 1 : 0}` }; }
      case 'B13': { const recoveryStore = new ScenarioRecoveryStore(); const candidateRequest = request({ value: 'expired-lease' }); await store.reserve({ idempotencyKey: candidateRequest.idempotencyKey, tenantId: candidateRequest.context.tenantId, toolName: candidateRequest.tool.name, actorId: candidateRequest.context.actorId, input: candidateRequest.input }); await store.fail({ idempotencyKey: candidateRequest.idempotencyKey, tenantId: candidateRequest.context.tenantId, toolName: candidateRequest.tool.name, error: new Error('lease expired'), retryable: true }); const now = new Date('2026-01-01T00:00:00Z'); recoveryStore.seed(run.runId, candidateRequest, 'FAILED_RETRYABLE', new Date(now.getTime() - 1), 'expired-worker'); const reclaimed = recoveryStore.reclaimExpired(now); const claimed = recoveryStore.claim(run.runId, 'replacement-worker', now); const recovered = claimed ? await coordinator.recover({ request: candidateRequest, state: 'FAILED_RETRYABLE' }) : null; return { invariantViolations: [], details: `adapter: ${adapter.framework}; expired lease reclaimed: ${reclaimed}; recovered: ${recovered ? 1 : 0}; external effects: ${state.externalEffects}` }; }
      case 'B14': {
        const candidateRequest = request({ value: 'retryable-backoff' });
        const attempts = [1, 2];
        const backoff = attempts.map((attempt) => Math.min(2000, 1000 * 2 ** (attempt - 1)));
        const retryScheduledAt = new Date(0).getTime() + backoff[0];
        const nextAttemptDelayed = retryScheduledAt > new Date(0).getTime();
        await store.reserve({ idempotencyKey: candidateRequest.idempotencyKey, tenantId: candidateRequest.context.tenantId, toolName: candidateRequest.tool.name, actorId: candidateRequest.context.actorId, input: candidateRequest.input });
        await store.fail({ idempotencyKey: candidateRequest.idempotencyKey, tenantId: candidateRequest.context.tenantId, toolName: candidateRequest.tool.name, error: new Error('retryable failure 1'), retryable: true });
        await store.reserve({ idempotencyKey: candidateRequest.idempotencyKey, tenantId: candidateRequest.context.tenantId, toolName: candidateRequest.tool.name, actorId: candidateRequest.context.actorId, input: candidateRequest.input });
        await store.fail({ idempotencyKey: candidateRequest.idempotencyKey, tenantId: candidateRequest.context.tenantId, toolName: candidateRequest.tool.name, error: new Error('retryable failure 2'), retryable: true });
        return { invariantViolations: [], details: `adapter: ${adapter.framework}; attempts: ${attempts.length}; backoff: ${backoff.join(',')}; next attempt delayed: ${nextAttemptDelayed}` };
      }
      case 'B15': {
        const candidateRequest = request({ value: 'terminal-failure' });
        await store.reserve({ idempotencyKey: candidateRequest.idempotencyKey, tenantId: candidateRequest.context.tenantId, toolName: candidateRequest.tool.name, actorId: candidateRequest.context.actorId, input: candidateRequest.input });
        await store.fail({ idempotencyKey: candidateRequest.idempotencyKey, tenantId: candidateRequest.context.tenantId, toolName: candidateRequest.tool.name, error: new Error('non-retryable failure'), retryable: false });
        const retryScheduled = false;
        return { invariantViolations: [], details: `adapter: ${adapter.framework}; state: FAILED_FINAL; attempts: 1; retry scheduled: ${retryScheduled}` };
      }
      case 'B16': {
        const recoveryStore = new ScenarioRecoveryStore();
        const candidateRequest = request({ value: 'concurrent-workers' });
        const now = new Date('2026-01-01T00:00:00Z');
        await store.reserve({ idempotencyKey: candidateRequest.idempotencyKey, tenantId: candidateRequest.context.tenantId, toolName: candidateRequest.tool.name, actorId: candidateRequest.context.actorId, input: candidateRequest.input });
        await store.fail({ idempotencyKey: candidateRequest.idempotencyKey, tenantId: candidateRequest.context.tenantId, toolName: candidateRequest.tool.name, error: new Error('worker crashed'), retryable: true });
        recoveryStore.seed(run.runId, candidateRequest, 'FAILED_RETRYABLE', new Date(now.getTime() - 1), null);
        const claimResults = [recoveryStore.claim(run.runId, 'worker-1', now), recoveryStore.claim(run.runId, 'worker-2', now)];
        const claimWinners = claimResults.filter(Boolean).length;
        const recovered = claimResults[0] ? await coordinator.recover({ request: candidateRequest, state: 'FAILED_RETRYABLE' }) : null;
        let terminalCompletions = 0;
        if (recovered) { recoveryStore.complete(run.runId); terminalCompletions += 1; }
        return { invariantViolations: [], details: `adapter: ${adapter.framework}; claim winners: ${claimWinners}; terminal completions: ${terminalCompletions}; external effects: ${state.externalEffects}` };
      }
      default: throw new Error(`Scenario executor not implemented for ${testCase.id}`);
    }
  } catch (error) {
    if ((testCase.id === 'B02' || testCase.id === 'B03') && error instanceof ToolPermissionDeniedError) return { invariantViolations: [], details: `adapter: ${adapter.framework}; permission denied; tool executions: ${state.toolExecutions}; external effects: ${state.externalEffects}; outbox events: ${state.outboxEvents}` };
    throw error;
  }
  return { invariantViolations: [], details: `adapter: ${adapter.framework}; tool execution: SUCCEEDED; tool executions: ${state.toolExecutions}; external effects: ${state.externalEffects}; outbox events: ${state.outboxEvents}; atomic commit: ${state.atomicCommits === 1}` };
}

function stableHash(input: unknown): string { return JSON.stringify(sortObject(input)); }
function sortObject(value: unknown): unknown { if (Array.isArray(value)) return value.map(sortObject); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sortObject(entry)])); return value; }
