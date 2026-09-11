import { DeploymentApplication } from '@agent-native/deployment-boundary';
import type { AgentRuntime, StartRunInput } from '@agent-native/runtime-contract';

export function createHandler(application: DeploymentApplication) {
  return async function handler(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    let body: { agentId?: unknown; input?: unknown };
    try {
      body = await request.json() as { agentId?: unknown; input?: unknown };
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 });
    }

    if (typeof body.agentId !== 'string' || !body.agentId || !('input' in body)) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }

    const input: StartRunInput = { agentId: body.agentId, input: body.input };
    const run = await application.startRun(input);
    return Response.json(run, { status: 202 });
  };
}

/**
 * Production composition is intentionally dependency-injected: a Vercel request
 * must never construct an in-memory runtime or a durable worker itself.
 */
export function createVercelHandler(application: DeploymentApplication) {
  return createHandler(application);
}

export type RequestRuntimeFactory = () => AgentRuntime;
