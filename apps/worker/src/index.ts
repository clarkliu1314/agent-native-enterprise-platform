import {
  DurableRuntimeService,
  DurableWorker,
  PostgresDatabase,
  PostgresToolRepositories,
} from '@agent-native/runtime';
import type { QueueConsumer, RuntimeAdapter } from '@agent-native/runtime';
import { createRedisConsumer, type RedisStreamConsumer } from '@agent-native/queue';

export interface WorkerComposition<C extends QueueConsumer = QueueConsumer> {
  database: PostgresDatabase;
  repositories: PostgresToolRepositories;
  runtime: DurableRuntimeService;
  worker: DurableWorker;
  consumer: C;
}

export interface WorkerCompositionOptions {
  owner?: string;
  leaseMs?: number;
  heartbeatMs?: number;
  executionSliceMs?: number;
}

export function composeWorker(
  adapter: RuntimeAdapter,
  consumer: QueueConsumer,
  options: WorkerCompositionOptions = {},
): WorkerComposition {
  const database = new PostgresDatabase();
  const repositories = new PostgresToolRepositories(database);
  const runtime = new DurableRuntimeService(repositories, {
    adapter,
    leaseMs: options.leaseMs,
    heartbeatMs: options.heartbeatMs,
  });
  const worker = new DurableWorker(runtime, consumer, {
    owner: options.owner ?? `worker-${process.pid}`,
    executionSliceMs: options.executionSliceMs,
  });
  return { database, repositories, runtime, worker, consumer };
}

export function composeRedisWorker(
  adapter: RuntimeAdapter,
  redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379',
  options: WorkerCompositionOptions = {},
): WorkerComposition<RedisStreamConsumer> {
  const consumer = createRedisConsumer(redisUrl);
  const database = new PostgresDatabase();
  const repositories = new PostgresToolRepositories(database);
  const runtime = new DurableRuntimeService(repositories, {
    adapter,
    leaseMs: options.leaseMs,
    heartbeatMs: options.heartbeatMs,
  });
  const worker = new DurableWorker(runtime, consumer, {
    owner: options.owner ?? `worker-${process.pid}`,
    executionSliceMs: options.executionSliceMs,
  });
  return { database, repositories, runtime, worker, consumer };
}

export { RecoveryWorker } from './recovery-worker';
export type { RecoveryWorkerOptions, RecoveryWorkerResult, RecoveryOutcome, RecoveryOutcomeClassification } from './recovery-worker';
