import { createHash } from 'node:crypto';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { ASSET_CONTEXT_OPEN, ASSET_CONTEXT_CLOSE, renderAssetManifest, type RequirementAssetManifest } from '../domains/requirement/shared/asset_context.ts';
import { encodeJsonForXml } from './prompt-runtime/boundary-encoding.ts';

const TURN_OPEN = '<turn_payload encoding="json">';
const TURN_CLOSE = '</turn_payload>';
const REQUIREMENT_CONTEXT_OPEN = '<requirement_context>\n';
const REQUIREMENT_CONTEXT_CLOSE = '\n</requirement_context>';
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function isAssetBlock(value: unknown): value is RequirementAssetManifest {
  if (!isObject(value) || value.schemaVersion !== 1 || !isObject(value.scope)) return false;
  const scope = value.scope;
  if (!['requirementId', 'workspaceId', 'stage'].every(key => typeof scope[key] === 'string') ||
      !Array.isArray(value.assets) || value.assets.length > 100) return false;
  return value.assets.every(asset => isObject(asset) &&
    ['id', 'path'].every(key => typeof asset[key] === 'string' && asset[key].length > 0) &&
    typeof asset.hash === 'string' && /^[a-f0-9]{64}$/.test(asset.hash) &&
    typeof asset.name === 'string' && typeof asset.workingPath === 'string' &&
    Number.isInteger(asset.stage) && Number.isSafeInteger(asset.bytes) && Number(asset.bytes) >= 0 &&
    (asset.format === 'text' || asset.format === 'binary'));
}

/** Pure request projection. Rebuild evidence from the *active* Pi history on
 * every request so compaction, branching and rollback cannot leave stale flags.
 * Persisted messages and their source manifests are never changed. */
export function projectRequirementAssetContext(messages: AgentMessage[]) {
  const seen = new Set<string>();
  const versions = new Map<string, string>();
  const seenRequirements = new Set<string>();
  const seenRepositories = new Set<string>();
  const seenEmbeddedAssets = new Set<string>();
  let removedCharacters = 0;
  let references = 0;
  let contextReferences = 0;
  let contextFieldsRemoved = 0;
  const projectQuery = (query: string) => {
    let projected = query;
    const contextStart = projected.indexOf(REQUIREMENT_CONTEXT_OPEN);
    const contextEnd = projected.indexOf(REQUIREMENT_CONTEXT_CLOSE, contextStart + REQUIREMENT_CONTEXT_OPEN.length);
    if (contextStart >= 0 && contextEnd >= 0) {
      const jsonStart = contextStart + REQUIREMENT_CONTEXT_OPEN.length;
      let context: unknown;
      try { context = JSON.parse(projected.slice(jsonStart, contextEnd)); } catch { context = undefined; }
      if (isObject(context)) {
        let contextChanged = false;
        const next = { ...context };
        // These values identify a fetch/snapshot event, not requirement facts.
        // Sending them on every turn needlessly changes an otherwise stable prefix.
        for (const field of ['syncedAt']) {
          if (field in next) { delete next[field]; contextChanged = true; contextFieldsRemoved++; }
        }
        if (isObject(context.requirement)) {
          const key = JSON.stringify(context.requirement);
          if (seenRequirements.has(key)) {
            next.requirement = {
              id: context.requirement.id,
              name: context.requirement.name,
              contextRef: '本需求详情与会话更早消息中的需求详情完全相同，沿用该内容。',
            };
            contextChanged = true;
            contextReferences++;
          } else seenRequirements.add(key);
        }
        if (isObject(context.inputs)) {
          const inputs = { ...context.inputs };
          for (const field of ['id', 'createdAt']) {
            if (field in inputs) { delete inputs[field]; contextChanged = true; contextFieldsRemoved++; }
          }
          if (Array.isArray(context.inputs.repositories)) inputs.repositories = context.inputs.repositories.map(repository => {
            if (!isObject(repository) || typeof repository.id !== 'string') return repository;
            // Snapshot IDs and timestamps change every turn. Compare only the
            // repository facts that affect where and what the agent may read.
            const key = JSON.stringify([
              repository.id, repository.path, repository.root, repository.roles,
              repository.scope, repository.branch, repository.commit, repository.dirty,
            ]);
            if (seenRepositories.has(key)) {
              contextChanged = true;
              contextReferences++;
              return {
                id: repository.id,
                name: repository.name,
                path: repository.path,
                root: repository.root,
                roles: repository.roles,
                scope: repository.scope,
                contextRef: '仓库信息与会话更早消息相同；沿用其中的分支、提交号和状态。',
              };
            }
            seenRepositories.add(key);
            return repository;
          });
          if (Array.isArray(context.inputs.assets)) {
            inputs.assets = context.inputs.assets.map(asset => {
              if (!isObject(asset) || typeof asset.id !== 'string' || typeof asset.hash !== 'string') return asset;
              const key = JSON.stringify([asset.id, asset.hash, asset.path]);
              if (seenEmbeddedAssets.has(key)) {
                contextChanged = true;
                contextReferences++;
                return {
                  id: asset.id,
                  hash: asset.hash,
                  path: asset.path,
                  name: asset.name,
                  contextRef: '该资产版本的正文与会话更早消息相同，沿用其中的正文；需要时从 path 读取。',
                };
              }
              seenEmbeddedAssets.add(key);
              return asset;
            });
          }
          next.inputs = inputs;
        }
        if (contextChanged) {
          projected = projected.slice(0, jsonStart) + encodeJsonForXml(next) + projected.slice(contextEnd);
        }
      }
    }

    const start = projected.indexOf(ASSET_CONTEXT_OPEN);
    const end = projected.indexOf(ASSET_CONTEXT_CLOSE, start + ASSET_CONTEXT_OPEN.length);
    if (start < 0 || end < 0) {
      removedCharacters += query.length - projected.length;
      return projected;
    }
    let block: unknown;
    try { block = JSON.parse(projected.slice(start + ASSET_CONTEXT_OPEN.length, end)); } catch {
      removedCharacters += query.length - projected.length;
      return projected;
    }
    if (!isAssetBlock(block)) {
      removedCharacters += query.length - projected.length;
      return projected;
    }
    const scope = JSON.stringify([block.scope.workspaceId, block.scope.requirementId, block.scope.stage]);
    let changed = false;
    const assets = block.assets.map(asset => {
      const identity = JSON.stringify([scope, asset.id]);
      const previousHash = versions.get(identity);
      versions.set(identity, asset.hash);
      const fingerprint = createHash('sha256').update(JSON.stringify([
        identity, asset.hash, asset.path,
        asset.name, asset.workingPath, asset.stage, asset.bytes, asset.format,
      ])).digest('hex');
      const versionChanged = previousHash !== undefined && previousHash !== asset.hash;
      const reference = { id: asset.id, hash: asset.hash, path: asset.path,
        state: 'earlier_in_active_context' as const, ...(versionChanged ? { previousHash } : {}) };
      if (seen.has(fingerprint) && JSON.stringify(reference).length < JSON.stringify(asset).length) {
        changed = true; references++;
        return reference;
      }
      seen.add(fingerprint);
      if (versionChanged) { changed = true; return { ...asset, previousHash }; }
      return asset;
    });
    if (changed) projected = projected.slice(0, start) + renderAssetManifest({ ...block, assets }) + projected.slice(end + ASSET_CONTEXT_CLOSE.length);
    removedCharacters += query.length - projected.length;
    return projected;
  };
  const projectText = (text: string) => {
    const start = text.indexOf(TURN_OPEN);
    const end = text.indexOf(TURN_CLOSE, start + TURN_OPEN.length);
    if (start < 0 || end < 0) return text;
    let payload: unknown;
    try { payload = JSON.parse(text.slice(start + TURN_OPEN.length, end)); } catch { return text; }
    if (!isObject(payload) || typeof payload.query !== 'string') return text;
    const query = projectQuery(payload.query);
    if (query === payload.query) return text;
    return text.slice(0, start + TURN_OPEN.length) + encodeJsonForXml({ ...payload, query }) + text.slice(end);
  };
  const projected = messages.map(message => {
    if (message.role !== 'user') return message;
    if (typeof message.content === 'string') {
      const content = projectText(message.content);
      return content === message.content ? message : { ...message, content };
    }
    let changed = false;
    const content = message.content.map(part => {
      if (part.type !== 'text') return part;
      const text = projectText(part.text);
      if (text === part.text) return part;
      changed = true; return { ...part, text };
    });
    return changed ? { ...message, content } : message;
  });
  return { messages: projected, removedCharacters, references, contextReferences, contextFieldsRemoved };
}
