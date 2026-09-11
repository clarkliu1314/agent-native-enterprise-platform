import {
  OutboxPublisher,
  PostgresDatabase,
  PostgresOutboxRepository,
} from '@agent-native/runtime';
import type { QueuePublisher } from '@agent-native/runtime';

export interface OutboxPublisherComposition {
  database: PostgresDatabase;
  repository: PostgresOutboxRepository;
  publisher: OutboxPublisher;
}

export function composeOutboxPublisher(queue: QueuePublisher, claimLeaseMs = 30_000): OutboxPublisherComposition {
  const database = new PostgresDatabase();
  const repository = new PostgresOutboxRepository(database, claimLeaseMs);
  const publisher = new OutboxPublisher(repository, queue);
  return { database, repository, publisher };
}

export async function publishOnce(
  composition: OutboxPublisherComposition,
  batchSize = 50,
): Promise<{ published: number; retried: number }> {
  return composition.publisher.publishBatch(batchSize);
}
