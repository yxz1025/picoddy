import type { LocalProjectCreate } from "../shared/workflow.ts";
import type { LocalProjectWorkflowService } from "./local_workflow.ts";

interface LocalProjectHttpAdapterDependencies {
  service: LocalProjectWorkflowService;
  getAccountId(): string | null | undefined;
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function sanitizedBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("请求体必须是 JSON 对象"), { status: 400, code: "INVALID_REQUEST" });
  const { accountId: _ignoredAccount, action: _ignoredAction, ...body } = value as Record<string, unknown>;
  return body;
}

/**
 * Thin HTTP adapter. Account scope is resolved by the active auth callback and
 * is never accepted from the renderer payload.
 */
export function createLocalProjectHttpAdapter(dependencies: LocalProjectHttpAdapterDependencies) {
  return async function handleLocalProjectRequest(req: Request, rawPath: string): Promise<Response | null> {
    const path = rawPath.split("?")[0];
    if (path !== "/api/local-projects" && !path.startsWith("/api/local-projects/")) return null;
    const accountId = dependencies.getAccountId()?.trim();
    if (!accountId) return response({ error: "请先登录", code: "AUTH_REQUIRED" }, 401);
    try {
      if (path === "/api/local-projects") {
        if (req.method === "GET") return response(dependencies.service.listProjects(accountId));
        if (req.method === "POST") {
          const body = sanitizedBody(await req.json());
          return response(await dependencies.service.createProject(accountId, body as unknown as LocalProjectCreate));
        }
        return response({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, 405);
      }

      const encodedId = path.slice("/api/local-projects/".length);
      if (!encodedId || encodedId.includes("/")) return response({ error: "项目路径无效", code: "INVALID_REQUEST" }, 400);
      const id = decodeURIComponent(encodedId);
      if (req.method === "GET") {
        const refresh = new URL(req.url).searchParams.get("refresh") === "1";
        return response(refresh
          ? await dependencies.service.refreshPresentedAssets(accountId, id)
          : dependencies.service.getProject(accountId, id));
      }
      if (req.method !== "POST") return response({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, 405);

      const raw = await req.json();
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return response({ error: "请求体必须是 JSON 对象", code: "INVALID_REQUEST" }, 400);
      const action = String((raw as Record<string, unknown>).action ?? "");
      const payload = sanitizedBody(raw) as any;
      switch (action) {
        case "settings": return response(dependencies.service.updateSettings(accountId, id, payload));
        case "archive": return response(dependencies.service.setArchived(accountId, id, Boolean(payload.archived)));
        case "repository": return response(await dependencies.service.addRepository(accountId, id, payload));
        case "asset": return response(await dependencies.service.addAsset(accountId, id, payload));
        case "start": return response(await dependencies.service.startStage(accountId, id, payload));
        case "review": return response(await dependencies.service.submitReview(accountId, id, payload));
        case "confirm": return response(dependencies.service.confirmStage(accountId, id, payload));
        case "reopen": return response(dependencies.service.reopenStage(accountId, id, payload));
        default: return response({ error: "未知项目操作", code: "INVALID_ACTION" }, 400);
      }
    } catch (error) {
      const typed = error as { message?: unknown; status?: unknown; code?: unknown };
      const status = Number.isInteger(typed.status) && Number(typed.status) >= 400 && Number(typed.status) < 600 ? Number(typed.status) : 500;
      const message = status >= 500 && !typed.message ? "本地项目操作失败" : String(typed.message || "本地项目操作失败");
      return response({ error: message, ...(typed.code ? { code: String(typed.code) } : {}) }, status);
    }
  };
}
