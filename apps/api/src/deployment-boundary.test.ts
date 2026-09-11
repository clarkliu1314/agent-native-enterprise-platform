import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Vercel deployment boundary', () => {
  it('does not import worker-only capabilities into the request handler', async () => {
    const source = await readFile(new URL('./handler.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/recovery-worker|recovery-store|outbox-publisher|claimRecoveryCandidate|publishOutbox/);
  });
});
