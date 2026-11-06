# 云端分阶段实施计划

**Goal:** 在 cloud/ 实现独立浏览器多用户 Agent，保留技能代码执行能力并逐项迁移桌面功能。

**Architecture:** 原生 HTTP API、PostgreSQL 持久任务/事件、独立 Pi Worker、OpenSandbox、本地或 S3 文件存储、React Web。仅 cloud/ 可写，不导入桌面运行时。

**Tech Stack:** Node/TypeScript、Pi 1.0.4、React/Vite、pg、OpenSandbox 官方 JS SDK、S3 SDK。

勾选代表文档或源码已交付，不代表真实验收通过。各阶段运行验收见 `03-progress.md`。P1–P5 未完成真实验收前不进入 P6 业务扩展迁移；P6 切片规格见 `05-desktop-parity.md`。

## P0：设计与独立工程

- [x] 建立详细架构、边界、风险与范围矩阵。
- [x] 独立 package.json/lock、tsconfig、环境变量样例。
- [x] 定义 API 契约，所有后续模块按契约实现。
- [x] 创建阶段跟踪和运维验收文档。

## P1：身份与数据闭环

文件：src/config.ts、src/infra/db.ts、src/cloud/auth/service.ts、src/application.ts、src/server.ts、src/transport/http/routes.ts、database/schema.sql、scripts/init-db.ts、scripts/admin.ts。

- [x] PostgreSQL schema 与迁移事务、所有资源带 owner。
- [x] 管理员 CLI 创建账号、scrypt、cookie session、登录限制和 Origin 检查。
- [x] 会话/消息、任务提交与查询、幂等提交和单会话并发约束。
- [x] 持久事件分页与 SSE 重连，下载鉴权。
- [x] 双用户越权、会话、session 到期测试源码（尚未执行）。

## P2：真实 Agent 与 OpenSandbox

文件：src/worker.ts、src/agent/execute.ts、src/agent/engine.ts、src/platform/sandbox.ts、src/agent/tools/index.ts、src/infra/crypto.ts。

- [x] 任务原子领取、lease/fencing、心跳、worker 中断状态。
- [x] Pi 多轮消息与模型调用，模型请求密钥只在 worker 使用。
- [x] 官方 SDK create/exec/files/kill/close，非零退出、输出限额和取消信号接入。
- [ ] 真实 OpenSandbox 的取消、创建失联后的回收验收。
- [x] 租户验证先于沙箱连接，任务超时与清理失败记录。
- [x] 工具事件、审批接口及流式增量持久化。

## P3：个人技能、专家与连接器

文件：src/domains/skill/node/package.ts、src/transport/http/resources.ts、sandbox/mcp-runner.mjs、resources/skills/。

- [x] SKILL.md/zip 安装、安全路径、限制、不可变 digest 版本、启停与删除。
- [x] 任务引用版本冻结；专家组合与个人选择。
- [x] 个人 stdio/remote MCP 配置，沙箱内 MCP SDK 执行 list/call，生命周期清理。
- [x] 迁入 3 个兼容内置技能并记录来源，保留技能包标准。
- [ ] 其它桌面技能逐项适配和验收。

## P4：文件、文档、浏览器及 Web 工作台

文件：src/platform/storage.ts、web/desktop/src/*、sandbox/Dockerfile、sandbox/package.json。

- [x] 默认本地持久存储与可选 S3 上传/下载，元数据双写和失败清理；Agent 输入和发布产物。
- [x] 工作台登录、会话、流式消息、任务状态/取消、技能安装、设置、文件下载、连接器和专家管理。
- [x] 文档/Chromium 镜像定义，中文字体，用户目录，出网策略说明。
- [x] 响应式、可访问错误态、空态和加载态源码；UI 不伪造任务结果。
- [ ] 镜像构建、浏览器实测和文档视觉验收。

## P5：持续工作与运维

文件：src/automation.ts、deploy/*、docs/04-operations.md。

- [x] 个人项目/记忆、时区定时任务与唯一触发键。
- [x] 任务统计、工具事件、token 用量、每用户活动任务上限及 worker 并发限制。
- [ ] 实际费用计价、生产审计归档、容量/保留策略。
- [x] Compose 与 API/worker 构建定义、数据库初始化脚本、备份/恢复说明。
- [ ] 限额、网络拦截、故障恢复、Windows 开发验证。

## P6：桌面扩展能力与生产验收

- [ ] SkillHub 企业认证/市场兼容（需要真实服务及授权）。
- [ ] 企业 SSO、TAPD 需求工作台和企业连接器业务 UI（逐项迁移与联调）。
- [ ] RAG、分支消息、技能草稿原子发布、完整 Pi 插件宿主、高级文档预览。
- [ ] 真实 OpenSandbox、真实模型、MCP、文档、浏览器端到端。
- [ ] 租户隔离/SSRF/资源压测，目标环境监控与恢复演练。
- [ ] 用户目标云环境上线与验收。

## 完成定义

每项只能在对应证据存在时打勾。遇外部条件阻塞先完成其它独立项；不能删减 P6 来声称全部迁移完成。真实部署缺失时明确交付状态为未完成。
