import { describe, expect, it, vi } from 'vitest';
import { createVercelInvestmentHandler } from './investment-handler';

describe('investment Vercel request boundary', () => {
  it('returns 202 for workflow admission without executing a turn in the request', async () => {
    const startWorkflow = vi.fn().mockResolvedValue({ runId: 'run-1', state: 'QUEUED' });
    const application = {
      createOpportunity: vi.fn(),
      advanceStage: vi.fn(),
      submitDecision: vi.fn(),
      startWorkflow,
      getWorkflow: vi.fn(),
      resumeWorkflow: vi.fn()
    };

    const handler = createVercelInvestmentHandler(application);
    const response = await handler(new Request('https://example.test/investment-workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 'tenant-a', 'idempotency-key': 'workflow-1' },
      body: JSON.stringify({ opportunityId: 'opp-1' })
    }));

    expect(response.status).toBe(202);
    expect(startWorkflow).toHaveBeenCalledTimes(1);
    expect(application.advanceStage).not.toHaveBeenCalled();
    expect(application.submitDecision).not.toHaveBeenCalled();
  });

  it('does not import worker-only capabilities into the Vercel investment handler', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('./investment-handler.ts', import.meta.url), 'utf8'));
    expect(source).not.toMatch(/recovery-worker|recovery-store|outbox-publisher|claimRecoveryCandidate|publishOutbox/);
  });
});
