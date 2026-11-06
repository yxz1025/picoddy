# 测试专家跨设备安装识别修复

## 背景与现状

新设备从专家市场召唤测试专家后，需求开发完成阶段仍提示先安装。RequirementChat 仅调用 `/api/experts/installed`，该接口仅返回 my-experts 个人市场注册包。SkillHub 召唤的包存于 skillhub-experts/packages，作为 catalog 缓存参与完整专家目录，不进入 installed 列表；其 ID 为 namespace--slug，不等于个人包 ID testing-expert。

后端发布入口还硬编码 expertId === testing-expert，并仅从个人市场解析资源，即使修复进入阶段，市场版本仍无法正确获得模板路径或执行发布。

## 目标与非目标

目标：直接从需求进入测试阶段即可自动安装并激活测试专家；已召唤的本地包直接复用，以同一真实 ID 绑定、解析资源和发布。非目标：不按中文展示名猜测专家，不改变 TAPD 状态，不自动生成或上传，不重新下载用户已安装版本。

## 方案

1. 用户已明确测试阶段必须与其他阶段一致：复用 createStageExpertSummoner，已安装则复用，否则查询发布版本、自动下载安装并激活。
2. 已只读核实市场身份为 team-qa/testing-expert，固定运行时 ID 为 team-qa--testing-expert；不按显示名称猜测，不加入个人包优先或歧义选包流程。
3. 将测试专家加入统一 stageExperts 映射，删除 summonTestingExpert 特殊分支，所有阶段使用同一召唤逻辑。
4. 后端模板运行时和明确发布指令使用同一市场 ID；复用现有 SkillHub 缓存校验和路径约束解析包资源，仍校验账户、需求会话与绑定身份。生成任务也提供模板运行时信息。
5. 保留当前生成、修改和明确发布流程。维护首次自动召唤、已安装复用、缓存包解析及缺失包拒绝的回归测试源码。

## 影响范围

测试阶段召唤、专家包解析、需求发布入口及专家系统专项文档；不修改用户已有包或产物。

## 风险与验证

风险：目录专家 available 不一定代表已下载；角色展示名可能重复。以真实本地包和已校验 manifest 为依据。只执行 TypeScript 检查、语法检查及 git diff --check；未经用户授权不运行测试套件。Windows 路径使用现有 platformPaths 和包解析能力，不引入平台特有路径。

## 状态

用户已明确沿用其他阶段自动召唤规则，已完成代码修改。前端 TypeScript 检查和 git diff --check 通过；后端 TypeScript 检查被已有 src/domains/skill/node/store.ts 的 version 字段类型错误阻断，未报告本次改动错误。未运行测试套件、真实设备安装及 Windows x64 构建/启动。
