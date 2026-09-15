import { describe, expect, it } from 'vitest';
import {
  productionReadinessCaseIds,
  runProductionReadinessBenchmark,
  type ProductionReadinessReport,
} from './production-readiness-benchmark.js';

describe('production readiness benchmark harness', () => {
  it('defines deterministic P01-P04 cases in stable order', () => {
    expect(productionReadinessCaseIds).toEqual(['P01', 'P02', 'P03', 'P04']);
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
});
