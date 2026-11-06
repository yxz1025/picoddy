import type { ResourceTransactionStore } from "../../resource/node/store.ts";
import {
  assertOwnedIds,
  createResourceCrudService,
  type ResourceServiceDependencies,
} from "../../resource/node/service.ts";
import {
  basePublicResource,
  type PublicResource,
  type ResourceDraft,
  type ResourceRow,
} from "../../resource/node/types.ts";
import { text, uuid } from "../../resource/node/validation.ts";
import { fail } from '../../../shared/errors.ts';

async function memoryDraft(
  ownerId: string,
  body: Record<string, unknown>,
  transaction: ResourceTransactionStore,
): Promise<ResourceDraft> {
  const workspaceId = uuid(body.workspaceId, "workspaceId");
  const scope = body.scope ?? 'user';
  if (typeof scope !== 'string' || !['user', 'working'].includes(scope)) fail(400, 'INVALID_MEMORY_SCOPE', '记忆范围无效');
  const conversationId = uuid(body.conversationId, 'conversationId');
  if (scope === 'working' && (!conversationId || !await transaction.hasOwnedConversation(ownerId, conversationId))) fail(400, 'INVALID_REFERENCE', '工作记忆必须绑定自己的会话');
  if (scope !== 'working' && conversationId) fail(400, 'INVALID_MEMORY_SCOPE', '长期记忆不能绑定会话');
  if (workspaceId) {
    await assertOwnedIds(transaction, ownerId, "workspace", [workspaceId], "workspaceId");
  }
  return {
    name: text(body.title, "title", 200),
    data: {
      content: text(body.content, "content", 200_000),
      ...(body.kind !== undefined ? { kind: text(body.kind, 'kind', 64) } : {}),
      ...(body.scope !== undefined ? { scope } : {}),
      ...(scope === 'working' ? { conversationId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    },
    secret: null,
  };
}

export function createMemoryResourceService(dependencies: ResourceServiceDependencies) {
  const service = createResourceCrudService(dependencies, {
    kind: "memory",
    lockOwner: true,
    create: (body, transaction) => memoryDraft(dependencies.ownerId, body, transaction),
    update(existing: ResourceRow, patch, transaction) {
      const merged: Record<string, unknown> = { name: existing.name, ...existing.data, ...patch };
      if (patch.title === undefined) merged.title = existing.name;
      return memoryDraft(dependencies.ownerId, merged, transaction);
    },
    present(row): PublicResource {
      const result = basePublicResource(row);
      result.title = row.name;
      return result;
    },
  });
  return { ...service, async list() {
    // Management lists long-term memories. Working memories are recalled only
    // by the active run's conversation-scoped runtime service.
    return (await service.list()).filter(memory => (memory.scope ?? 'user') === 'user');
  } };
}
