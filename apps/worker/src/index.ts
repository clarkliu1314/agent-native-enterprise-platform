import {
  DurableRuntimeService,
  DurableWorker,
  PostgresDatabase,
  PostgresToolRepositories,
} from '@agent-native/runtime';
import type { QueueConsumer, RuntimeAdapter } from '@agent-native/runtime';

export interface WorkerComposition {
  database: PostgresDatabase;
  repositories: PostgresToolRepositories;
  runtime: DurableRuntimeService;
  worker: DurableWorker;
}

export interface WorkerCompositionOptions {
  owner?: string;
  leaseMs?: number;
  heartbeatMs?: number;
  executionSliceMs?: number;
}

/**
 * Worker is a separate process root: it owns infrastructure construction but
 * delegates execution authority to the framework-neutral RuntimeFacade.
 */
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
  return { database, repositories, runtime, worker };
}

export { RecoveryWorker } from './recovery-worker';
export type { RecoveryWorkerOptions, RecoveryWorkerResult, RecoveryOutcome, RecoveryOutcomeClassification } from './recovery-worker';
