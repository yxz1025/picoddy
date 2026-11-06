import { createSkillService } from "../../domains/skill/node/service.ts";
import { UUID } from "../../shared/validation.ts";
import type { RequestContext } from "./routes.ts";

export async function handleSkillRoutes(context: RequestContext): Promise<boolean> {
  const path = context.url.pathname;
  const method = context.request.method || "GET";
  const service = createSkillService({
    database: context.database,
    maxUploadBytes: context.config.maxUploadBytes,
  });

  if (path === "/api/skills" && method === "GET") {
    context.json(200, await service.list(context.user.id));
    return true;
  }
  if (path === "/api/skills" && method === "POST") {
    context.json(201, await service.create(context.user.id, await context.readJson<unknown>()));
    return true;
  }

  const versions = path.match(/^\/api\/skills\/([0-9a-f-]+)\/versions$/i);
  const rollback = path.match(/^\/api\/skills\/([0-9a-f-]+)\/rollback$/i);
  if (rollback && UUID.test(rollback[1]) && method === 'POST') {
    context.json(200, await service.rollback(context.user.id, rollback[1], await context.readJson()));
    return true;
  }
  if (versions && UUID.test(versions[1]) && method === "GET") {
    context.json(200, await service.versions(context.user.id, versions[1]));
    return true;
  }
  if (versions && UUID.test(versions[1]) && method === "POST") {
    context.json(
      201,
      await service.addVersion(context.user.id, versions[1], await context.readJson<unknown>()),
    );
    return true;
  }

  const content = path.match(/^\/api\/skills\/([0-9a-f-]+)\/content$/i);
  if (content && UUID.test(content[1]) && method === "GET") {
    context.json(200, await service.content(context.user.id, content[1]));
    return true;
  }

  const item = path.match(/^\/api\/skills\/([0-9a-f-]+)$/i);
  if (item && UUID.test(item[1]) && method === "PATCH") {
    context.json(200, await service.update(context.user.id, item[1], await context.readJson<unknown>()));
    return true;
  }
  if (item && UUID.test(item[1]) && method === "DELETE") {
    await service.remove(context.user.id, item[1]);
    context.empty(204);
    return true;
  }
  return false;
}
