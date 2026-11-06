import { APP_CSP, WIDGET_HOST_CSP } from "./transport/http/web-policy.ts";
import { readFile, stat } from "node:fs/promises";
import { createServer as createHttpServer, type Server } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadConfig, type Config } from "./config.ts";
import { assertDatabaseInitialized, pool, database } from "./infra/db.ts";
import { cleanupExpiredAuth } from './cloud/auth/service.ts';
import type { RouteDependencies } from "./transport/http/routes.ts";
import { createApplication } from "./application.ts";
import { createStorage } from "./platform/storage.ts";

const CLOUD_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_DIST = resolve(CLOUD_ROOT, "web", "dist");
const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function serveWeb(
  requestUrl: string | undefined,
  method: string | undefined,
  response: import("node:http").ServerResponse,
): Promise<void> {
  if (method !== "GET" && method !== "HEAD") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(requestUrl || "/", "http://localhost").pathname);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }
  if (pathname.includes("\0") || pathname.includes("\\")) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }
  const requested = resolve(WEB_DIST, `.${pathname}`);
  const inDist = requested === WEB_DIST || requested.startsWith(`${WEB_DIST}${sep}`);
  if (!inDist) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  let file = requested;
  try {
    if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
  } catch {
    file = resolve(WEB_DIST, "index.html");
  }
  try {
    const bytes = await readFile(file);
    const immutable = /\.[a-f\d]{8,}\./i.test(file);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": bytes.byteLength,
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": file === resolve(WEB_DIST, "widget-host.html") ? WIDGET_HOST_CSP : APP_CSP,
    });
    response.end(method === "HEAD" ? undefined : bytes);
  } catch {
    response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Web application is not built");
  }
}

export function createServer(
  config: Config,
  dependencies: RouteDependencies = {},
): Server {
  const { handleApi: api } = createApplication(config, dependencies);
  return createHttpServer((request, response) => {
    let pathname = "";
    try {
      pathname = new URL(request.url || "/", config.publicOrigin).pathname;
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (pathname.startsWith("/api/")) {
      api(request, response);
      return;
    }
    void serveWeb(request.url, request.method, response);
  });
}

export async function startServer(config: Config = loadConfig()): Promise<Server> {
  await assertDatabaseInitialized();
  const storage = createStorage(config);
  await storage.ready();
  await cleanupExpiredAuth(database);
  const server = createServer(config, { storage });
  await new Promise<void>((resolveListen, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListen();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.port, config.host);
  });
  let cleaning = false;
  const cleanup = setInterval(() => {
    if (cleaning) return;
    cleaning = true;
    void cleanupExpiredAuth(database)
      .catch(() => console.error(JSON.stringify({event:'auth_cleanup_failed'})))
      .finally(() => { cleaning = false; });
  }, 60_000);
  cleanup.unref();
  server.once('close', () => clearInterval(cleanup));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const server = await startServer(config);
  console.log(JSON.stringify({ event: "api_listening", host: config.host, port: config.port }));
  const shutdown = () => {
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
