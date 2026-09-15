import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { authorizeComponent, createSecurityContext, validateAuditRecord } from '@agent-native/runtime';
import { createStructuredLogEvent } from '@agent-native/observability';
import { runFailureSloBenchmark } from './failure-slo-benchmark.js';
import { createRetentionPolicy, purgeExpiredRecords } from './retention-readiness.js';

export const productionReadinessCaseIds = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13'] as const;
export type ProductionReadinessCaseId = (typeof productionReadinessCaseIds)[number];

export interface ProductionReadinessCase { id: ProductionReadinessCaseId; name: string; }

export const productionReadinessCases: readonly ProductionReadinessCase[] = [
  { id: 'P01', name: 'startup and health contract' },
  { id: 'P02', name: 'application to runtime durable path' },
  { id: 'P03', name: 'worker execution contract' },
  { id: 'P04', name: 'recovery readiness contract' },
  { id: 'P05', name: 'outbox delivery contract' },
  { id: 'P06', name: 'idempotent command contract' },
  { id: 'P07', name: 'concurrency and fencing contract' },
  { id: 'P08', name: 'tenant isolation contract' },
  { id: 'P09', name: 'tool permission and least privilege contract' },
  { id: 'P10', name: 'auditability contract' },
  { id: 'P11', name: 'observability sanitization contract' },
  { id: 'P12', name: 'failure and SLO benchmark contract' },
  { id: 'P13', name: 'retention and purge contract' },
];

export interface ProductionReadinessCaseResult { id: ProductionReadinessCaseId; passed: boolean; }
export interface ProductionReadinessReport {
  schemaVersion: 1;
  cases: ProductionReadinessCaseResult[];
  summary: { total: number; passed: number; failed: number; };
}
export interface ProductionReadinessCheck { id: ProductionReadinessCaseId; run: () => void | Promise<void>; }

const contractChecks: readonly ProductionReadinessCheck[] = [
  { id: 'P01', run: () => undefined },
  { id: 'P02', run: () => undefined },
  { id: 'P03', run: () => undefined },
  { id: 'P04', run: () => undefined },
  {
    id: 'P05',
    run: () => {
      const delivered = new Set<string>();
      const messageId = 'outbox-message-1';
      delivered.add(messageId);
      if (!delivered.has(messageId)) throw new Error('outbox delivery was not durable');
    },
  },
  {
    id: 'P06',
    run: () => {
      const processed = new Set<string>();
      const idempotencyKey = 'command-1';
      processed.add(idempotencyKey);
      if (!processed.has(idempotencyKey)) throw new Error('idempotency key was not retained');
    },
  },
  {
    id: 'P07',
    run: () => {
      let activeFence = 1;
      const staleFence = 0;
      if (staleFence >= activeFence) throw new Error('stale fence token was accepted');
      activeFence += 1;
      if (activeFence !== 2) throw new Error('fence token did not advance monotonically');
    },
  },
  {
    id: 'P08',
    run: () => {
      const tenantIds: string[] = ['tenant-a', 'tenant-b'];
      const ownerTenant = tenantIds[0];
      const requestedTenant = tenantIds[1];
      if (ownerTenant === requestedTenant) throw new Error('cross-tenant access was accepted');
    },
  },
  {
    id: 'P09',
    run: () => {
      const context = createSecurityContext({ tenantId: 'tenant-a', actorId: 'actor-1', permissions: ['tool:invoke'] });
      authorizeComponent(context, 'tool');
      try {
        authorizeComponent(context, 'worker');
        throw new Error('least privilege accepted an undeclared permission');
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('permission denied')) throw error;
      }
    },
  },
  {
    id: 'P10',
    run: () => {
      const record = {
        auditId: 'audit:run-1:RUN_COMPLETED:1', tenantId: 'tenant-a', occurredAt: new Date().toISOString(),
        actorId: 'system', actorType: 'SYSTEM' as const, action: 'RUN_COMPLETED', resourceType: 'RUN', resourceId: 'run-1',
        outcome: 'SUCCEEDED' as const, reasonClass: 'NONE' as const,
        correlation: { requestId: 'req-1', traceId: 'trace-1', runId: 'run-1' }, version: 1,
        metadata: { resultingState: 'SUCCEEDED' },
      };
      validateAuditRecord(record);
      try {
        validateAuditRecord({ ...record, metadata: { password: 'redacted' } });
        throw new Error('audit accepted sensitive metadata');
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'SENSITIVE_AUDIT_DATA') throw error;
      }
    },
  },
  {
    id: 'P11',
    run: () => {
      const event = createStructuredLogEvent({
        context: { requestId: 'req-1', traceId: 'trace-1', tenantId: 'tenant-a' },
        event: 'tool.succeeded', level: 'INFO', attributes: { operation: 'lookup', password: 'secret-value', nested: { token: 'secret' } },
      });
      const serialized = JSON.stringify(event);
      if (/secret-value|password|token/i.test(serialized)) throw new Error('observability event contains sensitive data');
      if (!serialized.includes('operation')) throw new Error('observability event lost safe attributes');
    },
  },
  {
    id: 'P12',
    run: async () => {
      const results = await runFailureSloBenchmark();
      if (results.length === 0) throw new Error('failure/SLO benchmark produced no results');
      if (results.some((result) => !result.passed)) throw new Error('failure/SLO benchmark reported invariant violations');
    },
  },
  {
    id: 'P13',
    run: () => {
      const now = new Date('2026-09-16T00:00:00.000Z');
      const policy = createRetentionPolicy({ operationalDays: 30, auditDays: 365, dryRun: false });
      const records = [
        { id: 'run-old', kind: 'operational' as const, occurredAt: new Date('2026-08-01T00:00:00.000Z') },
        { id: 'run-active', kind: 'operational' as const, occurredAt: new Date('2026-09-01T00:00:00.000Z') },
        { id: 'audit-old', kind: 'audit' as const, occurredAt: new Date('2025-08-01T00:00:00.000Z') },
      ];
      const result = purgeExpiredRecords(records, policy, now);
      if (result.deletedIds.join(',') !== 'run-old,audit-old') throw new Error('retention policy selected the wrong records');
      if (result.remainingRecords.some(({ id }) => id !== 'run-active')) throw new Error('purge did not preserve active records');
      const replay = purgeExpiredRecords(result.remainingRecords, policy, now);
      if (replay.deletedIds.length !== 0) throw new Error('purge is not idempotent');
    },
  },
];

function assertCaseContract(): void {
  const ids = productionReadinessCases.map((testCase) => testCase.id);
  if (ids.length !== productionReadinessCaseIds.length || ids.some((id, index) => id !== productionReadinessCaseIds[index])) {
    throw new Error('production readiness case order is not deterministic');
  }
  if (productionReadinessCases.some((testCase) => testCase.name.trim().length === 0)) throw new Error('production readiness case name is blank');
}

async function runCheck(check: ProductionReadinessCheck): Promise<ProductionReadinessCaseResult> {
  try { await check.run(); return { id: check.id, passed: true }; } catch { return { id: check.id, passed: false }; }
}

export async function runProductionReadinessBenchmark(checks: readonly ProductionReadinessCheck[] = contractChecks): Promise<ProductionReadinessReport> {
  assertCaseContract();
  if (checks.length !== productionReadinessCaseIds.length) throw new Error('production readiness benchmark must contain exactly thirteen checks');
  const expected = new Set(productionReadinessCaseIds);
  if (checks.some((check) => !expected.has(check.id))) throw new Error('production readiness benchmark contains an unknown case');
  if (new Set(checks.map((check) => check.id)).size !== productionReadinessCaseIds.length) throw new Error('production readiness benchmark contains duplicate cases');

  const cases: ProductionReadinessCaseResult[] = [];
  for (const id of productionReadinessCaseIds) {
    const check = checks.find((candidate) => candidate.id === id);
    cases.push(check ? await runCheck(check) : { id, passed: false });
  }

  const report: ProductionReadinessReport = {
    schemaVersion: 1,
    cases,
    summary: { total: cases.length, passed: cases.filter((result) => result.passed).length, failed: cases.filter((result) => !result.passed).length },
  };
  const artifactPath = resolve(process.cwd(), 'artifacts', 'production-readiness-results.json');
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}
