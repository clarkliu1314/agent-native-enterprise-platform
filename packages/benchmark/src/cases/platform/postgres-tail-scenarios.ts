import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { RecoveryCandidateStore, RecoveryCoordinator } from '@agent-native/durability';
import { PostgresToolExecutionStore, ToolExecutionService, type ToolExecutionRequest } from '@agent-native/tool-runtime';
import type { BenchmarkAdapter, BenchmarkCase } from '../../framework/types';
import type { BenchmarkScenarioResult } from '../../framework/scenario-runner';

const ELIGIBILITY_SKEW_MS = 5_000;

export async function executePostgresTailScenario(
  caseId: Extract<BenchmarkCase['id'], 'B14' | 'B15' | 'B16'>,
  adapter: BenchmarkAdapter,
  databaseUrl: string,
): Promise<BenchmarkScenarioResult> {
  const pool = new Pool({ connectionString: databaseUrl });
  const toolStore = new PostgresToolExecutionStore(pool);
  const recoveryStore = new RecoveryCandidateStore(pool);
  const prefix = `pg-benchmark-${caseId}-${adapter}-${randomUUID()}`;
  const request = createRequest(prefix);
  const runId = `${prefix}:run`;

  try {
    await toolStore.migrate();
    await recoveryStore.migrate();
    await cleanup(pool, prefix, runId);

    if (caseId === 'B14') {
      const firstNow = new Date(Date.now() + ELIGIBILITY_SKEW_MS);
      await seedCandidate(pool, runId, request);
      const firstLease = await recoveryStore.claimRecoveryCandidate(runId, 'retry-worker', 'lease-b14-1', 30_000, firstNow);
      if (!firstLease) return result(caseId, adapter, ['idempotency'], 'first recovery claim was not acquired');
      const firstFailure = await recoveryStore.recordRecoveryFailure({ runId, owner: firstLease.owner, leaseToken: firstLease.leaseToken, retryable: true, error: new Error('retryable failure 1'), now: firstNow, baseBackoffMs: 1_000, maxBackoffMs: 2_000 });
      const secondNow = new Date(firstFailure.nextAttemptAt.getTime() + ELIGIBILITY_SKEW_MS);
      const secondLease = await recoveryStore.claimRecoveryCandidate(runId, 'retry-worker', 'lease-b14-2', 30_000, secondNow);
      if (!secondLease) return result(caseId, adapter, ['idempotency'], 'second recovery claim was not acquired');
      const secondFailure = await recoveryStore.recordRecoveryFailure({ runId, owner: secondLease.owner, leaseToken: secondLease.leaseToken, retryable: true, error: new Error('retryable failure 2'), now: secondNow, baseBackoffMs: 1_000, maxBackoffMs: 2_000 });
      const firstDelay = firstFailure.nextAttemptAt.getTime() - firstNow.getTime();
      const secondDelay = secondFailure.nextAttemptAt.getTime() - secondNow.getTime();
      const beforeDue = await recoveryStore.findRecoverableCandidates(10, secondNow);
      const afterDue = await recoveryStore.findRecoverableCandidates(10, new Date(secondFailure.nextAttemptAt.getTime() + 1));
      const valid = firstFailure.state === 'FAILED_RETRYABLE' && secondFailure.state === 'FAILED_RETRYABLE' && firstFailure.attempts === 1 && secondFailure.attempts === 2 && firstDelay === 1_000 && secondDelay === 2_000 && !beforeDue.some((entry) => entry.runId === runId) && afterDue.some((entry) => entry.runId === runId);
      return result(caseId, adapter, valid ? [] : ['idempotency'], `postgresql: true; adapter: ${adapter}; attempts: ${secondFailure.attempts}; backoff: ${firstDelay},${secondDelay}; next attempt delayed: ${secondFailure.nextAttemptAt > secondNow}`);
    }

    if (caseId === 'B15') {
      const now = new Date(Date.now() + ELIGIBILITY_SKEW_MS);
      await seedCandidate(pool, runId, request);
      const lease = await recoveryStore.claimRecoveryCandidate(runId, 'terminal-worker', 'lease-b15', 30_000, now);
      if (!lease) return result(caseId, adapter, ['idempotency'], 'terminal failure claim was not acquired');
      const failure = await recoveryStore.recordRecoveryFailure({ runId, owner: lease.owner, leaseToken: lease.leaseToken, retryable: false, error: new Error('non-retryable failure'), now });
      const candidates = await recoveryStore.findRecoverableCandidates(10, new Date(now.getTime() + 60_000));
      const valid = failure.state === 'FAILED_FINAL' && failure.attempts === 1 && !candidates.some((entry) => entry.runId === runId);
      return result(caseId, adapter, valid ? [] : ['idempotency'], `postgresql: true; adapter: ${adapter}; state: ${failure.state}; attempts: ${failure.attempts}; retry scheduled: ${candidates.some((entry) => entry.runId === runId)}`);
    }

    const state = { externalEffects: 0 };
    const service = new ToolExecutionService({ authorize: async () => true, execute: async () => { state.externalEffects += 1; return { caseId, adapter, recovered: true }; }, store: toolStore });
    const coordinator = new RecoveryCoordinator(service);
    const now = new Date(Date.now() + ELIGIBILITY_SKEW_MS);
    await seedRetryableTool(pool, request);
    await seedCandidate(pool, runId, request);
    const leases = await Promise.all([
      recoveryStore.claimRecoveryCandidate(runId, 'worker-1', 'lease-b16-1', 30_000, now),
      recoveryStore.claimRecoveryCandidate(runId, 'worker-2', 'lease-b16-2', 30_000, now),
    ]);
    const winners = leases.filter((lease): lease is NonNullable<typeof lease> => lease !== null);
    if (winners.length !== 1) return result(caseId, adapter, ['idempotency', 'outbox'], `postgresql: true; adapter: ${adapter}; claim winners: ${winners.length}; logical effects: ${state.externalEffects}`);
    const recovered = await coordinator.recover({ request, state: 'FAILED_RETRYABLE' });
    await recoveryStore.completeRecovery(winners[0].runId, winners[0].owner, winners[0].leaseToken);
    const outboxRows = await pool.query('SELECT COUNT(*)::int AS count FROM outbox_events WHERE tenant_id = $1 AND idempotency_key = $2', [request.context.tenantId, request.idempotencyKey]);
    const outboxEvents = Number(outboxRows.rows[0]?.count ?? 0);
    const valid = recovered.replayed === false && state.externalEffects === 1 && outboxEvents === 1;
    return result(caseId, adapter, valid ? [] : ['idempotency', 'outbox'], `postgresql: true; adapter: ${adapter}; claim winners: ${winners.length}; logical effects: ${state.externalEffects}; outbox events: ${outboxEvents}`);
  } finally {
    await cleanup(pool, prefix, runId);
    await pool.end();
  }
}

async function seedCandidate(pool: Pool, runId: string, request: ToolExecutionRequest): Promise<void> {
  await pool.query(`INSERT INTO agent_runs (run_id, agent_id, state, input, version, metadata, recovery_state, recovery_attempts, next_attempt_at) VALUES ($1, 'benchmark-agent', 'RUNNING', '{}', 0, $2::jsonb, 'IN_PROGRESS', 0, NOW())`, [runId, JSON.stringify({ recovery_request: request })]);
}
async function seedRetryableTool(pool: Pool, request: ToolExecutionRequest): Promise<void> {
  const store = new PostgresToolExecutionStore(pool);
  await store.reserve({ idempotencyKey: request.idempotencyKey, tenantId: request.context.tenantId, toolName: request.tool.name, actorId: request.context.actorId, input: request.input });
  await store.fail({ idempotencyKey: request.idempotencyKey, tenantId: request.context.tenantId, toolName: request.tool.name, error: new Error('worker crashed'), retryable: true });
}
function createRequest(prefix: string): ToolExecutionRequest { return { tool: { name: 'benchmark.effect', description: 'deterministic benchmark tool', sideEffect: true }, input: { prefix }, context: { actorId: 'benchmark-actor', tenantId: prefix, permissions: ['tool:benchmark.effect'] }, idempotencyKey: `${prefix}:request` }; }
async function cleanup(pool: Pool, prefix: string, runId: string): Promise<void> { await pool.query('DELETE FROM agent_runs WHERE run_id = $1', [runId]); await pool.query('DELETE FROM outbox_events WHERE tenant_id = $1', [prefix]); await pool.query('DELETE FROM tool_execution_idempotency WHERE tenant_id = $1', [prefix]); }
function result(caseId: BenchmarkCase['id'], adapter: BenchmarkAdapter, violations: string[], details: string): BenchmarkScenarioResult { return { invariantViolations: violations, details: `case: ${caseId}; ${details}` }; }
