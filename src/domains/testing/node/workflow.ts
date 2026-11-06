import { readFile } from 'node:fs/promises';
import type { TestingSnapshot } from '../shared/contracts.ts';
export interface AuthoringInputs {
  discussionOnly: boolean;
  repositories: Array<{ id: string; root: string; commit: string }>;
  assets: Array<{ id: string; hash: string; name: string; path: string; content: string; truncated: boolean }>;
}

/** Stage-level workflow, independent of downloadable Excel expert resources. */
export function testingExpertWorkflow(discussionOnly: boolean, deliveryOnly: boolean) {
  if (discussionOnly) return '\n本轮仅讨论测试方案，不读取源码、生成脚本或启动测试。';
  if (deliveryOnly) return '\n本轮只执行用户要求的测试产物提交，不生成新脚本、不启动测试。';
  return `\n当前自动测试阶段负责“需求/SDD + 代码变更 → 测试用例 → 可执行脚本 → 真实执行 → 报告分析”。
先调用 requirement_testing 的 authoring 获取本轮已选输入、目标及脚本协议，同时利用本轮需求详情、用户对话、提供的本地文档和已授权仓库资料。有已选 SDD 时读取原文（截断时读 path）；未选已提交资产、未上传 TAPD 或尚未配置测试目标均不是用例生成的硬阻塞，不得声称提交 TAPD 是唯一解除阻塞的动作。验收信息不足时只追问具体缺项，继续完成可独立部分，不编造业务规则，也不把源码现状直接当成验收标准。为真实需求或用户确认建立稳定 AC-ID，记录来源，再映射 TC-ID 和断言。代码变化时更新受影响项及关键回归。
明确要求“开始自动化测试/执行测试/复测”时，连续完成脚本生成、必要前置检查、执行及报告分析；不要在生成 Excel 或脚本后宣告任务完成。用户只要求用例、脚本、方案或上传时只完成指定内容，不启动测试。阶段切换本身不是执行授权。
Web/H5/微前端用本地 Playwright，使用配置 BASE_URL 和 ENTRY_URL 作为测试入口；微应用根据实际主应用挂载路径或独立地址编写导航；微信小程序通过本地脚本使用官方 miniprogram-automator 和 Node test，结果明确标记开发者工具模拟器，不能宣称真机通过。脚本写入关联仓库，通过已有文件工具操作，不使用内置技能。fixtures 负责账号、测试数据与清理；不能编造域名、页面定位、账号、数据或用跳过/空断言冒充通过。
执行前确认用户授权范围、测试环境/本地项目、登录和数据条件；仅 MCP 跟踪需要所选连接器，版本核验需要目标版本；缺少配置先列出具体阻塞，可以继续完成独立的脚本准备。生成变更遵循仓库约束，不自动升级依赖、不自动发布业务代码；提交/推送沿用用户授权，不擅自提交无关修改。微信编译项目先按仓库实际构建命令准备产物并核对对应提交，执行器不会替你编译。
需要正式测试包跟踪时，已提交脚本通过 importPackage 登记，prepareRun 返回冻结请求。目标未配置 connector 时，使用现有本地执行工具启动生成的脚本并交付真实报告，不调用 MCP 或 collect。仅已配置 connector 的目标用本轮选择的本地测试 MCP 的 local_start_test 执行返回的 request；Web 直接访问配置的域名和入口，不经过 Jenkins。不要自行改写请求参数。仅 MCP 跟踪路径随后调用 collect 读取结果，只需 runId；直接脚本读取本地报告。Web 不配置版本接口时允许测试但必须说明部署版本未核验，不得把脚本 SHA 当作部署 SHA。同一请求中断后先查状态，不重复触发。运行未结束时明确仍在执行，可持续查询；已结束依据原始结果分析业务缺陷、脚本缺陷和环境阻塞，输出覆盖说明及报告，不擅自修改业务代码或重部署。
本地脚本直接执行不要求先 importPackage、提交 Git 或上传 TAPD；用户授权且入口、账号、数据等实际前提满足即可执行并交付真实报告。版本登记、已提交脚本及资产 id/hash 条件仅适用于正式测试包跟踪，不得前置到用例生成或直接本地执行。正式 importPackage 校验保持不变，不能伪造资产引用。直接脚本路径不调用 prepareRun/collect；仅使用已配置 MCP 的跟踪路径才调用。无仓库 Playwright 时可用宿主提供的独立受管测试工程。微信也可以通过专家包官方 SDK 脚本直接执行，无需 MCP。
Excel/TAPD 上传是独立配套交付，不是自动化执行结果。生成完成仅表示脚本就绪；执行成功必须有本轮版本对应的逐条报告。`;
}

export async function authoringContext(snapshot: TestingSnapshot, inputs: AuthoringInputs, targetId?: string) {
  const targets = snapshot.targets.filter(t => inputs.repositories.some(r => r.id === t.repositoryId));
  const target = targetId ? targets.find(t => t.id === targetId) : targets.length === 1 ? targets[0] : undefined;
  if (targetId && !target) throw new Error('测试目标不存在或对应仓库未在本轮选中');
  const resources: Record<string, string> = {};
  if (target?.kind === 'wechat-mini') {
    resources['mini-case-contract'] = `将业务脚本写为已提交的 .cjs 文件，module.exports.cases 是 { 'TC-ID': async ({miniProgram, assert, environment}) => {真实页面操作和断言} }。可选 setup/teardown 为相同参数的 async 函数；teardown 必须清理测试数据，失败应抛错。miniProgram 是已启动的官方 SDK 实例，assert 为 node:assert/strict。不得自行 launch/close、把仅访问页面当作验收或写入仓库污染工作区。每个用例 60 秒，顺序执行，不自动重试；失败截图由执行器保存。测试清单 file 指向此 .cjs 文件。本地执行要求业务与测试同一完整 SHA、干净工作区，测试产物保存在应用独立目录。`;
  } else if (target) {
    for (const name of ['templates/playwright.config.ts.example']) resources[name] = await readFile(new URL(`../../../../scripts/testing/${name}`, import.meta.url), 'utf8');
  }
  return { target, targets, inputs, resources,
    blockers: [],
    inputWarnings: inputs.assets.length ? [] : ['本轮未选择已提交资产版本。可使用本轮需求详情、对话、用户提供的本地文档及已授权仓库资料生成用例；记录真实来源，不得声称已完成资产版本核验。缺少实际验收规则时只追问具体项，不要求先提交 TAPD。'],
    executionPrerequisites: targets.length ? [] : ['执行前需确认实际入口、登录和测试数据条件；可先生成用例。正式跟踪时再配置对应测试目标。'],
    registrationRequirements: [
      ...(!target ? ['正式登记测试包时需明确单个 targetId；跨端分别登记，不影响跨端用例编写'] : []),
      ...(!inputs.assets.length ? ['正式 importPackage 需要当前需求已提交资产的真实 id/hash；这是登记要求，不是用例生成或直接本地执行的前提，不要求先上传 TAPD'] : []),
    ],
    manifest: { schemaVersion: 1, inputAssets: inputs.assets.map(a => ({ id: a.id, hash: a.hash })), cases: [] },
    caseSchema: { id: '唯一 TC-ID', title: '业务验收标题', acceptanceIds: ['真实需求/文档/用户确认中的稳定 AC-ID，覆盖矩阵记录来源'], required: true, automation: 'automated | manual | blocked', file: '真实脚本仓库相对路径；automated 必填' },
    previousRuns: snapshot.runs.filter(r => !target || r.target.id === target.id).slice(0, 5),
    workflow: testingExpertWorkflow(false, false),
    note: '此结果用于编写准备，不代表验收信息充分或执行条件就绪。空 cases/inputAssets 是草稿，不是可登记测试包；不得伪造资产引用。先利用真实上下文完成可独立工作，只追问具体缺项。本工具不执行代码，不要求提交 TAPD。',
  };
}
