import {
  OutboxPublisher,
  PostgresDatabase,
  PostgresOutboxRepository,
} from '@agent-native/runtime';
import type { QueuePublisher } from '@agent-native/runtime';
import { createRedisPublisher, type RedisStreamPublisher } from '@agent-native/queue';

export interface OutboxPublisherComposition {
  database: PostgresDatabase;
  repository: PostgresOutboxRepository;
  queue: QueuePublisher;
  publisher: OutboxPublisher;
}

export function composeOutboxPublisher(queue: QueuePublisher, claimLeaseMs = 30_000): OutboxPublisherComposition {
  const database = new PostgresDatabase();
  const repository = new PostgresOutboxRepository(database, claimLeaseMs);
  const publisher = new OutboxPublisher(repository, queue);
  return { database, repository, queue, publisher };
}

export function composeRedisOutboxPublisher(
  redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379',
  claimLeaseMs = 30_000,
): OutboxPublisherComposition & { queue: RedisStreamPublisher } {
  return composeOutboxPublisher(createRedisPublisher(redisUrl), claimLeaseMs);
}

export async function publishOnce(
  composition: OutboxPublisherComposition,
  batchSize = 50,
): Promise<{ published: number; retried: number }> {
  return composition.publisher.publishBatch(batchSize);
}
