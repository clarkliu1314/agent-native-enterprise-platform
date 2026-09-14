import { DurableRuntimeService, PostgresDatabase, PostgresOperationalControlRepository, PostgresToolRepositories, OperationalControlService } from '@agent-native/runtime';
import type { RuntimeAdapter } from '@agent-native/runtime';
import { createDurableHandler } from './durable-handler';
import { createOperationalControlHandler } from './operational-control-handler';

export interface ApiComposition { handler: ReturnType<typeof createDurableHandler>; controlHandler: ReturnType<typeof createOperationalControlHandler>; runtime: DurableRuntimeService; control: OperationalControlService; database: PostgresDatabase; }

export function composeApi(adapter: RuntimeAdapter): ApiComposition {
  const database = new PostgresDatabase();
  const repositories = new PostgresToolRepositories(database);
  const runtime = new DurableRuntimeService(repositories, { adapter });
  const control = new OperationalControlService({ repository: new PostgresOperationalControlRepository(database) });
  return { handler: createDurableHandler(runtime), controlHandler: createOperationalControlHandler({ service: control }), runtime, control, database };
}
