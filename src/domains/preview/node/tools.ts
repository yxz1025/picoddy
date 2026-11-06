import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { previewAuthoring } from './authoring.ts';
import type { previewService } from './service.ts';
const commandSchema = Type.Object({ file: Type.String(), args: Type.Array(Type.String(), { maxItems: 100 }) });
const targetSchema = Type.Object({
  id: Type.Optional(Type.String({ description: '仅修改已有目标时填写 list 返回的目标 id；新建时省略' })),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  repositoryId: Type.String({ minLength: 1, description: 'list 返回的 selectedRepositories[].id，不是路径或 targetId' }),
  kind: Type.Union([Type.Literal('web'), Type.Literal('wechat-mini')]),
  projectPath: Type.String({ description: '相对关联仓库根目录，如 . 或 super-advisor-center；不能传绝对路径' }),
  build: Type.Optional(commandSchema), start: Type.Optional(commandSchema),
  webUrl: Type.Optional(Type.String({ description: 'web 必填，本机 HTTP(S) 地址，例如 http://localhost:5173' })),
  viewport: Type.Optional(Type.Object({ width: Type.Integer({ minimum: 240, maximum: 3840 }), height: Type.Integer({ minimum: 240, maximum: 3840 }) })),
  cliPath: Type.Optional(Type.String({ description: 'wechat-mini 必填，微信 CLI 绝对路径' })),
  miniProjectPath: Type.Optional(Type.String()), entryPath: Type.Optional(Type.String()),
  design: Type.Optional(Type.Object({ url: Type.Optional(Type.String()), version: Type.Optional(Type.String()), server: Type.Optional(Type.String()) })),
  scenarios: Type.Optional(Type.Array(Type.Object({ id: Type.String(), name: Type.String(), entryPath: Type.Optional(Type.String()), module: Type.Optional(Type.String()) }), { maxItems: 30 })),
}, { additionalProperties: false });
const schema = Type.Object({
  action: Type.Union(['list', 'configure', 'designTools', 'readDesign', 'deliver'].map(v => Type.Literal(v))),
  targetId: Type.Optional(Type.String({ description: 'deliver/designTools/readDesign 必填，使用 list/configure 返回的目标 id' })), target: Type.Optional(targetSchema), tool: Type.Optional(Type.String()), arguments: Type.Optional(Type.Record(Type.String(), Type.Any())),
  summary: Type.Optional(Type.String()), pending: Type.Optional(Type.String()), files: Type.Optional(Type.Array(Type.String())),
});
export function requirementPreviewTool(service: ReturnType<typeof previewService>, authoring: () => ReturnType<typeof previewAuthoring>, stageKey: string, allowedServers: Set<string>): AgentTool<typeof schema> {
  return { name: 'requirement_preview', label: '设计代码与交互预览', parameters: schema,
    description: '先 list 获取 selectedRepositories 和已有 targets。configure.target 必须为对象，提供 repositoryId、name、kind、相对仓库根目录的 projectPath；web 还需本机 webUrl，wechat-mini 还需 cliPath；新建不要传 id。configure 返回真实目标 id 后，deliver 才可用该 targetId 登记 summary、pending 和 files。每次 files 只含该目标仓库的相对路径，多仓库分别登记。没有可运行预览的纯后端改动不必伪造 web 目标。只修改所选仓库当前分支，不创建 worktree/分支、不切换或重置。绑定 Figma 时先 designTools 获取实际参数，再 readDesign 真实读取；链接不等于读取证据。仅讨论或没有代码文件不登记交付。工具不启动预览、不发布、不合并、不推进 TAPD，由用户点击启动。',
    async execute(_id, p, signal) {
      const missing: string[] = [];
      if (['deliver', 'designTools', 'readDesign'].includes(p.action) && !p.targetId?.trim()) missing.push('targetId（先 list/configure 获取真实目标 id）');
      if (p.action === 'readDesign' && !p.tool?.trim()) missing.push('tool（先 designTools 获取工具名称）');
      if (p.action === 'deliver') {
        if (!p.summary?.trim()) missing.push('summary');
        if (!p.files?.length) missing.push('files（同一目标仓库内的相对路径数组）');
      }
      if (p.action === 'configure') {
        if (!p.target || typeof p.target !== 'object' || Array.isArray(p.target)) throw new Error('configure.target 必须是 JSON 对象，不能传 JSON 字符串。必填 repositoryId、name、kind、projectPath；web 还需 webUrl。');
        for (const key of ['repositoryId', 'name', 'kind', 'projectPath'] as const) if (!p.target[key]?.trim()) missing.push(`target.${key}`);
        if (p.target.kind === 'web' && !p.target.webUrl?.trim()) missing.push('target.webUrl');
        if (p.target.kind === 'wechat-mini' && !p.target.cliPath?.trim()) missing.push('target.cliPath');
      }
      if (missing.length) throw new Error(`缺少参数：${missing.join('、')}。修正参数后再调用，不要原样重试。`);
      const author = authoring(), inputs = author.inputs();
      if (p.action === 'readDesign') return author.read(String(p.targetId), String(p.tool), p.arguments || {}, signal);
      let result: unknown;
      if (p.action === 'list') result = { ...service.snapshot(), selectedRepositories: inputs.repositories, stageKey };
      else if (p.action === 'configure') {
        const target = p.target;
        if (!target || !inputs.repositories.some((r: any) => r.id === target.repositoryId)) throw new Error('target.repositoryId 不在本轮选中的仓库中；请 list 后使用 selectedRepositories[].id，不要填写目标 id 或路径');
        if (target.id && !service.snapshot().targets.some(t => t.id === target.id && t.stageKey === stageKey)) throw new Error('target.id 不是当前阶段的已有目标；新建请省略 id，修改请先 list');
        if (target.design?.server && !allowedServers.has(target.design.server)) throw new Error('请先在预览配置绑定 Figma MCP，或在会话中选择该连接器');
        result = await service.action({ action: 'saveTarget', target: { ...target, scenarios: target.scenarios ?? [], stageKey } });
      } else if (p.action === 'designTools') result = await author.tools(String(p.targetId));
      else if (p.action === 'deliver') result = await author.deliver(String(p.targetId), p.summary || '', p.pending || '', p.files || []);
      else throw new Error('未知设计操作');
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} };
    },
  };
}
