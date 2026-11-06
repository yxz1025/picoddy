import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { loginOpenAIChatGPT } from "./openai_subscription_login.ts";
import { subscriptionError, type SubscriptionStage } from "./openai_subscription_errors.ts";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ModelRuntime, readStoredCredential } from "@earendil-works/pi-coding-agent";
import { platformPaths } from "../platform/paths.ts";
import { getApiKey } from "../infra/keychain.ts";
import { getSetting, setSetting } from "../domains/settings/node/store.ts";

export const modelAuthPath = () => join(platformPaths.appDataDir, "pi-agent", "auth.json");
export function hasOpenAISubscription(): boolean {
  return readStoredCredential("openai", modelAuthPath())?.type === "oauth";
}
export async function hasProviderCredential(provider: string): Promise<boolean> {
  return (provider === "openai" && hasOpenAISubscription()) || Boolean(await getApiKey(provider));
}
function installationId() {
  let id = getSetting("openai_oauth_device_id", "");
  if (!id) { id = randomUUID(); setSetting("openai_oauth_device_id", id); }
  return id;
}
/** App-owned callback UI, native Pi persistence and refresh. Also used by isolated integration tests. */
export async function createSubscriptionRuntime(authPath = modelAuthPath()) {
  const runtime = await ModelRuntime.create({authPath, modelsPath: null, refreshOnCreate: false});
  const provider = openaiProvider();
  runtime.registerNativeProvider({...provider, auth: {...provider.auth, oauth: {
    ...provider.auth.oauth!,
    login: async (interaction, options) => {
      const credential = await loginOpenAIChatGPT(interaction, options);
      interaction.notify({type: "progress", message: "Saving credentials..."});
      return credential;
    },
  }}});
  return runtime;
}
export type SubscriptionStatus = {
  state: "idle" | "connecting" | "authorizing" | "authorized" | "cancelled" | "error";
  authorized: boolean;
  url?: string;
  manualInput?: boolean;
  error?: string;
  stage?: SubscriptionStage;
};

/** Pi owns OAuth, PKCE, callbacks, token persistence and locked refresh. */
export class OpenAISubscription {
  private runtime?: Promise<ModelRuntime>;
  private state: Omit<SubscriptionStatus, "authorized"> = { state: "idle" };
  private attempt?: { controller: AbortController; done: Promise<void> };
  private answer?: (value: string) => void;
  constructor(private readonly createRuntime: () => Promise<ModelRuntime> = () => createSubscriptionRuntime(), private readonly getDeviceId: () => string = installationId) {}
  private getRuntime() { return this.runtime ??= this.createRuntime(); }
  async status(): Promise<SubscriptionStatus> {
    const authorized = (await (await this.getRuntime()).listCredentials()).some(c => c.providerId === "openai" && c.type === "oauth");
    return { ...this.state, state: this.state.state === "idle" && authorized ? "authorized" : this.state.state, authorized };
  }
  async login(): Promise<SubscriptionStatus> {
    if (this.attempt) return this.status();
    const controller = new AbortController();
    this.state = { state: "connecting", stage: "initializing" };
    const attempt = { controller, done: Promise.resolve() };
    this.attempt = attempt;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 5 * 60_000);
    timer.unref();
    attempt.done = (async () => {
      try {
        const runtime = await this.getRuntime();
        await runtime.login("openai", "oauth", {
          signal: controller.signal,
          notify: event => {
            if (event.type === "auth_url") this.state = { state: "authorizing", stage: "callback", url: event.url };
            if (event.type === "progress") {
              this.state = { state: "authorizing", stage: event.message === "Saving credentials..." ? "storage" : "exchange" };
            }
          },
          prompt: prompt => new Promise<string>((resolve, reject) => {
            if (prompt.type !== "manual_code") { reject(new Error("Unsupported login prompt")); return; }
            const signal = prompt.signal ?? controller.signal;
            const cleanup = () => { signal.removeEventListener("abort", abort); this.answer = undefined; };
            const abort = () => { cleanup(); reject(new Error("Authorization cancelled")); };
            this.answer = value => { cleanup(); resolve(value); };
            signal.addEventListener("abort", abort, { once: true });
            this.state = { ...this.state, manualInput: true };
            if (signal.aborted) abort();
          }),
        }, { getDeviceId: this.getDeviceId });
        this.state = { state: "authorized" };
      } catch (error) {
        const stage = this.state.stage ?? "initializing";
        this.state = timedOut ? { state: "error", stage, error: "授权超时，请检查网络后重新发起登录" }
          : controller.signal.aborted ? { state: "cancelled" }
          : { state: "error", stage, error: subscriptionError(error, stage) };
      } finally {
        clearTimeout(timer);
        this.answer = undefined;
        if (this.attempt === attempt) this.attempt = undefined;
      }
    })();
    return this.status();
  }
  async submit(value: string) {
    if (!this.answer || !value.trim()) throw new Error("当前没有等待中的授权回调");
    this.answer(value.trim());
    return this.status();
  }
  async cancel() {
    const attempt = this.attempt;
    attempt?.controller.abort();
    await attempt?.done;
    return this.status();
  }
  async logout() {
    await this.cancel();
    await (await this.getRuntime()).logout("openai");
    this.state = { state: "idle" };
    return this.status();
  }
  async models() {
    return (await (await this.getRuntime()).getAvailable("openai")).map(m => ({id:m.id,name:m.name,contextWindow:m.contextWindow}));
  }
  async test(modelId: string) {
    try {
      const runtime = await this.getRuntime();
      const model = runtime.getModel("openai", modelId);
      if (!model) throw new Error("model_not_found");
      const start = Date.now();
      const result = await runtime.completeSimple(model, { messages:[{role:"user",content:"Reply OK",timestamp:Date.now()}] }, {
        maxTokens:16, signal:AbortSignal.timeout(30_000),
      });
      if (result.stopReason === "error" || result.stopReason === "aborted") {
        throw new Error(result.errorMessage || (result.stopReason === "aborted" ? "request timeout" : "unknown model error"));
      }
      return {ok:true,latencyMs:Date.now()-start,message:"ChatGPT 订阅模型调用成功"};
    } catch (error) {
      throw new Error(subscriptionError(error, "request"));
    }
  }
}
export const openAISubscription = new OpenAISubscription();
