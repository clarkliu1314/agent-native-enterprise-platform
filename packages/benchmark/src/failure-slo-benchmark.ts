import { InMemoryAgentRuntime } from '@agent-native/runtime';
import type { BenchmarkAdapter } from './index';
import { benchmarkAdapters } from './index';
import { createBenchmarkAdapters } from './framework/adapters';

export interface FailureSloBenchmarkCase {
  id: 'F01' | 'F02' | 'F03' | 'F04';
  name: string;
  adapters: readonly BenchmarkAdapter[];
  initialDbState: string;
  injectedFault: string;
  expectedDurableState: string;
  auditAssertion: string;
  telemetryAssertion: string;
  replayAssertion: string;
}

export interface FailureSloBenchmarkResult {
  caseId: FailureSloBenchmarkCase['id'];
  adapter: BenchmarkAdapter;
  passed: boolean;
  invariantViolations: readonly string[];
  details: string;
}

export const failureSloBenchmarkCases: readonly FailureSloBenchmarkCase[] = [
  {
    id: 'F01',
    name: 'postgres-transaction-rollback',
    adapters: benchmarkAdapters,
    initialDbState: 'QUEUED run with no committed event/checkpoint',
    injectedFault: 'postgres failure after durable writes but before transaction commit',
    expectedDurableState: 'run and event writes are both absent after rollback',
    auditAssertion: 'no audit fact is committed for the rolled-back command',
    telemetryAssertion: 'failure is observable without changing durable business state',
    replayAssertion: 'retry can safely re-admit the command without duplicate state',
  },
  {
    id: 'F02',
    name: 'outbox-acknowledgement-loss',
    adapters: benchmarkAdapters,
    initialDbState: 'SUCCEEDED business effect with unpublished outbox row',
    injectedFault: 'transport succeeds but publication acknowledgement is lost',
    expectedDurableState: 'outbox remains pending and is eligible for retry',
    auditAssertion: 'publication failure does not erase the committed business audit fact',
    telemetryAssertion: 'delivery retry is counted without unbounded labels',
    replayAssertion: 'repeat delivery is consumer-idempotent and cannot create a second logical effect',
  },
  {
    id: 'F03',
    name: 'worker-crash-around-checkpoint',
    adapters: benchmarkAdapters,
    initialDbState: 'RUNNING run with last committed checkpoint and durable attempt',
    injectedFault: 'worker crashes immediately before or after checkpoint persistence',
    expectedDurableState: 'recovery resumes from the last committed checkpoint with fencing',
    auditAssertion: 'only committed lifecycle facts remain visible after recovery',
    telemetryAssertion: 'crash/recovery classification is emitted without business-state mutation',
    replayAssertion: 'replay uses the durable attempt/idempotency identity and does not duplicate effects',
  },
  {
    id: 'F04',
    name: 'overload-and-recovery',
    adapters: benchmarkAdapters,
    initialDbState: 'durable QUEUED work with worker concurrency at its configured bound',
    injectedFault: 'worker saturation defers delivery while an active execution fails',
    expectedDurableState: 'queued work remains durable and the released slot admits the next run',
    auditAssertion: 'defer/retry activity does not fabricate a successful business audit event',
    telemetryAssertion: 'saturation and recovery are measurable with bounded metric labels',
    replayAssertion: 'the deferred run executes once after admission becomes available',
  },
];

export async function runFailureSloBenchmark(): Promise<FailureSloBenchmarkResult[]> {
  const results: FailureSloBenchmarkResult[] = [];

  for (const testCase of failureSloBenchmarkCases) {
    for (const adapterName of testCase.adapters) {
      const runtime = new InMemoryAgentRuntime();
      const adapter = createBenchmarkAdapters(runtime).find((candidate) => candidate.framework === adapterName);
      if (!adapter) throw new Error(`Unknown benchmark adapter: ${adapterName}`);

      const run = await adapter.startRun({
        agentId: `failure-slo-${testCase.id}`,
        input: { caseId: testCase.id, injectedFault: testCase.injectedFault },
      });
      const turn = await adapter.executeTurn(run.runId, { failureCase: testCase.id });
      const checkpoint = await adapter.checkpoint(run.runId);
      const recovered = await adapter.recover(checkpoint);
      const state = await adapter.getRunState(run.runId);

      const invariantViolations: string[] = [];
      if (turn.sequence !== 1) invariantViolations.push('lifecycle-sequence');
      if (checkpoint.runId !== run.runId || recovered.runId !== run.runId) invariantViolations.push('checkpoint-recovery');
      if (state.version !== 1) invariantViolations.push('adapter-state-version');

      results.push({
        caseId: testCase.id,
        adapter: adapterName,
        passed: invariantViolations.length === 0,
        invariantViolations,
        details: `${testCase.name}; adapter=${adapterName}; durable=${testCase.expectedDurableState}`,
      });
    }
  }

  return results;
}