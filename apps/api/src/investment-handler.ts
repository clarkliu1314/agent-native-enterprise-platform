export interface InvestmentApiApplication {
  createOpportunity(command: Record<string, unknown>): Promise<unknown>;
  advanceStage(command: Record<string, unknown>): Promise<unknown>;
  submitDecision(command: Record<string, unknown>): Promise<unknown>;
  startWorkflow(command: Record<string, unknown>): Promise<unknown>;
  getWorkflow(runId: string, tenantId: string): Promise<unknown>;
  resumeWorkflow(command: Record<string, unknown>): Promise<unknown>;
}

export function createInvestmentHandler(application: InvestmentApiApplication) {
  return async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const tenantId = request.headers.get('x-tenant-id');
    const actorId = request.headers.get('x-actor-id');
    const idempotencyKey = request.headers.get('idempotency-key');
    const requiresIdempotency = method === 'POST' && !url.pathname.match(/^\/investment-workflows\/[^/]+\/resume$/);

    if (!tenantId || (method === 'POST' && requiresIdempotency && !idempotencyKey)) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }

    try {
      const body = method === 'GET' ? {} : await request.json() as Record<string, unknown>;
      if (method === 'POST' && url.pathname === '/investment-opportunities') {
        if (!actorId) return Response.json({ error: 'invalid_request' }, { status: 400 });
        const result = await application.createOpportunity({ ...body, tenantId, actorId, idempotencyKey });
        return Response.json(result, { status: 201 });
      }

      const stageMatch = url.pathname.match(/^\/investment-opportunities\/([^/]+)\/stage$/);
      if (method === 'POST' && stageMatch) {
        if (!actorId || typeof body.nextStage !== 'string' || typeof body.expectedVersion !== 'number') return Response.json({ error: 'invalid_request' }, { status: 400 });
        const result = await application.advanceStage({ ...body, tenantId, actorId, idempotencyKey, opportunityId: decodeURIComponent(stageMatch[1]) });
        return Response.json(result, { status: 200 });
      }

      if (method === 'POST' && url.pathname === '/investment-decisions') {
        if (!actorId) return Response.json({ error: 'invalid_request' }, { status: 400 });
        const result = await application.submitDecision({ ...body, tenantId, actorId, idempotencyKey });
        return Response.json(result, { status: 200 });
      }

      if (method === 'POST' && url.pathname === '/investment-workflows') {
        const result = await application.startWorkflow({ ...body, tenantId, idempotencyKey });
        return Response.json(result, { status: 202 });
      }

      const workflowMatch = url.pathname.match(/^\/investment-workflows\/([^/]+)$/);
      if (method === 'GET' && workflowMatch) {
        return Response.json(await application.getWorkflow(decodeURIComponent(workflowMatch[1]), tenantId), { status: 200 });
      }

      const resumeMatch = url.pathname.match(/^\/investment-workflows\/([^/]+)\/resume$/);
      if (method === 'POST' && resumeMatch) {
        const result = await application.resumeWorkflow({ ...body, tenantId, runId: decodeURIComponent(resumeMatch[1]) });
        return result === undefined ? new Response(null, { status: 202 }) : Response.json(result, { status: 202 });
      }

      return Response.json({ error: 'not_found' }, { status: 404 });
    } catch (error) {
      if (error instanceof SyntaxError) return Response.json({ error: 'invalid_json' }, { status: 400 });
      if (error instanceof Error && /version|conflict/i.test(error.message)) return Response.json({ error: 'conflict' }, { status: 409 });
      return Response.json({ error: 'internal_error' }, { status: 500 });
    }
  };
}

export const createVercelInvestmentHandler = createInvestmentHandler;
