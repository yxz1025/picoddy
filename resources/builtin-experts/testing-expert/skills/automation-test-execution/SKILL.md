---
name: automation-test-execution
description: Generate or update runnable Web, H5, microfrontend and WeChat Mini Program tests from selected requirement/SDD assets and associated repositories, support single-target and cross-target business scenarios, obtain execution authorization unless the user already requested execution, prepare and clean up test data, and execute local scripts using the official WeChat SDK or native Playwright, and analyze original reports.
description_zh: "基于资产生成单端或跨端业务用例，获授权后准备数据、统一执行并反馈结果"
license: MIT
metadata:
  category: testing
  version: "1.2.0"
---

# 自动化脚本生成与本地执行

本技能承担测试方法和流程编排。客户端提供资产、关联仓库与普通命令工具，技能随包脚本直接调用微信官方 SDK，Web 使用项目原生 Playwright；不依赖客户端专用测试阶段、部署按钮或内置测试状态机。既可用于需求会话，也可用于用户已明确资产和仓库的独立专家会话。

## 测试范围与交互流程

先按业务范围确定单端或跨端；端与仓库可多对多关联，不能通过仓库数量机械判断。一个端默认该端覆盖；跨端须明确业务链路、各端入口和角色。详细遵循 [业务场景编排](references/business-scenarios.md)，配置参考 [项目配置](references/project-config.md)。

- **先生成用例**：读取资产 → 明确覆盖范围 → 生成交付用例 → 询问是否执行 → 用户确认 → 补齐目标/数据配置 → 生成脚本 → 准备数据 → 执行 → 清理 → 反馈。
- **直接启动测试**：用户已明确授权本轮执行 → 补齐范围、各端入口和数据条件 → 生成用例及脚本 → 准备数据 → 执行 → 清理 → 反馈；不重复询问启动。
- 明确“只生成”“先不测试”时不执行测试或造数。纯用例设计可以列出缺失执行配置，不强迫先提供域名/登录态。只要求脚本也不等于授权执行。
- 配置优先复用，集中询问缺项；不会因处于自动测试阶段、安装技能或等待超时而默认授权。额外安装、部署、数据库写入不隐含在测试请求中。
- 用户暂停/取消时停止新步骤，只中断本轮所属命令，记录中断和清理状态。

工作记录按需使用 cases_ready、awaiting_confirmation、configuring、scripts_ready、preparing_data、running、cleaning、finished/blocked/interrupted。直接启动路径无需 awaiting_confirmation；这些是专家工作记录，不依赖客户端状态机。

## 1. 读取真实基线

读取所选需求、PRD、SDD、验收标准、研发交付资产。需求会话优先使用 inputs.assets 的固定版本和 path；截断内容继续读原文。记录来源 ID/hash 或本地文件路径/hash，不编造资产 ID。读取 inputs.repositories 中选中的仓库和 scope，核对实际路由、组件、接口、已有测试、项目规范、Git 分支/提交和工作区变更。仓库没有被关联或授权时不能搜索任意用户目录寻找替代项目。

产品验收标准决定预期；源码用于确认定位、调用方式和影响范围，不能把当前错误实现当作正确规则。关联仓库不代表测试地址、账号和数据已知。缺少源码时可设计业务用例，但不能声称已生成可运行的页面脚本。

## 2. 形成用例与可执行脚本

建立 REQ/AC → TC-ID → 脚本 → 运行结果的映射。每条用例包含来源、前提、数据、步骤、真实断言、必测标记和自动化状态（automated/manual/blocked）。业务规则不明确时标记问题，不用空断言、固定 true、skip 或 mock 掉被测业务来伪造覆盖。

优先复用仓库现有测试组织方式和稳定定位约定。业务脚本保存在关联仓库，不存到专家技能目录；报告写入独立产物目录，不污染源码。需要 Excel 时仍使用 tapd-excel-template，追溯字段保留在矩阵，不能修改其 11 列格式。Excel 是配套产物，不是执行器输入的唯一来源。

读取 [项目配置](references/project-config.md) 与 [执行协议](references/execution-protocol.md)，选择目标类型：

- **Web/H5/微应用**：本地 Playwright。使用项目已确认的测试域名和入口路径；微应用区分独立入口与主应用挂载入口。结合实际路由编写导航、交互和业务断言，保留真实后端集成；认证测试可使用专用账号和已有 fixtures。
- **微信小程序**：官方 miniprogram-automator 控制本机微信开发者工具。根据实际页面路由和组件生成脚本。项目路径必须指向开发者工具可打开的目录；编译型工程先明确构建命令与输出目录。开发者工具结果标为模拟器验证，不能替代真机能力验证。

登录态、测试账号和数据来源使用项目既有安全机制，不把密码、token 或 storageState 正文写进技能、报告、聊天或 Git。setup/teardown 要可重复，清理失败须报告。依赖缺失时说明具体缺项；安装、升级、提交/推送和构建遵循本次用户授权及仓库规范，不能静默更改环境或提交无关代码。

## 3. 获授权后补齐配置并启动场景

获得本轮执行授权（用例交付后确认或用户直接要求启动）后，核对已有项目配置，补齐实际目标、依赖/浏览器或开发者工具、登录与测试数据。缺失项先一次性列明，等待必要信息；不得用假值继续。用户只要用例时不进入此步骤。

微信小程序使用本技能的 scripts/run-wechat.cjs；它通过官方 miniprogram-automator.launch({cliPath, projectPath}) 启动开发者工具，以 Node test 运行真实业务用例，最后调用 miniProgram.close()。不是只有技能说明，也不需要 MCP。根据 [执行协议](references/execution-protocol.md) 的实际命令调用；--check 仅检查文件，正式命令才运行测试。SDK 从业务仓库依赖加载，不安装到客户端或由技能静默下载。

Web/H5/微应用直接运行业务项目原生 Playwright 配置与命令，使用真实测试域名和入口。项目未部署就绪时列为环境阻塞，不自动发起 Jenkins；测试不读取 Jenkins 报告。

单端一次运行整套已选脚本，由框架管理断言、超时和报告。跨端按业务场景编排参考生成关联仓库内的统一入口，顺序执行有依赖步骤并传递真实业务 ID；run-wechat.cjs 不是跨端执行器。记录命令会话 ID、报告目录、用例/脚本版本和本次 runId。中断后先读取已有状态和报告，未知不能重启或假定成功。停止只作用于当前任务，不杀无关进程。

## 4. 核验报告与闭环

以原始框架报告为准，核对请求、脚本版本、目标域名/入口或小程序项目、运行模式和逐条 TC-ID。Web 没有版本接口时允许页面测试，但明确“未核验部署版本”，不得用脚本 SHA 代替已部署业务版本。仅缺少版本接口不应阻塞普通页面测试。

区分 passed、failed、skipped、blocked、not_run、flaky。零执行、全部跳过、必测项缺失、清理失败、报告无效和重试后通过均不能笼统宣布全量通过。报告不完整时明确仍在执行、未知或阻塞；不能凭进程启动、退出码、构建成功或 AI 总结独立认定测试通过。

交付执行摘要、覆盖矩阵、逐条结果、原始报告及失败截图/Trace 路径。跨端按 SC-ID 展示各端步骤、业务 ID、依赖阻塞、数据准备和清理结果；单端通过不得宣称全流程通过。区分业务缺陷、脚本错误、环境/登录/数据问题，并附具体证据；自动截图/日志脱敏，敏感原件只保留在受控本地目录。未经授权不修改业务代码、不创建远端缺陷或重新部署。脚本修复和复测必须保留前一次失败证据。

## 5. 改动后的回归

对比上次已测版本、本次 SDD 版本与真实 Git diff，更新受影响用例和脚本；执行受影响项及关键主流程回归，而不是只重跑失败项。共享组件、权限、路由、接口契约或构建配置变更需要扩大回归范围；无法可靠判断影响时说明原因并运行已授权范围内的完整相关测试包。记录本次选择依据，不能沿用旧版本通过结论。
