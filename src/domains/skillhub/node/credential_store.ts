import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
interface SecretStorage { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string; getSelectedStorageBackend?(): string }
import { SkillHubAuthError, type SkillHubCredential, type SkillHubCredentialStore } from "./auth.ts";

export function createSkillHubCredentialStore(path: string, storage: SecretStorage): SkillHubCredentialStore {
  function assertEncryption() {
    if (!storage.isEncryptionAvailable() || storage.getSelectedStorageBackend?.() === "basic_text") {
      throw new SkillHubAuthError("系统安全存储不可用，无法保存 SkillHub 登录凭据", 503);
    }
  }
  return {
    async read() {
      assertEncryption();
      let bytes: Buffer;
      try { bytes = await readFile(path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new SkillHubAuthError("无法读取 SkillHub 登录凭据", 503);
      }
      try {
        const value = JSON.parse(storage.decryptString(bytes));
        if (value.version !== 1 || typeof value.credential?.identity !== "string" ||
            !/^sk_[A-Za-z0-9_-]+$/.test(value.credential.token) ||
            !(value.credential.tokenExpiresAt === null || Number.isFinite(value.credential.tokenExpiresAt)) ||
            typeof value.credential.cookies?.SESSION !== "string" ||
            typeof value.credential.cookies?.["XSRF-TOKEN"] !== "string") throw new Error();
        return value.credential as SkillHubCredential;
      } catch { throw new SkillHubAuthError("无法解密 SkillHub 登录凭据，请恢复系统钥匙串或退出后重新登录", 503); }
    },
    async write(credential) {
      assertEncryption();
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(temporary, storage.encryptString(JSON.stringify({ version: 1, credential })), { mode: 0o600, flag: "wx" });
        await rename(temporary, path);
      } catch { throw new SkillHubAuthError("无法保存 SkillHub 登录凭据", 503); }
      finally { await rm(temporary, { force: true }).catch(() => {}); }
    },
    async clear() { await rm(path, { force: true }); },
  };
}
