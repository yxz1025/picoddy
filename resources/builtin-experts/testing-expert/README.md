# 当前流程说明

当前规则以文末 1.2.0-local.1 及技能正文为准：支持先生成后确认和直接授权启动两个入口；下文旧版本说明仅为变更记录。

# 测试专家

从开发中或开发完成的需求前序资产设计测试用例，生成符合 TAPD 导入模板的 Excel 和验收覆盖矩阵。专家采用 schemaVersion 2 单 Agent 标准；不执行测试，不更改业务状态。

目录包含 .picoddy-plugin/plugin.json、agents/testing-expert.md、agents/references/、skills/test-case-design/、skills/tapd-excel-template/、assets/excel_template.xlsx 和自带 ExcelJS 的 bin/generate-test-cases.cjs。随包资源不依赖创建者 Downloads 路径或目标仓库 npm 依赖。

在支持本次需求接入的 Pi-a 中，自动测试阶段绑定 testing-expert；专家生成并交付产物，只有用户明确发布时宿主才上传 TAPD 需求附件。其他主机需将包安装至 Pi-a 个人专家目录并使用 expert-manager 的 validate_expert.py、register_expert.py 注册；本包尚未发布远端市场。

独立运行：node bin/generate-test-cases.cjs input.json output.xlsx。Electron 运行时设置 ELECTRON_RUN_AS_NODE=1；参考 agents/references/test-case-template-spec.md。

包作者代码与模板来自当前项目；生成器包含 ExcelJS 及其依赖，第三方许可证位于 license/。该程序只生成用例文件，不访问 TAPD token；独立会话没有宿主上传能力时交付文件与明确未上传状态。

## 本地增量：用例确认与直接脚本执行（1.1.1-local.1）

固定流程：所选资产 → 生成并交付用例 → 询问是否启动自动化 → 确认后复用/补齐配置 → 生成或更新脚本 → 执行并分析报告。“只要用例”“先不测试”时停止，不追问配置、不执行。

skills/automation-test-execution 包含真实的 scripts/run-wechat.cjs、scripts/wechat-harness.cjs，以及项目配置和用例模块示例。微信直接使用官方 miniprogram-automator 启动本机开发者工具，Node test 负责顺序、超时与报告；Web/H5/微应用直接运行关联仓库的原生 Playwright 命令。没有 MCP 或客户端专用状态机依赖。

脚本不会自动安装 SDK、浏览器或微信开发者工具。完整参数与运行命令见该技能 references/execution-protocol.md。原 Excel 模板和生成器不变。示例用例未实现会失败，不能作为测试通过证据。

这是已安装市场专家包的本地修改，重新下载安装/更新市场包可能覆盖本地版本。

## 1.2.0-local.1：单端与跨端业务流程

按业务范围选择单端或跨端，端数不由仓库数决定。支持先生成用例再确认执行，以及直接授权启动后补齐配置、生成并执行。增加数据准备/清理、角色隔离、业务 ID 传递与逐场景报告规则。复杂任务可按需委派脚本分析/生成，依赖链统一执行。

新增 references/business-scenarios.md 和 templates/business-scenario.example.json（位于 skills/automation-test-execution/）。这是专家生成业务编排脚本的契约，尚不是通用跨端运行器；实际入口由专家依据关联仓库生成。原单端 run-wechat.cjs、Excel 模板和生成器不变。本次未执行测试、造数或安装依赖。本地包可能被后续市场更新覆盖。
