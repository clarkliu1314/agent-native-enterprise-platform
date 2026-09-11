import {
  PostgresDatabase,
  PostgresRuntimeRepositories,
  RecoveryCoordinator,
} from '@agent-native/runtime';
import type { QueuePublisher, RuntimeAdapter } from '@agent-native/runtime';
import { createRedisPublisher, type RedisStreamPublisher } from '@agent-native/queue';

export interface RecoveryComposition {
  database: PostgresDatabase;
  repositories: PostgresRuntimeRepositories;
  queue: QueuePublisher;
  coordinator: RecoveryCoordinator;
}

export function composeRecovery(
  adapter: RuntimeAdapter,
  queue: QueuePublisher,
  leaseMs = 30_000,
): RecoveryComposition {
  const database = new PostgresDatabase();
  const repositories = new PostgresRuntimeRepositories(database);
  const coordinator = new RecoveryCoordinator(repositories, adapter, leaseMs, queue);
  return { database, repositories, queue, coordinator };
}

export function composeRedisRecovery(
  adapter: RuntimeAdapter,
  redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379',
  leaseMs = 30_000,
): RecoveryComposition & { queue: RedisStreamPublisher } {
  const queue = createRedisPublisher(redisUrl);
  return composeRecovery(adapter, queue, leaseMs);
}

export async function recoverOnce(
  composition: RecoveryComposition,
  limit = 25,
) {
  return composition.coordinator.recoverExpired(limit);
}
