import type { Config } from '../../../config.ts';
import type { Database } from '../../../infra/db.ts';
import { unseal } from '../../../infra/crypto.ts';
import { builtinInstalled } from '../../../platform/builtin-sandbox.ts';
import { object, string } from '../../../shared/validation.ts';
import { fail } from '../../../shared/errors.ts';
import { createConnectorResourceService } from './service.ts';

export const builtinNpmCatalog = {
  gitlab: { name: 'GitLab', description: '管理 GitLab 代码仓库、合并请求和议题', package: '@masuratech/gitlab-mcp-server', version: '1.0.0', fields: [
    { key: 'GITLAB_API_URL', label: 'GitLab API 地址', placeholder: 'https://gitlab.example.com/api/v4', secret: false, url: true },
    { key: 'GITLAB_PERSONAL_ACCESS_TOKEN', label: 'Personal Access Token', placeholder: '填写具有 api 权限的 Token', secret: true, url: false },
  ] },
  jenkins: { name: 'Jenkins', description: '管理 Jenkins 构建任务、流水线和构建日志', package: '@kud/mcp-jenkins', version: '2.3.0', fields: [
    { key: 'MCP_JENKINS_URL', label: 'Jenkins 服务地址', placeholder: 'http://jenkins.example.com:8081', secret: false, url: true },
    { key: 'MCP_JENKINS_USER', label: '用户名', placeholder: '填写 Jenkins 用户名', secret: false, url: false },
    { key: 'MCP_JENKINS_API_TOKEN', label: 'API Token', placeholder: '填写 Jenkins API Token', secret: true, url: false },
  ] },
} as const;
export type BuiltinNpmId = keyof typeof builtinNpmCatalog;
export const builtinNpmEntry = (id: BuiltinNpmId) => `/opt/picoddy/node_modules/${builtinNpmCatalog[id].package}/dist/index.js`;

export function mergeBuiltinEnvironment(id: BuiltinNpmId, input: unknown, old: Record<string, string>) {
  const env = object(input), fields = builtinNpmCatalog[id].fields;
  if (Object.keys(env).some(key => !fields.some(field => field.key === key))) fail(400, 'INVALID_REQUEST', '不支持的连接器参数');
  const result: Record<string, string> = {};
  for (const field of fields) {
    const value = field.secret && (env[field.key] === '' || env[field.key] === undefined) ? old[field.key] : env[field.key];
    result[field.key] = string(value, field.label, 1, 20000).trim();
    if (!result[field.key] || /[\u0000\r\n]/.test(result[field.key])) fail(400, 'INVALID_REQUEST', '连接器参数无效');
    if (field.url) {
      let url: URL;
      try { url = new URL(result[field.key]); } catch { fail(400, 'INVALID_REQUEST', `${field.label}无效`); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) fail(400, 'INVALID_REQUEST', `${field.label}无效`);
    }
  }
  return result;
}

export function createBuiltinNpmService(database: Database, config: Config, ownerId: string,
  installed = (id: BuiltinNpmId, force = false) => builtinInstalled(config, id, force)) {
  async function row(id: BuiltinNpmId, db = database) {
    const rows = await db.query('SELECT id,name,data,secret FROM resources WHERE owner_id=$1 AND kind=\'connector\' AND name=$2 AND deleted_at IS NULL', [ownerId, id]);
    const found = rows.rows[0];
    const conflict = rows.rows.length > 1 || !!found && (found.data.transport !== 'stdio' || found.data.command !== 'node' || JSON.stringify(found.data.args) !== JSON.stringify([builtinNpmEntry(id)]));
    const env = found?.secret && !conflict ? (unseal(found.secret, config.encryptionKey) as any).env ?? {} : {};
    return { found, conflict, env };
  }
  async function status(id: BuiltinNpmId) {
    const entry = builtinNpmCatalog[id], state = await row(id), ready = await installed(id);
    return { id, name: entry.name, description: entry.description, fields: entry.fields, installed: ready, installing: false,
      configured: ready && !!state.found && !state.conflict && state.found.data.enabled !== false && entry.fields.every(field => !!state.env[field.key]),
      values: Object.fromEntries(entry.fields.filter(field => !field.secret).map(field => [field.key, state.env[field.key] ?? ''])),
      hasToken: entry.fields.some(field => field.secret && !!state.env[field.key]), conflict: state.conflict,
      ...(!ready ? { error: '执行镜像中缺少锁定版本的依赖，请更新云端执行镜像后重试' } : {}) };
  }
  return { status,
    async install(id: BuiltinNpmId) {
      if ((await row(id)).conflict) fail(409, 'BUILTIN_PRESET_CONFLICT', '存在同名手动配置，请先重命名');
      if (!await installed(id, true)) fail(503, 'BUILTIN_RUNTIME_UNAVAILABLE', '执行镜像缺少连接器依赖，请更新云端执行镜像');
      return status(id);
    },
    async configure(id: BuiltinNpmId, input: unknown) {
      const body = object(input);
      if (Object.keys(body).some(key => key !== 'env')) fail(400, 'INVALID_REQUEST', '不支持的连接器配置字段');
      if (!await installed(id)) fail(503, 'BUILTIN_RUNTIME_UNAVAILABLE', '请先准备连接器运行环境');
      await database.transaction(async client => {
        await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerId]);
        const scoped: Database = { query: (sql, values) => client.query(sql, values ? [...values] : undefined), transaction: work => work(client) };
        const state = await row(id, scoped);
        if (state.conflict) fail(409, 'BUILTIN_PRESET_CONFLICT', '存在同名手动配置，请先重命名');
        const entry = builtinNpmCatalog[id];
        const payload = { name: id, transport: 'stdio', command: 'node', args: [builtinNpmEntry(id)], enabled: true,
          displayName: entry.name, description: entry.description, env: mergeBuiltinEnvironment(id, body.env, state.env) };
        const service = createConnectorResourceService({ database: scoped, config, ownerId });
        if (state.found) await service.update(state.found.id, payload); else await service.create(payload);
      });
      return status(id);
    },
  };
}
