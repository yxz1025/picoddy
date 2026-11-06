# 需求测试专家与 TAPD 用例交付设计

2026-09-22 更新：测试协同用例创建改为新版 TestX 批量接口，每批最多 200 条，保留单条回执与详情核验；未知结果先核对，禁止整批盲目重发。此改动不影响 Excel 等文件作为需求附件提交。实现及验证范围见 [批量创建设计](2026-09-22-testx-batch-create-design.md)。

## 背景与目标

用户要求：从项目进入需求时，需求处于“开发中”或“开发完成”应唤起测试专家；专家根据前几个阶段的资产自动编写测试用例，按 Downloads/excel_template.xlsx 的规范交付并上传 TAPD（用户描述中的 tade 按项目现有 TAPD 理解）。专家文件遵循产品专家、软件架构师的包标准。

用户已确认本设计。专家包已编写、通过权威校验器并注册；入口、自动任务和只上传流程已实现，实际 TAPD 会话及 Windows 启动尚未验证。

## 现状与参考

- requirementStageExpert.ts 将开发中映射软件开发，绑定 senior-developer；开发完成未映射；自动测试阶段无专家身份。
- RequirementChat 根据阶段召唤固定市场身份，再创建或恢复阶段会话；目前没有自动发送首次任务。
- 需求 inputs 已提供所选资产的固定版本、哈希、路径与文本摘要，可逐项追溯产品、设计、研发资产。attachments 只有元信息，不能当作已读内容。
- requirementDelivery 支持 xlsx 文件收集；现有上传通过 TAPD files/upload_attachment 写入当前需求附件字段，并记录同步状态与哈希。
- 当前 completeRequirementStage 将上传与状态流转绑定；测试准备期间应支持只上传，保留开发中的业务状态。
- 已完整核实本机安装的软件架构师 1.4.0 清单及主 Agent；本机未找到产品专家包，不声称已读取。采用架构师标准和 expert-manager 的 Agent/manifest 规范。
- 模板已读取两张表、全部列、示例、说明与等级下拉；原文件保留。

## 非目标

本次核心是用例设计与 Excel 交付，不自动执行端到端测试、修改业务代码、发布版本或创建缺陷。上传定义为当前需求附件，用户可将 Excel 导入 TAPD 测试管理；不将附件上传描述为原生测试用例创建。

## 专家包

新增 testing-expert（测试专家），按既有 init_expert.py → 填充 → validate_expert.py → register_expert.py → package_expert.py 流程创建，安装目录遵循现有个人专家市场约定。

```text
testing-expert/
  .picoddy-plugin/plugin.json
  agents/testing-expert.md
  agents/references/testing-workflow.md
  agents/references/test-case-template-spec.md
  agents/references/testing-artifacts.md
  assets/excel_template.xlsx
  bin/generate-test-cases.cjs
```

清单使用 schemaVersion 2、expertType agent、中英文展示字段、categoryId 10-ProjectQuality；agentName 与主文件名称一致。frontmatter 不声明 tools。主 Agent 明确能力、参考路由、工作流程、输出规范与权限边界；不引入无关技能。将 Excel 模板原样随包携带，运行时不能依赖创建者的 Downloads 或 macOS 路径。

生成脚本采用项目已有 ExcelJS 能力，正式交付时明确运行时依赖与跨平台调用方式，不假定目标仓库安装 ExcelJS，不自动安装依赖。模板与规范采用相对包路径。

实现采用 scripts/experts/configure-testing-expert.mjs 填充固定目录中的初始化包。生成器由 src/domains/requirement/node/test_case_workbook.ts 打包为内置 ExcelJS 的单个 CJS 文件，提供第三方许可证；宿主上下文提供 expertRoot 与 Electron Node executable，Windows 使用 PowerShell 并设置 ELECTRON_RUN_AS_NODE=1。打包 ZIP 位于 output/testing-expert/testing-expert.zip。

## 入口与自动任务

1. 进入项目需求及继续产研时刷新 TAPD 状态。开发中及已有同义状态、开发完成进入自动测试工作阶段，绑定 testing-expert；不修改 TAPD 业务状态。手动软件开发阶段仍绑定开发专家。
2. 自动测试阶段固定绑定本次真实注册的本地 expert ID，按 ID 校验可用性，不按名称匹配，也不虚构未发布的市场 namespace。产品、架构、开发现有市场安装流程保留。测试包缺失明确提示安装；远端分发需包发布后接入真实市场身份。
3. 用例准备与正式执行在专家任务中区分：开发中根据产品及设计基线编写用例，未实现行为标记待实现，不报告测试通过；开发完成补充实际实现、接口与回归范围。
4. 首次进入测试会话，通过现有发送与输入冻结链路启动“读取本需求前序已确认资产、生成模板用例、校验并上传”任务。持久化任务启动记录，重复进入或 React effect 重跑不重复启动；运行中的会话不切换专家。
5. 延续用户已保存的输入选择；自动选择只发生于首次默认选择。资产不足时先产出有依据的用例和问题清单，不编造验收条件；关键缺失阻止正式完整交付。用例设计无需强制关联仓库，产品资产充分时可以开展，源码读取仅用于核实研发细节。

## 用例设计与资产

逐项读取需求澄清、PRD、原型、评审、技术设计和研发计划；按选定范围读取开发交付与真实代码。记录需求编号、验收编号、资产版本/哈希和必要代码基准。

覆盖主流程、异常、边界、权限、状态流转、数据一致性、接口契约、跨仓库集成和受影响回归；性能与安全场景仅据真实需求形成，不自行增加业务规则。每条用例有具体数据与可判定预期。

交付遵循目标仓库已有目录约定；无约定时采用 docs/requirements/<需求编号>/，文件采用需求编号前缀：测试用例.xlsx、测试覆盖矩阵.md、测试问题清单.md。覆盖矩阵保存稳定用例 ID、REQ/AC、来源资产、风险、待确认状态，避免向导入表增加列。

## Excel 模板合同

第一张表 Sheet1 第一行原样保留，下列 11 列顺序不可改变，从第二行填写真实用例，删除模板示例数据，保留使用说明表：

| 列 | 字段 | 规则 |
| --- | --- | --- |
| A | 用例目录 | / 分隔，最多 10 层 |
| B | 用例标题 | 模板红色必填列，非空且清楚描述行为 |
| C | 等级 | 模板红色必填列，P0/P1/P2/P3 |
| D | 前置条件 | 明确角色、状态与数据；未知条件进入问题清单 |
| E | 步骤描述类型 | 每条必须为“步骤”或“文本” |
| F | 步骤描述 | 步骤模式每条以数字+、开头，换行分隔 |
| G | 预期结果 | 步骤模式与 F 的数量、序号逐项对应；文本模式整体描述 |
| H | 标签 | 多标签用中文逗号 ， |
| I | 关联需求 | 当前需求 URL；多个 URL 用英文分号 ; |
| J | 评估工时 | 有依据时写数值小数，无依据留空 |
| K | 执行次数 | 未执行不伪造次数，可留空 |

生成前校验结构化输入，生成后回读 xlsx 核实列顺序、必填、等级、类型、步骤配对、目录层数和 URL；保留样式及等级校验。正式用例步骤、预期非空属于专家质量要求，不冒称模板红色必填规则。

## TAPD 上传

复用需求资产保存与附件上传领域能力，新增仅上传交付的操作，独立于业务状态流转。现有完成阶段操作保持原用途。

上传限定当前账户、当前需求、当前会话产物及项目已配置字段；生成并校验成功后自动上传本次用例和覆盖说明。请求复用 IPC/API 统一路由，凭证只在后端读取，不让专家脚本获取 token。

API 复用 POST /api/conversations/:id/requirement-completion 的 uploadOnly=true 分支，不要求 targetStatus。GET 同一路径返回 testingTask 状态；测试准备可在状态流转工作流不可用时继续，保留 workflowError 提示且不给出流转目标，不能猜测可流转状态。自动首次任务通过既有 /api/prompt → session.continue 链路携带 testingTask（customField、可选 regenerate），后端按会话与实时业务状态原子防重。手动继续任务沿用已保存字段；明确重新生成才重启已完成任务。

只接收最近一次成功 present_files 明确交付的正式 Excel 与覆盖说明；自动上传还要求该交付属于本轮任务。失败或取消的模型任务不上传。上传前回读 Excel 与 immutable 文件 hash；新版本或新字段独立同步，保存可核实上传回执。登录账户变化时中止上传。

按需求、产物哈希、附件字段防重；成功记录可核实的附件返回标识、哈希与状态。失败保留本地产物和错误，可重试；成功响应未收到时不声称已上传。整个自动任务不得修改需求状态。资产版本发生变化时输出新版本并更新覆盖记录，不复用旧版本结论。

## 影响范围

专家包与个人市场注册；requirementStageExpert.ts、RequirementChat.tsx、项目角色说明；需求输入/上下文及交付领域；现有 API/IPC 映射（若新增上传操作则同步 preload、handler、HTTP 路由）；对应专家与交付专项文档。

## 风险与验证

- 市场尚无已核实测试专家身份：先接真实本地注册 ID，不能配置一个未发布身份后声称可自动下载。
- 首次任务重复触发及资产过期：持久化启动键，沿用资产固定版本与哈希。
- 上传与流转耦合：新增只上传操作，保证开发中的 TAPD 状态保持原值。
- 自动任务权限仍由现有会话工具和授权系统决定，不能绕过 MCP 选择和权限钩子。
- 编写状态映射、任务去重、模板校验、只上传防重及失败恢复的回归测试源码；根据 AGENT.md 本次不自动执行测试。
- 允许的默认验证：专家 authoritative validator、脚本语法检查、前后端 TypeScript 检查与 git diff --check。测试、构建/打包和 Windows x64 实际启动检查需用户明确授权，未经验证不声称通过。

## 本次验证记录

- 专家 validate_expert.py 通过；register_expert.py 完成注册；package_expert.py 完成 ZIP 交付。
- 配置脚本与内置生成器 node --check 通过。
- 需求回归测试、会话请求映射测试源码及其领域实现的定向严格 TypeScript 检查通过；未执行测试套件。
- 前后端整体类型检查仍受修改范围之外的既有错误阻断：src/domains/skill/node/store.ts 的 version 字段类型，以及 frontend/src/components/Composer.tsx 的 node/offset 联合类型访问。本次新增及修改文件没有剩余类型错误。
- 未执行应用构建、真实 TAPD 上传、模型自动任务或 Windows x64 构建/启动，不将这些流程描述为已验证通过。
