import { describe, expect, it } from 'vitest';
import {
  productionReadinessCaseIds,
  productionReadinessCases,
  runProductionReadinessBenchmark,
  type ProductionReadinessReport,
} from './production-readiness-benchmark.js';

describe('production readiness benchmark harness', () => {
  it('defines deterministic P01-P08 cases with non-empty names', () => {
    expect(productionReadinessCaseIds).toEqual(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08']);
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
        { id: 'P05', passed: true },
        { id: 'P06', passed: true },
        { id: 'P07', passed: true },
        { id: 'P08', passed: true },
      ],
      summary: { total: 8, passed: 8, failed: 0 },
    };

    expect(report).toEqual(expected);
    expect(JSON.stringify(report)).not.toMatch(/prompt|completion|apiKey|password|secret|credential/i);
  });

  it('preserves deterministic case order when one check fails', async () => {
    const report = await runProductionReadinessBenchmark([
      { id: 'P07', run: () => { throw new Error('synthetic failure'); } },
      { id: 'P03', run: () => undefined },
      { id: 'P01', run: () => undefined },
      { id: 'P08', run: () => undefined },
      { id: 'P05', run: () => undefined },
      { id: 'P04', run: () => undefined },
      { id: 'P06', run: () => undefined },
      { id: 'P02', run: () => undefined },
    ]);

    expect(report.cases).toEqual([
      { id: 'P01', passed: true },
      { id: 'P02', passed: true },
      { id: 'P03', passed: true },
      { id: 'P04', passed: true },
      { id: 'P05', passed: true },
      { id: 'P06', passed: true },
      { id: 'P07', passed: false },
      { id: 'P08', passed: true },
    ]);
    expect(report.summary).toEqual({ total: 8, passed: 7, failed: 1 });
  });
});
