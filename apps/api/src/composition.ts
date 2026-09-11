import { DurableRuntimeService, PostgresDatabase, PostgresRuntimeRepositories } from '@agent-native/runtime';
import type { RuntimeAdapter } from '@agent-native/runtime';
import { createDurableHandler } from './durable-handler';

export interface ApiComposition {
  handler: ReturnType<typeof createDurableHandler>;
  runtime: DurableRuntimeService;
  database: PostgresDatabase;
}

export function composeApi(adapter: RuntimeAdapter): ApiComposition {
  const database = new PostgresDatabase();
  const repositories = new PostgresRuntimeRepositories(database);
  const runtime = new DurableRuntimeService(repositories, { adapter });
  return { handler: createDurableHandler(runtime), runtime, database };
}
