import { rm, mkdir, rename, writeFile, readFile } from "node:fs/promises";
import { writeFileSync, readdirSync } from "node:fs";
const platformOs = process.platform === "win32" ? "windows" : process.platform;

const DIST_DIR = "./frontend/dist";
const OUT_FILE = "./src/ui/frontend-assets.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function scan(d: string) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = d + "/" + entry.name;
      if (entry.isDirectory()) await scan(full);
      else results.push(full);
    }
  }
  await scan(dir);
  return results;
}

function toBase64(data: Uint8Array): string {
  // 分块处理避免栈溢出
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.slice(i, i + chunk));
  }
  return btoa(binary);
}

function isWindowsMappedFileError(error: unknown): boolean {
  if (platformOs !== "windows" || !(error instanceof Error)) return false;
  return error.message.includes("os error 1224") ||
    error.message.toLowerCase().includes("user-mapped");
}

async function writeGeneratedFrontend(output: string): Promise<void> {
  try {
    await writeFile(OUT_FILE, output);
    return;
  } catch (error) {
    if (!isWindowsMappedFileError(error)) throw error;
  }

  // The running desktop app can keep the old generated module memory-mapped
  // while an installed app is still running. Windows then refuses to truncate
  // that file (ERROR_USER_MAPPED_FILE / 1224), even though renaming it is safe.
  // Move the old file into ignored scratch space, create a new file at the
  // canonical path, and restore the original if generation unexpectedly fails.
  await mkdir("./scratch", { recursive: true });
  const backup =
    `./scratch/frontend-assets.previous-${process.pid}-${crypto.randomUUID()}.ts`;
  await rename(OUT_FILE, backup);
  try {
    await writeFile(OUT_FILE, output);
  } catch (error) {
    try {
      await rm(OUT_FILE);
    } catch (removeError) {
      if (!((removeError as { code?: string }).code === "ENOENT")) {
        console.warn(
          `[gen:frontend] 清理未完成的新资源失败：${OUT_FILE}: ${
            removeError instanceof Error
              ? removeError.message
              : String(removeError)
          }`,
        );
      }
    }
    try {
      await rename(backup, OUT_FILE);
    } catch {
      // Preserve the original error; the backup path is included below.
    }
    throw new Error(
      `生成前端资源失败，旧文件保留在 ${backup}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    await rm(backup);
  } catch (error) {
    console.warn(
      `[gen:frontend] 新资源已生成；旧的内存映射副本将在 scratch 中保留：${backup}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

const files = await walkDir(DIST_DIR);
const entries: string[] = [];

for (const filePath of files) {
  const relativePath = filePath.slice(DIST_DIR.length);
  const data = await readFile(filePath);
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const contentType = MIME["." + ext] || "application/octet-stream";
  const base64 = toBase64(data);
  entries.push(
    `  ${JSON.stringify(relativePath)}: { content: new Uint8Array(Buffer.from(${
      JSON.stringify(base64)
    }, "base64")), contentType: ${JSON.stringify(contentType)} }`,
  );
}

const output = `// AUTO-GENERATED — 由 npm run gen:frontend 生成
export const FRONTEND_FILES: Record<string, { content: Uint8Array; contentType: string }> = {
${entries.join(",\n")}
};
`;

await writeGeneratedFrontend(output);
console.log(`[gen:frontend] ${entries.length} files`);
