// src/infra/keychain.ts
// Cross-platform API key storage with environment-variable fallback.

import { platformPaths } from "../platform/paths.ts";
import { currentPlatform } from "../platform/runtime.ts";
import {
  createWindowsCredentialStore,
  type WindowsCredentialStore,
} from "./windows_credentials.ts";

const SERVICE = "pi-a";

interface KeytarLike {
  getPassword(service: string, provider: string): Promise<string | null>;
  setPassword(
    service: string,
    provider: string,
    key: string,
  ): Promise<void>;
  deletePassword(service: string, provider: string): Promise<boolean>;
}

export interface KeychainServiceOptions {
  platform: typeof currentPlatform;
  env: (name: string) => string | undefined;
  windowsStore: WindowsCredentialStore;
  loadKeytar: () => Promise<KeytarLike>;
}

import { spawnSync } from "node:child_process";

async function runMacOSKeychain(args: string[]): Promise<string> {
  const output = spawnSync("/usr/bin/security", args);
  if (output.status !== 0) {
    const detail = output.stderr ? new TextDecoder().decode(output.stderr).trim() : "";
    throw new Error(detail || `security exited with code ${output.status}`);
  }
  return output.stdout ? new TextDecoder().decode(output.stdout).trim() : "";
}

async function loadMacOSKeychain(): Promise<KeytarLike> {
  return {
    async getPassword(service, provider) {
      try {
        return await runMacOSKeychain([
          "find-generic-password",
          "-s",
          service,
          "-a",
          provider,
          "-w",
        ]) || null;
      } catch {
        return null;
      }
    },
    async setPassword(service, provider, key) {
      await runMacOSKeychain([
        "add-generic-password",
        "-U",
        "-s",
        service,
        "-a",
        provider,
        "-w",
        key,
      ]);
    },
    async deletePassword(service, provider) {
      try {
        await runMacOSKeychain([
          "delete-generic-password",
          "-s",
          service,
          "-a",
          provider,
        ]);
        return true;
      } catch {
        return false;
      }
    },
  };
}

function providerToEnvKey(provider: string): string {
  return `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
}

export function createKeychainService(options: KeychainServiceOptions) {
  const keyCache = new Map<string, string>();

  return {
    async getApiKey(provider: string): Promise<string | undefined> {
      const envValue = options.env(providerToEnvKey(provider));
      if (envValue) return envValue;
      const cached = keyCache.get(provider);
      if (cached) return cached;
      try {
        if (options.platform === "windows") {
          const value = await options.windowsStore.get(provider);
          if (value) keyCache.set(provider, value);
          return value;
        }
        if (options.platform === "darwin") {
          const value = (await (await options.loadKeytar()).getPassword(
            SERVICE,
            provider,
          )) ?? undefined;
          if (value) keyCache.set(provider, value);
          return value;
        }
      } catch (e) {
        console.warn(
          `[keychain] 读取 ${provider} 失败:`,
          (e as Error).message,
        );
      }
      return undefined;
    },

    async setApiKey(provider: string, key: string): Promise<void> {
      if (options.platform === "windows") {
        await options.windowsStore.set(provider, key);
        keyCache.set(provider, key);
        return;
      }
      if (options.platform === "darwin") {
        await (await options.loadKeytar()).setPassword(SERVICE, provider, key);
        keyCache.set(provider, key);
        return;
      }
      throw new Error("当前平台暂不支持安全存储 API Key");
    },

    async deleteApiKey(provider: string): Promise<void> {
      if (options.platform === "windows") {
        await options.windowsStore.delete(provider);
        keyCache.delete(provider);
        return;
      }
      if (options.platform === "darwin") {
        await (await options.loadKeytar()).deletePassword(SERVICE, provider);
        keyCache.delete(provider);
      }
    },
  };
}

const service = createKeychainService({
  platform: currentPlatform,
  env: (name) => process.env[name],
  windowsStore: createWindowsCredentialStore({
    appDataDir: platformPaths.appDataDir,
  }),
  loadKeytar: loadMacOSKeychain,
});

export const getApiKey = service.getApiKey;
export const setApiKey = service.setApiKey;
export const deleteApiKey = service.deleteApiKey;
