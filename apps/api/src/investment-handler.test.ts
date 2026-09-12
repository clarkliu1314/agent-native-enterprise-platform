import { describe, expect, it, vi } from 'vitest';
import { createInvestmentHandler, type InvestmentApiApplication } from './investment-handler';

function application(): InvestmentApiApplication {
  return {
    createOpportunity: vi.fn().mockResolvedValue({ opportunityId: 'opp-1', tenantId: 'tenant-a', stage: 'DRAFT', version: 1 }),
    advanceStage: vi.fn().mockResolvedValue({ opportunityId: 'opp-1', tenantId: 'tenant-a', stage: 'RESEARCH', version: 2 }),
    submitDecision: vi.fn().mockResolvedValue({ decisionId: 'decision-1', opportunityId: 'opp-1', recommendation: 'APPROVE', decisionCycle: 1 }),
    startWorkflow: vi.fn().mockResolvedValue({ runId: 'run-1', nextStep: 0 }),
    getWorkflow: vi.fn().mockResolvedValue({ runId: 'run-1', state: 'WAITING', nextStep: 4 }),
    resumeWorkflow: vi.fn().mockResolvedValue(undefined),
  };
}

describe('investment HTTP application boundary', () => {
  it('creates an opportunity and forwards tenant/actor/idempotency context', async () => {
    const app = application();
    const handler = createInvestmentHandler(app);

    const response = await handler(new Request('https://example.test/investment-opportunities', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'create-1', 'x-tenant-id': 'tenant-a', 'x-actor-id': 'user-1' },
      body: JSON.stringify({ opportunityId: 'opp-1', companyId: 'co-1', companyName: 'Acme', ownerId: 'owner-1' }),
    }));

    expect(response.status).toBe(201);
    expect(app.createOpportunity).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', actorId: 'user-1', idempotencyKey: 'create-1', opportunityId: 'opp-1',
    }));
  });

  it('advances an opportunity using optimistic version and returns a conflict instead of retrying blindly', async () => {
    const app = application();
    const handler = createInvestmentHandler(app);
    const response = await handler(new Request('https://example.test/investment-opportunities/opp-1/stage', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'stage-1', 'x-tenant-id': 'tenant-a', 'x-actor-id': 'user-1' },
      body: JSON.stringify({ nextStage: 'RESEARCH', expectedVersion: 1 }),
    }));

    expect(response.status).toBe(200);
    expect(app.advanceStage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', opportunityId: 'opp-1', nextStage: 'RESEARCH', expectedVersion: 1,
    }));
  });

  it('submits an investment decision with the business idempotency key and does not expose provider/runtime details', async () => {
    const app = application();
    const handler = createInvestmentHandler(app);
    const response = await handler(new Request('https://example.test/investment-decisions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'decision:opp-1:1', 'x-tenant-id': 'tenant-a', 'x-actor-id': 'ic-1' },
      body: JSON.stringify({ opportunityId: 'opp-1', decisionCycle: 1, recommendation: 'APPROVE', rationale: 'passes IC gate' }),
    }));

    expect(response.status).toBe(200);
    expect(app.submitDecision).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', actorId: 'ic-1', idempotencyKey: 'decision:opp-1:1', recommendation: 'APPROVE',
    }));
  });

  it('starts a durable workflow asynchronously and exposes status/resume as separate operations', async () => {
    const app = application();
    const handler = createInvestmentHandler(app);
    const start = await handler(new Request('https://example.test/investment-workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'workflow-1', 'x-tenant-id': 'tenant-a' },
      body: JSON.stringify({ opportunityId: 'opp-1' }),
    }));
    expect(start.status).toBe(202);

    const status = await handler(new Request('https://example.test/investment-workflows/run-1', { method: 'GET' }));
    expect(status.status).toBe(200);

    const resume = await handler(new Request('https://example.test/investment-workflows/run-1/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 'tenant-a' },
      body: JSON.stringify({ approval: 'APPROVE' }),
    }));
    expect(resume.status).toBe(202);
    expect(app.resumeWorkflow).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1', tenantId: 'tenant-a' }));
  });

  it('rejects mutating requests without tenant and idempotency context', async () => {
    const handler = createInvestmentHandler(application());
    const response = await handler(new Request('https://example.test/investment-opportunities', {
      method: 'POST', body: JSON.stringify({ opportunityId: 'opp-1' }),
    }));
    expect(response.status).toBe(400);
  });
});
