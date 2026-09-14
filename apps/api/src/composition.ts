import { DurableRuntimeService, PostgresAuditRepository, PostgresDatabase, PostgresOperationalControlRepository, PostgresToolRepositories, OperationalControlService } from '@agent-native/runtime';
import type { RuntimeAdapter } from '@agent-native/runtime';
import { createDurableHandler } from './durable-handler';
import { createOperationalControlHandler } from './operational-control-handler';
import { createVercelHandler } from './handler';

export interface ApiComposition {
  handler: ReturnType<typeof createDurableHandler>;
  controlHandler: ReturnType<typeof createOperationalControlHandler>;
  vercelHandler: ReturnType<typeof createVercelHandler>;
  runtime: DurableRuntimeService;
  control: OperationalControlService;
  database: PostgresDatabase;
}

export function composeApi(adapter: RuntimeAdapter): ApiComposition {
  const database = new PostgresDatabase();
  const audit = new PostgresAuditRepository(database);
  const repositories = new PostgresToolRepositories(database, audit);
  const runtime = new DurableRuntimeService(repositories, { adapter });
  const control = new OperationalControlService({ repository: new PostgresOperationalControlRepository(database), audit });
  const handler = createDurableHandler(runtime);
  const controlHandler = createOperationalControlHandler({ service: control });
  const vercelHandler = createVercelHandler(runtime, controlHandler);
  return { handler, controlHandler, vercelHandler, runtime, control, database };
}
