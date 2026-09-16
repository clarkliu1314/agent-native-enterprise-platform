import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const domainRoot = join(process.cwd(), 'packages/investment-domain/src/domain');
const forbiddenImports = [
  '@agent-native/runtime',
  'postgres',
  'redis',
  'apps/',
  'adapters/',
  'vercel',
];

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.ts')).map((entry) => join(root, entry.name));
}

describe('investment architecture boundaries', () => {
  it('keeps the domain free from infrastructure and application imports', async () => {
    for (const file of await sourceFiles(domainRoot)) {
      const content = await readFile(file, 'utf8');
      for (const forbidden of forbiddenImports) {
        expect(content, `${file} imports ${forbidden}`).not.toContain(`from '${forbidden}`);
        expect(content, `${file} imports ${forbidden}`).not.toContain(`from \"${forbidden}`);
      }
    }
  });
});
