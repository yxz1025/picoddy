# PiCoddy-a 桌面智能体设计与架构文档

> 基于 **Pi Agent 引擎** + **Electron** 打造的 AI 原生桌面工作台。
> 目标：打造一款**极简、可靠、具备本地 OS 动手能力、不绑定特定生态**的中文个人 AI 助理。

---

## 目录与设计文档索引

发布工具：[本地构建后手动上传](./designs/2026-10-26-release-manual-upload-design.md)（已实施；未运行测试）。

需求资产上下文：[资产清单、按需读取与当前历史去重](./designs/2026-10-26-requirement-asset-context-design.md)（借鉴 Codex 上下文状态比较；源码实现，不运行测试）。

Agent 性能：[74 分钟编码耗时调查](./2026-10-23-requirement-coding-latency-investigation.md) · [逐项优化设计与实施边界](./designs/2026-10-23-agent-coding-latency-design.md)（源码已修改；用户要求暂不运行测试）。

需求工作台最新方案：[四阶段需求交付与测试专家详细设计](./designs/2026-09-16-four-stage-delivery-testing-design.md)（产品设计 → 研发实现 → 测试验收 → 发布；详细设计草案，尚未实施）。

代码知识库方案：[多仓库代码知识库远程部署与 MCP 查询设计](./designs/2026-09-20-infigraph-remote-code-knowledge-design.md)（Infigraph + Neo4j/Postgres + 内置 webhook；评审草案，尚未实施）。

构建与运维：[自动更新构建、发布与升级手册](./自动更新构建与发布升级手册.md) · [更新操作速查](./remote-update-operations.md)

| # | 文档 | 核心解答的问题 |
|---|------|----------------|
| 01 | [市场调研与产品定位](./01-市场调研与产品定位.md) | 市场现状、痛点分析、产品定位与差异化优势 |
| 02 | [产品架构与功能设计](./02-产品架构与功能设计.md) | PiCoddy-a 的整体产品架构、模块划分与用户交互流 |
| 03 | [技术架构设计](./03-技术架构设计.md) | Electron 主进程 + IPC 通信 + node:http + Pi Agent + SQLite 的整体技术架构 |
| 04 | [文档处理引擎](./04-文档处理引擎.md) | Word / Excel / PPT / PDF 的本地解析、生成与编辑实现 |
| 05 | [OS 自动化与权限](./05-OS自动化与权限.md) | 系统指令操控、安全沙箱机制与多级审批模型 |
| 06 | [MVP 与路线图](./06-MVP与路线图.md) | 功能阶段规划、里程碑与风险评估 |
| 07 | [Deno Desktop Spike 验证](./07-deno-desktop-spike验证.md) | 早期 Deno Desktop 技术验证（已废弃，保留作为历史参考） |
| 09 | [Deno 无标题栏方案调研](./09-deno无标题栏方案调研.md) | Deno Desktop 窗口定制调研（已废弃，保留作为历史参考） |
| 10 | [Windows MSI 构建与启动处理记忆](./10-Windows-MSI构建与启动处理记忆.md) | Windows 平台打包和安装流程处理 |
| 11 | [已安装技能修订与原子更新处理记忆](./11-已安装技能修订与原子更新处理记忆.md) | Skill 安装和更新机制 |
| 12 | [MCP 按需连接与会话工具隔离处理记忆](./12-MCP按需连接与会话工具隔离处理记忆.md) | MCP 连接管理和会话级工具隔离 |
| 13 | [PICODDY 零售子应用动态 MCP 接入处理记忆](./13-PICODDY零售子应用动态MCP接入处理记忆.md) | PICODDY 零售系统 MCP 集成方案 |
| 14 | [浏览器与文件预览实现参考](./14-浏览器与文件预览实现参考.md) | 内置浏览器（WebContentsView）和文件预览的架构实现 |
| 15 | [Pi-Agent与Electron前端IPC交互协议](./15-Pi-Agent与Electron前端IPC交互协议.md) | 78+ IPC handlers 路由表、client.ts 正则匹配、SSE 桥接 |
| 16 | [Visualizer 可视化引擎设计](./16-Visualizer可视化引擎设计.md) | read_me/show_widget 两工具协议、SVG/HTML widget 流式注入、主题感知与安全渲染 |
| 17 | [受管 CLI 连接器框架设计](./superpowers/specs/2026-08-25-managed-cli-connector-framework-design.md) | 通用第三方 CLI 安装、授权、权限、子代理和生命周期框架，钉钉为首个适配器 |
| 18 | [受管 CLI 连接器实施计划](./superpowers/plans/2026-08-25-managed-cli-connector-framework.md) | 按 TDD 拆分连接器协议、运行时、授权、命令安全、子代理、IPC、UI 和打包验收 |
| 19 | [移动端远程 Agent 与电脑桌面连接设计](./designs/2026-08-27-mobile-remote-desktop-connection-design.md) | 移动端 PWA、设备配对、云端中转、远程 Agent、WebRTC 桌面查看与安全控制 |
| 20 | [受管 CLI 运行时版本对齐与启动隔离设计](./designs/2026-08-27-managed-cli-runtime-version-alignment-design.md) | Electron/Node/npm 运行时锁单一来源、版本升级对齐和连接器启动失败隔离 |
| 21 | [macOS 构建、ASAR 与签名分层设计](./designs/2026-08-27-macos-build-packaging-and-signing-design.md) | macOS 产物路径统一、ASAR 外置边界、本地无签名构建与正式签名发布分层 |
| 22 | [打包客户端启动加载动效设计](./designs/2026-08-28-packaged-client-startup-loading-design.md) | 主窗口两阶段导航、内置 Orb 启动页、IPC 就绪顺序和启动失败反馈 |
| 23 | [打包客户端连接器注册表与受管 CLI 真实资源设计](./designs/2026-08-28-packaged-connector-registry-resources-design.md) | 连接器描述文件与受管 npm 使用 ASAR 外真实路径，并保持文件身份和运行时安全校验 |
| 24 | [内联解释器脚本沙箱误报修复设计](./designs/2026-08-28-inline-interpreter-sandbox-false-positive-design.md) | 区分纯内存方法与真实文件系统写入 API，消除 Python 数据分析脚本误报并保留受保护路径硬拒绝 |
| 25 | [PowerShell 只读管道沙箱误报修复设计](./designs/2026-08-31-powershell-readonly-pipeline-sandbox-design.md) | 允许 PowerShell 只读附件分析管道，同时保持应用管理目录写入和动态写目标硬拒绝 |
| 26 | [微应用创建完成模式类型修复设计](./designs/2026-09-01-microapp-created-mode-type-fix-design.md) | 补齐微应用创建成功状态的联合类型，使前端类型检查与现有成功页状态机一致 |
| 27 | [write_xlsx 参数完整性与自动纠正展示设计](./designs/2026-09-01-write-xlsx-validation-recovery-design.md) | 强化 Excel 工具必填参数约束，并将紧邻重试成功的校验失败展示为已自动纠正 |
| 28 | [输入框附件标签尾部空白、光标稳定性与可输入性优化设计](./designs/2026-09-01-attachment-token-trailing-space-design.md) | 删除按钮显隐不改变布局，并通过真实零宽锚点恢复附件后的正常光标和键盘输入 |
| 29 | [折叠侧边栏标题缩进与导航间距优化设计](./designs/2026-09-01-collapsed-sidebar-layout-design.md) | 统一折叠态展开入口，让标题随侧栏收回，并规范窄轨导航图标尺寸与间距 |
| 30 | [Windows 原生菜单栏恢复设计（已取代）](./designs/2026-09-01-windows-native-menu-restoration-design.md) | 曾恢复标题栏下方的原生菜单，现由单行 Window Controls Overlay 方案取代 |
| 31 | [Windows 标题栏 Logo 与菜单同行设计](./designs/2026-09-01-windows-titlebar-inline-menu-design.md) | 使用 Window Controls Overlay 将品牌与菜单合并为单行，并保留 Windows 原生窗口按钮 |
| 32 | [XLSX 读取工具名误调用与恢复展示设计](./designs/2026-09-09-xlsx-read-tool-name-recovery-design.md) | 强化 `read_doc` 统一入口，并将同路径成功恢复的 `read_xlsx` 未知工具错误展示为已自动纠正 |
| 33 | [需求测试专家与 TAPD 用例交付设计](./designs/2026-09-17-testing-expert-design.md) | 开发中/开发完成自动唤起测试专家，按前序资产生成模板 Excel 与覆盖矩阵，校验后上传需求附件 |

---

## 核心架构判断

> **自然语言操控电脑 + 本地文档自动化 + 智能代理** 需求真实且切中用户痛点。
> PiCoddy-a 采用 **Electron（主进程 + IPC 通信）+ Pi Agent 引擎 + 原生 Node.js HTTP 服务 + 本地开源文档栈** 的选型，核心优势在于：
> 1. **架构清晰**：主进程/渲染进程严格分离，preload + IPC 桥接，`handleApi()` 统一业务入口，Pi Agent 直跑在 Node.js runtime。
> 2. **模型自由**：原生覆盖 DeepSeek、OpenAI 等多主流模型，通过 pi 的 provider 机制不锁死单一厂商。
> 3. **本地优先与开源轻量**：核心能力本地自治、隐私优先，拥有极高的启动与响应速度。

---

## 技术选型概览

| 层级 | 选型 | 理由与优势 |
|---|------|---|
| **桌面框架** | **Electron 43** | 成熟稳定、跨平台（macOS/Windows）、完整原生 API（Tray/Dock/快捷键）、丰富生态 |
| **Agent 内核** | **Pi Agent Engine** (`pi-agent-core` + `pi-ai` + `pi-coding-agent`) | 极简架构、中文大模型覆盖全面、原生钩子拦截 |
| **进程通信** | **Preload + IPC（ipcMain.handle / ipcRenderer.invoke）** | 主进程/渲染进程严格分离，`contextIsolation: true`，禁止渲染进程使用 Node.js |
| **后端 API** | **原生 node:http + handleApi() 统一路由** | 主进程内嵌 HTTP 服务器（8000 端口），前端通过 IPC 优先调用；所有领域 CRUD 经 `handleApi` 统一处理 |
| **数据库** | **node:sqlite（Node 22 内置）** | 无需额外原生依赖，SQLite 同步 API，WAL 模式 |
| **文档处理引擎** | **开源文档栈** (`docx` / `exceljs` / `pptxgenjs` / `pdfjs-dist` / `mammoth`) | 本地解析与生成，无需依赖外部付费 API |
| **OS 自动化** | **Node.js Subprocess + 平台 API** | 安全执行 Shell 指令与操作系统级能力编排 |
| **前端框架** | **React 19 + TypeScript + Vite + Zustand** | 现代设计系统、组件化架构、HMR 开发体验 |
| **构建与打包** | **electron-builder** | 跨平台打包（macOS DMG/ZIP、Windows MSI） |

小模型工具发现：[移除关键词裁剪，保留专家技能](./designs/2026-10-26-native-tool-discovery-design.md)。

- [通用部署配置与凭据存储清理](designs/2026-11-03-neutral-config-and-secret-storage-design.md)：公司标识清理、显式部署配置与 MCP 加密存储。
