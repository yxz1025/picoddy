import { SkillHubAuthError, validateSkillHubSecret } from "./auth.ts";

export interface SkillHubSecretStatus {
  configured: boolean;
  source: "environment" | "secure-store" | "none";
  error: string | null;
}

export function createSkillHubSecretConfig(options: {
  getEnvironmentSecret(): string | undefined;
  readSecret(): Promise<string | undefined>;
  writeSecret(secret: string): Promise<void>;
}) {
  async function resolve() {
    const environment = options.getEnvironmentSecret()?.trim();
    if (environment) return { secret: environment, source: "environment" as const };
    const stored = (await options.readSecret())?.trim();
    return { secret: stored || "", source: stored ? "secure-store" as const : "none" as const };
  }
  return {
    async getSecret(): Promise<string> {
      const { secret, source } = await resolve();
      try { validateSkillHubSecret(secret); }
      catch (error) {
        if (source === "environment") {
          throw new SkillHubAuthError("环境变量 SKILLHUB_AUTH_ACCESS_TOKEN_SECRET 格式无效，请修正或移除后重启应用", 503);
        }
        throw error;
      }
      return secret;
    },
    async status(): Promise<SkillHubSecretStatus> {
      let source: SkillHubSecretStatus["source"] = "none";
      try {
        const resolved = await resolve();
        source = resolved.source;
        const { secret } = resolved;
        validateSkillHubSecret(secret);
        return { configured: true, source, error: null };
      } catch (error) {
        return { configured: false, source, error: (error as Error).message };
      }
    },
    async save(input: unknown): Promise<SkillHubSecretStatus> {
      if (options.getEnvironmentSecret()?.trim()) {
        throw new SkillHubAuthError("当前使用环境变量配置，请修正或移除 SKILLHUB_AUTH_ACCESS_TOKEN_SECRET 后重启应用，再保存密钥", 409);
      }
      const secret = typeof input === "string" ? input.trim() : "";
      try { validateSkillHubSecret(secret); }
      catch (error) { throw new SkillHubAuthError((error as Error).message, 400); }
      try { await options.writeSecret(secret); }
      catch { throw new SkillHubAuthError("无法安全保存技能市场密钥，请检查系统安全存储是否可用", 503); }
      return { configured: true, source: "secure-store", error: null };
    },
  };
}
