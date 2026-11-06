# PiCoddy Agent 路由地图

本文件只负责两件事：定义项目级约束，以及把 Agent 路由到正确的专项文档和源码入口。

不要把领域实现细节继续堆入本文件。开始任务前，必须根据下方路由阅读 `docs/` 中对应的专项文档；不能仅凭本文件摘要猜测实现。

## 项目定位

PiCoddy 是基于 Electron、React、TypeScript、Pi Agent 和 SQLite 的本地优先桌面智能体。

核心边界：

- Electron 主进程负责本地能力、HTTP 服务、IPC、数据库和 Agent 运行时。
- React 渲染进程只负责界面与交互，不直接访问 Node.js API。
- 前后端通过 preload 暴露的安全 IPC 通道通信，HTTP 只作为规定场景下的补充链路。
- 领域逻辑优先放在 `src/domains/*`，Agent 编排放在 `src/agent/*`，平台能力放在 `src/platform/*`。

## 强制迭代流程

每次功能新增、缺陷修复、重构、协议调整、依赖变更、配置变更或内置资源变更，必须按以下顺序执行：

1. 阅读本文件，并根据任务路由阅读相关专项文档和源码。
2. 先在 `docs/designs/YYYY-MM-DD-主题-design.md` 编写技术设计文档。
3. 设计文档至少包含：背景、目标、非目标、现状、方案、影响范围、风险和验证方式。
4. 将设计交给用户确认；确认前不得修改代码、配置、测试或资源。
5. 用户确认后直接实施。只有用户明确要求时才另写实施计划。
6. 实施中如出现实质性方案变化，先更新技术设计并再次确认。
7. 完成后执行用户允许的验证，并同步更新受影响的专项文档或索引。

技术设计文档本身是迭代的前置产物，不需要再为“编写设计文档”创建另一份设计。纯文案错别字修正可以直接完成；任何影响产品行为、架构、接口、数据、依赖或资源的修改都必须先设计、后实施。

## 全局约束

### 工作方式

- 当前用户指令优先于项目文档；发生冲突时执行用户当前指令。
- Windows 兼容是所有新增和修改的必要条件：不得引入仅 macOS/Linux 可用的实现；涉及平台差异时必须提供 Windows 分支、降级方案或明确阻断，并在交付前完成 Windows x64 构建/启动相关验证。
- 每次修改禁止使用 `superpowers` / `using-superpowers` 技能。不得加载、激活或遵循该技能；若通用指令要求使用，以本项目约束为准直接完成任务。
- 先阅读现有代码、依赖和专项文档，再决定方案；不要假设项目没有可复用能力。
- 优先选择成熟、持续维护的库；没有明确理由不要自行重写成熟能力。
- 选择满足当前需求的最简单完整实现，不做预防性抽象或多余配置层。
- 架构决策必须可长期维护，不接受明知要推翻的临时方案。
- 组件保持模块化和关注点分离，但不要为尚不存在的复杂度过度拆分。
- 不保留过时兼容层：过时实现直接删除，不新增 migration、fallback 或双轨逻辑，除非用户明确要求。
- 先参考成熟产品和项目现有模式，再引入新交互或新架构。

### 验证与测试

- 禁止自动运行测试套件，只允许语法检查、TypeScript 类型检查和 `git diff --check`。
- 只有用户明确授权运行测试时，才能执行对应测试命令。
- 可以编写或维护回归测试源码，但不得擅自执行。
- 后端和脚本测试统一放在根目录 `test/`，并按源码目录镜像组织。
- `frontend/` 测试保持现有位置，不迁移到根目录。
- 不能在未验证时声称功能已通过、问题已修复或测试已成功。

### Electron、IPC 与后端

- 渲染进程绝对禁止直接使用 Node.js API；只能使用 `window.electronAPI` 暴露的能力。
- 保持 `contextIsolation: true` 和 `nodeIntegration: false`。
- Preload 使用 CJS 格式 `src/electron/preload.cjs`，通过 `contextBridge` 暴露白名单能力。
- 后端使用原生 `node:http`，不引入 Express。
- 不使用 Deno API；Node 原生能力不能满足的 FFI 场景使用项目既定方案。
- 涉及数据库的 IPC handler 必须通过统一 API/领域边界处理，不得在 handler 内直接操作数据库。
- 新增或修改 IPC 路由时，必须同步检查前端路由映射、preload 暴露、主进程 handler 和 HTTP 降级链路。
- 附件上传必须同时写入本地文件和附件数据库记录，否则会话无法构建附件上下文。

### 文件与依赖

- 保留用户已有的未提交修改；不要覆盖、删除或暂存无关文件。
- 文件修改使用精确目标，避免破坏性命令和宽泛递归操作。
- 增加依赖前先检查 `package.json`、锁文件和现有依赖是否已经提供所需能力。
- 生成文件必须通过项目生成脚本更新，不手工修改生成产物。

## 任务文档路由

先确定任务领域，再阅读表中“必读文档”。跨领域任务需要读取所有相关条目。

| 任务领域 | 必读文档 | 何时使用 |
|---|---|---|
| 产品定位与总体架构 | [产品架构与功能设计](docs/02-产品架构与功能设计.md)、[技术架构设计](docs/03-技术架构设计.md) | 新模块、跨层改造、技术选型、总体数据流 |
| Pi Agent 内核 | [Prompt Runtime V2](docs/architecture/prompt-runtime-v2-design.md) | Provider、会话运行时、上下文、工具、提示词、模型调用 |
| Electron、IPC 与 API | [Pi-Agent 与 Electron 前端 IPC 协议](docs/15-Pi-Agent与Electron前端IPC交互协议.md) | 前后端通信、IPC handler、preload、HTTP/SSE、会话消息 |
| 专家系统 | [专家系统架构设计](docs/18-专家系统架构设计.md) | 专家创建、安装、绑定、技能组合、专家会话 |
| 技能安装与更新 | [已安装技能修订与原子更新](docs/11-已安装技能修订与原子更新处理记忆.md) | 内置技能、外部技能、SkillHub、安装、升级、回滚 |
| 技能选择交互 | [UI 与网站技能选择设计](docs/superpowers/specs/2026-08-24-ui-and-website-skill-selection-design.md)、[插件斜杠会话激活设计](docs/superpowers/specs/2026-08-25-plugin-slash-session-activation-design.md) | 新建任务技能、斜杠菜单、会话技能保持与切换 |
| MCP 与会话工具隔离 | [MCP 连接器统一架构设计](docs/19-MCP连接器统一架构设计.md)、[MCP 按需连接与会话工具隔离](docs/12-MCP按需连接与会话工具隔离处理记忆.md)、[插件架构](docs/architecture/plugins.md) | Connector Domain、pi-mcp-adapter、MCP 注册、工具暴露、插件与会话上下文 |
| 受管 CLI 连接器 | [受管 CLI 连接器框架](docs/superpowers/specs/2026-08-25-managed-cli-connector-framework-design.md)、[运行时版本对齐与启动隔离](docs/designs/2026-08-27-managed-cli-runtime-version-alignment-design.md) | 第三方 CLI 下载、安装、授权、凭证、权限、生命周期、子代理和 Electron/Node/npm 运行时锁 |
| PICODDY 动态 MCP | [PICODDY 零售动态 MCP 接入](docs/13-PICODDY零售子应用动态MCP接入处理记忆.md) | 零售业务系统、动态工具发现和 MCP 接入 |
| 文档处理 | [文档处理引擎](docs/04-文档处理引擎.md) | Word、Excel、PPT、PDF 的解析、生成与编辑 |
| 幻灯片技能 | [Open Kimi PPT 内置接入设计](docs/superpowers/specs/2026-08-24-open-kimi-ppt-builtin-integration-design.md) | 内置 PPT 技能、编辑器资源和日常办公入口 |
| 浏览器与文件预览 | [浏览器与文件预览实现参考](docs/14-浏览器与文件预览实现参考.md) | WebContentsView、网页浏览、附件与文件预览 |
| 可视化与交付物 | [Visualizer 可视化引擎](docs/16-Visualizer可视化引擎设计.md)、[交付物展示设计](docs/17-交付物展示设计.md) | Widget、HTML/SVG 可视化、产物面板和预览 |
| OS 自动化与权限 | [OS 自动化与权限](docs/05-OS自动化与权限.md) | Shell、系统操作、权限审批和安全边界 |
| 移动端与远程桌面 | [移动端远程 Agent 与电脑桌面连接设计](docs/designs/2026-08-27-mobile-remote-desktop-connection-design.md) | 设备配对、云端中转、远程会话、WebRTC 屏幕共享与远程控制 |
| Windows 构建与启动 | [Windows MSI 构建与启动](docs/10-Windows-MSI构建与启动处理记忆.md) | Windows 打包、安装、启动和平台差异 |
| 路线图与历史计划 | [MVP 与路线图](docs/06-MVP与路线图.md) | 里程碑、范围判断和历史任务背景 |

更多文档从 [docs/README.md](docs/README.md) 进入。正式迭代设计位于 `docs/designs/`；既有历史设计与计划位于 `docs/superpowers/specs/` 和 `docs/superpowers/plans/`。

## 关键源码入口

| 入口 | 职责 |
|---|---|
| `main.mjs` | Electron 主进程、窗口和本地 HTTP 服务入口 |
| `application.electron.ts` | `handleApi` 统一业务 API 入口 |
| `src/electron/preload.cjs` | 渲染进程安全能力桥接 |
| `src/electron/ipc-handlers.ts` | IPC handler 集中注册与主进程转发 |
| `src/agent/` | Agent、Provider、提示词、专家、技能与工具编排 |
| `src/agent/prompt-runtime/` | 会话提示词与上下文运行时 |
| `src/domains/` | 会话、附件、连接器、技能、设置等领域逻辑 |
| `src/platform/` | 路径、权限、CLI、扩展等平台能力 |
| `src/infra/db.ts` | SQLite 初始化和数据库入口 |
| `frontend/src/api/` | 前端 IPC/HTTP 请求映射 |
| `frontend/src/store/useStore.ts` | Zustand 全局状态和主要会话动作 |
| `frontend/src/components/` | React 界面组件 |
| `resources/builtin-skills/` | 内置技能源资源 |
| `scripts/` | 生成与构建辅助脚本 |

## 常用命令

```bash
# 前端开发服务
cd frontend && npm run dev

# Electron 主进程；主进程代码变更后必须重启
npm run electron:dev

# 主进程与后端静态类型检查
npx tsc --project tsconfig.electron.json --noEmit

# 前端静态类型检查
cd frontend && npx tsc --noEmit -p tsconfig.app.json

# 差异格式检查
git diff --check

# 重新生成内置前端和技能资源
npm run gen:frontend
npm run gen:builtin-skills
```

不要把测试命令作为默认验证步骤。构建、打包或测试只有在用户明确要求或授权后执行。

## 文档维护规则

- `AGENT.md` 只维护稳定的全局约束和路由，不复制专项实现正文。
- 领域行为、接口或架构变化时，更新对应 `docs/` 专项文档。
- 新设计统一进入 `docs/designs/`，文件名使用 `YYYY-MM-DD-主题-design.md`。
- `docs/superpowers/specs/` 和 `docs/superpowers/plans/` 作为既有历史记录保留，不再作为新设计的默认位置。
- 当前已确认设计优先于历史设计；专项文档应描述当前有效架构。
- 文档与代码不一致时，先通过只读检查确认现状，不得凭记忆补写；确认后同步修正文档。
- 新增长期有效的专项文档时，同时更新 `docs/README.md` 和本文件的任务路由。
