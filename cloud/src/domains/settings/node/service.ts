import type { Config } from "../../../config.ts";
import { seal, unseal } from "../../../infra/crypto.ts";
import { fail } from "../../../shared/errors.ts";
import type { ResourceTransactionStore } from "../../resource/node/store.ts";
import {
  createResourceCrudService,
  type ResourceServiceDependencies,
} from "../../resource/node/service.ts";
import {
  basePublicResource,
  type PublicResource,
  type ResourceDraft,
  type ResourceRow,
} from "../../resource/node/types.ts";
import { optionalText, text } from "../../resource/node/validation.ts";

const PROVIDERS = new Set(["openai", "anthropic", "google", "deepseek", "moonshot", "qwen"]);

type ModelSettingsConfig = Pick<Config, "encryptionKey" | "modelAllowedHosts">;

export interface ModelSettingsDependencies extends ResourceServiceDependencies {
  config: ModelSettingsConfig;
}

function secretRecord(row: ResourceRow, config: ModelSettingsConfig): Record<string, unknown> {
  if (!row.secret) return {};
  const value = unseal(row.secret, config.encryptionKey);
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function validateModelUrl(baseUrl: string | undefined, config: ModelSettingsConfig): void {
  if (!baseUrl) return;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    fail(400, "INVALID_MODEL_URL", "baseUrl must be a valid URL");
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    parsed.protocol !== "https:" || parsed.username || parsed.password ||
    (parsed.port && parsed.port !== "443") || !config.modelAllowedHosts.includes(host)
  ) {
    fail(400, "MODEL_HOST_NOT_ALLOWED", "Model baseUrl must use an allowed HTTPS host");
  }
}

function modelDraft(body: Record<string, unknown>, config: ModelSettingsConfig): ResourceDraft {
  const provider = text(body.provider, "provider", 100).toLowerCase();
  if (!PROVIDERS.has(provider)) {
    fail(400, "UNSUPPORTED_MODEL_PROVIDER", "provider is not supported by the cloud worker");
  }
  const baseUrl = optionalText(body.baseUrl, "baseUrl", 4_000)?.trim() || undefined;
  validateModelUrl(baseUrl, config);
  const apiKey = text(body.apiKey, "apiKey", 20_000);
  return {
    name: text(body.name, "name", 200),
    data: {
      provider,
      model: text(body.model, "model", 500),
      ...(baseUrl ? { baseUrl } : {}),
      isDefault: body.isDefault === true,
    },
    secret: seal({ apiKey }, config.encryptionKey),
  };
}

export function createModelSettingsService(dependencies: ModelSettingsDependencies) {
  return createResourceCrudService(dependencies, {
    kind: "model",
    lockOwner: true,
    async create(body: Record<string, unknown>, _transaction: ResourceTransactionStore) {
      return modelDraft(body, dependencies.config);
    },
    async update(existing: ResourceRow, patch) {
      const currentSecret = secretRecord(existing, dependencies.config);
      const merged: Record<string, unknown> = { name: existing.name, ...existing.data, ...patch };
      delete merged.apiKeyConfigured;
      merged.apiKey = patch.apiKey === undefined ? currentSecret.apiKey : patch.apiKey;
      return modelDraft(merged, dependencies.config);
    },
    async beforeWrite(transaction, draft, existingId) {
      if (draft.data.isDefault === true) {
        await transaction.clearModelDefaults(dependencies.ownerId, existingId);
      }
    },
    present(row): PublicResource {
      const result = basePublicResource(row);
      const secret = secretRecord(row, dependencies.config);
      result.apiKeyConfigured = typeof secret.apiKey === "string" && secret.apiKey.length > 0;
      return result;
    },
  });
}
