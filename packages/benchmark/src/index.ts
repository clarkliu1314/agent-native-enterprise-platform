export const benchmarkAdapters = ['agentscope', 'langgraph', 'eino', 'mastra'] as const;
export type BenchmarkAdapter = (typeof benchmarkAdapters)[number];

export const benchmarkInvariants = ['permission', 'idempotency', 'outbox'] as const;
export type BenchmarkInvariant = (typeof benchmarkInvariants)[number];

export interface BenchmarkInitialState {
  runState: string;
  recoveryState: string;
  toolExecutionState: string;
  outboxState: string;
}

export interface BenchmarkMock {
  llm: string;
  tool: string;
  externalEffect?: string;
}

export interface BenchmarkCase {
  id: `B${string}`;
  fixture: string;
  initialState: BenchmarkInitialState;
  mock: BenchmarkMock;
  steps: readonly string[];
  sqlAssertions: readonly string[];
  expectedResult: string;
  failureCriteria: readonly string[];
  invariants: readonly BenchmarkInvariant[];
  adapters: readonly BenchmarkAdapter[];
}

const sharedAdapters = benchmarkAdapters;
const safety = benchmarkInvariants;

function defineCase(
  id: BenchmarkCase['id'],
  fixture: string,
  runState: string,
  recoveryState: string,
  toolExecutionState: string,
  outboxState: string,
  llm: string,
  tool: string,
  steps: readonly string[],
  sqlAssertions: readonly string[],
  expectedResult: string,
  failureCriteria: readonly string[],
): BenchmarkCase {
  return {
    id,
    fixture,
    initialState: { runState, recoveryState, toolExecutionState, outboxState },
    mock: { llm, tool },
    steps,
    sqlAssertions,
    expectedResult,
    failureCriteria,
    invariants: safety,
    adapters: sharedAdapters,
  };
}

export const benchmarkCases: readonly BenchmarkCase[] = [
  defineCase('B01', 'permission-allow', 'RUNNING', 'NONE', 'PENDING', 'PENDING', 'deterministic tool call', 'allow once', ['start run', 'authorize tool', 'execute tool', 'persist result and outbox'], ['tool execution is SUCCEEDED', 'one outbox row exists'], 'tool executes once and event is durable', ['permission denial', 'missing outbox row']),
  defineCase('B02', 'permission-deny', 'RUNNING', 'NONE', 'PENDING', 'NONE', 'deterministic denied call', 'deny by policy', ['start run', 'authorize tool', 'assert denial'], ['no tool execution row is committed', 'no outbox row is committed'], 'denied tool has no side effect', ['tool executes', 'outbox event is emitted']),
  defineCase('B03', 'permission-scope-mismatch', 'RUNNING', 'NONE', 'PENDING', 'NONE', 'scoped tool call', 'deny wrong scope', ['start run', 'authorize tenant-scoped tool', 'assert denial'], ['permission decision is denied', 'effect table remains unchanged'], 'scope mismatch is denied before execution', ['cross-scope effect']),
  defineCase('B04', 'idempotency-duplicate', 'RUNNING', 'NONE', 'PENDING', 'PENDING', 'same request twice', 'counting side effect', ['execute request with key k', 'execute same request with key k'], ['one successful effect for key k', 'one outbox event for key k'], 'second request replays the committed result', ['effect count greater than one']),
  defineCase('B05', 'idempotency-conflict', 'RUNNING', 'NONE', 'PENDING', 'NONE', 'same key different payload', 'counting side effect', ['execute payload A with key k', 'execute payload B with key k'], ['one idempotency record for key k', 'effect payload equals A'], 'conflicting reuse is rejected', ['payload B executes']),
  defineCase('B06', 'outbox-atomic-commit', 'RUNNING', 'NONE', 'RUNNING', 'PENDING', 'successful tool result', 'transactional effect', ['execute tool', 'commit effect and outbox in one transaction'], ['effect row and outbox row share the transaction outcome'], 'business state and publication intent commit atomically', ['effect without outbox', 'outbox without effect']),
  defineCase('B07', 'outbox-publish-retry', 'RUNNING', 'NONE', 'SUCCEEDED', 'PENDING', 'already persisted result', 'transport fails once then succeeds', ['publish outbox', 'observe transport failure', 'retry publish', 'ack after success'], ['outbox is acknowledged only after successful transport'], 'publisher retries without losing the event', ['ack before transport success']),
  defineCase('B08', 'publish-duplicate-delivery', 'RUNNING', 'NONE', 'SUCCEEDED', 'PENDING', 'already persisted result', 'transport succeeds but ack is lost', ['publish event', 'drop ack', 'publish same outbox event again', 'consume twice'], ['consumer effect is applied once', 'outbox eventually acknowledged'], 'at-least-once delivery remains consumer-idempotent', ['duplicate business effect']),
  defineCase('B09', 'crash-after-claim', 'RECOVERING', 'IN_PROGRESS', 'PENDING', 'PENDING', 'recovery replay', 'effectful tool', ['claim candidate', 'crash worker before execution', 'start replacement worker', 'reclaim and execute'], ['lease owner changes', 'recovery completes', 'one effect exists'], 'expired claim is safely reclaimed', ['two active owners', 'lost candidate']),
  defineCase('B10', 'crash-during-tool', 'RECOVERING', 'IN_PROGRESS', 'RUNNING', 'PENDING', 'recovery replay', 'effectful tool with durable key', ['claim candidate', 'begin tool execution', 'crash worker', 'restart and replay same key'], ['idempotency record prevents duplicate effect', 'recovery reaches terminal success'], 'ambiguous execution is resolved by idempotent replay', ['double effect', 'permanent loss']),
  defineCase('B11', 'crash-after-result-before-outbox', 'RECOVERING', 'IN_PROGRESS', 'SUCCEEDED', 'PENDING', 'result already durable', 'effect already committed', ['persist result', 'crash before publication intent', 'recover', 'publish outbox'], ['exactly one result exists', 'exactly one outbox row exists'], 'recovery repairs the publication gap', ['duplicate result', 'missing publication']),
  defineCase('B12', 'crash-after-outbox-before-ack', 'RUNNING', 'NONE', 'SUCCEEDED', 'PENDING', 'published event', 'transport succeeds ack lost', ['publish event', 'crash before ack', 'restart publisher', 'republish and ack'], ['consumer observes one logical effect', 'outbox is eventually acknowledged'], 'duplicate transport is harmless', ['duplicate logical effect']),
  defineCase('B13', 'expired-lease-reclaim', 'RECOVERING', 'IN_PROGRESS', 'PENDING', 'PENDING', 'retryable recovery', 'recoverable tool', ['create expired lease', 'worker discovers candidate', 'claim with new lease', 'recover'], ['old lease is cleared', 'new owner is persisted', 'state becomes terminal'], 'expired work becomes eligible exactly once', ['expired owner can still complete']),
  defineCase('B14', 'retryable-backoff', 'RECOVERING', 'FAILED_RETRYABLE', 'PENDING', 'PENDING', 'temporary failure', 'fails twice then succeeds', ['recover', 'record retryable failure', 'wait until next_attempt_at', 'recover again'], ['attempt count increments durably', 'next_attempt_at increases with bounded backoff'], 'retry schedule is deterministic and bounded', ['immediate hot loop', 'attempt count lost']),
  defineCase('B15', 'terminal-failure', 'RECOVERING', 'FAILED_RETRYABLE', 'PENDING', 'PENDING', 'permanent failure', 'policy/idempotency terminal error', ['recover', 'classify non-retryable error', 'record final failure'], ['recovery_state is FAILED_FINAL', 'no future retry is scheduled'], 'terminal errors stop retries durably', ['continued retry', 'state regresses to retryable']),
  defineCase('B16', 'concurrent-workers', 'RECOVERING', 'IN_PROGRESS', 'PENDING', 'PENDING', 'same recovery candidate', 'effectful tool', ['start two workers concurrently', 'both discover candidate', 'both attempt claim', 'execute winner'], ['exactly one lease owner exists', 'exactly one terminal completion exists'], 'row locking and lease fencing prevent double recovery', ['two owners', 'duplicate effect', 'lost completion']),
];

export interface BenchmarkRunResult {
  caseId: BenchmarkCase['id'];
  adapter: BenchmarkAdapter;
  passed: boolean;
  invariantViolations: readonly BenchmarkInvariant[];
  details: string;
}

export interface BenchmarkRunner {
  run(testCase: BenchmarkCase, adapter: BenchmarkAdapter): Promise<BenchmarkRunResult>;
  runAll(): Promise<BenchmarkRunResult[]>;
}
