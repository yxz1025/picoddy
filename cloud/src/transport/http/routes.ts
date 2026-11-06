import { createSessionService } from "../../domains/session/node/service.ts";
import { HttpError, fail } from '../../shared/errors.ts';
import { object, string, optionalUuid, UUID } from '../../shared/validation.ts';
import { enqueueUsingDatabase, publicRunColumns, mapPublicRun, type PublicRunRow } from '../../cloud/runs/service.ts';
const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
import type { IncomingMessage, ServerResponse } from "node:http";


import {
  assertRequestOrigin,
  authenticate,
  expiredSessionCookie,
  hashSessionToken,
  requestSessionToken,
  type AuthUser,
} from "../../cloud/auth/service.ts";
import { beginCasLogin, finishCasLogin } from "../../cloud/auth/cas.ts";
import { handleModelDiagnostics } from './model-diagnostics.ts';
import { handleSkillHubRoutes } from './skillhub.ts';
import type { ModelRequest } from '../../platform/model-request.ts';
import type { Config } from "../../config.ts";
import { database as defaultDatabase, type Database } from "../../infra/db.ts";
import { handleFileRoutes } from "./files.ts";
import { handleSkillDraftRoutes } from './skill-drafts.ts';
import { handleExpertRoutes } from './experts.ts';
import { handleExpertDraftRoutes } from './expert-drafts.ts';
import { handleQuestionRoutes } from './questions.ts';
import { handleWorkspaceFileRoutes } from './workspace-files.ts';
import { handleResourceRoutes } from "./resources.ts";
import { handleSkillRoutes } from "./skills.ts";
import { handlePreferenceRoutes } from './preferences.ts';
import { handleMcpRoutes, type McpRouteDependencies } from './mcp.ts';
import { handleMcpOAuthRoutes } from './mcp-oauth.ts';
import { createStorage, type Storage } from "../../platform/storage.ts";

export interface RouteDependencies {
  mcp?: McpRouteDependencies;
  database?: Database;
  storage?: Storage;
  casFetch?: typeof fetch;
  modelRequest?: ModelRequest;
  skillHubFetch?: typeof fetch;
}

export interface RequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  config: Config;
  database: Database;
  storage: Storage;
  user: AuthUser;
  readJson<T = Record<string, unknown>>(limit?: number): Promise<T>;
  json(status: number, data: unknown): void;
  empty(status: number): void;
  fail(status: number, code: string, message: string): never;
}

async function readJsonBody<T>(request: IncomingMessage, limit: number): Promise<T> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    fail(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > limit) fail(413, "BODY_TOO_LARGE", "Request body is too large");
    chunks.push(bytes);
  }
  if (size === 0) fail(400, "INVALID_JSON", "Request body is required");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    fail(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function sendEmpty(response: ServerResponse, status: number): void {
  response.writeHead(status, { "Cache-Control": "no-store" });
  response.end();
}


async function streamEvents(context: RequestContext, runId: string): Promise<void> {
  const run = await context.database.query(
    "SELECT id FROM runs WHERE id=$1 AND owner_id=$2",
    [runId, context.user.id],
  );
  if (!run.rows[0]) fail(404, "NOT_FOUND", "Run not found");
  const lastEventHeader = context.request.headers["last-event-id"];
  const afterValue = context.url.searchParams.get("after")
    ?? (Array.isArray(lastEventHeader) ? lastEventHeader[0] : lastEventHeader)
    ?? "0";
  if (!/^\d+$/.test(afterValue)) fail(400, "INVALID_CURSOR", "Event cursor must be an integer");
  let cursor = BigInt(afterValue);
  context.response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  context.response.flushHeaders();
  context.response.write(": connected\n\n");

  let closed = false;
  const close = () => { closed = true; };
  context.response.once("close", close);
  let heartbeatAt = Date.now();
  let authenticatedAt = Date.now();
  try {
    while (!closed) {
      if (Date.now() - authenticatedAt >= 30_000) {
        if (!await authenticate(context.request, context.database)) break;
        authenticatedAt = Date.now();
      }
      const events = await context.database.query<{
        id: string;
        run_id: string;
        type: string;
        payload: unknown;
        created_at: Date | string;
      }>(
        `SELECT id::text, run_id, type, payload, created_at
           FROM events
          WHERE owner_id=$1 AND run_id=$2 AND id>$3
          ORDER BY id LIMIT 500`,
        [context.user.id, runId, cursor.toString()],
      );
      for (const event of events.rows) {
        if (closed || context.response.destroyed) break;
        cursor = BigInt(event.id);
        const data = {
          id: event.id,
          runId: event.run_id,
          type: event.type,
          payload: event.payload,
          createdAt: iso(event.created_at),
        };
        if (!context.response.write(
          `id: ${event.id}\nevent: update\ndata: ${JSON.stringify(data)}\n\n`,
        ) && !closed && !context.response.destroyed) {
          await new Promise<void>((resolve) => {
            const done = () => {
              context.response.off("drain", done);
              context.response.off("close", done);
              resolve();
            };
            context.response.once("drain", done);
            context.response.once("close", done);
          });
        }
      }
      if (!closed && !context.response.destroyed && Date.now() - heartbeatAt >= 15_000) {
        context.response.write(": heartbeat\n\n");
        heartbeatAt = Date.now();
      }
      if (closed || context.response.destroyed) break;
      // Brief gaps between model tokens are normal. A one-second idle delay
      // turns the subsequent live tokens into a visibly batched response.
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    context.response.off("close", close);
    if (!context.response.writableEnded) context.response.end();
  }
}

async function handleAuthenticated(context: RequestContext, mcpDependencies?: McpRouteDependencies): Promise<boolean> {
  const { request, url, user, database } = context;
  const method = request.method || "GET";
  const path = url.pathname;

  if (method === "GET" && path === "/api/auth/me") {
    context.json(200, { id: user.id, email: user.email, name: user.name, subject: user.subject, avatar: user.avatar,
      sessionId: user.sessionId, loggedInAt: user.loggedInAt, expiresAt: user.expiresAt });
    return true;
  }
  if (method === "POST" && path === "/api/auth/logout") {
    const token = requestSessionToken(request);
    if (token) await database.query("DELETE FROM sessions WHERE token_hash=$1", [hashSessionToken(token)]);
    context.response.setHeader("Set-Cookie", expiredSessionCookie(context.config));
    context.json(200, { loggedOut: true });
    return true;
  }

  if (await handleSkillRoutes(context)) return true;
  if (await handleSkillDraftRoutes(context)) return true;
  if (await handleExpertRoutes(context)) return true;
  if (await handleExpertDraftRoutes(context)) return true;
  if (await handleQuestionRoutes(context)) return true;
  if (await handlePreferenceRoutes(context)) return true;
  if (await handleFileRoutes(context)) return true;
  if (await handleWorkspaceFileRoutes(context)) return true;
  if (await handleResourceRoutes(context)) return true;
  if (await handleMcpRoutes(context, mcpDependencies)) return true;
  if (await handleMcpOAuthRoutes(context)) return true;

  const sessions = createSessionService(database);
  if (path === "/api/conversations" && method === "GET") {
    context.json(200, await sessions.list(user.id));
    return true;
  }
  if (path === "/api/conversations" && method === "POST") {
    context.json(201, await sessions.create(user.id, await context.readJson()));
    return true;
  }
  const conversationMatch = path.match(/^\/api\/conversations\/([0-9a-f-]+)$/i);
  if (conversationMatch && UUID.test(conversationMatch[1])) {
    const id = conversationMatch[1];
    if (method === "GET") { context.json(200, await sessions.get(user.id, id)); return true; }
    if (method === "PATCH") {
      context.json(200, await sessions.update(user.id, id, await context.readJson()));
      return true;
    }
    if (method === "DELETE") { await sessions.remove(user.id, id); context.empty(204); return true; }
  }
  const messagesMatch = path.match(/^\/api\/conversations\/([0-9a-f-]+)\/messages$/i);
  if (messagesMatch && method === "GET" && UUID.test(messagesMatch[1])) {
    context.json(200, await sessions.messages(user.id, messagesMatch[1]));
    return true;
  }

  const submitMatch = path.match(/^\/api\/conversations\/([0-9a-f-]+)\/runs$/i);
  if (submitMatch && method === "POST" && UUID.test(submitMatch[1])) {
    const body = object(await context.readJson());
    const result = await enqueueUsingDatabase(database, user.id, submitMatch[1], body);
    context.json(result.created ? 201 : 200, result.run);
    return true;
  }

  if (path === "/api/runs" && method === "GET") {
    const conversationId = optionalUuid(url.searchParams.get("conversationId"), "conversationId");
    const result = await database.query<PublicRunRow>(
      `SELECT ${publicRunColumns("r")} FROM runs r WHERE r.owner_id=$1
        AND ($2::uuid IS NULL OR r.conversation_id=$2)
        ORDER BY r.created_at DESC,r.id LIMIT 500`,
      [user.id, conversationId ?? null],
    );
    context.json(200, result.rows.map(mapPublicRun));
    return true;
  }

  const runMatch = path.match(/^\/api\/runs\/([0-9a-f-]+)$/i);
  if (runMatch && method === "GET" && UUID.test(runMatch[1])) {
    const result = await database.query<PublicRunRow>(
      `SELECT ${publicRunColumns("r")} FROM runs r WHERE r.id=$1 AND r.owner_id=$2`,
      [runMatch[1], user.id],
    );
    if (!result.rows[0]) fail(404, "NOT_FOUND", "Run not found");
    context.json(200, mapPublicRun(result.rows[0]));
    return true;
  }

  const cancelMatch = path.match(/^\/api\/runs\/([0-9a-f-]+)\/cancel$/i);
  if (cancelMatch && method === "POST" && UUID.test(cancelMatch[1])) {
    const result = await database.transaction(async (client) => {
      const found = await client.query<{ id: string; status: string }>(
        "SELECT id,status FROM runs WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [cancelMatch[1], user.id],
      );
      const run = found.rows[0];
      if (!run) fail(404, "NOT_FOUND", "Run not found");
      if (!["succeeded", "failed", "cancelled", "interrupted"].includes(run.status)) {
        const nextStatus = run.status === "queued"
          ? "cancelled"
          : run.status === "cleanup_pending" ? "cleanup_pending" : "cancelling";
        await client.query(
          `UPDATE runs SET cancel_requested=true,status=$3,updated_at=now(),
             finished_at=CASE WHEN $3='cancelled' THEN now() ELSE finished_at END,
             cleanup_target_status=CASE WHEN status='cleanup_pending' THEN 'cancelled' ELSE cleanup_target_status END
           WHERE id=$1 AND owner_id=$2`,
          [run.id, user.id, nextStatus],
        );
        await client.query(
          "INSERT INTO events(owner_id,run_id,type,payload) VALUES($1,$2,'status',$3::jsonb)",
          [user.id, run.id, JSON.stringify({ status: nextStatus })],
        );
        await client.query(`UPDATE runs SET cancel_requested=true,
          status=CASE WHEN status='queued' THEN 'cancelled' WHEN status='cleanup_pending' THEN status ELSE 'cancelling' END,
          finished_at=CASE WHEN status='queued' THEN now() ELSE finished_at END,updated_at=now()
          WHERE parent_run_id=$1 AND owner_id=$2 AND status IN ('queued','provisioning','running','waiting_approval','cancelling','cleanup_pending')`, [run.id,user.id]);
      }
      const publicRun = await client.query<PublicRunRow>(
        `SELECT ${publicRunColumns("r")} FROM runs r WHERE r.id=$1 AND r.owner_id=$2`,
        [run.id, user.id],
      );
      return publicRun.rows[0];
    });
    context.json(200, mapPublicRun(result));
    return true;
  }

  const eventsMatch = path.match(/^\/api\/runs\/([0-9a-f-]+)\/events$/i);
  if (eventsMatch && method === "GET" && UUID.test(eventsMatch[1])) {
    await streamEvents(context, eventsMatch[1]);
    return true;
  }

  const approvalsMatch = path.match(/^\/api\/runs\/([0-9a-f-]+)\/approvals$/i);
  if (approvalsMatch && method === "GET" && UUID.test(approvalsMatch[1])) {
    const run = await database.query("SELECT id FROM runs WHERE id=$1 AND owner_id=$2", [approvalsMatch[1], user.id]);
    if (!run.rows[0]) fail(404, "NOT_FOUND", "Run not found");
    const result = await database.query<{
      id: string; run_id: string; tool_call_id: string; tool: string; input: unknown;
      status: string; created_at: Date | string; decided_at: Date | string | null;
    }>(
      `SELECT a.id,a.run_id,a.tool_call_id,a.tool,a.input,a.status,a.created_at,a.decided_at FROM approvals a
        JOIN runs r ON r.id=a.run_id AND r.owner_id=a.owner_id
        WHERE (a.run_id=$1 OR r.parent_run_id=$1) AND a.owner_id=$2 ORDER BY a.created_at,a.id`,
      [approvalsMatch[1], user.id],
    );
    context.json(200, result.rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      toolCallId: row.tool_call_id,
      tool: row.tool,
      input: row.input,
      status: row.status,
      createdAt: iso(row.created_at),
      decidedAt: row.decided_at ? iso(row.decided_at) : null,
    })));
    return true;
  }

  const approvalDecision = path.match(
    /^\/api\/runs\/([0-9a-f-]+)\/approvals\/([0-9a-f-]+)$/i,
  );
  if (
    approvalDecision && method === "POST" &&
    UUID.test(approvalDecision[1]) && UUID.test(approvalDecision[2])
  ) {
    const body = object(await context.readJson());
    if (typeof body.approved !== "boolean") {
      fail(400, "INVALID_REQUEST", "approved must be a boolean");
    }
    const status = body.approved ? "approved" : "denied";
    const result = await database.transaction(async (client) => {
      const updated = await client.query<{
        id: string; run_id: string; status: string;
      }>(
        `UPDATE approvals a SET status=$4,decided_at=now()
          FROM runs r
         WHERE a.id=$1 AND a.run_id=$2 AND a.owner_id=$3 AND a.status='pending'
           AND r.id=a.run_id AND r.owner_id=$3
           AND r.lease_until>now() AND NOT r.cancel_requested AND r.status='waiting_approval'
         RETURNING a.id,a.run_id,a.status`,
        [approvalDecision[2], approvalDecision[1], user.id, status],
      );
      if (!updated.rows[0]) fail(404, "NOT_FOUND", "Pending approval not found");
      await client.query(
        "INSERT INTO events(owner_id,run_id,type,payload) VALUES($1,$2,'approval_decided',$3::jsonb)",
        [user.id, approvalDecision[1], JSON.stringify({ id: approvalDecision[2], status })],
      );
      await client.query(`INSERT INTO events(owner_id,run_id,type,payload)
        SELECT owner_id,parent_run_id,'approval_decided',$3::jsonb FROM runs WHERE id=$1 AND owner_id=$2 AND parent_run_id IS NOT NULL`,
        [approvalDecision[1],user.id,JSON.stringify({id:approvalDecision[2],status})]);
      return updated.rows[0];
    });
    context.json(200, { id: result.id, runId: result.run_id, status: result.status });
    return true;
  }

  if (path === "/api/usage" && method === "GET") {
    const result = await database.query<{
      runs: string; input_tokens: string; output_tokens: string;
    }>(
      `SELECT count(*)::text AS runs,
              coalesce(sum(coalesce((usage->>'inputTokens')::bigint,0)),0)::text AS input_tokens,
              coalesce(sum(coalesce((usage->>'outputTokens')::bigint,0)),0)::text AS output_tokens
         FROM runs WHERE owner_id=$1`,
      [user.id],
    );
    context.json(200, {
      runs: Number(result.rows[0].runs),
      inputTokens: Number(result.rows[0].input_tokens),
      outputTokens: Number(result.rows[0].output_tokens),
      cost: null,
    });
    return true;
  }

  return false;
}

export function createRequestHandler(
  config: Config,
  dependencies: RouteDependencies = {},
): (request: IncomingMessage, response: ServerResponse) => void {
  const database = dependencies.database ?? defaultDatabase;
  const storage = dependencies.storage ?? createStorage(config);
  return (request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url || "/", config.publicOrigin);
        if (!url.pathname.startsWith("/api/")) fail(404, "NOT_FOUND", "Route not found");
        if (request.method === "GET" && url.pathname === "/api/health") {
          sendJson(response, 200, { data: { status: "live" } });
          return;
        }
        if (request.method === "GET" && url.pathname === "/api/ready") {
          try {
            await database.query("SELECT 1");
            await storage.ready();
            sendJson(response, 200, { data: { status: "ready" } });
          } catch {
            sendJson(response, 503, { error: { code: "NOT_READY", message: "Service dependencies are unavailable" } });
          }
          return;
        }

        assertRequestOrigin(request, config);
        const baseContext = {
          request,
          response,
          url,
          config,
          database,
          storage,
          readJson: <T,>(limit = Math.ceil(config.maxUploadBytes * 1.4) + 65_536) =>
            readJsonBody<T>(request, limit),
          json: (status: number, data: unknown) => sendJson(response, status, { data }),
          empty: (status: number) => sendEmpty(response, status),
          fail,
        };
        if (request.method === "POST" && url.pathname === "/api/auth/login") {
          await beginCasLogin(baseContext);
          return;
        }
        if (request.method === "GET" && url.pathname === "/api/auth/callback") {
          await finishCasLogin(baseContext, dependencies.casFetch);
          return;
        }
        const user = await authenticate(request, database);
        if (!user) fail(401, "AUTHENTICATION_REQUIRED", "Sign in is required");
        if (await handleSkillHubRoutes({...baseContext,user},dependencies.skillHubFetch)) return;
        if (await handleModelDiagnostics({...baseContext,user},dependencies.modelRequest)) return;
        const handled = await handleAuthenticated({ ...baseContext, user }, dependencies.mcp);
        if (!handled) fail(404, "NOT_FOUND", "Route not found");
      } catch (error) {
        if (response.headersSent) {
          if (!response.writableEnded) response.end();
          return;
        }
        const status = error instanceof HttpError
          ? error.status
          : typeof error === "object" && error && "status" in error && typeof error.status === "number"
            ? error.status
            : 500;
        const code = error instanceof HttpError
          ? error.code
          : typeof error === "object" && error && "code" in error && typeof error.code === "string"
            ? error.code
            : "INTERNAL_ERROR";
        const safeSkillHubError = error instanceof HttpError && ['SKILLHUB_UNAVAILABLE','SKILLHUB_NOT_CONFIGURED','SKILLHUB_DOWNLOAD_FAILED','SKILLHUB_TIMEOUT','EXPERT_PACKAGE_STORAGE_UNAVAILABLE'].includes(error.code);
        const message = status >= 500 && !safeSkillHubError
          ? "An internal error occurred"
          : error instanceof Error ? error.message : "Request failed";
        sendJson(response, status, { error: { code, message } });
      }
    })();
  };
}
