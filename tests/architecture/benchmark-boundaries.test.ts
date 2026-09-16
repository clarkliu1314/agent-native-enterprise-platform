import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const frameworkRoot = join(process.cwd(), 'packages/benchmark/src/framework');

describe('benchmark architecture boundaries', () => {
  it('keeps the shared framework independent from business-domain cases', async () => {
    for (const entry of await readdir(frameworkRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const content = await readFile(join(frameworkRoot, entry.name), 'utf8');
      expect(content, `${entry.name} must not import investment cases`).not.toMatch(/cases\/investment/);
      expect(content, `${entry.name} must not import platform case implementations`).not.toMatch(/cases\/platform/);
    }
  });

  it('keeps the shared framework independent from parent benchmark composition modules', async () => {
    for (const entry of await readdir(frameworkRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const content = await readFile(join(frameworkRoot, entry.name), 'utf8');
      expect(content, `${entry.name} must not import parent benchmark modules`).not.toMatch(/from ['"]\.\.\//);
    }
  });

  it('keeps investment cases on the shared benchmark contract', async () => {
    const content = await readFile(join(process.cwd(), 'packages/benchmark/src/cases/investment/index.ts'), 'utf8');
    expect(content).toContain("from '../../framework/types'");
  });
});
