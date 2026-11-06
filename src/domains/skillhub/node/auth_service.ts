import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";
import { getActiveAuthSession } from "../../../auth/session_store.ts";
import { platformPaths } from "../../../platform/paths.ts";
import { getApiKey, setApiKey } from "../../../infra/keychain.ts";
import { createSkillHubAuthClient, SkillHubAuthError } from "./auth.ts";
import { createSkillHubCredentialStore } from "./credential_store.ts";
import { resolveSkillHubBaseUrl } from "./config.ts";
import { createSkillHubSecretConfig } from "./secret_config.ts";

let clientPromise: Promise<ReturnType<typeof createSkillHubAuthClient>> | undefined;
const secretConfig = createSkillHubSecretConfig({
  getEnvironmentSecret: () => process.env["SKILLHUB_AUTH_ACCESS_TOKEN_SECRET"]?.trim() ||
    process.env["SKILLHUB_ACCESS_TOKEN_SECRET_API_KEY"]?.trim(),
  readSecret: () => getApiKey("skillhub-access-token-secret"),
  writeSecret: secret => setApiKey("skillhub-access-token-secret", secret),
});

export async function getSkillHubSecretStatus() {
  currentIdentity();
  return secretConfig.status();
}

export async function saveSkillHubSecret(input: unknown) {
  currentIdentity();
  return secretConfig.save(input);
}

function currentIdentity() {
  const session = getActiveAuthSession();
  if (!session) throw new SkillHubAuthError("请先登录应用", 401);
  return {
    email: session.profile.email ?? session.profile.mail ?? "",
    nickName: session.nick,
    headimgurl: session.avatar,
  };
}

async function getClient() {
  clientPromise ??= (async () => {
    const { safeStorage } = await import("electron");
    // Token names are scoped to users on SkillHub; a device suffix prevents cross-device rotation.
    const device = createHash("sha256").update(`${hostname()}\n${platformPaths.appDataDir}`).digest("hex").slice(0, 24);
    return createSkillHubAuthClient({
      baseUrl: resolveSkillHubBaseUrl(),
      getIdentity: currentIdentity,
      getSecret: () => secretConfig.getSecret(),
      tokenName: `picoddy-${device}`,
      store: createSkillHubCredentialStore(join(platformPaths.appDataDir, "skillhub-auth.enc"), safeStorage),
    });
  })().catch((error) => { clientPromise = undefined; throw error; });
  return clientPromise;
}

export async function ensureSkillHubAuth(checkSession = true) {
  currentIdentity();
  return (await getClient()).ensure(checkSession);
}

export async function getSkillHubApiToken() {
  return (await ensureSkillHubAuth(false)).token;
}

export async function clearSkillHubAuth() {
  await (await getClient()).clear();
}

export async function withSkillHubAuth<T>(operation: (token: string) => Promise<T>): Promise<T> {
  const token = await getSkillHubApiToken();
  try { return await operation(token); }
  catch (error) {
    // Only explicit authentication failures trigger revalidation; network/write failures do not rotate tokens.
    if (!(error instanceof Error) || !(error.message === "SkillHub CLI 鉴权失败" ||
        (error as { status?: number }).status === 401)) throw error;
    const refreshed = await ensureSkillHubAuth(true);
    if (refreshed.token === token) throw error;
    return operation(refreshed.token);
  }
}


/** Web endpoints use the checked login session; CLI endpoints keep using API tokens. */
export async function withSkillHubSession<T>(operation: (cookies: Record<string, string>) => Promise<T>): Promise<T> {
  const credential = await ensureSkillHubAuth(true);
  try { return await operation({ ...credential.cookies }); }
  catch (error) {
    if (!(error instanceof Error) || (error as { status?: number }).status !== 401) throw error;
    const refreshed = await ensureSkillHubAuth(true);
    if (refreshed.cookies.SESSION === credential.cookies.SESSION) throw error;
    return operation({ ...refreshed.cookies });
  }
}
