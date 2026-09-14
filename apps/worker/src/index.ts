import {
  DurableRuntimeService,
  DurableWorker,
  OperationalControlService,
  PostgresDatabase,
  PostgresOperationalControlRepository,
  PostgresToolRepositories,
} from '@agent-native/runtime';
import type { QueueConsumer, RuntimeAdapter } from '@agent-native/runtime';
import { createRedisConsumer, type RedisStreamConsumer } from '@agent-native/queue';

export interface WorkerComposition<C extends QueueConsumer = QueueConsumer> {
  database: PostgresDatabase;
  repositories: PostgresToolRepositories;
  runtime: DurableRuntimeService;
  worker: DurableWorker;
  control: OperationalControlService;
  consumer: C;
}

export interface WorkerCompositionOptions {
  owner?: string;
  leaseMs?: number;
  heartbeatMs?: number;
  executionSliceMs?: number;
  operationalControl?: OperationalControlService;
}

function createWorkerComposition(
  adapter: RuntimeAdapter,
  consumer: QueueConsumer,
  options: WorkerCompositionOptions,
): WorkerComposition {
  const database = new PostgresDatabase();
  const repositories = new PostgresToolRepositories(database);
  const runtime = new DurableRuntimeService(repositories, {
    adapter,
    leaseMs: options.leaseMs,
    heartbeatMs: options.heartbeatMs,
  });
  const control = options.operationalControl ?? new OperationalControlService({
    repository: new PostgresOperationalControlRepository(database),
  });
  const worker = new DurableWorker(runtime, consumer, {
    owner: options.owner ?? `worker-${process.pid}`,
    executionSliceMs: options.executionSliceMs,
    operationalControl: control,
  });
  return { database, repositories, runtime, worker, control, consumer };
}

export function composeWorker(
  adapter: RuntimeAdapter,
  consumer: QueueConsumer,
  options: WorkerCompositionOptions = {},
): WorkerComposition {
  return createWorkerComposition(adapter, consumer, options);
}

export function composeRedisWorker(
  adapter: RuntimeAdapter,
  redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379',
  options: WorkerCompositionOptions = {},
): WorkerComposition<RedisStreamConsumer> {
  const consumer = createRedisConsumer(redisUrl);
  return createWorkerComposition(adapter, consumer, options) as WorkerComposition<RedisStreamConsumer>;
}

export { RecoveryWorker } from './recovery-worker';
export type { RecoveryWorkerOptions, RecoveryWorkerResult, RecoveryOutcome, RecoveryOutcomeClassification } from './recovery-worker';
