import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('E2E test boundaries', () => {
  it('keeps end-to-end tests under an explicit platform or business-domain directory', async () => {
    const testsRoot = join(process.cwd(), 'tests');
    const entries = await readdir(testsRoot, { withFileTypes: true });
    const rootE2EFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.e2e.test.ts')).map((entry) => entry.name);
    expect(rootE2EFiles, 'root tests directory must not own E2E tests').toEqual([]);
  });
});
