import { describe, expect, it } from 'vitest';
import {
  productionReadinessCaseIds,
  productionReadinessCases,
  runProductionReadinessBenchmark,
  type ProductionReadinessReport,
} from './production-readiness-benchmark.js';

describe('production readiness benchmark harness', () => {
  it('defines deterministic P01-P04 cases with non-empty names', () => {
    expect(productionReadinessCaseIds).toEqual(['P01', 'P02', 'P03', 'P04']);
    expect(productionReadinessCases.map((testCase) => testCase.id)).toEqual(productionReadinessCaseIds);
    expect(productionReadinessCases.every((testCase) => testCase.name.trim().length > 0)).toBe(true);
  });

  it('produces a deterministic, sanitized report contract', async () => {
    const report = await runProductionReadinessBenchmark();
    const expected: ProductionReadinessReport = {
      schemaVersion: 1,
      cases: [
        { id: 'P01', passed: true },
        { id: 'P02', passed: true },
        { id: 'P03', passed: true },
        { id: 'P04', passed: true },
      ],
      summary: { total: 4, passed: 4, failed: 0 },
    };

    expect(report).toEqual(expected);
    expect(JSON.stringify(report)).not.toMatch(/prompt|completion|apiKey|password|secret|credential/i);
  });

  it('preserves deterministic case order when one check fails', async () => {
    const report = await runProductionReadinessBenchmark([
      { id: 'P03', run: () => { throw new Error('synthetic failure'); } },
      { id: 'P01', run: () => undefined },
      { id: 'P04', run: () => undefined },
      { id: 'P02', run: () => undefined },
    ]);

    expect(report.cases).toEqual([
      { id: 'P01', passed: true },
      { id: 'P02', passed: true },
      { id: 'P03', passed: false },
      { id: 'P04', passed: true },
    ]);
    expect(report.summary).toEqual({ total: 4, passed: 3, failed: 1 });
  });
});
