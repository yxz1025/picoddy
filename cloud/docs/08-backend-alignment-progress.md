# 后端桌面基线对齐：实施记录

日期：2026-10-12。设计：`designs/2026-10-12-backend-desktop-alignment-design.md`。

## 最新批次：技能草稿、专家绑定与持久问答

见 [09-skill-expert-agent-progress.md](09-skill-expert-agent-progress.md)。本轮云端全量测试 190 项通过、0 跳过，生产构建通过。已接私有技能草稿/发布/修订及回滚 API、专家持久绑定与运行快照、持久问答与恢复；未完成专家 Creator、goal_complete、子代理及真实外部环境验收。

## 最新批次：用户空间恢复与版本回写（2026-10-12）

- 提交任务冻结 workspace manifest；绑定空间时按 owner+workspace 隔离，未绑定时按 owner+conversation 隔离。Worker 在执行前恢复冻结文件，craft/full 成功后执行版本比较并回写；Ask/Plan/readonly 不回写。
- 持久化范围是 `/workspace/work` 和 `/workspace/output` 中的普通文件；输入副本、技能安装、临时请求与凭据不纳入。单文件25MiB、总计100MiB、1000文件、每空间最多100个版本，超限失败，不静默裁剪。空目录不保存。
- 回写先登记 staging 清单再上传，提交时校验运行租约与空间 revision；冲突保留独立版本并返回 WORKSPACE_REVISION_CONFLICT，不覆盖胜出任务。恢复历史版本同样要求 expectedRevision。
- 新增 `/api/workspace-files/:scopeId` 列表及 `/versions`、`/restore`、`/content`、`/download`；全部用户鉴权，不返回对象键。content/download 校验大小与哈希，支持 GET/HEAD 与单段 Range，活动格式按纯文本处理。
- 删除会话/空间时通过数据库触发器，将当前与历史版本对象原子放入既有删除重试队列。空间仍遵循引用保护；新 schema 用于全新初始化，未对已有数据库执行迁移。
- 已验证真实 PostgreSQL 下双会话同空间并发冲突、越权拒绝、历史恢复、删除清理入队及 HTTP 接口。对象存储和沙箱使用测试替身，不能据此宣称真实 OSS/OpenSandbox 端到端通过。
- 本批最终验证：独立临时 PostgreSQL 中173项测试通过，0失败、0跳过；npm run build（含后端与桌面样式前端类型检查）通过，仍有约864kB主包体积警告。扫描不可读目录时拒绝部分清单，防止误判文件删除；清单拒绝文件/目录路径冲突。
- 未完成：前端空间版本面板和桌面同款完整预览、Office 转换任务、失败 staging 版本自动回收/保留策略、账户总容量配额及真实环境联调。失败/取消任务不回写空间；已发布交付物仍走独立交付链路。

## 上一批次：全新独立数据与 OSS 基础（2026-10-12）

- 云端与桌面数据不互通：不导入、不同步、不做历史升级兼容，全部变更限 cloud/。
- 六份增量 SQL 已合并为 database/schema.sql，命令改为 db:init。空 schema 原子初始化，相同定义重复执行无改动；未知非空 schema（含表、类型、函数）或安装指纹不匹配拒绝，绝不自动清库。指纹用于比对安装定义，不是实际数据库所有对象的漂移审计。
- server/admin/worker/scheduler 启动仅检查初始化状态；Docker/Compose 使用显式 initialize 服务。初始定义添加 owner 复合外键，数据库层也拒绝跨用户会话、运行、文件、索引和资源引用。
- 空间字段/API 统一 workspace；会话绑定与记忆写入、空间删除使用 owner 锁。被会话或记忆引用的空间返回 WORKSPACE_IN_USE，不悄悄丢弃引用。
- 存储后的 runtimeProfile/permission/settings 必填，缺失即失败，不以 craft/full/空设置兼容旧任务。新提交请求仍有明确、冻结的默认选择。
- 原生 OSS 驱动及独立配置已接入，HTTPS/V4、RAM 服务端凭据、有界流式读取；local/S3 保留，无自动降级。新增 SDK 适配测试，不代表真实 Bucket 联调。
- GET/HEAD 文件 content 与 download 支持单段 Range、owner 鉴权、大小/哈希校验，活动文档在应用源只作为纯文本。完整 Office 解析队列、前端同款预览、空间文件恢复/回写尚未完成。
- 子代理完成只读范围审查并指出空间删除竞态与跨 owner 外键缺口，主代理已补回归与实现；另一审查任务因模型容量限制未执行，不能标为独立代码质量审查通过。
- 本批最终验证：独立空测试库 picoddy_cloud_isolation_test 中166项自动化测试通过，0失败、0跳过；npm run build（含两套类型检查）退出0，仍有前端大块体积警告。126个云端文件 no-index whitespace 检查通过。真实 OSS/OpenSandbox/模型、完整预览、Windows x64 实机未验证。

下文为分批实施记录，涉及旧增量 SQL 的条目仅为开发过程记录；当前部署以本节及04-operations为准。

## 本轮代码

- `src/application.ts` 成为 API 依赖装配入口，`server.ts` 只负责 HTTP 启动和静态页面。
- 基础设施迁入 `infra/`，文件与执行环境迁入 `platform/`，HTTP 适配迁入 `transport/http/`；旧文件已移动，不保留重导出兼容壳。同步调整脚本、测试引用及数据库迁移目录定位。
- `cloud/runs/service.ts` 接管资源冻结、幂等提交和任务创建事务；自动化不再依赖 HTTP 路由模块。既有用户锁、并发限制和归属查询保留。
- `domains/session/node/store.ts` 和 `service.ts` 承接会话 CRUD、项目校验、删除保护和消息 DTO。HTTP 只解析路径并调用服务，保留原有接口响应。
- `agent/engine.ts` 以桌面 `createAgentSession` 生命周期为基线，使用 pi-coding-agent 1.0.4。明确注入内存凭据、模型目录、设置、会话及资源加载器，禁止宿主机资源扫描，不加载用户扩展；只注册云端沙箱工具，工具串行执行。
- `agent/execute.ts` 接入 AgentSession，事件按序持久化，工具执行前等待此前事件落库并校验租约；持久化失败中断执行，不让异步监听错误成为未处理 Promise。
- `domains/session/node/runtime.ts` 与 `003-session-runtime.sql` 保存原生会话条目（含压缩信息）。检查点按用户、会话鉴权，使用消息递增游标补接中断后的历史，写入受租约保护；不丢弃已压缩前缀，也不忽略可能已执行的工具。
- `agent/session-checkpoint.ts` 保存最新压缩节点及保留的消息链，维持 ID 和引用关系，不反复保存已被摘要替代的完整日志。消息原文仍保存在数据库用于历史展示与审计。
- `agent/prompt-runtime/` 迁入边界编码、预算、快照、分块与 envelope 结构；生产入口消费 system/user 两部分、记录无原文的 manifest，工具能力来自实际注册列表。未迁入桌面完整 mode/category/prompt-pack 体系。

## 代码来源与适配

不是整文件无差异复制：桌面 engine 含本机权限、文件快照、模型单例和插件加载，云端保留其 AgentSession 装配语义，替换不适用的环境能力。会话 store 沿用桌面的领域位置与操作边界，使用现有云端 PostgreSQL SQL，不模拟 SQLite 同步接口。

审阅时桌面基线 SHA-256：

- `src/agent/engine.ts`：`7a923e485c9f348461e5ab7a405ceffb5d848dad565b85f2050d54768607638d`
- `src/domains/session/node/store.ts`：`3891fca4cc877859bd0ce7bebfba52ed65d05a84abd09001df224793a04cfe2e`
- `src/agent/prompt-runtime/runtime.ts`：`c9d520d8dde417e129ebfb067989a7b85aa5d74161ab1fa4403fea4a7693a993`

提示词迁入模块在各文件头记录具体来源与改动，不将云端环境规则伪装成桌面原文。

## 当前边界

- 这是核心后端对齐，不是全部桌面领域移植完成。资源、附件和技能已下沉领域服务；run 查询/取消/审批及部分认证逻辑仍在 HTTP 模块。
- present_files 已接入桌面参数和消息级结构化结果；其他工具尚未全面对齐桌面名称/schema，专家运行时、完成边界及可信编排扩展仍未完成。
- 在任务成功、原生非消息条目追加和压缩完成时保存检查点，保留重试期间的 context_edit；下一次模型请求等待此前状态落库。进程在写入提交前异常时仍可能需要重算最新压缩，不承诺任意指令时刻的原位恢复。16 MiB 活跃状态/增量历史上限明确报错，不自动删历史。
- OSS、桌面同款预览、工作空间文件自动同步均未在本轮实施。

## 全量审查后的第二批实施

- settings/connector/expert/memory/workspace/automation 分别承担各自业务验证，共享 resource store 承接 PostgreSQL CRUD；路由无 SQL，保留原状态码、加密字段 patch 和默认模型锁规则。
- skill service/store 承接安装、版本读取、启停和删除；不可变版本与 expectedVersion 原子校验保留，null 请求体返回400，非法 Base64 和超限错误分别保留400/413。
- 新增技能当前正文只读接口，Web 不再以空正文替代已安装技能；描述/正文变化形成完整新版本，单纯启停不发布内容，多文件包不通过单文件编辑截断。
- Web 技能更新带读取时版本，防止陈旧修改覆盖新版本；额外 frontmatter 元数据不通过简化表单静默丢弃，而是明确要求完整包更新。独立 displayName 仍未实现，明确拒绝；特殊名称的管理使用 UUID。当前技能列表读取正文为 N+1 请求，需在大目录验收时评估。
- attachment service/store 承接上传、归属查询与删除，保留鉴权下载和对象 key 不外泄。新增004迁移和删除 outbox：数据库删除/登记同事务，提交后执行对象删除，失败由 Worker 独立循环重试，不再在事务提交前不可逆删除对象。未执行迁移或真实删除。
- artifact service 承接 present_files：按输入顺序验证非空文件，整体预算、沙箱输出目录限制、SHA256；本批文件与事件同事务。同一工具调用使用持久 delivery_batch 收据，不同参数复用调用 ID 明确报错；提交结果不确定时宁可保留可能孤立对象，不删除可能已被引用的文件。孤立上传对象的通用回收尚待实现。
- 桌面来源 Web 恢复 `toolResult → tool`、工具名、调用 ID 和 details，消息级卡片不再依赖全局最新文件；批次保持原始顺序，外部链接需用户点击，不自动加载。
- 终态事件只有消息恢复成功才确认游标；恢复接口暂时失败继续重连，不直接丢掉最终工具/assistant 消息。相关回归源码尚未运行。

来源基线：present_files 合同参考 `src/agent/tools/present_files.ts`（SHA256 `4246a13de6fa62de895b0348b44d240bab40c73388bbe60e5f7757eb9bd7c0bc`）；附件服务职责参考 `src/domains/attachment/node/store.ts`（`816c4a03d4df92caffa71a0d2db4b31937a49c33bc27ea809f927a00baf2f186`）。云端 SQL、事务与持久对象实现是适配，不声称整文件原样复用。

全量差异与 P0–P9 扩展方案见 [已批准设计](designs/2026-10-12-full-desktop-parity-design.md)。企业集成、RAG、草稿、空间同步等现已纳入实施范围，但不在这里冒充已实现。

## 批准后的提示词补齐

- 删除简化 CLOUD_CORE_PROMPT 替代桌面规则的做法，恢复桌面8个核心片段、assistant/craft 规则，按资源选择加载 memory/skills 规则。独立资源副本位于 cloud/resources/prompts/v2，除 identity 的桌面→浏览器云端身份与换行外保持原内容；没有运行时跨目录依赖。
- 云端边界作为独立补充；manifest 记录静态片段路径、SHA256、字节数，不记录动态敏感正文。缺失/空片段和模板占位符报错，不静默降级。Docker 构建与运行阶段均包含提示词资源。
- 这只补齐当前 assistant/craft 使用的基础系统规则；Ask/Plan、Creator、其他 capability packs 和用户 agent_system_prompt 设置尚未全量迁入。RAG 确认为桌面内置本地检索链路，不是外部企业知识库接入；云端 RAG 尚未实现。
- 已补提示词加载和条件选择回归源码，未执行测试。
- 本批后端/Web TypeScript 检查退出0；测试、构建、模型调用及部署未执行。后续仍需验证真实模型请求使用的提示词与 manifest 一致。

## 验证与部署

### 全量对齐后续批次（进行中）

- 服务端冻结 mode/category/permission，Ask 无工具，Plan/只读权限只注册已分类的读取工具；Web 透传选择，删除此前拒绝 Ask/Plan 的分支。其他 Creator 类别仍待对应业务工作流实现，不作为完成项。
- 用户 agentSystemPrompt/language/fontSize 通过 /api/preferences 按用户持久化；提交任务冻结 customInstructions/language，Worker 不读取最新设置。005-user-preferences.sql 仅在临时测试库执行，生产未迁移。
- prompt packs 按实际工具选择；使用与桌面相同的 before_agent_start 精确系统提示词投影。新增测试捕获模拟 provider 请求，验证真正收到唯一的系统提示词，而非依赖 SDK 旧 state.systemPrompt 字段。
- read/write/edit/grep/find/ls 替换 read_file/write_file，I/O 通过沙箱只读运行脚本，带路径、大小、符号链接、正则超时控制。RAG 四工具、PostgreSQL 索引、按 owner/conversation 检索及回答前注入已接入；引用内容使用编码边界，不拼接可闭合标签。离线模型镜像准备仍在收尾。
- 按最新要求移除云端项目面板和最近需求导航，保留个人空间；空间公开接口改为 /api/workspaces。全新结构已统一为 workspace/workspace_id/workspaceId，不保留 project 字段和兼容迁移。
- 中间验收：临时 PostgreSQL 中151项自动化测试通过，0失败、0跳过；生产前端构建通过（有单个大块体积警告）。此结果不代表全部P0–P9业务或真实OpenSandbox/模型联调完成，后续变更仍需复验。

### 之前批次的历史验证记录

之前补充了架构边界、会话领域、AgentSession、提示词和检查点回归测试源码。`npm run typecheck`（后端及桌面来源 Web 两套 TypeScript 配置）通过。当时测试、构建、数据库迁移、真实模型/OpenSandbox 联调未执行；当前自动化验证进展以上节为准。

第二批最终检查：`npm run typecheck` 退出0；102个相关源码/测试/迁移/文档文件以 no-index diff 检查无空白错误（保留桌面来源文件的 CRLF）。新增领域、交付幂等/恢复、SSE 重连、技能正文/版本和删除 outbox 回归源码，均未执行。代码审阅不等同运行验收。004删除 outbox 必须在更新 API/Worker 前部署，不能只更新代码而跳过迁移。

当前按全新独立云端数据库初始化：`npm run db:init` 安装 `database/schema.sql`。此前001–006增量文件已合并删除，没有历史升级路径。API/管理员只检查结构，拒绝非空未知库，不清空开发数据。Windows x64 与 Linux 实际部署尚未验收。
