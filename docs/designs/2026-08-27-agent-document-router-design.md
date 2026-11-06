# AGENT.md 文档路由地图改造设计

## 1. 背景

当前 `AGENT.md` 同时承载技术栈、目录结构、架构细节、调用链、开发命令和项目约束。内容重复且篇幅持续增长，Agent 很难快速判断“当前任务应该先读哪份专项文档”，也容易把根文档中的摘要误当成完整实现依据。

本次改造将 `AGENT.md` 定位为项目级路由地图和约束入口。详细架构、领域知识、协议和历史决策继续由 `docs/` 下的专项文档维护。

## 2. 目标

- `AGENT.md` 只保存项目定位、全局约束、强制工作流和导航信息。
- Agent 能根据任务类型定位必须阅读的专项文档和关键源码入口。
- 每次迭代在修改代码、配置或资源前，必须先产出技术设计文档。
- 避免在 `AGENT.md` 重复专项文档中的详细实现，防止多份事实来源产生冲突。

## 3. 非目标

- 本次不重写 `docs/` 中已有专项文档的正文。
- 本次不调整应用代码、目录结构或运行时行为。
- 本次不把所有按日期生成的设计和计划逐条展开到 `AGENT.md`。

## 4. AGENT.md 信息架构

`AGENT.md` 按以下顺序组织：

1. **项目定位**：一句话说明产品、主要运行环境和核心技术边界。
2. **全局约束**：集中列出任何任务都必须遵守的不可违反规则。
3. **强制迭代流程**：规定技术设计、确认、实施、验证和文档同步顺序。
4. **任务路由表**：按领域把任务映射到 `docs/` 专项文档和源码入口。
5. **代码入口地图**：仅列最关键的入口文件及职责，不展开实现细节。
6. **常用命令**：只保留启动和静态语法/类型检查命令。
7. **文档使用原则**：明确专项文档优先级、冲突处理和更新责任。

## 5. 强制迭代流程

所有功能新增、缺陷修复、重构、协议调整、依赖变更、配置变更和内置资源变更，都必须遵循：

1. 阅读 `AGENT.md`，根据任务路由找到并阅读相关专项文档。
2. 在 `docs/designs/YYYY-MM-DD-主题-design.md` 输出本次技术设计。
3. 技术设计至少包含背景、目标、非目标、现状、方案、影响范围、风险和验证方式。
4. 在用户确认技术设计前，不得修改代码、配置、测试或资源文件。
5. 设计确认后再实施；如实施中发生实质性方案变化，先更新设计并重新确认。
6. 完成后按用户约束执行验证，并同步更新受影响的专项文档或索引。

技术设计文档本身就是迭代的前置产物，因此“先写设计”规则不会形成递归。纯文案错别字修正可以直接完成；只要会影响产品行为、架构、接口、数据、依赖或资源，就必须先写设计。

## 6. 任务路由

`AGENT.md` 使用按任务类型组织的路由表，不复制专项文档正文。首版至少覆盖：

| 任务领域 | 必读文档 | 主要源码入口 |
|---|---|---|
| 产品与总体架构 | `docs/02-产品架构与功能设计.md`、`docs/03-技术架构设计.md` | `main.mjs`、`application.electron.ts` |
| Pi Agent 与会话运行时 | `docs/01-Agent框架实现逆向.md`、`docs/architecture/prompt-runtime-v2-design.md` | `src/agent/` |
| Electron、IPC 与前端通信 | `docs/15-Pi-Agent与Electron前端IPC交互协议.md` | `src/electron/`、`frontend/src/api/` |
| 专家系统 | `docs/18-专家系统架构设计.md` | `src/agent/experts/`、`src/domains/session/node/expert_binding_store.ts`、`frontend/src/components/` |
| 技能安装与更新 | `docs/11-已安装技能修订与原子更新处理记忆.md` | `src/domains/skillhub/node/`、`src/agent/builtin_skills/` |
| MCP 与连接器 | `docs/12-MCP按需连接与会话工具隔离处理记忆.md`、`docs/superpowers/specs/2026-08-25-managed-cli-connector-framework-design.md` | `src/agent/mcp.ts`、`src/domains/connector/node/`、`src/agent/tools/connector_*.ts` |
| 文档处理 | `docs/04-文档处理引擎.md` | `src/agent/tools/`、`frontend/src/components/documentProcessingModel.ts` |
| 浏览器、预览与可视化 | `docs/14-浏览器与文件预览实现参考.md`、`docs/16-Visualizer可视化引擎设计.md`、`docs/17-交付物展示设计.md` | `src/electron/browser-view-manager.ts`、`src/domains/preview/node/`、`frontend/src/components/previews/` |
| OS 自动化与权限 | `docs/05-OS自动化与权限.md` | 平台、权限与工具执行模块 |
| 构建与 Windows | `docs/10-Windows-MSI构建与启动处理记忆.md` | `electron-builder.yml`、构建脚本 |

日期型设计和实施记录不在根路由逐条枚举。`AGENT.md` 只提供 `docs/designs/`、`docs/superpowers/specs/` 和 `docs/superpowers/plans/` 的分类入口；具体历史记录由目录和 `docs/README.md` 管理。

## 7. 全局约束保留策略

现有 `AGENT.md` 中真正跨领域的规则继续保留，包括：

- Electron 渲染进程不得直接使用 Node.js API。
- 后端使用原生 `node:http`，不引入 Express 或 Deno API。
- 涉及数据库的 IPC 必须通过统一 API/领域边界处理。
- 新增 IPC 路由时同步更新前端路由和 preload 暴露。
- 附件上传必须同时落盘并写入数据库。
- 不保留过时兼容层，不做预防性抽象。
- 优先复用成熟依赖和项目已有能力。
- 后端测试文件位于根目录 `test/` 并镜像源码结构，前端测试保留现有位置。
- 按当前用户要求，不自动执行测试套件，只执行语法、类型和差异格式检查，除非用户后续明确授权运行测试。

领域专属规则不再在根文档展开，而是链接到对应专项文档。

## 8. 文档优先级与冲突处理

- 用户当前指令优先于项目文档。
- `AGENT.md` 负责全局约束和路由，不作为领域实现细节的唯一依据。
- 专项文档负责该领域的完整设计、协议和决策。
- 当前已确认的技术设计优先于历史设计记录。
- 文档与代码不一致时，不得自行猜测；先以代码验证现状，再更新设计或请求确认。

## 9. 验收标准

- `AGENT.md` 不再包含大段 IPC、附件或数据库实现流程。
- 新成员只阅读 `AGENT.md` 即可知道项目边界、不可违反的规则和下一步该读哪份文档。
- 任一常见任务都能通过路由表定位至少一份专项文档和一个代码入口。
- 文档明确规定“先设计、后实施、设计变更先确认”。
- 所有链接均指向仓库内真实存在的路径。
- Markdown 差异通过 `git diff --check`；不运行自动化测试。
