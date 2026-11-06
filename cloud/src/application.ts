import type { Config } from './config.ts';
import { database } from './infra/db.ts';
import { createStorage } from './platform/storage.ts';
import { createRequestHandler, type RouteDependencies } from './transport/http/routes.ts';

/** Composition root: domain dependencies are shared by a single API instance. */
export function createApplication(config: Config, dependencies: RouteDependencies = {}) {
  const services = {
    database: dependencies.database ?? database,
    storage: dependencies.storage ?? createStorage(config),
    casFetch: dependencies.casFetch,
    modelRequest: dependencies.modelRequest,
    skillHubFetch: dependencies.skillHubFetch,
    mcp: dependencies.mcp,
  };
  return {
    handleApi: createRequestHandler(config, services),
    async ready() {
      await services.database.query('SELECT 1');
      await services.storage.ready();
    },
  };
}
