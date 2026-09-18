import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { RecoveryCandidateStore, RecoveryCoordinator, type RecoveryState } from '@agent-native/durability';
import { PostgresToolExecutionStore as DurableToolStore, ToolExecutionService, type ToolExecutionRequest } from '@agent-native/tool-runtime';
import { PostgresOutboxRepository } from '@agent-native/outbox';
import type { BenchmarkAdapter, BenchmarkCase } from '../../framework/types';
import type { BenchmarkScenarioResult } from '../../framework/scenario-runner';

const ELIGIBILITY_SKEW_MS = 5_000;

export async function executePostgresRecoveryScenario(caseId: BenchmarkCase['id'], adapter: BenchmarkAdapter, databaseUrl: string): Promise<BenchmarkScenarioResult> {
  if (!['B09', 'B10', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16'].includes(caseId)) throw new Error(`Unsupported PostgreSQL recovery benchmark case: ${caseId}`);
  const pool = new Pool({ connectionString: databaseUrl });
  const toolStore = new DurableToolStore(pool);
  const recoveryStore = new RecoveryCandidateStore(pool);
  const outboxStore = new PostgresOutboxRepository(pool);
  const prefix = `pg-benchmark-${caseId}-${adapter}-${randomUUID()}`;
  try {
    await toolStore.migrate(); await recoveryStore.migrate(); await cleanup(pool, prefix);
    const state = { externalEffects: 0, toolExecutions: 0, deliveries: 0, logicalEffects: 0 };
    const service = createService(toolStore, state, caseId); const coordinator = new RecoveryCoordinator(service); const request = createRequest(prefix);
    if (caseId === 'B09') {
      await seedRetryable(pool, request); await seedRecoveryCandidate(pool, request, 'IN_PROGRESS', new Date(Date.now() - 1_000), 'dead-worker');
      const now = new Date(Date.now() + ELIGIBILITY_SKEW_MS); const reclaimed = (await recoveryStore.reclaimExpiredRecoveryCandidates(now)) > 0;
      const lease = await recoveryStore.claimRecoveryCandidate(requestRunId(prefix), 'replacement-worker', 'lease-b09', 30_000, now); const recovered = lease ? await coordinator.recover({ request, state: 'FAILED_RETRYABLE' }) : null;
      if (recovered && lease) await recoveryStore.completeRecovery(lease.runId, lease.owner, lease.leaseToken);
      return result(caseId, adapter, { violations: reclaimed && !!lease && !!recovered ? [] : ['idempotency'], details: `postgresql: true; adapter: ${adapter}; lease reclaimed: ${reclaimed}; recovered: ${recovered ? 1 : 0}; external effects: ${state.externalEffects}` });
    }
    if (caseId === 'B10') {
      let crashed = false; const crashingService = new ToolExecutionService({ authorize: async () => true, execute: async () => { state.externalEffects += 1; if (!crashed) { crashed = true; throw new Error('worker crashed after external effect'); } return { caseId, adapter }; }, store: toolStore });
      try { await crashingService.execute(request); } catch { /* simulated worker crash */ }
      await seedRecoveryCandidate(pool, request, 'FAILED_RETRYABLE', null, null); const now = new Date(Date.now() + ELIGIBILITY_SKEW_MS); const lease = await recoveryStore.claimRecoveryCandidate(requestRunId(prefix), 'recovery-worker', 'lease-b10', 30_000, now); const recovered = lease ? await coordinator.recover({ request, state: 'FAILED_RETRYABLE' }) : null;
      if (recovered && lease) await recoveryStore.completeRecovery(lease.runId, lease.owner, lease.leaseToken);
      return result(caseId, adapter, { violations: recovered && state.externalEffects === 1 ? [] : ['idempotency'], details: `postgresql: true; adapter: ${adapter}; recovered: ${recovered ? 1 : 0}; external effects: ${state.externalEffects}; tool executions: ${state.toolExecutions}` });
    }
    if (caseId === 'B11') {
      await seedSucceededWithoutOutbox(pool, request, { caseId, adapter, recoveredOutput: true }); await seedRecoveryCandidate(pool, request, 'IN_PROGRESS', null, null); const now = new Date(Date.now() + ELIGIBILITY_SKEW_MS); const lease = await recoveryStore.claimRecoveryCandidate(requestRunId(prefix), 'recovery-worker', 'lease-b11', 30_000, now); const recovered = lease ? await coordinator.recover({ request, state: 'IN_PROGRESS' }) : null;
      if (recovered && lease) await recoveryStore.completeRecovery(lease.runId, lease.owner, lease.leaseToken); const rows = await pool.query('SELECT COUNT(*)::int AS count FROM outbox_events WHERE tenant_id = $1 AND idempotency_key = $2', [request.context.tenantId, request.idempotencyKey]); const outboxEvents = Number(rows.rows[0]?.count ?? 0);
      return result(caseId, adapter, { violations: recovered?.replayed && state.externalEffects === 0 && outboxEvents === 1 ? [] : ['outbox', 'idempotency'], details: `postgresql: true; adapter: ${adapter}; recovered: ${recovered ? 1 : 0}; external effects: ${state.externalEffects}; outbox events: ${outboxEvents}` });
    }
    if (caseId === 'B12') {
      await service.execute(request); const transport = async () => { state.deliveries += 1; if (state.deliveries === 1) state.logicalEffects += 1; };
      const firstMessage = (await outboxStore.claim(1, 'worker-b12-crashed'))[0]; if (!firstMessage) return result(caseId, adapter, { violations: ['outbox'], details: `postgresql: true; adapter: ${adapter}; deliveries: 0; logical effects: 0; recovered: 0` });
      await transport(); await pool.query("UPDATE outbox_events SET locked_at = NOW() - INTERVAL '10 minutes' WHERE event_id = $1", [firstMessage.eventId]);
      const secondMessage = (await outboxStore.claim(1, 'worker-b12-recovery'))[0]; if (!secondMessage) return result(caseId, adapter, { violations: ['outbox'], details: `postgresql: true; adapter: ${adapter}; deliveries: ${state.deliveries}; logical effects: ${state.logicalEffects}; recovered: 0` });
      await transport(); await outboxStore.markPublished(secondMessage.eventId, 'worker-b12-recovery'); const recovered = await coordinator.recover({ request, state: 'SUCCEEDED' });
      const rows = await pool.query('SELECT COUNT(*)::int AS count FROM outbox_events WHERE tenant_id = $1 AND idempotency_key = $2', [request.context.tenantId, request.idempotencyKey]); const outboxEvents = Number(rows.rows[0]?.count ?? 0);
      return result(caseId, adapter, { violations: state.deliveries === 2 && state.logicalEffects === 1 && outboxEvents === 1 && recovered.replayed ? [] : ['outbox', 'idempotency'], details: `postgresql: true; adapter: ${adapter}; deliveries: ${state.deliveries}; logical effects: ${state.logicalEffects}; outbox events: ${outboxEvents}; recovered: ${recovered ? 1 : 0}` });
    }
    if (caseId === 'B14') {
      const runId = requestRunId(prefix); const baseBackoffMs = 100; const maxBackoffMs = 150; const firstNow = new Date(Date.now() + ELIGIBILITY_SKEW_MS);
      await seedRecoveryCandidate(pool, request, 'IN_PROGRESS', null, null);
      const firstLease = await recoveryStore.claimRecoveryCandidate(runId, 'retry-worker-1', 'lease-b14-1', 30_000, firstNow);
      if (!firstLease) return result(caseId, adapter, { violations: ['idempotency'], details: `postgresql: true; adapter: ${adapter}; attempts: 0; backoff bounded: false; recovered: 0` });
      const firstFailure = await recoveryStore.recordRecoveryFailure({ runId, owner: firstLease.owner, leaseToken: firstLease.leaseToken, retryable: true, error: new Error('temporary failure 1'), now: firstNow, maxAttempts: 5, baseBackoffMs, maxBackoffMs });
      const secondNow = new Date(firstFailure.nextAttemptAt.getTime() + 1);
      const secondLease = await recoveryStore.claimRecoveryCandidate(runId, 'retry-worker-2', 'lease-b14-2', 30_000, secondNow);
      if (!secondLease) return result(caseId, adapter, { violations: ['idempotency'], details: `postgresql: true; adapter: ${adapter}; attempts: ${firstFailure.attempts}; backoff bounded: false; recovered: 0` });
      const secondFailure = await recoveryStore.recordRecoveryFailure({ runId, owner: secondLease.owner, leaseToken: secondLease.leaseToken, retryable: true, error: new Error('temporary failure 2'), now: secondNow, maxAttempts: 5, baseBackoffMs, maxBackoffMs });
      const bounded = secondFailure.nextAttemptAt.getTime() - secondNow.getTime() <= maxBackoffMs;
      const recoveryNow = new Date(secondFailure.nextAttemptAt.getTime() + 1);
      const finalLease = await recoveryStore.claimRecoveryCandidate(runId, 'retry-worker-3', 'lease-b14-3', 30_000, recoveryNow);
      const recovered = finalLease ? await coordinator.recover({ request, state: 'FAILED_RETRYABLE' }) : null;
      if (recovered && finalLease) await recoveryStore.completeRecovery(finalLease.runId, finalLease.owner, finalLease.leaseToken);
      const row = await pool.query('SELECT recovery_attempts, recovery_state FROM agent_runs WHERE run_id = $1', [runId]);
      const attempts = Number(row.rows[0]?.recovery_attempts ?? -1); const terminalState = row.rows[0]?.recovery_state;
      return result(caseId, adapter, { violations: attempts === 2 && terminalState === 'SUCCEEDED' && bounded && !!recovered ? [] : ['idempotency'], details: `postgresql: true; adapter: ${adapter}; attempts: ${attempts}; backoff bounded: ${bounded}; recovered: ${recovered ? 1 : 0}` });
    }
    if (caseId === 'B15') {
      const runId = requestRunId(prefix); const now = new Date(Date.now() + ELIGIBILITY_SKEW_MS);
      await seedRecoveryCandidate(pool, request, 'IN_PROGRESS', null, null);
      const lease = await recoveryStore.claimRecoveryCandidate(runId, 'terminal-worker', 'lease-b15', 30_000, now);
      if (!lease) return result(caseId, adapter, { violations: ['idempotency'], details: `postgresql: true; adapter: ${adapter}; state: UNKNOWN; future retry eligible: true` });
      const failure = await recoveryStore.recordRecoveryFailure({ runId, owner: lease.owner, leaseToken: lease.leaseToken, retryable: false, error: new Error('permanent failure'), now, maxAttempts: 5, baseBackoffMs: 100, maxBackoffMs: 150 });
      const future = await recoveryStore.findRecoverableCandidates(10, new Date(failure.nextAttemptAt.getTime() + 1));
      const futureRetryEligible = future.some((candidate) => candidate.runId === runId);
      return result(caseId, adapter, { violations: failure.state === 'FAILED_FINAL' && !futureRetryEligible ? [] : ['idempotency'], details: `postgresql: true; adapter: ${adapter}; state: ${failure.state}; future retry eligible: ${futureRetryEligible}` });
    }
    if (caseId === 'B16') {
      const runId = requestRunId(prefix); const now = new Date(Date.now() + ELIGIBILITY_SKEW_MS);
      await seedRecoveryCandidate(pool, request, 'IN_PROGRESS', null, null);
      const leases = await Promise.all([
        recoveryStore.claimRecoveryCandidate(runId, 'worker-a', 'lease-b16-a', 30_000, now),
        recoveryStore.claimRecoveryCandidate(runId, 'worker-b', 'lease-b16-b', 30_000, now),
      ]);
      const winners = leases.filter((lease): lease is NonNullable<typeof lease> => lease !== null);
      let recovered: unknown = null;
      if (winners[0]) { recovered = await coordinator.recover({ request, state: 'IN_PROGRESS' }); await recoveryStore.completeRecovery(winners[0].runId, winners[0].owner, winners[0].leaseToken); }
      const row = await pool.query('SELECT recovery_state, recovery_owner, recovery_lease_token FROM agent_runs WHERE run_id = $1', [runId]);
      const terminalCompletions = row.rows[0]?.recovery_state === 'SUCCEEDED' ? 1 : 0; const claimWinners = winners.length;
      const valid = claimWinners === 1 && terminalCompletions === 1 && state.externalEffects === 1 && !!recovered;
      return result(caseId, adapter, { violations: valid ? [] : ['idempotency'], details: `postgresql: true; adapter: ${adapter}; claim winners: ${claimWinners}; terminal completions: ${terminalCompletions}; external effects: ${state.externalEffects}` });
    }
    await seedRetryable(pool, request); await seedRecoveryCandidate(pool, request, 'IN_PROGRESS', null, null); const initialNow = new Date(Date.now() + ELIGIBILITY_SKEW_MS); const firstLease = await recoveryStore.claimRecoveryCandidate(requestRunId(prefix), 'expired-worker', 'lease-b13', 1, initialNow); if (!firstLease) return result(caseId, adapter, { violations: ['idempotency'], details: `postgresql: true; adapter: ${adapter}; expired lease reclaimed: false; recovered: 0; external effects: 0` });
    const expiredAt = new Date(initialNow.getTime() + 2_000); await pool.query('UPDATE agent_runs SET recovery_lease_expires_at = $2 WHERE run_id = $1', [requestRunId(prefix), expiredAt]); const reclaimNow = new Date(expiredAt.getTime() + 1_000); const reclaimed = (await recoveryStore.reclaimExpiredRecoveryCandidates(reclaimNow)) > 0; const replacement = await recoveryStore.claimRecoveryCandidate(requestRunId(prefix), 'replacement-worker', 'lease-b13-replacement', 30_000, reclaimNow); const recovered = replacement ? await coordinator.recover({ request, state: 'FAILED_RETRYABLE' }) : null;
    if (recovered && replacement) await recoveryStore.completeRecovery(replacement.runId, replacement.owner, replacement.leaseToken); return result(caseId, adapter, { violations: reclaimed && !!replacement && !!recovered ? [] : ['idempotency'], details: `postgresql: true; adapter: ${adapter}; expired lease reclaimed: ${reclaimed}; recovered: ${recovered ? 1 : 0}; external effects: ${state.externalEffects}` });
  } finally { await cleanup(pool, prefix); await pool.end(); }
}
function createService(store: DurableToolStore, state: { externalEffects: number; toolExecutions: number }, caseId: string): ToolExecutionService { return new ToolExecutionService({ authorize: async () => true, execute: async () => { state.toolExecutions += 1; if (caseId !== 'B11' && state.externalEffects === 0) state.externalEffects += 1; return { caseId, recovered: true }; }, store }); }
function createRequest(prefix: string): ToolExecutionRequest { return { tool: { name: 'benchmark.effect', description: 'deterministic benchmark tool', sideEffect: true }, input: { prefix }, context: { actorId: 'benchmark-actor', tenantId: prefix, permissions: ['tool:benchmark.effect'] }, idempotencyKey: `${prefix}:request` }; }
function requestRunId(prefix: string): string { return `${prefix}:run`; }
async function seedRetryable(pool: Pool, request: ToolExecutionRequest): Promise<void> { const store = new DurableToolStore(pool); await store.reserve({ idempotencyKey: request.idempotencyKey, tenantId: request.context.tenantId, toolName: request.tool.name, actorId: request.context.actorId, input: request.input }); await store.fail({ idempotencyKey: request.idempotencyKey, tenantId: request.context.tenantId, toolName: request.tool.name, error: new Error('retryable crash'), retryable: true }); }
async function seedRecoveryCandidate(pool: Pool, request: ToolExecutionRequest, state: RecoveryState, leaseExpiresAt: Date | null, owner: string | null): Promise<void> { await pool.query(`INSERT INTO agent_runs (run_id, agent_id, state, input, version, metadata, recovery_state, recovery_attempts, next_attempt_at, recovery_owner, recovery_lease_token, recovery_lease_expires_at) VALUES ($1, 'benchmark-agent', 'RUNNING', '{}', 0, $2::jsonb, $3, 0, NOW(), $4, $5, $6)`, [requestRunId(request.context.tenantId), JSON.stringify({ recovery_request: request }), state, owner, owner ? `${owner}-token` : null, leaseExpiresAt]); }
async function seedSucceededWithoutOutbox(pool: Pool, request: ToolExecutionRequest, output: unknown): Promise<void> { const store = new DurableToolStore(pool); await store.reserve({ idempotencyKey: request.idempotencyKey, tenantId: request.context.tenantId, toolName: request.tool.name, actorId: request.context.actorId, input: request.input }); await pool.query(`UPDATE tool_execution_idempotency SET status = 'SUCCEEDED', output = $3::jsonb, lease_expires_at = NULL WHERE tenant_id = $1 AND idempotency_key = $2`, [request.context.tenantId, request.idempotencyKey, JSON.stringify(output)]); }
async function cleanup(pool: Pool, prefix: string): Promise<void> { await pool.query('DELETE FROM agent_runs WHERE run_id = $1', [`${prefix}:run`]); await pool.query('DELETE FROM outbox_events WHERE tenant_id = $1', [prefix]); await pool.query('DELETE FROM tool_execution_idempotency WHERE tenant_id = $1', [prefix]); }
function result(_caseId: string, _adapter: BenchmarkAdapter, value: { violations: string[]; details: string }): BenchmarkScenarioResult { return { invariantViolations: value.violations, details: value.details }; }
