import { assertExpertContextBudget } from "../../../agent/prompt-runtime/expert-budget.ts";
import {expertRevision} from './binding.ts';
import type { ResourceTransactionStore } from "../../resource/node/store.ts";
import {
  assertOwnedIds,
  createResourceCrudService,
  type ResourceServiceDependencies,
} from "../../resource/node/service.ts";
import {
  basePublicResource,
  type ResourceDraft,
  type ResourceRow,
} from "../../resource/node/types.ts";
import { text, uuidList } from "../../resource/node/validation.ts";

async function expertDraft(
  ownerId: string,
  body: Record<string, unknown>,
  transaction: ResourceTransactionStore,
): Promise<ResourceDraft> {
  const name = text(body.name, "name", 200);
  const prompt = text(body.prompt, "prompt", 100_000);
  assertExpertContextBudget({
    trust: "user-supplied-untrusted",
    id: "00000000-0000-4000-8000-000000000000",
    name,
    instructions: prompt,
  });
  const skillIds = uuidList(body.skillIds, "skillIds");
  await assertOwnedIds(transaction, ownerId, "skill", skillIds, "skillIds");
  return { name, data: { prompt, skillIds }, secret: null };
}

export function createExpertResourceService(dependencies: ResourceServiceDependencies) {
  return createResourceCrudService(dependencies, {
    kind: "expert",
    create: (body, transaction) => expertDraft(dependencies.ownerId, body, transaction),
    async update(existing: ResourceRow, patch, transaction) {
      const merged = { name: existing.name, ...existing.data, ...patch };
      const draft=await expertDraft(dependencies.ownerId, merged, transaction);
      return {...draft,data:{...existing.data,...draft.data}};
    },
    present: row => {
      const {skillhubPackage:_package,bundledSkills:_bundles,...data}=row.data;
      const publicValue=basePublicResource({...row,data});
      return row.data.skillhubPackage ? {...publicValue,revision:expertRevision(row)} : publicValue;
    },
  });
}
