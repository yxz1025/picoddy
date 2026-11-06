# 部署、验证与运维手册

本手册是执行步骤，不是已经运行成功的记录。实际证据见 `03-progress.md`。

云端是全新、独立系统，不连接桌面数据库，不导入或同步桌面数据。首次对空的独立 PostgreSQL schema 执行 `npm run db:init`，一次安装 `database/schema.sql`；没有升级迁移链。相同结构重复初始化不会更改数据，遇到非空未知库或结构指纹不同会拒绝。不要对不匹配的库执行清空来绕过检查，应确认配置或使用新的专用开发/测试库。API 和管理员命令启动仅检查数据库，不自动建表。

初始结构包含文件删除 outbox。文件删除先提交逻辑删除与 outbox，之后清理对象；Worker 每10秒处理一批，默认失败5次停止自动重试并保留队列记录。管理员可只读检查 `SELECT id,attempts,next_attempt_at,lease_until FROM file_deletions ORDER BY created_at`；排除存储故障后再对明确失败项重置重试状态，不批量删除队列。对象 key/last_error 属于内部运维数据，不对普通用户暴露。此队列只覆盖显式文件删除，不代表上传中断产生的全部孤立对象已自动回收。

## 1. 部署拓扑与前置条件

业务节点：Node 24+、PostgreSQL 17、持久本地文件卷、HTTPS 反向代理。多主机部署改用所有 API/Worker 共享的文件系统，或配置私有 S3 bucket。
执行节点：独立 Linux Docker 主机和 OpenSandbox 管理服务，运行任务镜像。
API 不挂载 Docker socket；Worker 只通过 OpenSandbox HTTP API 创建任务。
OpenSandbox API 必须仅允许 Worker 网段访问，并启用认证/TLS 或受保护的私网链路。

当前交付没有安装 Kata，也没有自动修改宿主机防火墙。默认 Docker 隔离不等同虚拟机隔离。
生产开放用户任意技能之前，必须验证下文网络/资源/租户验收；未通过时只允许受控内部试运行。

## 2. 本地开发

在 `cloud/` 执行，禁止改根目录 package.json：

```sh
npm ci --ignore-scripts
# 手动复制 .env 为 .env，并填写真实配置。
npm run db:init
npm run admin -- --help
npm run seed-skills -- --subject 企业用户名
npm run dev
```

另外两个终端执行 `npm run worker`、`npm run web`。需要定时任务时另启动 `npm run scheduler`。
Vite 默认 5173，API 默认 8080；开发 PUBLIC_ORIGIN 使用浏览器实际源（例如 http://localhost:5173）。
Windows PowerShell 使用相同 npm 命令；复制文件用 Copy-Item；Node API、数据库和对象存储无 POSIX shell 依赖。
沙箱只能是 Linux 容器；Windows/macOS 开发机使用 Docker Desktop 的 Linux VM 或远程执行节点。
尚未完成 Windows x64 实机启动验证，不把“代码跨平台”当成已验证。

登录与桌面同源：企业 CAS → PICODDY 网关换票 → 独立云端会话。首次成功认证自动创建普通用户，不提供邮箱密码入口或管理员建号。模型仍由每个用户登录后自行配置。`npm run admin -- set-role --subject 企业用户名 --role admin` 可显式授予已登录用户管理角色；禁用/启用使用 `disable-user`/`enable-user --subject 企业用户名`，不以邮箱合并身份。

`CAS_LOGIN_URL`、`PICODDY_AUTH_EXCHANGE_URL` 可省略，默认与桌面源码一致；覆盖值必须为可信 HTTPS endpoint，不允许账号信息、query 或 fragment。`PUBLIC_ORIGIN` 决定完整回调 service，不能使用任意 Host 头替代。只允许 loopback 开发地址使用 HTTP；HTTPS 必须启用 Secure Cookie。生产域名需要企业 SSO 允许相应 `/api/auth/callback` service；真实换票须由用户完成一次企业登录来验收。

挑战绑定浏览器、10 分钟有效、一次性消费；同浏览器新登录撤销旧请求和旧浏览器会话，换票后再次事务校验，防止慢回调覆盖新账号。无效回调不清除正在登录的 Cookie。会话有效期 30 天；企业令牌加密保存于服务端会话，不发送前端/模型/沙箱。API 启动及每分钟清理过期会话与 challenge。退出只撤销当前云端会话，不联动桌面或企业全局登出。

当前应用层每浏览器 10 分钟 30 次、每连接来源粗粒度 3000 次上限；反向代理须另外配置真实客户端 IP 限流。后端不直接信任客户端可伪造的 X-Forwarded-For。CAS 认证接入不代表 SkillHub/TAPD 等企业扩展已接通，这些能力仍需独立按当前会话授权。
ENCRYPTION_KEY 使用独立 32 字节随机密钥（hex64 位或等价编码），备份时与数据库分开保管。

### SkillHub 由服务端自动认证

共享密钥由部署系统统一提供，普通用户页面没有配置入口。当前本地服务已将既有系统共享密钥保存为 `cloud/data/skillhub-secret.enc`，使用云端 `ENCRYPTION_KEY` 加密，文件权限 0600；运行时无需 Electron 或系统钥匙串。服务器也可用 `SKILLHUB_AUTH_ACCESS_TOKEN_SECRET` 环境变量提供同一密钥。`SKILLHUB_SECRET_FILE` 可指定加密文件位置，默认相对 cloud/ 的 `data/skillhub-secret.enc`。容器部署须把该文件作为服务端配置挂载到指定路径，或由部署 secret 注入环境变量；不要把密钥写入 Web 配置。

`SKILLHUB_BASE_URL` 默认为桌面使用的企业 SkillHub 服务地址。进入市场后后端使用当前企业用户邮箱自动认证，远端 Cookie 和 API Token 加密保存在当前云端会话中，不发送到浏览器。不同用户、不同云端会话和桌面端各自持有独立远端用户 Token。

`SKILLHUB_DOWNLOAD_HOSTS` 默认仅允许企业归档 Bucket 域名，下载签名地址不会下发前端；跳出 registry 时不发送用户 Token/Cookie。专家完整包和声明的包内技能按版本冻结进 run，由 OpenSandbox 读取；完整 run JSON 上限 64 MiB。当前企业 registry 的 HTTPS 探测失败，生产需提供受保护 HTTPS endpoint 或受控加密链路再部署该认证功能。

`STORAGE_DRIVER=local` 是默认值。`STORAGE_LOCAL_ROOT` 相对路径从 `cloud/` 解析，默认 `cloud/data/files`，因此不受启动 cwd 影响。API 与 Worker 必须使用同一绝对目录或共享卷；不要把该目录暴露给沙箱。切换到 `STORAGE_DRIVER=s3` 时才需要设置 `STORAGE_ENDPOINT`、`STORAGE_ACCESS_KEY`、`STORAGE_SECRET_KEY`，并按平台设置 region/bucket。

## 3. 容器部署

### 内置联网工具

任务镜像固定安装 `pi-web-access@0.40.0`，Cloud 普通会话提供 `web_search`、`fetch_content`、`get_search_content`、`source_check`，无需手动选择连接器。每个任务在沙箱启动独立 MCP 进程，同任务复用结果缓存，任务结束后关闭。它不读取桌面凭据，也不把对话模型 Key 用作搜索 Key；当前默认使用无需 Key 的 Exa MCP，受其上游可用性和额度约束。

联网临时文件在 `/workspace/.web-access/`，不会自动保存到工作区或交付文件。浏览器默认仅返回文本、链接，显式 `screenshot: true` 才产生 `/workspace/output/browser.png`。镜像变化后必须重建执行镜像并重启 Worker，不能只刷新 Web 页面。显式联调命令为 `node --env-file-if-exists=.env --import tsx scripts/live-web-access.ts`：只创建临时沙箱、访问公开来源并销毁，不调用模型或修改业务数据库。

2026-10-13 本地联调发现 TUN/fake-IP DNS 把公网域名解析到 198.18.0.0/15，上游 SSRF 校验会拒绝正文抓取。当前仍保留该限制，本地适配开关须确认补充设计后启用，不应在生产整体关闭 SSRF 检查。

### 原生 OSS 配置

在 cloud/.env 设置 STORAGE_DRIVER=oss，并填写 OSS_REGION（如 oss-cn-hangzhou）、OSS_BUCKET、OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET。OSS_ENDPOINT 可省略，由地域生成；若填写，必须是无路径、无账号信息的 HTTPS endpoint。SDK 固定 ali-oss 6.23.0，采用 HTTPS/V4 签名。所有配置仅在 API/Worker，不下发浏览器或沙箱；独立私有 Bucket 不与桌面数据同步。

当前支持专用 RAM 用户的服务端 AccessKey；固定 OSS_STS_TOKEN 明确拒绝，尚未接入自动凭据刷新。为 RAM 授予目标 Bucket 所需 GetBucketInfo（ready）、GetObject、PutObject、DeleteObject 权限，禁止公共读与创建 Bucket/更改 ACL 权限。不自动创建资源或搬迁对象。读取通过 getStream 按实际字节限制，超过上限关闭流；参考[阿里云流式下载说明](https://www.alibabacloud.com/help/en/oss/developer-reference/streaming-download-2)。真实 OSS 鉴权与读写尚未联调。

所有存储驱动的 get(key,maxBytes?) 都有读取上限，默认 MAX_UPLOAD_BYTES；不会静默跨驱动降级。文件内容接口还核验数据库大小与 SHA-256。开启 OSS 不等于工作空间自动恢复/回写或 Office 预览已经完成。

在 cloud/ 目录，获得构建和部署授权后：

```sh
docker build -f sandbox/Dockerfile -t picoddyclaw-cloud-sandbox:0.1.0 .
docker compose --env-file .env -f deploy/compose.yaml up -d --build
docker compose --env-file .env -f deploy/compose.yaml run --rm api npm run admin -- --help
```

沙箱镜像需在执行节点可拉取；本机构建不会自动上传远程 Docker。生产将镜像推入受控仓库并固定 digest。
Compose 管理业务服务、PostgreSQL 及名为 `files` 的共享持久卷；一次性 storage-init 服务把卷授权给非 root 的 API/Worker。S3（启用时）和 OpenSandbox 按实际平台单独部署，不自动新建收费资源。
Compose 的 POSTGRES_PASSWORD 需为 URL-safe 随机值（如 hex），避免拼接 DATABASE_URL 时出现保留字符。
生产 PUBLIC_ORIGIN 改为真实 HTTPS 域名，SECURE_COOKIES=true；API 只绑定宿主 127.0.0.1:8080，由反代终止 TLS。

反代必须：保留 Origin/Cookie；SSE 关闭缓冲及响应压缩聚合、读超时大于 60 秒；请求 body 上限与 base64 开销匹配（25MiB 文件约 34MiB JSON）；登录入口设置按 IP 全局速率限制。不要信任用户提供的 X-Forwarded-For。
健康检查 `/api/health` 仅表明进程存活；`/api/ready` 检查业务依赖，不代表 OpenSandbox/模型可用。

## 4. 不可跳过的隔离验收

在专用测试执行节点、经过授权后验证：

1. 任意代码不能访问业务 DB、S3 管理口、OpenSandbox 管理口、Docker socket、宿主机文件或其他任务。
2. 公网 HTTPS 可以访问；RFC1918、loopback 指向宿主的映射、link-local/metadata、IPv6 私网、IPv4 映射 IPv6、DNS rebinding 和直连 IP 均按策略拦截。
3. 对任务内 loopback 的 MCP/Chromium 不误封；需要企业内网的连接器仅通过指定代理访问，不整体放开私网。
4. 禁止 privileged、host network、额外 host bind mount；启用 Docker 默认 seccomp/no-new-privileges 并验证工作负载用户。
5. CPU/内存硬限额实际生效；宿主机另配置 PID 数、磁盘、inode、网络带宽与节点总并发限制。SDK 的 CPU/内存字段不自动覆盖其余限制。
6. 创建超时、失联、取消、kill 失败和 Worker 被杀后，任务不会自动重放工具；遗留容器按 TTL 或回收器销毁。

设置 HTTPS_PROXY 不是隔离措施，因为技能能忽略它；必须采用宿主网络防火墙/受控网关或 OpenSandbox 对应 runtime 的强制网络机制。未完成这些步骤不能作为不可信多租户生产平台上线。

## 5. 任务、审批与定时任务

每个 run 拥有独立沙箱，默认 900 秒。Worker 每 10 秒续租，租约 60 秒。
失去租约后不再发工具，不自动重新执行原任务。回收器处理过期活动任务与 cleanup_pending。
创建请求已发出但未返回 ID 的情况先隔离等待 TTL + 5 分钟，再向管理服务按 metadata.runId 对账、销毁匹配项并确认无活动实例。列表/销毁无法确认时继续 cleanup_pending，不能仅凭时钟假装已经 kill；仍需验证目标服务的 TTL 与列表一致性。

Shell 保持执行审批。craft + full 下，本轮显式选择且当前授权有效的 MCP 自动发现工具并启动所选 stdio；所有可见工具调用自动执行，不按名称、annotations 或操作类型触发 MCP 执行审批；readonly/plan/ask 继续禁用业务 MCP。已生成的旧审批不会自动批准。
审批等待最多 5 分钟。定时任务不会绕过审批；需要无人值守执行 Shell 时必须另设计显式授权策略，当前无“自动批准一切”隐藏开关。
cron 使用标准五字段（最小粒度一分钟），按用户设置的 IANA 时区计算；服务恢复不补跑所有遗漏周期，只处理一项到期任务并推进到未来。
每次触发新会话，automation_runs 唯一键避免重复。提交失败记录 lastError，下一周期再尝试。

上下文超过当前保守字符限制时明确报错，不静默删除历史或截断工具调用对。
费用计价尚未配置，因此 cost=null；token 用量来自模型回复，不能将 null 显示成真实免费成本。

## 6. 备份和恢复

- 对 PostgreSQL 使用 pg_dump/平台持续备份。local 驱动单独备份 `cloud/data/files` 或 Compose `files` 卷，并保证 DB 与文件恢复点一致；S3 驱动启用 bucket 版本控制及生命周期策略。
- ENCRYPTION_KEY 独立密钥备份；丢失密钥无法恢复模型/MCP 凭据。
- 恢复演练先停止 scheduler/worker，恢复 DB 和本地文件卷（或 bucket），同步密钥，再启动 API 检查 owner 范围和文件校验。
- 对恢复出的活动任务只允许回收，不自动重放。对账对象 key、DB 元数据与实际 sandbox metadata。
- 观察 cleanup_pending 数量、最老 queued 时间、Worker 错误、DB 连接数、存储错误和本地卷/S3 容量。
- 事件/技能版本目前没有自动清理保留策略，需上线前制定归档/删除规则和容量预算，避免静默删历史。

## 7. 验证命令与真实验收

静态检查（已允许）：

```sh
npm run typecheck
node --check sandbox/mcp-runner.mjs
node --check runtime/browser.mjs
git diff --check
```

以下必须用户授权：

```sh
npm test
npm run build
```

API 集成测试需要显式 TEST_DATABASE_URL 指向**可清空的专用测试库**（名字包含 test）；测试会 TRUNCATE 表，绝不可用生产库。
默认不设置时数据库集成用例跳过，不能把跳过当成集成通过。
单元测试中的 fake SDK/storage 仅验证契约，不能替代真实 OpenSandbox、本地持久卷或 S3/MCP 测试。

真实验收清单：两个用户登录/越权；个人 zip 安装/升级冻结；真实模型文本流；Shell 成功/非零退出/拒绝审批/取消；上传 DOCX/XLSX/PDF、生成并下载文件；Chromium 公网访问与私网拒绝；stdio/HTTP MCP；SSE 断网续传；关闭浏览器任务继续；Worker crash 后不重放；技能/文件删除与活动任务竞争；定时任务时区与重复调度；Windows 浏览器及开发启动。
