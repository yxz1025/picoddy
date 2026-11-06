import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";

const mounts = new Map<string, string>();
const prefix = "/api/preview/site/";
const mime: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", ico: "image/x-icon", avif: "image/avif",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", wasm: "application/wasm",
  pdf: "application/pdf", txt: "text/plain; charset=utf-8", mp4: "video/mp4", webm: "video/webm",
};

/** Mount only the entry's directory, never an arbitrary path from asset requests. */
export async function openSitePreview(entry: string): Promise<string> {
  if (!isAbsolute(entry)) throw new Error("预览文件必须使用绝对路径");
  const file = await realpath(entry);
  if (!/\.html?$/i.test(file) || !(await stat(file)).isFile()) throw new Error("请选择 HTML 文件");
  const root = dirname(file);
  let id = [...mounts].find(([, value]) => value === root)?.[0];
  if (!id) { id = randomUUID(); mounts.set(id, root); }
  return `${prefix}${id}/${encodeURIComponent(basename(file))}`;
}

export async function serveSitePreview(url: URL, method = "GET"): Promise<Response> {
  if (method !== "GET" && method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const [id, ...parts] = url.pathname.slice(prefix.length).split("/");
  const root = mounts.get(id);
  if (!root) return new Response("预览已失效，请重新打开文件", { status: 404 });
  try {
    const segments = parts.map(decodeURIComponent);
    if (segments.some(p => p === ".." || /[\\/\0]/.test(p))) return new Response("禁止访问", { status: 403 });
    let file = await realpath(resolve(root, ...segments));
    const inside = (path: string) => {
      const rel = relative(root, path);
      return rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel);
    };
    if (!inside(file)) return new Response("禁止访问", { status: 403 });
    if ((await stat(file)).isDirectory()) {
      if (!url.pathname.endsWith("/")) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 302);
      file = await realpath(resolve(file, "index.html"));
    }
    if (!inside(file)) return new Response("禁止访问", { status: 403 });
    if (!(await stat(file)).isFile()) return new Response("文件不存在", { status: 404 });
    return new Response(method === "HEAD" ? null : await readFile(file), { headers: {
      "content-type": mime[extname(file).slice(1).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store", "x-content-type-options": "nosniff",
    } });
  } catch {
    return new Response("预览资源不存在或不可读取", { status: 404 });
  }
}
