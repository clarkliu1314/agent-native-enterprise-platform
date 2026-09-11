import type { AgentRuntime, AgentRun, RunSnapshot, StartRunInput, Turn } from '@agent-native/runtime-contract';

/** Framework-neutral adapter boundary. Frameworks translate into this contract; they do not own durability. */
export interface AgentFrameworkAdapter {
  readonly framework: string;
  readonly capabilities: ReadonlySet<string>;
  startRun(input: StartRunInput): Promise<AgentRun>;
  executeTurn(runId: string, input: unknown): Promise<Turn>;
  checkpoint(runId: string): Promise<RunSnapshot>;
  recover(snapshot: RunSnapshot): Promise<AgentRun>;
  cancel(runId: string): Promise<AgentRun>;
  getRunState(runId: string): Promise<AgentRun>;
}

export function createReferenceAdapter(
  framework: string,
  runtime: AgentRuntime,
  capabilities: Iterable<string> = [],
): AgentFrameworkAdapter {
  return {
    framework,
    capabilities: new Set(capabilities),
    startRun: (input) => runtime.startRun(input),
    executeTurn: (runId, input) => runtime.executeTurn(runId, input),
    checkpoint: (runId) => runtime.checkpoint(runId),
    recover: (snapshot) => runtime.recover(snapshot),
    cancel: (runId) => runtime.cancel(runId),
    getRunState: (runId) => runtime.getRunState(runId),
  };
}
