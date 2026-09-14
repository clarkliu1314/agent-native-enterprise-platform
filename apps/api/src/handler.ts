import { DeploymentApplication } from '@agent-native/deployment-boundary';
import type { AgentRuntime, StartRunInput } from '@agent-native/runtime-contract';
import type { RuntimeFacade } from '@agent-native/runtime-contract/durable';
import { createDurableHandler } from './durable-handler';
export { createDurableHandler } from './durable-handler';
export { createOperationalControlHandler } from './operational-control-handler';
export { composeApi } from './composition';

export function createHandler(application: DeploymentApplication) {
  return async function handler(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    let body: { agentId?: unknown; input?: unknown };
    try { body = await request.json() as { agentId?: unknown; input?: unknown }; }
    catch { return Response.json({ error: 'invalid_json' }, { status: 400 }); }
    if (typeof body.agentId !== 'string' || !body.agentId || !('input' in body)) return Response.json({ error: 'invalid_request' }, { status: 400 });
    const input: StartRunInput = { agentId: body.agentId, input: body.input };
    const run = await application.startRun(input);
    return Response.json(run, { status: 202 });
  };
}

export function createVercelHandler(
  application: DeploymentApplication | RuntimeFacade,
  controlHandler?: (request: Request) => Promise<Response>,
) {
  const durableHandler = isRuntimeFacade(application)
    ? createDurableHandler(application)
    : createHandler(application);
  return async function handler(request: Request): Promise<Response> {
    if (controlHandler && new URL(request.url).pathname.startsWith('/api/runs/')) {
      return controlHandler(request);
    }
    return durableHandler(request);
  };
}

export type RequestRuntimeFactory = () => AgentRuntime;

function isRuntimeFacade(application: DeploymentApplication | RuntimeFacade): application is RuntimeFacade {
  return typeof (application as RuntimeFacade).createRun === 'function';
}
