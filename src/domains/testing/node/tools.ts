import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { testingService } from './service.ts';
import { digest } from './validation.ts';

const schema = Type.Object({
  action: Type.Union(['list', 'authoring', 'importPackage', 'prepareRun', 'collect'].map(v => Type.Literal(v))),
  targetId: Type.Optional(Type.String()), testSha: Type.Optional(Type.String()),
  manifestPath: Type.Optional(Type.String()), packageId: Type.Optional(Type.String()),
  businessSha: Type.Optional(Type.String()), runId: Type.Optional(Type.String()),
});
export function requirementTestingTool(service: ReturnType<typeof testingService>, sourceMessage: () => string, requestId: string): AgentTool<typeof schema> {
  return {
    name: 'requirement_testing', label: '需求自动化测试', parameters: schema,
    description: 'authoring 不因缺少已提交 SDD 或目标阻塞编写；可利用本轮需求、对话和授权本地资料，只追问具体缺项。上传 TAPD 不是前提。importPackage 的真实资产版本校验仅用于正式登记，本地脚本可直接执行，无需 MCP 或登记包。当前需求自动化测试。authoring 返回本轮 SDD、仓库、目标及脚本协议，使用现有文件工具生成真实用例与断言；list 查看配置与记录；importPackage 读取完整 Git 提交中的测试包；prepareRun 冻结请求，返回 local_start_test 所需 request；collect 按 runId 读取本地真实报告并跟踪。Web/H5/微应用使用配置域名及入口路径，本地 Playwright 执行；微信使用本地开发者工具。仅 MCP 跟踪路径通过用户本轮选择的本地 MCP，不调用 Jenkins 构建或读取 Jenkins 报告。businessSha 为预期业务版本，Web 未配置版本接口时可省略并明确版本未核验；微信必须等于脚本完整 SHA。仅用户要求执行时启动测试，仅生成用例或上传时不执行。不得编造地址、SHA、凭据或用跳过/空断言宣称成功。',
    async execute(_id, params) {
      const result = params.action === 'list' ? service.snapshot() : await service.action({ ...params, sourceMessageId: sourceMessage(), requestId: digest(JSON.stringify([requestId, params.packageId, params.businessSha])) });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} };
    },
  };
}
