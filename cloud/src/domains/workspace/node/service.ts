import {
  createResourceCrudService,
  type ResourceServiceDependencies,
} from "../../resource/node/service.ts";
import { basePublicResource, type ResourceDraft, type ResourceRow } from "../../resource/node/types.ts";
import { optionalText, text } from "../../resource/node/validation.ts";
import { fail } from '../../../shared/errors.ts';

function workspaceDraft(body: Record<string, unknown>): ResourceDraft {
  return {
    name: text(body.name, "name", 200),
    data: { description: optionalText(body.description, "description", 20_000) ?? "" },
    secret: null,
  };
}

export function createWorkspaceResourceService(dependencies: ResourceServiceDependencies) {
  const crud = createResourceCrudService(dependencies, {
    kind: "workspace",
    async create(body) {
      return workspaceDraft(body);
    },
    async update(existing: ResourceRow, patch) {
      return workspaceDraft({ name: existing.name, ...existing.data, ...patch });
    },
    present: basePublicResource,
  });
  return {
    ...crud,
    async remove(id: string) {
      const { database, ownerId } = dependencies;
      await database.transaction(async client => {
        await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerId]);
        const space = await client.query("SELECT id FROM resources WHERE id=$1 AND owner_id=$2 AND kind='workspace' AND deleted_at IS NULL FOR UPDATE", [id, ownerId]);
        if (!space.rows[0]) fail(404, 'NOT_FOUND', 'Workspace not found');
        const references = await client.query(`SELECT id FROM conversations WHERE owner_id=$1 AND workspace_id=$2
          UNION ALL SELECT id FROM resources WHERE owner_id=$1 AND kind='memory' AND deleted_at IS NULL AND data->>'workspaceId'=$2::text LIMIT 1`, [ownerId, id]);
        if (references.rows[0]) fail(409, 'WORKSPACE_IN_USE', 'Detach conversations and memories before deleting this workspace');
        await client.query('DELETE FROM workspace_heads WHERE id=$1 AND owner_id=$2', [id, ownerId]);
        await client.query("UPDATE resources SET deleted_at=now(),updated_at=now() WHERE id=$1 AND owner_id=$2 AND kind='workspace'", [id, ownerId]);
      });
    },
  };
}
