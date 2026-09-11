import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

interface ApiPackageManifest {
  scripts?: Record<string, string>;
}

describe('API build contract', () => {
  it('defines independent typecheck and build commands', async () => {
    const packageJson = await readFile(new URL('../package.json', import.meta.url), 'utf8');
    const manifest = JSON.parse(packageJson) as ApiPackageManifest;

    expect(manifest.scripts?.typecheck).toBe('tsc --noEmit');
    expect(manifest.scripts?.build).toBe('tsc --noEmit');
  });
});
