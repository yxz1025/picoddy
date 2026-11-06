# 本地脚本执行：不依赖 MCP

## 微信官方调用链

本技能直接通过普通命令执行工具调用随包 Node 脚本：

测试专家读取资产和仓库 → 生成业务用例模块 → node run-wechat.cjs → 官方 miniprogram-automator → 本机微信开发者工具 → Node test 原始结果、截图与汇总。

微信官方快速开始明确：在项目安装 miniprogram-automator，开启开发者工具 CLI/HTTP 调用，在 Node 脚本中调用 automator.launch({cliPath, projectPath})，然后执行脚本。MCP 不是前置条件，不查找 local_start_test、requirement_testing 等客户端专用工具。

本包提供真实运行文件：
- scripts/run-wechat.cjs：配置/文件检查、输入指纹、启动测试框架、汇总和报告。
- scripts/wechat-harness.cjs：加载仓库 SDK，通过官方 launch 启动项目，逐条执行用例，失败时 screenshot，最后 close。
- templates/wechat.config.example.json：项目配置结构；占位值必须替换。
- templates/wechat.cases.example.cjs：业务模块结构，未实现会失败，不能作为已完成业务用例。

脚本使用 Node 内置 test 框架，不引入自制页面驱动或第三方微信包装层。Node 22+ 是此报告脚本的要求，不是对微信 SDK 最低版本的声称。使用目标项目已安装、锁定版本的 SDK，技能更新不会安装它。开发者工具、登录、项目权限和 CLI/HTTP 开关需已就绪；未就绪报告阻塞。

## 生成项目配置与业务脚本

把配置保存到业务仓库，例如 tests/automation/wechat.json。repositoryRoot 相对于配置文件目录；projectPath、用例 file 相对于 repositoryRoot；cliPath 是当前机器上真实 CLI 绝对路径，Windows 可为 cli.bat。编译型工程 projectPath 指向包含 project.config.json 的构建输出目录，脚本从该文件读取 miniprogramRoot 并检查 app.json 和 AppID。

cases 中每条包含稳定 id、title、acceptanceIds、required、automation。automated 条目必须有实际 .cjs 脚本路径；manual/blocked 保留覆盖缺口。配置示例中的 REPLACE 内容必须根据实际项目替换，不能猜域名、路由、账号或测试数据。

.cjs 文件导出 module.exports.cases = { 'TC-ID': async ({ miniProgram, assert, environment, signal }) => { 真实页面交互和业务断言 } }。miniProgram 是官方 SDK 实例，assert 为 node:assert/strict。先读取真实页面代码，再生成 reLaunch/navigateTo、元素查询、点击、输入和断言；具体 API 以对应官方文档与项目锁定 SDK 为准，不能以仅打开页面代替业务验收。

可选 setup/teardown 接收 {miniProgram, assert, environment}，负责可重复的数据准备与清理；错误应抛出。业务模块不自行 launch/close。异步循环响应 signal；超时后不再继续后续业务操作。执行框架顺序运行，不自动重试；超时后的剩余用例会阻断，避免仍在进行的 SDK 操作与下一条测试交叉。

允许新生成的未提交脚本执行，不要求用户为了测试强制提交或推送；记录实际 Git commit/dirty、脚本 hash、配置 hash 和小程序内容 hash。代码修改仍遵循目标仓库授权。构建内容 hash 不证明源码构建关系或线上部署版本，编译型项目必须先核实构建来源，报告中不能冒充线上验收。

## 调用方法

使用已知 Node 可执行文件和 expertRoot 下的实际脚本路径。下面只展示命令结构，不在读取技能时自动执行。

```text
node "<expertRoot>/skills/automation-test-execution/scripts/run-wechat.cjs" --config "<业务仓库>/tests/automation/wechat.json" --check
node "<expertRoot>/skills/automation-test-execution/scripts/run-wechat.cjs" --config "<业务仓库>/tests/automation/wechat.json" --output "<报告父目录>/<本次新目录>"
```

--check 只检查配置、文件和 SDK 可定位性，不加载 SDK/业务模块、不启动开发者工具，不证明登录或测试已通过。未带 --check 的命令才真实执行，必须符合用户当前测试授权；用户说“先不测试”时不得执行第二条命令。

若宿主提供的运行时是 Electron 可执行文件，按宿主约定设置 ELECTRON_RUN_AS_NODE=1 后使用该 executable；不要假设系统 PATH 上的 node 存在。Windows 使用 PowerShell 调用时，带引号的可执行文件前用 &，参数分别传递；不要拼接未经转义的用户输入。SDK 负责调用 cli/cli.bat，不用自己拼装 shell 启动开发者工具。

报告父目录需要先存在，每次输出子目录必须全新，不能覆盖旧报告，也不能放入实际小程序构建目录。不要用固定 sleep 代替测试框架完成状态。通过命令工具的会话 ID 查询进程输出；中断后读取 status.json，running 但原进程失联时视为未知，不能自动重跑。取消可通过命令工具中断所属运行；强制终止时 cleanup 可能无法完成，需明确记录并检查项目窗口，不杀无关进程。

## 报告与判定

产物为 request.json（输入快照）、status.json、node-test.json（框架原始事件）、summary.json、cleanup.json 和失败时的 TC-ID.png。日志及截图可能包含业务数据，只存到受控本地目录，脱敏后再交付。

summary 中 mini-devtools 只代表开发者工具模拟器；不能宣称真机通过。零执行、全部跳过、缺少必测项、required 人工项、输入变化、清理未知/失败或报告不完整均不能判定整体通过。框架失败、用例失败、用户中断必须区分。失败截图不可用时不能伪造截图，仍保留失败记录。

## Web/H5/微应用

使用业务仓库自己的 Playwright 配置和测试命令，直接运行已安装的 Playwright CLI 或 npm script，不通过 Jenkins/MCP。由测试专家根据 SDD 和实际路由生成原生 Playwright 测试，标题带稳定 [TC-ID]。配置 BASE_URL/ENTRY_URL 或项目已有等价字段，对应 H5 域名、微应用独立地址或主应用挂载入口；实际配置必须读取这些值，不能只设置环境变量却仍测试旧域名。

复用登录/数据 fixtures，开启 JSON/HTML 报告、失败截图和 Trace，输出到本次独立目录。禁止 webServer 自动启动/替换用户指定的远端测试环境。不把微信 runner 用来执行 Web 脚本。未配置部署版本接口时允许页面测试，但报告“未核验部署版本”。

## 官方依据

- [微信快速开始](https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/quick-start.html)：SDK 安装、CLI/HTTP 权限、launch 和 node 执行脚本。
- [Automator API](https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/automator.html)：launch/connect 参数。
- [MiniProgram API](https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/miniprogram.html)：页面导航、模拟器 screenshot、close。
- [Playwright 报告](https://playwright.dev/docs/test-reporters)：Web 原始测试报告。

同一真实项目通过临时目录中的独占锁避免并发执行。正常清理完成才释放锁；中断或清理状态未知时保留锁和报告路径。此时先核实原任务已停止并清理项目，再由用户授权处理残留锁，不能自动偷锁重跑。

## 跨端入口边界

本文件 run-wechat.cjs 是单端执行入口，保持不变。跨端必须按 [业务场景编排](business-scenarios.md) 在关联业务仓库生成统一入口，复用 Playwright 和官方 miniprogram-automator，管理各端会话生命周期、数据准备/清理及步骤依赖。不可用各端独立运行报告拼接冒充全流程。
