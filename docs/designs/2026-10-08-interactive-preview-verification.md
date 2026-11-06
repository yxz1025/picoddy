# 交互预览实现与验证记录

日期：2026-10-08。基线提交：`c2e20f1`。本轮先完成设计文档，再编码；用户要求不使用技能后，后续未使用任何技能或子代理。

## 已实现

- 需求阶段右侧新增“交互预览”面板，配置 Web/H5 与微信目标、设计链接、入口和场景。
- 直接绑定关联仓库当前目录和分支，保留已有修改；不新建 worktree、不切分支、不 stash/reset。读取、交付和预览前验证分支。
- 独立 Node worker 执行配置的构建/服务命令，使用项目依赖中的 Playwright 或微信官方 Automator。
- 场景 setup → 导航 → ready；cleanup 在关闭时执行。切换场景结束旧运行。Web 使用新浏览器上下文；小程序存储由场景显式准备/恢复。
- 所有权隔离、可信 IPC、本地地址与目录约束、端口占用检测、启动超时、服务退出、手动关闭浏览器页面、登录身份变化和退出清理。
- 截图与评审说明保存为待确认资产，关联目标、设计来源、场景、资产版本、代码状态；不自动推进 TAPD，不生成测试通过判定。
- 阶段专家获得所选仓库的预览上下文和 requirement_preview 工具；通过已绑定 MCP 读取 Figma 并保存凭据，登记实际文件哈希和待确认交付资产。旧会话数据不迁移。
- 会话按来源用户消息显示交付卡片，支持点击预览、场景切换、代码差异、评审截图；失败修复请求填入会话输入框，由用户发送。
- 打包文件清单加入运行器；Windows CI 增加预览测试。没有新增应用 npm 依赖或修改 lockfile。

## 自动化结果

| 验证 | 结果 | 实际执行范围 |
| --- | --- | --- |
| 预览 store/workspace/context | 4/4 通过 | 真实临时 Git 仓库、SQLite；越界、跨账号、当前分支绑定及切换阻止、活动运行超过历史上限仍保留 |
| authoring | 2/2 通过 | 临时真实 Git、SQLite；MCP 协议替身调用，读取凭据与当前轮次绑定，未读取禁止交付，设计范围、连接器、分支检查和代码差异；登记不会启动预览 |
| service 集成 | 1/1 通过 | 真实 worker 子进程、IPC、截图归档、重复启动、切换场景、退出登录清理；SDK 为明确标记的协议替身 |
| runtime | 8/8 通过 | Windows 命令生成、场景时序、失败清理、端口占用、构建失败、页面关闭、微信 SDK 协议、路径逃逸 |
| 真实 Chromium H5 | 1/1 通过 | 临时本地订单页，Mock 空列表→点击重试→恢复订单→真实 PNG 截图；新场景恢复真实数据 |
| React 面板与交付卡片 | 通过 | 真实浏览器加载组件，隔离 IPC 替身；面板新建、当前分支显示、启动、截图、失败、停止、CLI 检测、取消编辑；交付卡片手动启动、切换场景带交付 ID、差异和失败填回请求；330px 无横向溢出 |
| 前端构建 | 通过 | `npm run build:frontend`；现有大 chunk 提示仍存在 |
| 后端类型检查 | 通过 | `npx tsc --project tsconfig.electron.json --noEmit` |
| JavaScript 与差异检查 | 通过 | `node --check` 检查主入口与 worker；`git diff --check` |

新增自动化共 **16 项通过**；UI 操作检查单独统计，未把替身测试算作真实 Figma 或微信验证。

## 既有回归结果

覆盖 requirement 的 assets、context、store、delivery、repositories，共 24 项，22 项通过、2 项失败。两处失败均用 `git show HEAD:...` 提取的修改前模块独立复现：

1. `context.test.ts` 仍期待“架构设计”文本，基线模块已经显示“研发设计”。修改前后同样失败。
2. `repositories.test.ts` 的多仓库用例调用已停用的 `stage:软件开发`；基线输入模块同样抛出“需求阶段无效”。

本轮没有为使这些旧用例通过而恢复停用阶段或改动现有阶段名称。上述问题需要单独更新测试预期。

## 未完成的真实环境验证

- 本机检测到 `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`。官方 `cli islogin` 实际返回 `{"login":false}`。因此未进行带真实项目权限的小程序启动、Mock、交互与截图验收；需先登录工具并提供可用项目/SDK。
- 当前是 macOS。Windows 命令构造用例已通过，并接入 Windows CI，但本轮未运行真实 Windows CI/安装包，也未在 Windows 机器启动开发者工具。
- 真实浏览器测试使用受控演示仓库与本地服务，并非已验证用户每一个前端仓库。每个目标需要配置它自己的构建命令、依赖、入口和业务场景。
- 没有执行使用真实账号的 Figma 读取、OAuth 或真实需求的完整设计到代码生成。已实现原生 MCP 调用与读取凭据、交付约束，并以明确的 MCP 替身验证；真实账号与节点仍需端到端验收。人工版本说明不等同于 Figma revision。
- 未进行整个 Electron 安装包构建与重新安装。本次修改 IPC 与主进程后，需要重启开发客户端才会启用新接口。

## 检查证据（本机临时文件）

- `/private/tmp/preview-v2-all.log`
- `/private/tmp/preview-v2-runtime.log`
- `/private/tmp/preview-v2-browser.log`
- `/private/tmp/preview-regression.log`
- `/private/tmp/preview-repositories-regression.log`
- `/private/tmp/preview-baseline-repositories.log`
- `/private/tmp/preview-v2-build.log`
- `/private/tmp/preview-v2-type.log`
- `/private/tmp/interactive-preview-h5.png`
- `/private/tmp/interactive-preview-ui.png`
- `/private/tmp/interactive-preview-card.png`
- 浏览器操作脚本：`/private/tmp/preview-ui-test.mjs`、`/private/tmp/preview-card-ui.mjs`。使用隔离 IPC 替身，并非完整 Electron 端到端验收。

## 使用入口

重启桌面客户端 → 项目 → 打开 TAPD 需求 → 选择设计阶段 → 右侧“交互预览”。

首次配置与场景示例见 [`../examples/interactive-preview/README.md`](../examples/interactive-preview/README.md)。本轮没有提交 Git、推送、合并、发布小程序或改变真实 TAPD 状态。

## 自动选择 Figma 补充验证

- 新增选择规则测试 2/2 通过：唯一候选、已有绑定优先、多个候选、失效/禁用绑定、官方地址及实际工具识别。
- 浏览器组件检查通过（模拟 MCP 响应）：自动连接并选入会话、保留手动取消、多连接器手选、绑定优先、需要授权时不自动登录、点击授权后连接、异步返回不污染其他会话。
- 前端类型检查和生产构建通过，差异检查通过。选择规则测试已加入 Windows CI；本次代码不含平台专用 API，未实际执行 Windows CI。
- 证据：`/private/tmp/figma-auto-ui.mjs`、`/private/tmp/figma-auto-build.log`。没有执行真实 Figma 账号授权或设计读取。

## Figma 桌面连接器卡片验证

- 配置与自动选择测试 4/4 通过：固定桌面入口、拒绝云端预设、并发添加、其他连接器保留、同名冲突、禁用及已有参数保留。
- 浏览器组件验证通过：添加桌面连接器、检查连接、没有 OAuth 入口、连接失败提示、同名配置保护、搜索、360px 布局。使用模拟 MCP 响应，未连接真实 Figma。
- 前端生产构建与后端类型检查通过；未执行 Windows 原生运行。使用跨平台 HTTP MCP，无平台专用命令。
- 证据：`/private/tmp/figma-card-ui.mjs`、`/private/tmp/figma-connector-card.png`、`/private/tmp/figma-card-build.log`、`/private/tmp/figma-card-type.log`。

## 连接器卡片与详情弹窗

按最新交互要求，卡片统一为 144px，取消卡片内部滚动，简介两行省略、状态一行省略，右上角统一加号。点击卡片展示完整说明与操作弹窗。TAPD 过期时加号执行带原 grantId 的重新授权；已有账号管理与授权确认保留在详情中。Figma 连接使用桌面模式，GitLab/Jenkins 保留已有配置表单。

本地浏览器模拟接口验证通过：五张卡片等高且无内部滚动、仅打开详情不触发连接、TAPD 过期重新授权与确认、Figma 添加并连接、配置表单不叠加两个弹窗、窄屏与 Escape 关闭。前端类型检查与生产构建通过。证据：`/private/tmp/connector-detail-ui.mjs`、`/private/tmp/connector-detail-modal.png`、`/private/tmp/connectors-detail-grid.png`、`/private/tmp/connector-detail-build.log`。没有触发真实 TAPD 授权或连接真实 Figma。
