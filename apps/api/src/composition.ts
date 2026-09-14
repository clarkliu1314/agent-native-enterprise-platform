import { DurableRuntimeService, PostgresDatabase, PostgresOperationalControlRepository, PostgresToolRepositories, OperationalControlService } from '@agent-native/runtime';
import { DeploymentApplication } from '@agent-native/deployment-boundary';
import type { RuntimeAdapter } from '@agent-native/runtime';
import { createDurableHandler } from './durable-handler';
import { createOperationalControlHandler } from './operational-control-handler';
import { createVercelHandler } from './handler';

export interface ApiComposition {
  handler: ReturnType<typeof createDurableHandler>;
  controlHandler: ReturnType<typeof createOperationalControlHandler>;
  vercelHandler: ReturnType<typeof createVercelHandler>;
  application: DeploymentApplication;
  runtime: DurableRuntimeService;
  control: OperationalControlService;
  database: PostgresDatabase;
}

export function composeApi(adapter: RuntimeAdapter): ApiComposition {
  const database = new PostgresDatabase();
  const repositories = new PostgresToolRepositories(database);
  const runtime = new DurableRuntimeService(repositories, { adapter });
  const application = new DeploymentApplication(runtime);
  const control = new OperationalControlService({ repository: new PostgresOperationalControlRepository(database) });
  const handler = createDurableHandler(runtime);
  const controlHandler = createOperationalControlHandler({ service: control });
  const vercelHandler = createVercelHandler(application, controlHandler);
  return { handler, controlHandler, vercelHandler, application, runtime, control, database };
}
