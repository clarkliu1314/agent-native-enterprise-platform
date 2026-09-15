import { describe, expect, it } from 'vitest';
import { createSecurityContext, authorizeComponent, validateAuditRecord } from '@agent-native/runtime';
import {
  productionReadinessCaseIds,
  productionReadinessCases,
  runProductionReadinessBenchmark,
  type ProductionReadinessReport,
} from './production-readiness-benchmark.js';

describe('production readiness benchmark harness', () => {
  it('defines deterministic P01-P11 cases with non-empty names', () => {
    expect(productionReadinessCaseIds).toEqual([
      'P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11',
    ]);
    expect(productionReadinessCases.map((testCase) => testCase.id)).toEqual(productionReadinessCaseIds);
    expect(productionReadinessCases.every((testCase) => testCase.name.trim().length > 0)).toBe(true);
  });

  it('produces a deterministic, sanitized report contract', async () => {
    const report = await runProductionReadinessBenchmark();
    const expected: ProductionReadinessReport = {
      schemaVersion: 1,
      cases: [
        { id: 'P01', passed: true }, { id: 'P02', passed: true }, { id: 'P03', passed: true },
        { id: 'P04', passed: true }, { id: 'P05', passed: true }, { id: 'P06', passed: true },
        { id: 'P07', passed: true }, { id: 'P08', passed: true }, { id: 'P09', passed: true },
        { id: 'P10', passed: true }, { id: 'P11', passed: true },
      ],
      summary: { total: 11, passed: 11, failed: 0 },
    };

    expect(report).toEqual(expected);
    expect(JSON.stringify(report)).not.toMatch(/prompt|completion|apiKey|password|secret|credential/i);
  });

  it('preserves deterministic case order when one check fails', async () => {
    const report = await runProductionReadinessBenchmark(
      productionReadinessCaseIds.map((id) => ({
        id,
        run: id === 'P09' ? () => { throw new Error('synthetic failure'); } : () => undefined,
      })),
    );

    expect(report.cases).toEqual([
      { id: 'P01', passed: true }, { id: 'P02', passed: true }, { id: 'P03', passed: true },
      { id: 'P04', passed: true }, { id: 'P05', passed: true }, { id: 'P06', passed: true },
      { id: 'P07', passed: true }, { id: 'P08', passed: true }, { id: 'P09', passed: false },
      { id: 'P10', passed: true }, { id: 'P11', passed: true },
    ]);
    expect(report.summary).toEqual({ total: 11, passed: 10, failed: 1 });
  });

  it('covers least privilege, audit safety, and sanitized observability contracts', async () => {
    const securityContext = createSecurityContext({ tenantId: 'tenant-a', actorId: 'actor-1', permissions: ['tool:invoke'] });
    expect(authorizeComponent(securityContext, 'tool')).toBe(securityContext);
    expect(() => authorizeComponent(securityContext, 'worker')).toThrow(/permission denied/);

    expect(() => validateAuditRecord({
      auditId: 'audit-1', tenantId: 'tenant-a', occurredAt: new Date().toISOString(), actorId: 'actor-1',
      actorType: 'SYSTEM', action: 'RUN_COMPLETED', resourceType: 'RUN', resourceId: 'run-1', outcome: 'SUCCEEDED',
      reasonClass: 'NONE', correlation: { requestId: 'req-1', traceId: 'trace-1' }, metadata: { password: 'secret' },
    })).toThrow('SENSITIVE_AUDIT_DATA');

    const report = await runProductionReadinessBenchmark();
    expect(report.cases.find(({ id }) => id === 'P11')?.passed).toBe(true);
  });
});
