import { CronExpressionParser } from "cron-parser";

import { fail } from "../../../shared/errors.ts";
import type { ResourceTransactionStore } from "../../resource/node/store.ts";
import {
  assertOwnedIds,
  createResourceCrudService,
  type ResourceServiceDependencies,
} from "../../resource/node/service.ts";
import { basePublicResource, type ResourceDraft, type ResourceRow } from "../../resource/node/types.ts";
import { text, uuid, uuidList } from "../../resource/node/validation.ts";

async function automationDraft(
  ownerId: string,
  body: Record<string, unknown>,
  transaction: ResourceTransactionStore,
): Promise<ResourceDraft> {
  const skillIds = uuidList(body.skillIds, "skillIds");
  const connectorIds = uuidList(body.connectorIds, "connectorIds");
  const modelId = uuid(body.modelId, "modelId");
  await assertOwnedIds(transaction, ownerId, "skill", skillIds, "skillIds");
  await assertOwnedIds(transaction, ownerId, "connector", connectorIds, "connectorIds");
  if (modelId) await assertOwnedIds(transaction, ownerId, "model", [modelId], "modelId");

  const cron = text(body.cron, "cron", 500);
  const timezone = text(body.timezone, "timezone", 200);
  try {
    if (cron.split(/\s+/).length !== 5) throw new Error("Cron must have five fields");
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    CronExpressionParser.parse(cron, { tz: timezone });
  } catch {
    fail(400, "INVALID_SCHEDULE", "cron or timezone is invalid");
  }

  return {
    name: text(body.name, "name", 200),
    data: {
      prompt: text(body.prompt, "prompt", 100_000),
      cron,
      timezone,
      skillIds,
      connectorIds,
      ...(modelId ? { modelId } : {}),
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    },
    secret: null,
  };
}

export function createAutomationResourceService(dependencies: ResourceServiceDependencies) {
  return createResourceCrudService(dependencies, {
    kind: "automation",
    create: (body, transaction) => automationDraft(dependencies.ownerId, body, transaction),
    async update(existing: ResourceRow, patch, transaction) {
      const merged = { name: existing.name, ...existing.data, ...patch };
      const draft = await automationDraft(dependencies.ownerId, merged, transaction);
      for (const key of ["lastRunId", "lastError"] as const) {
        if (existing.data[key] !== undefined) draft.data[key] = existing.data[key];
      }
      draft.data.nextRunAt = patch.cron !== undefined || patch.timezone !== undefined
        ? null
        : existing.data.nextRunAt ?? null;
      return draft;
    },
    present: basePublicResource,
  });
}
