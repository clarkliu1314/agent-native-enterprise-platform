import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { RecoveryCandidateStore, RecoveryCoordinator, type RecoveryState } from '@agent-native/durability';
import { PostgresToolExecutionStore as DurableToolStore, ToolExecutionService, type ToolExecutionRequest } from '@agent-native/tool-runtime';
import { PostgresOutboxRepository } from '@agent-native/outbox';
import type { BenchmarkAdapter, BenchmarkCase } from './index';
import type { BenchmarkScenarioResult } from './scenario-runner';

const ELIGIBILITY_SKEW_MS = 5_000;

export async function executePostgresRecoveryScenario(caseId: BenchmarkCase['id'], adapter: BenchmarkAdapter, databaseUrl: string): Promise<BenchmarkScenarioResult> {
  if (!['B09', 'B10', 'B11', 'B12', 'B13'].includes(caseId)) throw new Error(`Unsupported PostgreSQL recovery benchmark case: ${caseId}`);
  const pool = new Pool({ connectionString: databaseUrl });
  const toolStore = new DurableToolStore(pool);
  const recoveryStore = new RecoveryCandidateStore(pool);
  const outboxStore = new PostgresOutboxRepository(pool);
  const prefix = `pg-benchmark-${caseId}-${adapter}-${randomUUID()}`;

  try {
    await toolStore.migrate();
    await recoveryStore.migrate();
    await cleanup(pool, prefix);
    const state = { externalEffects: 0, toolExecutions: 0, deliveries: 0, logicalEffects: 0 };
    const service = createService(toolStore, state, caseId);
    const coordinator = new RecoveryCoordinator(service);
    const request = createRequest(prefix);

    if (caseId === 'B09') {
      await seedRetryable(pool, request);
      await seedRecoveryCandidate(pool, request, 'IN_PROGRESS', new Date(Date.now() - 1_000), 'dead-worker');
      const recoveryNow = new Date(Date.now() + ELIGIBILITY_SKEW_MS);
      const reclaimed = (await recoveryStore.reclaimExpiredRecoveryCandidates(recoveryNow)) > 0;
      const lease = await recoveryStore.claimRecoveryCandidate(requestRunId(prefix), 'replacement-worker', 'lease-b09', 30_000, recoveryNow);
      const recovered = lease ? await coordinator.recover({ request, state: 'FAILED_RETRYABLE' }) : null;
      if (recovered && lease) await recoveryStore.completeRecovery(lease.runId, lease.owner, lease.leaseToken);
      return result(caseId, adapter, { violations: reclaimed && !!lease && !!recovered ? [] : ['idempotency'], details: `postgresql: true; adapter: ${adapter}; lease reclaimed: ${reclaimed}; recovered: ${recovered ? 1 : 0}; external effects: ${state.externalEffects}` });
    }

    if (caseId === 'B10') {
      let crashed = false;
      const crashingService = new ToolExecutionService({
        authorize: async () => true,
        execute: async () => { state.externalEffects += 1; if (!crashed) { crashed = true; throw new Error('worker crashed after external effect'); } return { caseId, adapter }; },
        store: toolStore,
      });
      try { await crashingService.execute(request); } catch { /* simulated worker crash */ }
      await seedRecoveryCandidate(pool, request, 'FAILED_RETRYABLE', null, null);
      const recoveryNow = new Date(Date.now() + ELIGIBILITY_SKEW_MS);
      const lease = await recoveryStore.claimRecoveryCandidate(requestRunId(prefix), 'recovery-worker', 'lease-b10', 30_000, recoveryNow);
      const recovered = lease ? await coordinator.recover({ request, state: 'FAILED_RETRYABLE' }) : null;
      if (recovered && lease) await recoveryStore.completeRecovery(lease.runId, lease.owner, lease.leaseToken);
      return result(caseId, adapter, { violations: recovered && state.externalEffects === 1 ? [] : ['idempotency'], details: `postgresql: true; adapter: ${adapter}; recovered: ${recovered ? 1 : 0}; external effects: ${state.externalEffects}; tool executions: ${state.toolExecutions}` });
    }

    if (caseId === 'B11') {
      await seedSucceededWithoutOutbox(pool, request, { caseId, adapter, recoveredOutput: true });
      await seedRecoveryCandidate(pool, request, 'IN_PROGRESS', null, null);
      const recoveryNow = new Date(Date.now() + ELIGIBILITY_SKEW_MS);
      const lease = await recoveryStore.claimRecoveryCandidate(requestRunId(prefix), 'recovery-worker', 'lease-b11', 30_000, recoveryNow);
      const recovered = lease ? await coordinator.recover({ request, state: 'IN_PROGRESS' }) : null;
      if (recovered && lease) await recoveryStore.completeRecovery(lease.runId, lease.owner, lease.leaseToken);
      const rows = await pool.query('SELECT COUNT(*)::int AS count FROM outbox_events WHERE tenant_id = $1 AND idempotency_key = $2', [request.context.tenantId, request.idempotencyKey]);
      const outboxEvents = Number(rows.rows[0]?.count ?? 0);
      return result(caseId, adapter, { violations: recovered?.replayed && state.externalEffects === 0 && outboxEvents === 1 ? [] : ['outbox', 'idempotency'], details: `postgresql: true; adapter: ${adapter}; recovered: ${recovered ? 1 : 0}; external effects: ${state.externalEffects}; outbox events: ${outboxEvents}` });
    }

    if (caseId === 'B12') {
      await service.execute(request);
      const transport = async () => {
        state.deliveries += 1;
        if (state.deliveries === 1) state.logicalEffects += 1;
      };
      const firstClaim = await outboxStore.claim(1, 'worker-b12-crashed');
      const firstMessage = firstClaim[0];
      if (!firstMessage) return result(caseId, adapter, { violations: ['outbox'], details: `postgresql: true; adapter: ${adapter}; deliveries: 0; logical effects: 0; published: false; recovered: 0` });
      await transport();
      await pool.query("UPDATE outbox_events SET locked_at = NOW() - INTERVAL '10 minutes' WHERE event_id = $1", [firstMessage.eventId]);
      const secondClaim = await outboxStore.claim(1, 'worker-b12-recovery');
      const secondMessage = secondClaim[0];
      if (!secondMessage) return result(caseId, adapter, { violations: ['outbox'], details: `postgresql: true; adapter: ${adapter}; deliveries: ${state.deliveries}; logical effects: ${state.logicalEffects}; published: false; recovered: 0` });
      await transport();
      await outboxStore.markPublished(secondMessage.eventId, 'worker-b12-recovery');
      const recovered = await coordinator.recover({ request, state: 'SUCCEEDED' });
      const rows = await pool.query('SELECT COUNT(*)::int AS count, MAX(status) AS status FROM outbox_events WHERE tenant_id = $1 AND idempotency_key = $2', [request.context.tenantId, request.idempotencyKey]);
      const outboxEvents = Number(rows.rows[0]?.count ?? 0);
      return result(caseId, adapter, { violations: state.deliveries === 2 && state.logicalEffects === 1 && outboxEvents === 1 && rows.rows[0]?.status === 'PUBLISHED' && recovered.replayed ? [] : ['outbox', 'idempotency'], details: `postgresql: true; adapter: ${adapter}; deliveries: ${state.deliveries}; logical effects: ${state.logicalEffects}; published: ${rows.rows[0]?.status === 'PUBLISHED'}; recovered: ${recovered ? 1 : 0}` });
    }

    await seedRetryable(pool, request);
    await seedRecoveryCandidate(pool, request, 'IN_PROGRESS', null, null);
    const initialNow = new Date(Date.now() + ELIGIBILITY_SKEW_MS);
    const firstLease = await recoveryStore.claimRecoveryCandidate(requestRunId(prefix), 'expired-worker', 'lease-b13', 1, initialNow);
    if (!firstLease) return result(caseId, adapter, { violations: ['idempotency'], details: `postgresql: true; adapter: ${adapter}; expired lease reclaimed: false; recovered: 0; external effects: 0` });
    const expiredAt = new Date(initialNow.getTime() + 2_000);
    await pool.query('UPDATE agent_runs SET recovery_lease_expires_at = $2 WHERE run_id = $1', [requestRunId(prefix), expiredAt]);
    const reclaimNow = new Date(expiredAt.getTime() + 1_000);
    const reclaimed = (await recoveryStore.reclaimExpiredRecoveryCandidates(reclaimNow)) > 0;
    const replacement = await recoveryStore.claimRecoveryCandidate(requestRunId(prefix), 'replacement-worker', 'lease-b13-replacement', 30_000, reclaimNow);
    const recovered = replacement ? await coordinator.recover({ request, state: 'FAILED_RETRYABLE' }) : null;
    if (recovered && replacement) await recoveryStore.completeRecovery(replacement.runId, replacement.owner, replacement.leaseToken);
    return result(caseId, adapter, { violations: reclaimed && !!replacement && !!recovered ? [] : ['idempotency'], details: `postgresql: true; adapter: ${adapter}; expired lease reclaimed: ${reclaimed}; recovered: ${recovered ? 1 : 0}; external effects: ${state.externalEffects}` });
  } finally {
    await cleanup(pool, prefix);
    await pool.end();
  }
}

function createService(store: DurableToolStore, state: { externalEffects: number; toolExecutions: number }, caseId: string): ToolExecutionService {
  return new ToolExecutionService({ authorize: async () => true, execute: async () => { state.toolExecutions += 1; if (caseId !== 'B11' && state.externalEffects === 0) state.externalEffects += 1; return { caseId, recovered: true }; }, store });
}

function createRequest(prefix: string): ToolExecutionRequest {
  return { tool: { name: 'benchmark.effect', description: 'deterministic benchmark tool', sideEffect: true }, input: { prefix }, context: { actorId: 'benchmark-actor', tenantId: prefix, permissions: ['tool:benchmark.effect'] }, idempotencyKey: `${prefix}:request` };
}
function requestRunId(prefix: string): string { return `${prefix}:run`; }

async function seedRetryable(pool: Pool, request: ToolExecutionRequest): Promise<void> {
  const store = new DurableToolStore(pool);
  await store.reserve({ idempotencyKey: request.idempotencyKey, tenantId: request.context.tenantId, toolName: request.tool.name, actorId: request.context.actorId, input: request.input });
  await store.fail({ idempotencyKey: request.idempotencyKey, tenantId: request.context.tenantId, toolName: request.tool.name, error: new Error('retryable crash'), retryable: true });
}

async function seedRecoveryCandidate(pool: Pool, request: ToolExecutionRequest, state: RecoveryState, leaseExpiresAt: Date | null, owner: string | null): Promise<void> {
  await pool.query(`INSERT INTO agent_runs (run_id, agent_id, state, input, version, metadata, recovery_state, recovery_attempts, next_attempt_at, recovery_owner, recovery_lease_token, recovery_lease_expires_at) VALUES ($1, 'benchmark-agent', 'RUNNING', '{}', 0, $2::jsonb, $3, 0, NOW(), $4, $5, $6)`, [requestRunId(request.context.tenantId), JSON.stringify({ recovery_request: request }), state, owner, owner ? `${owner}-token` : null, leaseExpiresAt]);
}

async function seedSucceededWithoutOutbox(pool: Pool, request: ToolExecutionRequest, output: unknown): Promise<void> {
  const store = new DurableToolStore(pool);
  await store.reserve({ idempotencyKey: request.idempotencyKey, tenantId: request.context.tenantId, toolName: request.tool.name, actorId: request.context.actorId, input: request.input });
  await pool.query(`UPDATE tool_execution_idempotency SET status = 'SUCCEEDED', output = $3::jsonb, lease_expires_at = NULL WHERE tenant_id = $1 AND idempotency_key = $2`, [request.context.tenantId, request.idempotencyKey, JSON.stringify(output)]);
}

async function cleanup(pool: Pool, prefix: string): Promise<void> {
  await pool.query('DELETE FROM agent_runs WHERE run_id = $1', [`${prefix}:run`]);
  await pool.query('DELETE FROM outbox_events WHERE tenant_id = $1', [prefix]);
  await pool.query('DELETE FROM tool_execution_idempotency WHERE tenant_id = $1', [prefix]);
}

function result(_caseId: string, _adapter: BenchmarkAdapter, value: { violations: string[]; details: string }): BenchmarkScenarioResult { return { invariantViolations: value.violations, details: value.details }; }
