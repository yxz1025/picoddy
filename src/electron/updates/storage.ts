import { createReadStream, closeSync, fsyncSync, openSync, writeFileSync, renameSync, mkdirSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

export function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temp, path);
  if (process.platform !== "win32") {
    const dir = openSync(dirname(path), "r");
    try { fsyncSync(dir); } finally { closeSync(dir); }
  }
}
export function readJson<T>(path: string): T | undefined {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
export function installationId(root: string): string {
  const path = join(root, "identity.json");
  const existing = readJson<{ id: string }>(path);
  if (existing && /^[\da-f-]{36}$/i.test(existing.id)) return existing.id;
  const id = randomUUID(); atomicJson(path, { id }); return id;
}
export async function digestFile(path: string): Promise<string> {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("base64");
}
