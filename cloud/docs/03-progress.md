# 实施与验证进度

2026-10-14 用户最终指定 MCP 全部自动执行：完全访问 craft 下，已选、已授权且可见的 MCP 发现/调用一律不请求执行审批，删除 MCP 风险分类和 approve 回调。保持当前资源/凭据、hidden、工具存在性与租约校验；readonly/plan/ask 继续禁用业务 MCP，Shell 审批不变。下方风险分类记录为此前历史，已由当前决定覆盖。

2026-10-14 MCP 审批修正：完全访问 craft 下，显式选中的 MCP 自动发现服务端工具及 annotations；查询和声明非破坏性的常规写操作自动执行，破坏性/发送上传付款等高风险名称/未知信息保留审批，readonly/plan/ask 继续禁止业务 MCP。审批后重新核对 owner/UUID/revision/当前授权，TAPD 项目适配也先经过工具发现与同一判定。真实已授权知识库的四个工具均声明 readOnlyHint=true/destructiveHint=false，本轮仅发现元数据，未执行真实业务工具。受控真实沙箱确认 query/routine_write 审批0、delete/unknown 审批1；镜像和 Web 构建、相关回归及只读审查通过。旧审批不自动放行。见 [执行审批设计](designs/2026-10-14-mcp-execution-approval-design.md)。

2026-10-14 标准 OAuth 浏览器往返修正：点击时同步预开授权窗口并清除 opener，知识库的异步预设创建复用该窗口；成功回调以 nonce CSP 的固定脚本关闭授权窗，不能关闭时返回同源应用根路径。原页面保留会话，轮询授权状态并自动更新连接；弹窗被拦截时提供手动链接。18 项 OAuth/知识库/窗口回归与模拟浏览器的知识库、自定义 MCP 自动打开/回调关闭/状态更新/拦截分支通过，类型和 Web 构建通过；未代替用户完成真实提供方账号同意。

2026-10-14 内置 MCP 补齐：AI 知识库预设已接入；新增 GitLab/Jenkins 的真实运行环境检查及加密配置，保留空 Token 的既有值；TAPD 的浏览器授权、会话绑定挑战、确认/取消对账、grants、解绑及项目临时凭据已接入。三个锁定版本在临时 OpenSandbox 发现 25/38/44 个工具（TAPD 账号接口为沙箱内受控服务）。59 项相关回归、类型检查、Web 与执行镜像构建、模拟浏览器操作通过。审查修正 hidden 原型链绕过、空项目发现、按 schema 填项目 ID、幂等确认及 stderr 凭据泄露。用户明确本轮不接 Figma，卡片和后端明确不可用。标准新 MCP 可直接通过同一配置入口添加，不新增专用路由；真实知识库/GitLab/Jenkins/TAPD 账号联调、Windows 实机及桌面的通用 MCP 持久会话与 direct/deferred/codemode 注入策略不能据此宣称完成。见 [内置 MCP 设计](designs/2026-10-14-builtin-mcp-parity-design.md)。

2026-10-14 MCP 连接器管理对齐：补齐主 HTTP 路由、原子配置保存、连接探测/断开/工具列表、标准 OAuth 浏览器管理及任务当前凭据读取；支持 SSE，并修正探测时间精度和同名 UUID 前端状态。相关回归、Cloud 类型与 Web 构建、模拟浏览器配置/连接/OAuth 交互通过。真实临时 OpenSandbox 验证 MCP 工具发现，以及受控 OAuth 服务的 PKCE、换票、刷新；未完成真实第三方账号授权和 Windows 实机验收。见 [连接器设计](designs/2026-10-13-cloud-connector-management-design.md)。

2026-10-13 内置联网工具：按已确认设计接入 pi-web-access 0.40.0 的官方 MCP 四工具；任务内保持单一进程与缓存，临时文件不进入交付目录。浏览器截图改为显式可选。27 项联网/桥接/提示词回归、9 项 Agent/权限回归及 Cloud 两套类型检查通过；实际执行镜像已构建。真实 OpenSandbox 的工具发现、Exa 搜索、同进程缓存读取与无交付文件检查成功；正文提取被当前本机 fake-IP DNS 的上游 SSRF 检查阻止，本地适配方案待确认。不能据此宣称所有联网功能或原失败会话已修复。见 [pi-web-access 接入设计](designs/2026-10-13-pi-web-access-design.md)。

2026-10-13 通义千问目录修正：本地代理 Fake-IP 被云端地址检查误拦截的问题已修复；例外仅作用于 loopback 开发配置与精确官方域名，生产和自定义域名保持严格检查。真实官方认证响应已可达；全量 330 项测试、类型检查和构建通过。详情见 [Qwen 目录网络修正](designs/2026-10-13-qwen-catalog-network-fix-design.md)。

2026-10-13 SkillHub 增量：服务端自动管理共享密钥，移除用户配置表单；真实企业会话已认证并读取 23 个技能、11 个专家和 4 个 namespace。技能/完整专家包安装、包内技能运行快照与受控 OSS 下载已接入。全量 327 项测试、类型检查、构建及浏览器模拟交互通过；真实归档安装准备在内存存储验证，未向业务空间添加测试资源。详情见 [SkillHub 自动认证修正](designs/2026-10-13-skillhub-managed-auth-design.md)。

2026-10-13 模型设置增量：已沿用桌面端设置交互补齐云端 API Key 配置、模型目录和连接测试；全量 291 项测试、浏览器模拟交互、类型检查及构建通过。订阅模式不在本次范围，真实供应商调用尚未验证。最新设计及验收边界见 [API Key 模型设置](designs/2026-10-13-api-key-model-settings-design.md)。以下历史阶段记录不代表本次最终验收结果。

更新时间：2026-10-12。**整体未完成**。最新批次云端自动化测试 190 项通过（0 跳过）、Web 生产构建通过；尚未生产部署、真实 OpenSandbox/OSS/模型端到端及全量桌面对齐验收。

最新事实以 [08 后端与空间](08-backend-alignment-progress.md) 和 [09 技能/专家/Agent](09-skill-expert-agent-progress.md) 为准。以下表格及授权前置条件是早期实施记录：用户已授权测试/构建、Docker 临时 PostgreSQL 测试已执行；项目功能已移除，OSS SDK、RAG、空间持久化、技能草稿已分批接入，不再将这些旧记录当作当前状态。

| 阶段 | 已写入内容 | 验证状态 |
|---|---|---|
| P0 设计/工程 | 设计、阶段计划、API 契约、桌面对齐规格、独立依赖锁、部署文档 | 文档及工程静态检查 |
| P1 身份/数据 | PostgreSQL 迁移、账号 CLI、session、owner 过滤、CRUD、幂等提交、SSE | 类型检查；数据库集成待执行 |
| P2 Agent/沙箱 | Pi Worker、远程工具、审批、租约/取消/回收、受限文件流 | 类型/语法检查；真实模型/OpenSandbox 待执行 |
| P3 技能/MCP | 安全包解析、不可变版本、专家、个人 MCP、3 个内置技能 | 类型检查及测试源码；实际技能/MCP 待执行 |
| P4 Web/文件 | 独立迁入桌面 UI、浏览器账号认证/云 API 适配、上传下载、默认本地/可选 S3 存储、文档/浏览器工具、镜像定义 | 类型/语法检查；存储与适配器测试源码已写未执行，Web 构建/截图/真实存储待执行 |
| P5 调度/运维 | 项目、记忆、时区 cron、任务统计、Compose、备份恢复步骤 | 类型检查；Docker/故障演练/Windows 实机待执行 |
| P6 扩展/生产 | 分切片规格，未开始实现 | SkillHub/SSO/TAPD、RAG、分支、草稿、完整插件、高级预览、上线均未完成 |

## 已执行的检查

- `cd cloud && npm run typecheck`：通过（TypeScript exit 0）。
- `node --check cloud/sandbox/mcp-runner.mjs`：通过。
- `node --check cloud/runtime/browser.mjs`：通过。
- documents.py 的 Python AST 语法解析：通过；没有运行文档转换。
- 基础实现阶段曾对 83 个新增 cloud 文件做 whitespace 检查；该记录不覆盖后续迁入的桌面 UI。根目录 `git diff --check` 只覆盖已跟踪差异，不代表整个未跟踪 cloud/ 的检查结果。
- 独立审查覆盖 MCP 请求协议、大文件读取限额、审批/产物租约竞争、SSE 重连、旧会话响应污染、文件删除与活动任务竞争、技能 zip 显式根目录。

静态证据不证明 SQL、浏览器行为、外部服务或隔离机制在真实环境可用。

## 继续工作的前置条件

1. 项目 AGENT.md 要求测试和构建明确授权；已请求但尚未收到授权。下一步需允许 cloud 专属测试、Web/镜像构建和本地 Docker 联调。
2. 本机有 Docker CLI，但检查时 daemon 未启动；没有擅自启动或部署服务。
3. 需要可清空的专用 PostgreSQL 测试库、持久本地测试目录（验证可清理）或私有 S3 测试 bucket、OpenSandbox 测试节点，以及测试模型/连接器配置。选择 S3 时密钥填 cloud/.env 或部署 secret，不写入文档或聊天。
4. 企业 SSO/SkillHub/TAPD 需 Web 应用注册、回调域名及授权测试环境；生产需明确目标云资源、HTTPS/预览域和网络隔离策略。

## 已知范围与风险

- Docker 不是 Kata/VM 级隔离。没有配置 Kata；宿主网络强制拦截、PID/磁盘限额及压测仍是上线阻断项。
- 同一 run 的技能与 MCP 共用沙箱权限；所选 MCP 凭据可能被同 run 的不可信代码读取，不能把同沙箱进程当成相互隔离的信任域。
- Shell 仍需审批；已选、已授权 MCP 的所有可见工具在完全访问 craft 下自动执行，OAuth 同意仍由用户完成。
- 仅迁入 3 个工具契约兼容的内置技能；其它技能、桌面插件未逐项迁移。
- 基础文档读写及单次浏览器导航/截图，不等于高级在线编辑、持久交互浏览器或完整 RAG。
- 文件/事件/技能版本容量与保留策略、本地卷或对象存储异常对账、实际费用计价仍需生产化。

## 改动边界

本次改造写入范围为 cloud/，未主动修改桌面端代码、依赖或打包脚本。
收尾时观察到 `src/agent/builtin_skills/builtin-skills.bundle.generated.ts` 的 gzip 常量出现额外差异，来源尚未确认，已保留，不擅自回退。它不计入云端交付。
原有未跟踪 `.claude/` 内容保留，没有暂存、提交或删除。

UI 对齐收尾检查时还观察到根目录发布相关文件（`scripts/release/feed.mjs`、`scripts/release/qiniu.mjs`、`test/scripts/qiniu-release.test.ts`、`docs/remote-update-operations.md`）存在并发改动。本任务没有修改或回退这些文件，也不把其验证结果计入 cloud 交付。

## 后端对齐追加记录（2026-10-12）

已开始实施桌面基线对齐：应用装配/平台/基础设施拆分、会话领域服务、持久任务提交服务、AgentSession 与提示词 envelope、压缩检查点及增量历史恢复。详情和未完成边界见 [08-backend-alignment-progress.md](08-backend-alignment-progress.md)。仍不是桌面全量后端替代；OSS 尚未接入。
