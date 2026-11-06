# PiCoddyClaw Cloud 云端改造设计

> 2026-10-12 后端对齐更新：应用采用桌面同源的 AgentSession 与分层领域结构，云端保留 PostgreSQL/持久任务/OpenSandbox 平台实现。当前代码与剩余差异见 `08-backend-alignment-progress.md`；下文中的初版能力矩阵不代表全部完成。

日期：2026-10-12。状态：按用户授权先文档、后实施；完成度见 `03-progress.md`。

## 1. 背景、目标和边界

现有根目录应用是 Electron + React + Pi 1.0.4 + SQLite，存在进程级单例、系统钥匙串和本机路径依赖。用户要求全部通过浏览器访问，每人可安装自己的 SKILL.md、Node/Python/Shell 代码及 MCP，允许公网访问，云端代码独立放在 cloud/，长期与桌面端分别维护。

本次所有新增、依赖锁、部署、测试、文档均在 cloud/。不移动现有目录，不修改桌面端启动、打包及依赖，不引入根目录共享包。云端可以在明确版本下复制平台无关资源，记录来源；运行时不 import ../src 或 ../frontend。

不迁移用户本机屏幕、剪贴板、辅助功能、Finder、Windows COM 和本机应用操作。对应云端能力为上传下载、Linux 工作区、Chromium、LibreOffice；依赖 Windows/macOS 的技能显示不兼容原因。API/前端开发支持 Windows/macOS/Linux；沙箱部署要求 Linux Docker（Windows/macOS 使用 Linux VM）。不宣称 Linux 可以运行全部桌面技能。

## 2. 架构

浏览器 → 同源 node:http API → PostgreSQL 中的任务 → 独立 Node Worker/Pi Harness → OpenSandbox → Linux 沙箱。

API 管身份、用户资源和任务授权。Worker 管模型、上下文、状态和结果；用户代码绝不加载到 API/Worker 的 JS 进程。OpenSandbox 管创建、执行、文件及销毁。附件和交付物通过统一 Storage 接口保存，默认是服务器本地持久目录，S3 兼容对象存储为可选驱动；PostgreSQL 保存业务事实、任务租约、事件、技能版本文件集和调度。API 与 Worker 必须看到同一个本地目录，多主机部署必须改用共享文件系统或 S3。首版将限额内的技能文件集与版本原子写入数据库，以保证安装与任务快照的一致性；规模扩大后再迁移到内容寻址的对象存储。首版使用 PostgreSQL `FOR UPDATE SKIP LOCKED` 实现持久任务领取，避免 DB/Redis 双写任务丢失；后续需要更高队列吞吐时再加入 Redis。任务与 API 连接解耦，关闭浏览器不取消任务。

OpenSandbox Docker Runtime 为开发和第一套可运行部署。Kata 是可选部署增强，非应用依赖。用户尚未最终确认生产隔离配置，普通 Docker 部署不能声称 VM 级隔离。OpenSandbox API 仅 Worker 可访问。Kubernetes runtime 与 Docker runtime 是两条部署路径，不能把 Docker runtime 与 Kubernetes Controller 配置混写。

每次 run 独立沙箱。会话历史、已选技能版本、文件在外部持久化；不会因为销毁沙箱丢失交付物。不承诺 Docker 与各 runtime 都具备相同内存快照/暂停能力。多轮复用已上传附件与已发布产物，不复用不同用户的脏容器。技能安装依赖在沙箱里完成，版本与依赖锁随技能包保存。

## 3. 功能迁移矩阵

| 桌面能力 | 云端目标 | 阶段 |
|---|---|---|
| 登录、本机单用户 | 管理员 CLI 创建账号、密码登录、服务端 cookie session、多用户归属检查；企业 SSO 独立接入 | P1 / P6 |
| 会话、流式消息、取消 | PostgreSQL 会话和消息、持久事件 SSE 游标、后台 run、取消 | P1/P2 |
| 多模型 | 配置模型 provider/model/baseUrl/key，Pi 负责流式模型调用；密钥加密 | P2 |
| 内置与个人技能 | SKILL.md 和 zip 文件集、元数据校验、不可变版本、启停卸载、按任务选择 | P3 |
| 专家 | 个人专家配置、system prompt 与技能组合、显式会话选择 | P3 |
| Shell/Node/Python | OpenSandbox 中远程工具；无本地 spawn fallback | P2 |
| MCP 连接器 | 个人 stdio/远程配置、显式选择、在沙箱执行协议客户端和服务端 | P3 |
| 文档/浏览器 | 镜像预装 Python 文档库、Node 文档库、Chromium、LibreOffice，技能执行并回收产物 | P4 |
| 文件与工件 | 用户上传、任务输入、显式发布产物、鉴权下载、原始内容安全呈现 | P4 |
| 工作区/项目/记忆 | 用户私有资源、会话绑定、按任务装配上下文 | P5 |
| 定时任务 | 持久 cron/时区、到点创建 run、唯一触发键、禁用与执行历史 | P5 |
| 用量、审批、审计 | 每次 run token/费用，工具执行事件，敏感动作确认 | P2/P5 |
| SkillHub/TAPD/GitLab/Jenkins 等 | 先通用用户 MCP/技能；企业特定登录/目录/需求 UI 逐项兼容，不以通用 MCP 代替验收 | P6 |
| RAG/分支/高级预览/插件扩展 | 独立迁移项，需独立验收，不因基础功能上线标记完成 | P6 |

## 4. 数据与身份

所有用户资源必须带 owner_id。服务端从 session 得到用户 ID，不采用请求体中的 ownerId。资源操作同时匹配 id 和 owner_id；越权统一 404。对象 key 由后端生成，不允许客户端指定任意 bucket/key。密码使用 scrypt 随机盐；session 存随机 token 的 SHA-256，cookie HttpOnly/SameSite，生产 Secure，写请求验证 Origin。登录限流，body/上传限额，错误不返回栈或密钥。

用户密钥用 AES-256-GCM，密钥来自部署 secret，不进仓库。模型 key 留在 Worker。MCP 的用户级第三方 key 如需传入任意 MCP 进程，就必须承认该进程可读取它；只注入当前连接器所需凭据。不能宣称所有认证协议都能透明代理。可实现的 HTTP 凭据代理与任意 stdio 凭据的信任模型分开记录。

任务状态：queued → provisioning → running → succeeded/failed/cancelled；running 可进入 waiting_approval 再返回 running。领取用租约和 owner token，心跳更新受 token 限制；租约过期标 interrupted，禁止自动重放可能有外部副作用的工具。取消设置 cancel_requested，Worker abort 模型、销毁沙箱并写终态。取消成功必须表示执行停止已确认，否则保留 cancelling/cleanup_pending。清理失败需可见并可再次回收。

事件有递增数据库 ID、runId、type、payload、createdAt。SSE 使用 Last-Event-ID，查询也校验 owner。终态最终消息与事件以事务提交；浏览器使用历史重建，避免重复文本。

## 5. 技能与执行

兼容现有 SKILL.md YAML frontmatter + scripts/references/assets。云端权限元数据由应用独立保存，不强迫所有旧技能增加 manifest。zip 校验绝对路径、..、反斜杠、symlink、重复路径、大小和文件数，防解压炸弹。安装不在控制平面执行 install script。版本使用 SHA-256，不覆盖正在运行任务引用的内容；升级按 expectedVersion 乐观锁提交。卸载先禁用，保留被历史任务引用的版本。

模型仅加载用户显式选择的技能。脚本、插件和 MCP 输出均视为数据，不能修改服务端授权。沙箱只得到本次输入文件与所选技能，不自动挂载用户全部文件。当前工具提供 bash、read_file、write_file、present_files、MCP 调用以及文档/浏览器工具。present_files 替换早期单文件 publish_file，保留消息级有序交付批次；尚未全面对齐桌面工具集合。

公网访问是允许的产品能力，但必须通过宿主机/网络出口实际控制。仅设置 HTTPS_PROXY 或列出域名不构成任意代码隔离。拒绝集群/私网/metadata/IPv6 link-local 等，处理 DNS rebinding、直连 IP 和代理绕过；任务内部 loopback 可以用于 MCP/Chromium，不能把它简单全禁。用户授权到内网企业系统需单独可审计代理，不能打开整个私网。

## 6. 部署与恢复

cloud/ 独立 package-lock、API/Worker 镜像、Web 构建、数据库 schema 和脚本。Compose 管业务服务；OpenSandbox 管理服务运行于独立执行主机，具有 Docker daemon 权限的管理服务不与业务 API 合并。任务容器无 Docker socket、无控制面 secret、无 privileged/host network。

开发运行真实 PostgreSQL 和持久文件存储；默认 local 驱动不依赖外部对象存储，选择 s3 时必须提供完整端点及凭据。无 SQLite 或 mock 自动 fallback。没有模型/OpenSandbox 配置时明确报配置错误。单元测试可用 fake 依赖，但不能当作真实云端联调。

健康检查拆 live 与 ready。SIGTERM 停止领取新任务，取消/标记活动任务，清理沙箱。数据库、文件卷（或对象存储）和部署密钥分别备份；任务执行状态和文件清单可对账。OpenSandbox 的高可用、KVM 支持和出网策略须在目标环境验证。

## 7. 验收

每阶段记录：实现文件、静态检查、自动化测试、真实外部验证、已知缺口。至少验证双用户越权、技能包攻击路径、版本冻结、Shell 非零退出、取消、SSE 重连、Worker 重启、文件下载、MCP、文档和浏览器、公网成功与私网拦截。代码完成≠生产部署完成。

仓库 AGENT.md 限制测试/构建需明确授权，已向用户异步请求；未回复时仅静态检查。生产部署、真实第三方写操作和凭据由用户提供，未授权不执行。

## 8. 一手参考与不确定性

- OpenSandbox JS SDK：https://github.com/opensandbox-group/OpenSandbox/blob/main/sdks/sandbox/javascript/README.md
- OpenSandbox deployment：https://github.com/opensandbox-group/OpenSandbox/blob/main/docs/deployment/index.md
- OpenSandbox 官方仓库：https://github.com/opensandbox-group/OpenSandbox
- Codex 任务隔离：https://help.openai.com/en/articles/20001545-using-codex-cloud

SDK 以安装版本的类型定义为准，不根据 main 文档臆造参数。早先讨论中的“每请求独立容器”“永久用户沙箱”“单独每语言 Worker”统一收敛为每 run 单独环境 + 外部持久资源。
