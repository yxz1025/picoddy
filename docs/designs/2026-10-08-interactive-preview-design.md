# 需求项目：多平台交互预览设计

状态：设计与本轮实现完成，真实平台验收仍有环境限制。本文先于实现编写；具体已验证范围见同目录 `2026-10-08-interactive-preview-verification.md`。

## 1. 目标与使用场景

设计师在 TAPD 需求的设计分析、产品 PRD、设计评审或研发设计阶段，引用已有需求资产、Figma 设计与前端仓库，在真实技术栈中查看可交互原型。H5 使用浏览器，微信小程序使用本机微信开发者工具。业务代码、组件库、路由、构建命令沿用关联仓库；不为统一预览而转成另一种前端。

典型过程：选择需求与阶段 → 关联前端仓库 → 配置预览目标 → 绑定关联仓库当前目录与分支 → 专家在该工作区实现设计与场景 → 启动预览 → 切换场景并体验 → 保存截图和评审说明 → 通过现有资产确认流程交付。

## 2. 现有能力与接入点

| 当前实现 | 本次使用方式 |
| --- | --- |
| `requirement/node/repositories.ts`：本地 Git 仓库关联、范围、分支、commit | 目标引用仓库 ID，启动时重新验证仓库；不修改关联仓库记录 |
| `requirement/node/inputs.ts`：阶段输入选择、固定资产版本 | 运行记录关联启动时的资产 ID/hash；向阶段专家提供设计工作区信息 |
| `requirement/node/assets.ts`：本地资产、版本、确认与 TAPD 同步 | 截图与预览记录先保存为待确认资产，由现有流程确认 |
| `RequirementChat.tsx`：阶段会话与右侧面板 | 添加“交互预览”面板，不增加阶段、不修改 stage key |
| `testing/node/wechat-cli.ts`：CLI 检测 | 直接复用路径检测；不另写安装器 |
| `scripts/testing`：项目自身 Playwright / 微信 Automator | 复用依赖查找模式，预览生命周期独立于测试报告 |
| Pi 原生 MCP 配置与授权 | 设计师已有 Figma MCP 可继续使用；不新建第二套 OAuth/token 管理 |

历史会话、输入快照、测试记录不迁移。新增数据放独立表。未配置预览的需求行为不变。

## 3. 方案选择

1. **统一操作、平台原生运行（采用）**：应用负责配置、工作区、启动、场景、记录；Web 由 Playwright 控制可见浏览器，微信由官方 Automator 控制开发者工具。运行精度高，需本机安装对应运行环境。
2. 全部转换成 H5：易于嵌入，但小程序组件与微信 API 行为不同，无法作为目标平台的交互评审依据，排除。
3. 云端桌面串流：便于分享，但需维护远程机器、账号和图形会话，超出本地桌面项目的本轮范围。

预览使用外部窗口。应用内展示状态、场景、日志及资产；不伪造可嵌入网页的微信模拟器。

## 4. 本轮交付范围

- Web/H5 与微信小程序两种目标；Taro/uni-app 等通过仓库已有构建命令输出对应目标。
- 目标 CRUD、Figma MCP 绑定、可选节点定位与设计版本说明、当前分支绑定、专家上下文和会话交付卡片。
- 可配置命令：工作目录、可执行文件、参数数组；支持 macOS/Windows，不拼接用户输入为任意 shell 文本。
- 可选前置构建命令、可选常驻开发服务；不自动安装依赖，不更改仓库构建配置。
- 默认真实页面预览；可添加仓库内场景模块，切换时创建新的浏览器上下文或重新连接小程序并执行场景准备。
- 启动、停止、场景选择、截图与评审记录保存。启动失败明确说明，不标记为已运行或测试通过。
- 自动化回归与可验证的 Web 场景演示；微信实机与 Windows 原生运行需对应环境，未运行必须明示。

本轮不承诺：Figma 文件全量双向同步、自动创建 Figma OAuth、自动把任意设计转换为无缺陷代码、自动发 PR/合并、自动发布小程序、云端模拟器、真实支付/微信登录验证。Figma 链接是来源引用，不等于已读取设计；专家需通过已授权 MCP 或用户提供的设计资产读取内容。

## 5. 页面交互

右侧“交互预览”面板在需求各有效阶段可打开；目标按创建阶段保存，当前阶段只展示本阶段目标，历史阶段仍可回看。

空态：说明需先关联前端仓库；按钮“添加预览目标”。

目标配置分组：

1. 名称、关联仓库、平台、项目相对目录。
2. Figma MCP 连接器、可选节点定位链接、设计版本/说明（选填，不能包含令牌）。
3. 构建命令与开发服务命令（均为可执行文件 + JSON 参数数组，选填）；现有命令完整保留，由实施者配置一次。
4. Web：本地 HTTP(S) 地址、视口尺寸；小程序：编译输出目录、CLI 路径、页面路由，CLI 可检测。
5. 场景列表：名称、入口、模块相对路径。空模块表示实际数据页面，明确标注“真实页面”；配置模块才称为模拟场景。

保存配置自动验证并绑定关联仓库当前目录和分支，不创建 worktree、不切换分支、不 stash/reset；保留已有修改。后续研发继续使用该分支。分支变化时要求重新关联并保存配置。依赖按仓库原有方式准备。

运行卡片：启动中 / 可交互 / 停止中 / 已停止 / 失败 / 中断；目标、场景、工作区、commit、未提交改动标识、最近日志。运行中禁止改目标配置；重复启动同目标返回已有运行，避免重复占用端口。切换场景采用停止旧运行再启动新运行，防止 Mock 和存储状态串场景。

“保存评审记录”收集截图、说明、设计引用、需求资产版本和代码信息，登记为待确认本地资产。它不会调用 TAPD 状态转换，不把运行状态转为测试 verdict。

## 6. 数据模型

独立表 `requirement_preview_targets(id, space_id, data)` 、`requirement_preview_runs(id, space_id, data)`、交付表和设计读取凭据表。JSON 保存经过校验的结构，space_id 与当前账号检查一致。

PreviewTarget：id、stageKey、name、repositoryId、kind(web/wechat-mini)、projectPath、build/start Command、webUrl、viewport、cliPath、miniProjectPath（相对工作区的编译输出目录）、entryPath、design{server,url,version}、scenarios[{id,name,entryPath,module}]、workspace{path,branch,baseCommit}、revision。

Command：file、args[]。不支持 shell 管道字符串；需要复合步骤时使用仓库现有脚本。

PreviewRun：id、target 的配置快照、account/space 所属关系由表约束、deliveryId、changedSinceDelivery、scenarioId、state、createdAt/updatedAt、workspace、commit、dirty、assetRefs、输出目录、message、有限长度 logs、运行 worker PID（仅内存持有，不作为恢复后杀进程依据）。

启动时冻结目标配置、资产版本和 Git 状态。dirty 记录明确说明不能只靠 commit 重现；记录不声称冻结全部源码。截图时再次读取 Git 状态并标记相较启动时的变化。已提交代码与场景模块随分支交付；不自动提交用户修改。

## 7. 运行时与进程

主进程 service 做所有权、路径、配置校验和状态持久化；独立 Node worker 加载业务仓库依赖和场景模块，避免业务代码进入 Electron 主进程。

主进程 → worker（IPC 控制）→ 可选构建 → 可选开发服务 → 浏览器 / 微信 Automator。

- 构建失败立即失败；开发服务提前退出立即失败。
- Web 启动前检查配置端口未被占用；命令启动后等待 URL 就绪，超时停止本次进程。地址必须为 localhost/127.0.0.1/[::1]，防止将远端页面误认成本地代码。
- 没有开发服务命令时允许连接用户已启动的本地服务，但标记为“外部服务，代码版本未核验”，不推断服务来自所选仓库目录。
- 浏览器使用项目内 `playwright` 或 `@playwright/test` 的 Chromium，创建独立 context，不复用用户日常登录态。H5 使用目标配置的 viewport。
- 小程序先核验 CLI 文件、输出 `project.config.json` 和小程序目录，再通过官方 `miniprogram-automator.launch` 启动。SDK 由工作区已有依赖解析；不另写模拟器协议。首次使用需开发者工具登录、项目权限和 CLI/HTTP 服务端口开启。
- 工作区可能同时被外部工具使用。仅结束本次 worker、常驻命令及本次连接的小程序项目窗口；不执行全局 `killall` 或关闭其他开发者工具项目。
- 停止、父进程断开、登录身份变化时清理。Unix 使用本次进程组；Windows 使用本次 PID 的 taskkill /T；不按进程名杀进程。
- 应用重启后原运行标记中断，不利用持久化 PID 恢复/终止进程，不自动重跑业务脚本。

## 8. 场景模块协议

场景是仓库内 `.cjs` 文件，作为受信任本地代码运行，用户点击启动才执行。路径必须位于设计工作区，拒绝绝对路径、越界与符号链接逃逸。

Web 导出 `setup({ page, context, baseURL })`，在页面导航前注册路由 Mock 等；可导出 `ready({page,context,baseURL})` 在导航后执行点击等演示；可导出 `cleanup()`。复用 Playwright 原生 API，支持请求错误、空列表、延迟等业务数据状态。

微信导出 `setup({ miniProgram })`，在入口 reLaunch 前使用官方 mockWxMethod 注册 Mock；`ready({miniProgram})` 在导航后执行操作；`cleanup()` 恢复 Mock/数据。切换场景关闭本次项目再重新启动；应用不宣称此操作会自动清空所有微信持久化存储，场景作者必须显式准备与恢复需要的存储。

场景脚本失败：本次运行失败并清理；不能退回真实数据场景后显示成功。默认场景不会注入 Mock。涉及支付、摄像头、定位等，只代表模拟结果下的界面行为，正式平台验证仍在测试阶段完成。

## 9. API、权限与上下文

`GET /api/tapd/requirements/:workspaceId/:storyId/preview` 返回目标、最近运行与交付记录；`POST` action：saveTarget、removeTarget、detectWechatCli、start、stop、capture、deliveryDiff。

沿用可信 Electron IPC → `_callApi` → `handleApi`。运行本地命令的接口仅接受可信客户端调用，普通网页 HTTP 不可触发。浏览器开发模式显示“请在桌面客户端使用本地预览”，不悄悄放宽边界。

所有查询与写入校验需求空间属于当前账号；开始每个异步阶段与写回前重新校验登录身份。停止不能用任意 PID；必须使用本需求自己的 runId。

专家上下文追加本阶段预览目标与已创建工作区信息，仅在所选仓库范围内提供。明确要求直接修改所选仓库当前分支，既有修改需保留。Figma 数据和场景描述按需求参考数据处理，不提高其指令权限。

## 10. 验证标准

| 层面 | 必须验证 |
| --- | --- |
| 配置/权限 | 跨账号、跨空间、其他仓库引用拒绝；无效 URL、目录穿越、越界符号链接、非法命令参数拒绝 |
| 工作区 | 直接绑定当前目录和分支；不创建额外 worktree；未提交修改保留；分支变化阻止读取、交付和启动 |
| 生命周期 | 构建失败、端口占用、服务退出、启动超时、重复启动、停止及重启后的中断状态 |
| 场景 | setup 在导航前执行；ready 在导航后；cleanup 在关闭前；失败不报告 ready；切换不复用 Web context |
| 证据 | 截图与运行记录对应同一 target/scenario；保存后为待确认资产；不自动推进 TAPD 或生成测试通过状态 |
| UI | 新建/编辑/取消、空态、错误态、运行态、禁用态；窄面板无横向溢出；切换需求不串数据 |
| Windows | 路径含空格/中文、`.cmd/.bat`、JSON 参数与进程树停止的单元测试；真实 Windows 冒烟记录单列 |
| 回归 | 需求上下文、资产、仓库、阶段会话、现有测试执行；前端构建与后端类型检查 |

实际未安装微信开发者工具或没有可访问 AppID 时，只能完成协议与失败路径测试，不能声称真实小程序预览通过。测试报告必须区分真实运行、受控替身与未验证项目。

## 11. 官方依据

- 微信 CLI（open、pure-simulator、auto、preview）：https://developers.weixin.qq.com/miniprogram/dev/devtools/cli.html
- 微信 Automator 入门：https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/quick-start.html
- 微信 Mock / 截图接口：https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/miniprogram.html
- CI 仅用于编译/上传/二维码预览：https://www.npmjs.com/package/miniprogram-ci
- Figma MCP 与代码关联：https://developers.figma.com/docs/figma-mcp-server/code-connect-integration/


## 12. 实现补充

运行器随应用打包；Windows CI 已加入模块测试。官方 `--pure-simulator` 与 Automator 的组合没有在本轮实现，微信使用 Automator 启动开发者工具窗口。上传与二维码按钮也不在本轮交付内。Web/微信场景示例、依赖准备方法与实际验证限制分别见示例 README 和验证记录。

## 13. 会话驱动的代码交付

用户确认：代码直接写入关联仓库的当前分支，研发继续使用该分支，不创建额外 worktree。保存目标时验证当前分支并绑定真实目录；执行、交付、预览前再次验证，发现分支切换则阻止并提示重新关联。原有未提交修改保留，不 checkout/stash/reset。

会话通过 requirement_preview 工具完成：读取目标配置、按实际仓库配置目标、调用已绑定的 Figma MCP 只读设计工具、登记代码交付。Figma 连接复用已有 MCP/OAuth 配置；节点可以通过引用链接定位，或使用支持桌面选中节点的 MCP。工具清单与参数取自实际连接，不假设存在文件选择 API。读取成功保存来源、参数、内容摘要/哈希和时间，链接本身不算读取证明。

Agent 完成代码后显式登记交付：校验本轮需求输入、所属会话、真实分支和列出的文件，保存文件哈希、需求资产与设计读取凭据，生成待确认设计实现记录。会话结果下面显示交付卡片，关联真实用户消息。普通回复不自动伪造交付。

卡片提供场景选择、启动/重新预览、停止、代码文件清单、交付说明、评审截图入口。启动失败可将包含目标与错误的修复请求填入会话输入框，由用户发送。点击预览只运行代码，不触发代码生成或 TAPD 流转；运行时固定交付 ID 并说明当前目录相较交付可能已修改。代码已交付、预览可交互、阶段已确认分开显示。

## 14. 设计评审阶段自动连接 Figma

进入设计评审会话并完成预览配置加载后，优先使用目标明确绑定的连接器，其次使用会话已选的 Figma，最后在只有一个可识别且启用的 Figma MCP 时自动选用。多个候选、多个绑定、绑定失效时不猜测设计来源，展示选择与管理入口。识别依据为名称、官方 MCP 地址、桌面本地端口或已公开的设计工具；连接后再次确认存在设计上下文工具。

复用现有 mcp.connect 和 Pi MCP OAuth，连接成功才加入当前会话。需要授权时由用户点击“授权连接”；不自动弹出登录页、不读取其他客户端令牌。未配置连接器时引导现有连接器管理，不自动安装服务。新建/编辑预览目标的空 Figma 字段会预选确定的候选，已有绑定保持不变。

自动选择仅在进入阶段、明确绑定改变或用户刷新时执行；用户取消本轮连接器后不会因发送消息或预览轮询立即加回。异步结果校验当前会话，避免切换后将连接器加入其他会话。仅连接不代表已读取设计；节点仍通过目标定位或桌面选中内容确定。

## 15. Figma 连接器入口：桌面模式

连接器页新增 Figma 卡片，通过可信 IPC 原子添加 `figma-desktop`，地址固定为 `http://127.0.0.1:3845/mcp`。保留已有同名配置及其他连接器，不断开已有连接。设计师在 Figma 桌面登录，打开设计文件，在 Dev Mode 开启桌面 MCP；随后点击卡片连接，进入设计评审阶段复用自动选择逻辑。卡片不提供云端授权，也不启动 OAuth。

Figma 云端 MCP 存在，但官方文档明确只支持其客户端目录中的应用，新客户端需要申请。当前项目没有完成云端客户端准入与真实授权验证，因此预设仅开放桌面模式；用户已有的手动 MCP 配置不删除。依据：https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/ 和 https://developers.figma.com/docs/figma-mcp-server/local-server-installation/ 。
