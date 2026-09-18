import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'packages/investment-domain/src');

async function filesUnder(relative: string): Promise<string[]> {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.ts')).map((entry) => join(relative, entry.name));
}

async function contents(relative: string): Promise<string> {
  return readFile(join(root, relative), 'utf8');
}

describe('investment architecture boundaries', () => {
  it('keeps domain code independent from application, persistence, workflow, and tool implementations', async () => {
    for (const file of await filesUnder('domain')) {
      const content = await contents(file);
      expect(content, `${file} must not import application code`).not.toMatch(/(?:\.\.?\/)+application\//);
      expect(content, `${file} must not import persistence code`).not.toMatch(/(?:\.\.?\/)+persistence\//);
      expect(content, `${file} must not import workflow code`).not.toMatch(/(?:\.\.?\/)+workflow\//);
      expect(content, `${file} must not import tool code`).not.toMatch(/(?:\.\.?\/)+tool\//);
    }
  });

  it('keeps application code independent from concrete persistence and workflow implementations', async () => {
    for (const file of await filesUnder('application')) {
      const content = await contents(file);
      expect(content, `${file} must not import persistence implementations`).not.toMatch(/(?:\.\.?\/)+persistence\//);
      expect(content, `${file} must not import workflow implementations`).not.toMatch(/(?:\.\.?\/)+workflow\//);
    }
  });

  it('keeps workflow orchestration independent from concrete persistence', async () => {
    for (const file of await filesUnder('workflow')) {
      const content = await contents(file);
      expect(content, `${file} must not import persistence implementations`).not.toMatch(/(?:\.\.?\/)+persistence\//);
    }
  });

  it('keeps PostgreSQL implementations inside persistence', async () => {
    for (const file of await filesUnder('persistence')) {
      const content = await contents(file);
      expect(content, `${file} must not import workflow implementations`).not.toMatch(/(?:\.\.?\/)+workflow\//);
    }
  });
});
