import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { validateMcpServerConfig } from "../vendor/pi_native_extensions.ts";
import { platformPaths } from "../platform/paths.ts";
import type { McpConfig, McpServerConfig } from "./mcp.ts";

const RESERVED_NAMES = new Set(["dingtalk"]);
export function customMcpConfig(config: McpConfig): McpConfig {
  return { mcpServers: Object.fromEntries(Object.entries(config.mcpServers).filter(([, entry]) => !entry.managedBy)) };
}

function validateConfig(value: unknown): asserts value is McpConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MCP 配置必须是对象");
  const servers = (value as McpConfig).mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) throw new Error("MCP 配置必须包含 mcpServers 对象");
  for (const [name, entry] of Object.entries(servers)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("MCP 连接器配置必须是对象");
    if (!entry.managedBy && !entry.provider && entry.type?.toLowerCase() !== "sse") {
      const checked = validateMcpServerConfig(name, { ...entry, type: entry.command ? "stdio" : "http", headers: { ...entry.staticHeaders, ...entry.headers }, exposure: entry.exposure ?? "direct" });
      if (typeof checked === "string") throw new Error(checked);
    }
  }
}

/** One file and one serialized read/modify/write queue for both configuration sources. */
export interface McpConfigEncryption {
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}

const ENCRYPTED_HEADER = Buffer.from("PICODDY-MCP-1\n");
async function systemStorage() {
  const { safeStorage } = await import("electron");
  if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === "basic_text") {
    throw new Error("系统安全存储不可用，无法读写连接器配置");
  }
  return safeStorage;
}
const systemEncryption: McpConfigEncryption = {
  async encrypt(value) { return (await systemStorage()).encryptString(value); },
  async decrypt(value) { return (await systemStorage()).decryptString(value); },
};

export function createMcpConfigStore(path: string, encryption: McpConfigEncryption = systemEncryption) {
  let queue: Promise<unknown> = Promise.resolve();
  const load = async (): Promise<McpConfig> => {
    try {
      const bytes = await readFile(path);
      if (!bytes.subarray(0, ENCRYPTED_HEADER.length).equals(ENCRYPTED_HEADER)) {
        throw new Error("旧版明文 MCP 配置已停用，请删除本地 mcp.json 后重新配置连接器");
      }
      let value: unknown;
      try {
        value = JSON.parse(await encryption.decrypt(bytes.subarray(ENCRYPTED_HEADER.length)));
      } catch {
        throw new Error("无法解密连接器配置，请检查系统安全存储");
      }
      validateConfig(value);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { mcpServers: {} };
      throw error;
    }
  };
  const update = (change: (config: McpConfig) => McpConfig | void): Promise<void> => {
    const operation = queue.then(async () => {
      const current = await load();
      const next = change(current) ?? current;
      validateConfig(next);
      let encrypted: Buffer;
      try { encrypted = await encryption.encrypt(JSON.stringify(next)); }
      catch { throw new Error("无法安全保存连接器配置，请检查系统安全存储"); }
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, Buffer.concat([ENCRYPTED_HEADER, encrypted]), { mode: 0o600, flag: "wx" });
        await rename(temporary, path);
      } finally { await rm(temporary, { force: true }); }
    });
    queue = operation.catch(() => {});
    return operation;
  };
  return {
    load,
    update,
    ensure: () => update(() => {}),
    saveCustom(value: unknown) {
      return update((current) => {
        validateConfig(value);
        for (const [name, entry] of Object.entries(value.mcpServers)) {
          if (RESERVED_NAMES.has(name) || entry.managedBy || current.mcpServers[name]?.managedBy || entry.type === "managed-cli") {
            throw new Error(`连接器 ${name} 由内置流程管理，请使用其他名称添加手动配置`);
          }
        }
        const managed = Object.entries(current.mcpServers).filter(([, entry]) => entry.managedBy);
        return { ...current, mcpServers: { ...value.mcpServers, ...Object.fromEntries(managed) } };
      });
    },
    setBuiltin(name: string, entry: McpServerConfig | undefined) {
      return update((current) => {
        if (entry) current.mcpServers[name] = { ...entry, managedBy: "builtin" };
        else if (current.mcpServers[name]?.managedBy === "builtin") delete current.mcpServers[name];
      });
    },
  };
}

export const mcpConfigStore = createMcpConfigStore(platformPaths.join(platformPaths.appDataDir, "mcp.json"));
