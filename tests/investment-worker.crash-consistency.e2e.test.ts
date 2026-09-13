import { describe, expect, it } from 'vitest';
import type { RuntimeAdapter } from '@agent-native/runtime';
import { InvestmentWorkflowApi } from '../packages/investment-domain/src/api';
import { PostgresInvestmentWorkflowRuntime } from '../packages/investment-domain/src/postgres-workflow-runtime';

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('investment worker crash consistency', () => {
  it('reclaims an expired lease with a new fencing token after worker crash', async () => {
    if (!databaseUrl) return;

    const runtime = new PostgresInvestmentWorkflowRuntime({
      databaseUrl,
    });

    const api = new InvestmentWorkflowApi(runtime);

    const admitted = await api.startInvestmentWorkflow({
      tenantId: 'tenant-h3-crash',
      opportunityId: `opp-h3-${Date.now()}`,
      idempotencyKey: `idem-h3-${Date.now()}`,
    });

    const firstClaim = await runtime.resumeRun(
      admitted.runId,
      'worker-a',
    );

    expect(firstClaim.state).toBe('RUNNING');
    expect(firstClaim.fencingToken).toBe(1n);
    expect(firstClaim.attempt).toBe(1);

    /*
     * Simulate worker-a crashing after acquiring the lease.
     *
     * The lease must eventually expire and become reclaimable by another
     * worker. The second worker must receive a strictly newer fencing token.
     */
    await runtime.expireLeaseForTest(admitted.runId);

    const secondClaim = await runtime.resumeRun(
      admitted.runId,
      'worker-b',
    );

    expect(secondClaim.state).toBe('RUNNING');
    expect(secondClaim.fencingToken).toBe(2n);
    expect(secondClaim.attempt).toBe(2);

    expect(secondClaim.fencingToken).toBeGreaterThan(
      firstClaim.fencingToken,
    );
  });

  it('rejects stale fencing after lease reclaim', async () => {
    if (!databaseUrl) return;

    const runtime = new PostgresInvestmentWorkflowRuntime({
      databaseUrl,
    });

    const api = new InvestmentWorkflowApi(runtime);

    const admitted = await api.startInvestmentWorkflow({
      tenantId: 'tenant-h3-fencing',
      opportunityId: `opp-h3-fencing-${Date.now()}`,
      idempotencyKey: `idem-h3-fencing-${Date.now()}`,
    });

    const firstClaim = await runtime.resumeRun(
      admitted.runId,
      'worker-a',
    );

    expect(firstClaim.fencingToken).toBe(1n);

    await runtime.expireLeaseForTest(admitted.runId);

    const secondClaim = await runtime.resumeRun(
      admitted.runId,
      'worker-b',
    );

    expect(secondClaim.fencingToken).toBe(2n);

    /*
     * A stale worker must not be able to mutate durable state using the
     * previous fencing token.
     */
    await expect(
      runtime.saveCheckpointForTest({
        runId: admitted.runId,
        owner: 'worker-a',
        fencingToken: firstClaim.fencingToken,
        sequence: 1n,
        payload: {
          stale: true,
        },
      }),
    ).rejects.toThrow();
  });
});
