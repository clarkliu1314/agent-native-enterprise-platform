import { describe, expect, it } from 'vitest';
import { createSecurityContext, authorizeComponent, validateAuditRecord } from '@agent-native/runtime';
import { productionReadinessCaseIds, productionReadinessCases, runProductionReadinessBenchmark, type ProductionReadinessReport } from './production-readiness-benchmark.js';

describe('production readiness benchmark harness', () => {
  it('defines deterministic P01-P15 cases with non-empty names', () => {
    expect(productionReadinessCaseIds).toEqual(['P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P11','P12','P13','P14','P15']);
    expect(productionReadinessCases.map((testCase) => testCase.id)).toEqual(productionReadinessCaseIds);
    expect(productionReadinessCases.every((testCase) => testCase.name.trim().length > 0)).toBe(true);
  });

  it('produces a deterministic, sanitized report contract', async () => {
    const report = await runProductionReadinessBenchmark();
    const expected: ProductionReadinessReport = {
      schemaVersion: 1,
      cases: productionReadinessCaseIds.map((id) => ({ id, passed: true })),
      summary: { total: 15, passed: 15, failed: 0 },
    };
    expect(report).toEqual(expected);
    expect(JSON.stringify(report)).not.toMatch(/prompt|completion|apiKey|password|secret|credential/i);
  });

  it('preserves deterministic case order when one check fails', async () => {
    const report = await runProductionReadinessBenchmark(productionReadinessCaseIds.map((id) => ({ id, run: id === 'P09' ? () => { throw new Error('synthetic failure'); } : () => undefined })));
    expect(report.cases).toEqual(productionReadinessCaseIds.map((id) => ({ id, passed: id !== 'P09' })));
    expect(report.summary).toEqual({ total: 15, passed: 14, failed: 1 });
  });

  it('covers security, observability, failure/SLO, retention, sensitive-data, and duplicate-request contracts', async () => {
    const securityContext = createSecurityContext({ tenantId: 'tenant-a', actorId: 'actor-1', permissions: ['tool:invoke'] });
    expect(authorizeComponent(securityContext, 'tool')).toBe(securityContext);
    expect(() => authorizeComponent(securityContext, 'worker')).toThrow(/permission denied/);
    expect(() => validateAuditRecord({ auditId: 'audit-1', tenantId: 'tenant-a', occurredAt: new Date().toISOString(), actorId: 'actor-1', actorType: 'SYSTEM', action: 'RUN_COMPLETED', resourceType: 'RUN', resourceId: 'run-1', outcome: 'SUCCEEDED', reasonClass: 'NONE', correlation: { requestId: 'req-1', traceId: 'trace-1' }, metadata: { password: 'secret' } })).toThrow('SENSITIVE_AUDIT_DATA');
    const report = await runProductionReadinessBenchmark();
    expect(report.cases.find(({ id }) => id === 'P11')?.passed).toBe(true);
    expect(report.cases.find(({ id }) => id === 'P12')?.passed).toBe(true);
    expect(report.cases.find(({ id }) => id === 'P13')?.passed).toBe(true);
    expect(report.cases.find(({ id }) => id === 'P14')?.passed).toBe(true);
    expect(report.cases.find(({ id }) => id === 'P15')?.passed).toBe(true);
  });
});
