import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

async function exists(relativePath: string): Promise<boolean> {
  try {
    await access(join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

describe('repository boundary layout', () => {
  it('does not retain legacy investment implementation paths', async () => {
    const legacyPaths = [
      'packages/investment-domain/src/application-service.ts',
      'packages/investment-domain/src/commands.ts',
      'packages/investment-domain/src/event-store.ts',
      'packages/investment-domain/src/investment-decision.ts',
      'packages/investment-domain/src/opportunity.ts',
      'packages/investment-domain/src/postgres-repositories.ts',
      'packages/investment-domain/src/postgres-repositories.test.ts',
      'packages/investment-domain/src/postgres-workflow-runtime.ts',
      'packages/investment-domain/src/repositories.ts',
      'packages/investment-domain/src/runtime-port.ts',
      'packages/investment-domain/src/unit-of-work.ts',
      'packages/investment-domain/src/workflow.ts',
      'packages/investment-domain/src/workflow.test.ts',
    ];

    for (const path of legacyPaths) {
      expect(await exists(path), path).toBe(false);
    }
  });

  it('does not retain legacy benchmark implementation paths', async () => {
    const legacyPaths = [
      'packages/benchmark/src/failure-slo-benchmark.ts',
    ];

    for (const path of legacyPaths) {
      expect(await exists(path), path).toBe(false);
    }
  });
});
