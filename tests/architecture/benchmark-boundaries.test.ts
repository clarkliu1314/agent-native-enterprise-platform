import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const benchmarkRoot = join(process.cwd(), 'packages/benchmark/src');
const frameworkRoot = join(benchmarkRoot, 'framework');
const platformCasesRoot = join(benchmarkRoot, 'cases/platform');
const investmentCasesRoot = join(benchmarkRoot, 'cases/investment');

async function readTypeScriptFiles(root: string): Promise<readonly [string, string][]> {
  return Promise.all(
    (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map(async (entry) => [entry.name, await readFile(join(root, entry.name), 'utf8')] as const),
  );
}

describe('benchmark architecture boundaries', () => {
  it('keeps the shared framework independent from business-domain cases', async () => {
    for (const [name, content] of await readTypeScriptFiles(frameworkRoot)) {
      expect(content, `${name} must not import investment cases`).not.toMatch(/cases\/investment/);
      expect(content, `${name} must not import platform case implementations`).not.toMatch(/cases\/platform/);
    }
  });

  it('keeps the shared framework independent from parent benchmark composition modules', async () => {
    for (const [name, content] of await readTypeScriptFiles(frameworkRoot)) {
      expect(content, `${name} must not import parent benchmark modules`).not.toMatch(/from ['"]\.\.\//);
    }
  });

  it('keeps platform cases independent from investment cases', async () => {
    for (const [name, content] of await readTypeScriptFiles(platformCasesRoot)) {
      expect(content, `${name} must not import investment cases`).not.toMatch(/cases\/investment/);
    }
  });

  it('keeps investment cases on the shared benchmark contract', async () => {
    for (const [name, content] of await readTypeScriptFiles(investmentCasesRoot)) {
      expect(content, `${name} must use the shared benchmark framework`).toMatch(/from ['"]\.\.\/\.\.\/framework\//);
      expect(content, `${name} must not import platform cases`).not.toMatch(/cases\/platform/);
    }
  });
});
