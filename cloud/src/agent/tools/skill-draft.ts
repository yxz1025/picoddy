import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Run } from '../../cloud/runs/types.ts';
import type { Database } from '../../infra/db.ts';
import type { Storage } from '../../platform/storage.ts';
import { createSkillDraftAgentService } from '../../domains/skill-draft/node/service.ts';
import { createAttachmentService } from '../../domains/attachment/node/service.ts';
import { fail } from '../../shared/errors.ts';

export function createSkillDraftTools(run: Run, database: Database, storage: Storage, maxUploadBytes: number): AgentTool<any>[] {
  const service = createSkillDraftAgentService(database, run);
  const parameters = {
    init: Type.Object({ name: Type.String({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 64 }),
      description: Type.String({ minLength: 1, maxLength: 1024 }),
      resources: Type.Optional(Type.Array(Type.Union([Type.Literal('scripts'),Type.Literal('references'),Type.Literal('assets')]), { uniqueItems: true })) }),
    empty: Type.Object({}),
    read: Type.Object({ path: Type.String({ minLength: 1, maxLength: 512 }) }),
    write: Type.Object({ path: Type.String({ minLength: 1, maxLength: 512 }), content: Type.String({ maxLength: 512_000 }) }),
    import: Type.Object({ attachmentId: Type.String(), fileName: Type.Optional(Type.String({ maxLength: 255 })) }),
  };
  function tool(name: string, schema: any, description: string, operation: (draft: Awaited<ReturnType<typeof service.current>>, input: any) => Promise<unknown>): AgentTool<any> {
    return { name: `skill_draft_${name}`, label: `技能草稿 ${name}`, description, parameters: schema,
      async execute(_id, input, signal) {
        signal?.throwIfAborted();
        if (run.selection.runtimeProfile.category !== 'skill_creator') fail(403, 'INVALID_CATEGORY', 'Draft tools require skill_creator');
        const draft = await service.current();
        const details = await operation(draft, input);
        return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
      } };
  }
  return [
    tool('init', parameters.init, 'Initialize SKILL.md in the current empty draft. Does not install or overwrite an existing draft.', async (draft, input) => {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.name) || input.name.length > 64 || !input.description.trim() || /[\r\n<>]/.test(input.description)) fail(400, 'INVALID_SKILL_METADATA', 'Invalid skill name or description');
      if ((await service.files(draft.id)).length) fail(409, 'DRAFT_ALREADY_INITIALIZED', 'Read the existing draft before editing it');
      const content = `---\nname: ${input.name}\ndescription: ${JSON.stringify(input.description)}\n---\n\n# ${input.name}\n\n${input.description}\n`;
      return service.write(draft.id, 'SKILL.md', Buffer.from(content), draft.revision);
    }),
    tool('list', parameters.empty, 'List the complete current conversation draft file set.', async draft => ({ files: await service.files(draft.id) })),
    tool('read', parameters.read, 'Read a draft text file or binary metadata.', async (draft, input) => service.read(draft.id, input.path)),
    tool('write', parameters.write, 'Write UTF-8 text to a private draft file. Invalidates prior validation, never publishes.', async (draft, input) => service.write(draft.id, input.path, Buffer.from(input.content), draft.revision)),
    tool('import_attachment', parameters.import, 'Copy an explicitly selected owned attachment into draft assets/.', async (draft, input) => {
      const selected = run.selection.files.find(file => file.id === input.attachmentId && file.owner_id === run.owner_id);
      if (!selected) fail(404, 'ATTACHMENT_NOT_SELECTED', 'Attachment is not selected for this run');
      const name = input.fileName ?? selected.name;
      if (typeof name !== 'string' || !name || /[/\\\u0000-\u001f]/.test(name)) fail(400, 'INVALID_ASSET_NAME', 'Use a single safe asset filename');
      const { bytes } = await createAttachmentService({ database, storage, maxUploadBytes }).download(run.owner_id, selected.id);
      return service.write(draft.id, `assets/${name}`, bytes, draft.revision);
    }),
    tool('delete', parameters.read, 'Remove a file from the current draft only.', async (draft, input) => service.write(draft.id, input.path, null, draft.revision)),
    tool('validate', parameters.empty, 'Validate the complete current draft structure, not runtime behavior. Publication remains a user action.', async draft => service.validate(draft.id)),
  ];
}
