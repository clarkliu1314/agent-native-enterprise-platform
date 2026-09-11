import {
  PostgresDatabase,
  PostgresRuntimeRepositories,
  RecoveryCoordinator,
} from '@agent-native/runtime';
import type { RuntimeAdapter } from '@agent-native/runtime';

export interface RecoveryComposition {
  database: PostgresDatabase;
  repositories: PostgresRuntimeRepositories;
  coordinator: RecoveryCoordinator;
}

export function composeRecovery(adapter: RuntimeAdapter, leaseMs = 30_000): RecoveryComposition {
  const database = new PostgresDatabase();
  const repositories = new PostgresRuntimeRepositories(database);
  const coordinator = new RecoveryCoordinator(repositories, adapter, leaseMs);
  return { database, repositories, coordinator };
}

export async function recoverOnce(
  composition: RecoveryComposition,
  limit = 25,
) {
  return composition.coordinator.recoverExpired(limit);
}
