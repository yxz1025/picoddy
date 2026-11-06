import { createAutomationResourceService } from "../../domains/automation/node/service.ts";
import { createConnectorResourceService } from "../../domains/connector/node/service.ts";
import { createExpertResourceService } from "../../domains/expert/node/service.ts";
import { createMemoryResourceService } from "../../domains/memory/node/service.ts";
import { createWorkspaceResourceService } from '../../domains/workspace/node/service.ts';
import type { ResourceCrudService } from "../../domains/resource/node/service.ts";
import { createModelSettingsService } from "../../domains/settings/node/service.ts";
import type { RequestContext } from "./routes.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ResourceFactory = (context: RequestContext) => ResourceCrudService;

const RESOURCE_FACTORIES: Record<string, ResourceFactory> = {
  // Private file spaces; unrelated to the removed TAPD project workflow.
  workspaces: (context) => createWorkspaceResourceService({ database: context.database, ownerId: context.user.id }),
  experts: (context) => createExpertResourceService({
    database: context.database,
    ownerId: context.user.id,
  }),
  connectors: (context) => createConnectorResourceService({
    database: context.database,
    ownerId: context.user.id,
    config: context.config,
  }),
  models: (context) => createModelSettingsService({
    database: context.database,
    ownerId: context.user.id,
    config: context.config,
  }),
  memories: (context) => createMemoryResourceService({
    database: context.database,
    ownerId: context.user.id,
  }),
  automations: (context) => createAutomationResourceService({
    database: context.database,
    ownerId: context.user.id,
  }),
};

export async function handleResourceRoutes(context: RequestContext): Promise<boolean> {
  const match = context.url.pathname.match(/^\/api\/([^/]+)(?:\/([0-9a-f-]+))?$/i);
  if (!match) return false;
  const factory = RESOURCE_FACTORIES[match[1]];
  if (!factory) return false;
  const id = match[2];
  if (id && !UUID.test(id)) return false;

  const service = factory(context);
  const method = context.request.method || "GET";
  if (!id && method === "GET") {
    context.json(200, await service.list());
    return true;
  }
  if (!id && method === "POST") {
    context.json(201, await service.create(await context.readJson()));
    return true;
  }
  if (id && method === "PATCH") {
    context.json(200, await service.update(id, await context.readJson()));
    return true;
  }
  if (id && method === "DELETE") {
    await service.remove(id);
    context.empty(204);
    return true;
  }
  return false;
}
