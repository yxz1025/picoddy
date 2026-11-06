# Cloud API v1 与模块契约

所有路径同源 `/api`，JSON response `{data: ...}`，错误 `{error:{code,message}}`。POST/PATCH/DELETE 检查 Origin。session 使用 HttpOnly cookie。资源 ID 为 UUID；事件 ID 为递增整数的字符串表示；时间 ISO8601；列表返回数组。写接口不接收 ownerId。下文资源集合的 GET/POST 对应列表/创建，/:id 的 PATCH/DELETE 对应更新/删除，不提供未列出的单资源 GET。

## HTTP

- GET /api/health：公开 live；GET /api/ready：依赖 ready。
- POST /api/auth/login `{email,password}` → `{id,email,name}`；GET /api/auth/me；POST /api/auth/logout。
- GET/POST /api/conversations；创建 `{title,workspaceId?}`；PATCH/DELETE /api/conversations/:id。
- GET /api/conversations/:id/messages → `{id,role,content,createdAt}[]`；toolResult 额外返回 `toolCallId/toolName/details/isError`，用于恢复消息级交付批次。数据库内部仍保存完整 Pi Message，不公开运行时游标或任意内部字段。
- POST /api/conversations/:id/runs `{prompt,skillIds:[],connectorIds:[],fileIds:[],expertId?,modelId?,idempotencyKey}` → run。
- GET /api/runs?conversationId=；GET /api/runs/:id；POST /api/runs/:id/cancel。
- GET /api/runs/:id/events?after=0 SSE，`id` 数据库递增值；data 为 `{id,runId,type,payload,createdAt}`；统一 `event: update`。
- GET /api/runs/:id/approvals → `{id,runId,toolCallId,tool,input,status,createdAt,decidedAt}[]`；POST /api/runs/:id/approvals/:approvalId `{approved:boolean}`。
- GET /api/skills；POST /api/skills `{filename,contentBase64}`（SKILL.md 或 zip）；PATCH /api/skills/:id `{enabled,expectedVersion?}`；DELETE /api/skills/:id。
- POST /api/skills/:id/versions `{filename,contentBase64,expectedVersion}`；GET /api/skills/:id/versions。
- GET /api/skills/:id/content → `{version,description,body,hasExtraFrontmatter,files:[{path}]}`：只读取当前用户当前不可变版本的 SKILL.md，正文去除 frontmatter；不返回其他脚本文件内容或宿主路径。Web 技能详情/编辑使用真实正文，单文件内容修改创建新版本，多文件或含额外元数据的文本修改明确拒绝并要求完整文件包；仅启停不创建内容版本。Web 编辑必须携带读取时的 version，不同版本返回409；独立 displayName 暂不支持时明确报错。管理操作使用资源 UUID，名称含特殊字符不参与路径拼接。
- GET/POST/PATCH/DELETE /api/experts[/:id]；专家 `{name,prompt,skillIds:[]}`。
- GET/POST/PATCH/DELETE /api/connectors[/:id]；连接器支持 stdio、Streamable HTTP、SSE，保存启停、显示名、描述、工具暴露配置及 OAuth 客户端配置。env/headers/clientSecret/授权令牌加密存储，不回读秘密。
- GET /api/mcp → `{config,availableConfig,connected}`，供桌面同款连接器面板使用；POST /api/mcp `{mcpServers:{...}}` 原子保存完整配置，保留未回传的凭据，支持资源 UUID 和配置 revision 校验。
- POST /api/mcp/presets/knowledge `{}` → `{id,name}`；固定知识库测试环境，复用标准 OAuth。POST /api/mcp/presets/figma 返回409 FIGMA_CLOUD_UNAVAILABLE，本轮不接入桌面 Figma。
- GET /api/mcp/builtin/npm/:id（gitlab/jenkins）；POST /install `{}` 真实检查沙箱镜像中的锁定依赖；POST /configure `{env:{...}}` 加密保存配置。同名手动配置不覆盖；空或未提交 Token 保留旧值，仅回读非秘密 fields/values 与 hasToken。
- GET /api/mcp/builtin/tapd、/grants；POST /install `{}`；POST /authorize `{intent:'connect'|'reauthorize',grantId?}` 返回状态及可信 launchUrl，由浏览器打开；POST /authorize/confirm、/authorize/cancel `{attemptId}` 绑定发起会话且同终态重试幂等；DELETE /grants/:id 解绑。固定 broker 网络请求位于沙箱，云端用户身份和 PKCE verifier 加密持久化，不回读 access token。每次运行核对授权项目/revision/有效期，再获取临时凭据。
- POST /api/mcp/connect、/api/mcp/disconnect 请求 `{id}` 或 `{name}`，二者只允许其一；GET /api/mcp/tools?id= 获取最近成功探测的工具。连接测试在临时沙箱执行，connected 表示最近探测成功，实际会话调用仍在任务沙箱建立连接。
- GET /api/mcp/oauth?id= 返回当前用户授权状态；POST /api/mcp/oauth `{id,action:'login'|'cancel'|'logout'}`；GET /api/mcp/oauth/callback 接收标准授权回调并返回固定 HTML。首次主动授权启用标准 OAuth；状态绑定当前用户和会话、一次性消费。退出授权清除凭据和探测状态，Agent 调用时重新核对配置与当前凭据。
- OAuth 成功回调 HTML 不反射 query，仅执行 nonce CSP 允许的固定关闭脚本；无法关闭时回到同源 `/`，不接受任意 returnUrl。失败页保留固定错误和返回应用链接，不执行脚本。浏览器授权窗口在用户点击内预开，原页面继续轮询服务端状态，授权完成后自动检查知识库连接。
- GET/POST/PATCH/DELETE /api/models[/:id]；`{name,provider,model,baseUrl?,apiKey?}`；读不返回 key。
- GET/POST /api/files；上传 `{name,mimeType,contentBase64}`；GET /api/files/:id/download；DELETE /api/files/:id。
- GET/HEAD /api/files/:id/content：逐请求 owner 鉴权，按文件扩展名限定 inline MIME；HTML/SVG/脚本以纯文本响应，不在应用源执行。download/content 支持单段 Range（206；非法范围416）。读取按 MAX_UPLOAD_BYTES 限额并核验大小/SHA-256，HEAD 无正文；目前每次先有界读取整个对象再切片，不是大文件端到端流式代理。
- 文件删除的204表示数据库记录和持久删除任务已原子提交，文件立即不可再通过 API 访问；对象存储清理由提交后的操作完成，失败由 Worker 重试。MIME 只接受可安全用于响应头的 ASCII 字符，控制字符拒绝。
- GET/POST/PATCH/DELETE /api/workspaces[/:id] `{name,description}`。
- workspace 删除与会话/记忆绑定以 owner 锁串行化；仍被引用时返回409 WORKSPACE_IN_USE，需先解除引用。不自动删除会话或把空间记忆提升为全局记忆。
- GET/POST/PATCH/DELETE /api/memories[/:id] `{title,content,workspaceId?}`。
- GET/POST/PATCH/DELETE /api/automations[/:id] `{name,prompt,cron,timezone,skillIds:[],connectorIds:[],modelId?,enabled}`。
- GET /api/usage → `{runs,inputTokens,outputTokens,cost}`。cost=null 表示尚未配置计价，不代表费用为零。

事件 payload：text_delta `{text}`；message `{messageId,role}`（消息与事件事务提交，前端重读消息列表，不重复携带大正文）；tool_start `{id,name,args}`；tool_end `{id,name,isError}`，成功的 present_files 增加 `result`；status `{status,error?}`；approval `{id,tool,input}`；artifact `{id,name,size,batchToolCallId?}` 保留原字段。

新增 delivery_batch `{toolCallId,inputHash,details:{files,explanation?,problems}}` 是 present_files 的持久收据，与本批 files 和逐文件 artifact 事件同一事务提交。同一 run/toolCallId 重放返回相同 details，不重复发布；参数哈希不同明确拒绝。批次最多32项，文件总字节不超过 maxUploadBytes，全部校验后发布，文件必须位于 /workspace/output 且非空。浏览器路径为 `/cloud-files/:id/:name`，实际下载仍按 owner 鉴权。外部 URL 不自动加载，只提供显式打开操作。

若 Worker 在发布提交后、toolResult 消息提交前退出，消息列表从 delivery_batch 补出只供展示的交付消息，保留顺序、标题和说明；原始模型历史/检查点不注入合成消息，不因此自动重放工具。已存在对应 run/toolCallId 的工具结果时不重复展示。

## 通用数据模型

资源表 resources: id uuid、owner_id uuid、kind text（skill/expert/connector/model/workspace/memory/automation）、name text、data jsonb、secret text nullable、created_at/updated_at timestamptz。API 映射 `{id,name,...data,createdAt,updatedAt}`；绝不展开 secret。

会话 conversations: id/owner_id/title/workspace_id/created_at/updated_at。
消息 messages: id/owner_id/conversation_id/run_id/content jsonb/created_at。
任务 runs: id/owner_id/conversation_id/status/prompt/selection jsonb/idempotency_key/lease_token/lease_until/cancel_requested/sandbox_id/error/usage jsonb/created_at/updated_at，以及 started_at/finished_at/cleanup_target_status/cleanup_after。
事件 events: id bigserial/owner_id/run_id/type/payload/created_at。
文件 files: id/owner_id/run_id/name/mime_type/object_key/size/sha256/created_at。
审批 approvals: id/owner_id/run_id/tool_call_id/tool/input/status/created_at/decided_at。

selection 冻结资源快照 `{skills:[{id,name,version,files:[{path,contentBase64}]}],connectors:[{id,name,data,secret}],model:{id,name,data,secret},expert?,files:[file row],memories:[...]}`，不把秘密快照返回浏览器。

## 模块约定

`config.ts`: export loadConfig(env=process.env): Config。字段 databaseUrl, host, port, publicOrigin, secureCookies, encryptionKey, sandboxDomain, sandboxApiKey, sandboxImage, sandboxTimeoutSeconds, storageDriver (`local` 或 `s3`), storageLocalRoot, storageEndpoint, storageRegion, storageBucket, storageAccessKey, storageSecretKey, maxUploadBytes, workerConcurrency, modelAllowedHosts。storageDriver 默认 `local`，默认目录稳定解析为 `cloud/data/files`；只有 `s3` 驱动要求 endpoint/access key/secret key。

`infra/db.ts`: export pool (pg Pool)，query<T>(sql,values?)，transaction(fn(client))，migrate()。会话 SQL 在 `domains/session/node/store.ts`，业务验证与 DTO 在同目录 `service.ts`；HTTP 入口为 `transport/http/routes.ts`。

`platform/sandbox.ts`: export createSandbox(config,runId,signal?): Promise<CloudSandbox>。CloudSandbox {id, exec(command,signal?,onOutput?): Promise<{stdout,stderr,exitCode}>, write(path,data:Uint8Array), read(path,maxBytes?,signal?):Promise<Uint8Array>, destroy():Promise<void>}。读取在流式下载过程中限额；连接/取消使用官方 SDK。sandboxPath 函数只接受 /workspace 下路径，禁止 .. 与反斜杠；这不是对沙箱内部 symlink 的独立安全边界，最终安全边界仍是没有宿主机挂载的沙箱。

`platform/storage.ts`: export createStorage(config) → {put(key,bytes,mime),get(key):Promise<Uint8Array>,remove(key),ready()}。local 驱动校验规范对象 key、拒绝目录穿越和符号链接、同目录临时文件 fsync 后原子 rename；S3 驱动保持私有 bucket 接口。

`domains/skill/node/package.ts`: export parseSkillPackage(filename,bytes) → {name,description,version,files:[{path,contentBase64}]}，version 内容 SHA256；无宿主机解压或执行。

技能、附件的 service/store 不依赖 HTTP RequestContext；资源 CRUD 共享 owner-scoped store，各 settings/connector/expert/memory/workspace/automation 域独立验证业务字段。更新省略密钥保留原加密值，默认模型写入保留 owner 锁，引用验证与写入使用同一事务。当前领域操作仍是云端已支持集合，不代表全部桌面领域迁移完成。

`infra/crypto.ts`: export seal(value,key):string、unseal(cipher,key):unknown。

`worker.ts`: 通过数据库领取 run，调用 `executeRun(run,config,signal)`，负责租约和清理。`agent/execute.ts` 接入 `agent/engine.ts` 的 AgentSession；`cloud/runs/service.ts` 提供事务性任务提交。

新增 `prompt_manifest` 事件保存本轮提示词的哈希、来源修订、实际工具名、技能名与裁剪诊断，不保存提示词原文或凭据。任务排队前校验编码后的提示词预算；超限返回 400 和具体错误，不创建任务。专家提示词上限 8000 UTF-8 字节，编码后专家块上限 12000 字节；系统和当前用户提示词分别上限 64000 字节。记忆按最近更新时间优先，在 4000 字节源预算内保留完整条目，省略时在 manifest 记录诊断。

`003-session-runtime.sql` 新增 `messages.runtime_sequence` 游标与 `session_runtime` 检查点表；HTTP 消息 DTO 不增加内部游标字段。检查点保留压缩前缀并恢复后续消息，写入仍需持有 run 租约。

`004-file-deletions.sql` 新增内部 file_deletions outbox；删除文件记录与登记待删 object_key 在同一事务中，网络删除不持有用户或文件行锁。Worker 独立循环每10秒领取最多10条，默认失败5次后保留记录供管理员排障，清理租约过期后可再领取。没有公开 outbox 接口，也不接受用户提交的任意 object_key。

用户依赖和不可信工具只能在 sandbox/ 镜像执行。控制面 Pi Agent 仅安装可信内置远程工具。
