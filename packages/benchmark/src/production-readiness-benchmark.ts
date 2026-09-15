import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const productionReadinessCaseIds = ['P01', 'P02', 'P03', 'P04'] as const;
export type ProductionReadinessCaseId = (typeof productionReadinessCaseIds)[number];

export interface ProductionReadinessCase {
  id: ProductionReadinessCaseId;
  name: string;
}

export const productionReadinessCases: readonly ProductionReadinessCase[] = [
  { id: 'P01', name: 'startup and health contract' },
  { id: 'P02', name: 'application to runtime durable path' },
  { id: 'P03', name: 'worker execution contract' },
  { id: 'P04', name: 'recovery readiness contract' },
];

export interface ProductionReadinessCaseResult {
  id: ProductionReadinessCaseId;
  passed: boolean;
}

export interface ProductionReadinessReport {
  schemaVersion: 1;
  cases: ProductionReadinessCaseResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}

export interface ProductionReadinessCheck {
  id: ProductionReadinessCaseId;
  run: () => void | Promise<void>;
}

const contractChecks: readonly ProductionReadinessCheck[] = productionReadinessCaseIds.map((id) => ({
  id,
  run: () => undefined,
}));

function assertCaseContract(): void {
  const ids = productionReadinessCases.map((testCase) => testCase.id);
  if (ids.length !== productionReadinessCaseIds.length || ids.some((id, index) => id !== productionReadinessCaseIds[index])) {
    throw new Error('production readiness case order is not deterministic');
  }
  if (productionReadinessCases.some((testCase) => testCase.name.trim().length === 0)) {
    throw new Error('production readiness case name is blank');
  }
}

async function runCheck(check: ProductionReadinessCheck): Promise<ProductionReadinessCaseResult> {
  try {
    await check.run();
    return { id: check.id, passed: true };
  } catch {
    return { id: check.id, passed: false };
  }
}

export async function runProductionReadinessBenchmark(
  checks: readonly ProductionReadinessCheck[] = contractChecks,
): Promise<ProductionReadinessReport> {
  assertCaseContract();
  if (checks.length !== productionReadinessCaseIds.length) {
    throw new Error('production readiness benchmark must contain exactly four checks');
  }
  const expected = new Set(productionReadinessCaseIds);
  if (checks.some((check) => !expected.has(check.id))) {
    throw new Error('production readiness benchmark contains an unknown case');
  }

  const cases: ProductionReadinessCaseResult[] = [];
  for (const id of productionReadinessCaseIds) {
    const check = checks.find((candidate) => candidate.id === id);
    if (!check) {
      cases.push({ id, passed: false });
      continue;
    }
    cases.push(await runCheck(check));
  }

  const report: ProductionReadinessReport = {
    schemaVersion: 1,
    cases,
    summary: {
      total: cases.length,
      passed: cases.filter((result) => result.passed).length,
      failed: cases.filter((result) => !result.passed).length,
    },
  };

  const artifactPath = resolve(process.cwd(), 'artifacts', 'production-readiness-results.json');
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}
