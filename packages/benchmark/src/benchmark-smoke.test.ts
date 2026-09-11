import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeBenchmarkReport } from './benchmark-artifact';
import { benchmarkRunner } from './benchmark-runner';

describe('benchmark executable smoke', () => {
  it('runs the canonical 64-scenario matrix and writes a deterministic report', async () => {
    const results = await benchmarkRunner.runAll();
    const artifact = serializeBenchmarkReport(results);
    const artifactPath = resolve(process.cwd(), 'artifacts', 'benchmark-results.json');

    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, artifact, 'utf8');

    const parsed = JSON.parse(artifact) as {
      schemaVersion: number;
      summary: { total: number; passed: number; failed: number };
    };

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.summary).toEqual({ total: 64, passed: 64, failed: 0 });
  }, 30_000);
});
