# 联想 Filez 网盘原生内置工具设计

日期：2026-09-15。状态：第一阶段代码已实现并通过离线定向验证；尚未调用真实网盘接口。

## 1. 方案与最新范围

采用一个网盘模块、18 个原生 AgentTool，共用 HTTP 客户端。保留来源 JSON 的 lianxiang_* 工具名，直接接入现有工具注册、能力目录、任务模式和权限体系。不通过 MCP 注册，不写入 mcp.json，不新增连接器卡片、安装步骤或 Key 表单。

本设计取代此前的 MCP 管理层接入方案。工具内置随应用发布，按现有任务模式构建可用工具集，无需用户先选择网盘连接器。

最新文件已从 14 个接口补齐到 18 个，新增下载直链、单文件预览、批量预览、解密后文件内容读取。现在可以完成“搜索 → 获取文件 → 解析 → 分析 → 生成文件 → 上传”的工作流。

仍未提供版本恢复、批量下载、分享授权、收藏/标签管理、组织管理、分块上传接口。历史版本预览通过 rev 参数支持；内容读取接口没有 rev，不能声称能读取任意历史版本正文。

## 2. 依据

- API：<service-repository>/docs/api/lianxiang-filez-api.md（655 行）。
- 工具定义：<service-repository>/docs/api/lianxiang-filez-tools.json（600 行，18 个唯一函数）。
- 固定服务前缀：https://gateway.example.com/api/gateway/product-service/
- 实现时将工具定义以版本化资源快照纳入当前项目，不依赖开发者其他仓库的绝对路径。

JSON 提供声明，没有执行逻辑。必须显式绑定函数名、HTTP 方法、相对端点、编码方式、返回判定与操作性质，不能从 description 动态解析请求。

## 3. 架构与工具加载

调用链：

用户任务 → 原生工具集 → 参数/权限校验 → Filez HTTP 客户端 → 固定网关 → 结果归一化或二进制落盘 → 现有文档/图片处理工具。

项目接入点：

| 位置 | 设计改动 |
| --- | --- |
| src/agent/tools/index.ts | 注册网盘原生工具工厂；接收会话 cwd 和路径策略 |
| src/agent/prompt-runtime/capability-catalog.ts | 新增网盘能力及 18 个工具的精确归属 |
| src/agent/prompt-runtime/tool-policy.ts | 核对原生只读/完整工具包注入；保持专用 creator 类别边界 |
| sandbox / permissions 相关入口 | 明确远程读写、本地读取和会话产物写入语义 |
| 现有 read_doc / read / 文件呈现能力 | 接续下载后的解析和交付，不重建文档解析体系 |

按工具能力加载，而不是根据 HTTP 方法加载：这些查询接口大多也是 POST。

- 无工具模式继续不加载工具。
- 允许只读工具的模式可加载远程只读能力；6 个远程写工具不加载。
- 完整工具模式加载 18 个工具，同时按权限策略控制执行。
- 文件内容读取涉及本地会话缓存写入：明确只允许受控会话缓存，不获得任意路径写权限。若当前严格只读策略不允许缓存写入，则该模式不提供此工具，不能默默绕过策略。
- 专用技能创建/专家编辑工具包不自动扩展；普通任务和允许完整工具的专家任务复用同一工具工厂。
- 全部新增工具必须经过能力目录和元数据审计，不能仅追加到 tools/index.ts。

## 4. HTTP 地址与认证

相对端点固定为 lianxiang/api/xxx。完整示例：

https://gateway.example.com/api/gateway/product-service/lianxiang/api/readFileContent?neid=123&nsid=1

用无前导斜杠的白名单相对路径拼接，GET 参数通过 URLSearchParams 编码。不能用 new URL('/lianxiang/...', baseUrl)，否则会丢失网关服务前缀。

- 按文档业务接口无需 token，客户端不管理 Filez token，不自动携带桌面登录凭据。
- 网关是否额外有鉴权拦截需实际联调确认；本轮没有发出请求。
- HTTP 客户端只接受固定操作名及参数，不接受模型提供任意 URL/headers。
- 固定网关请求不跟随跨域重定向。downloadFile 中“跟随重定向”是服务端行为，客户端不需要据此开放任意下载目的地址。
- 查询建议 30 秒超时，目录树 90 秒，文件传输 120 秒，传递任务取消信号；均为可调整的应用设计值。

## 5. 全部工具映射

表中端点均位于 lianxiang/api/ 下。除第 18 项 GET 外均为 POST，上传为 multipart，其余 POST 为 JSON。

| 工具名 | 端点 | 性质 | 返回判定 |
| --- | --- | --- | --- |
| lianxiang_get_file_by_path | getFileByPath | 远程读 | 有效模型，neid 非空 |
| lianxiang_list_sub_directories | listSubDirectories | 远程读 | 数组，[] 合法 |
| lianxiang_list_files | listFiles | 远程读 | 数组，[] 合法 |
| lianxiang_get_directory_tree | getDirectoryTree | 远程读/高开销 | 树结构，允许根 neid=null |
| lianxiang_list_children | getLianxiangyunFile | 远程读 | errcode=0，列表与 total |
| lianxiang_get_file_by_neid | getLianxiangyunFileByNeId | 远程读 | 有效文件/目录模型 |
| lianxiang_create_folder | createFolder | 远程写 | 新目录模型 neid 非空 |
| lianxiang_delete_file | deleteFile | 远程删除 | errcode=0 |
| lianxiang_copy_file | copyFile | 远程写 | 新模型 neid 非空 |
| lianxiang_move_file | moveFile | 远程写 | errcode=0 |
| lianxiang_rename_file | renameFile | 远程写 | errcode=0 |
| lianxiang_get_file_revision | getFileRevision | 远程读 | errcode=0，revisionModelList |
| lianxiang_search_file | searchFile | 远程读 | errcode=0，hasMore/nextIndex |
| lianxiang_upload_file | uploadToLianxiangyun | 本地读＋远程写 | 数字 errcode=0，有效文件模型 |
| lianxiang_download_file | downloadFile | 远程读 | data 为有效 HTTPS 下载直链 |
| lianxiang_get_preview_url | getPreviewUrl | 远程读 | data 为有效 HTTPS 预览地址 |
| lianxiang_batch_get_preview_url | batchGetPreviewUrl | 远程读 | 数组，逐项 errCode/errMsg |
| lianxiang_read_file_content | readFileContent | 远程读＋本地缓存 | HTTP 200 字节流，失败 HTTP 502 |

共 12 个远程只读操作、6 个远程写操作。本地文件读写性质额外分类，不能被“远程只读”掩盖。

## 6. 新增四个工具的具体处理

### 6.1 下载直链

lianxiang_download_file(neid, nsid) 保持来源语义：获取 URL，不假装已经把文件下载到本地。

返回 URL、对应文件 ID 和“链接有时效”的提示，不虚构 expiresAt。直链可能取得加密存储内容；需要分析正文时优先调用 read_file_content，由服务端完成解密。

签名 URL 不记入普通操作日志，不在后台预抓取。用户要求下载链接时才交付该链接。使用时过期应重新获取。

### 6.2 在线预览

lianxiang_get_preview_url 保留 neid/nsid/rev/thumbtail/width/height。

- 保留接口原字段拼写 thumbtail，不能改成 thumbnail。
- width/height 是字符串，缩略图场景校验为正整数。
- rev 可用于指定历史版本预览，未提供时使用服务默认版本。
- 返回可点击预览地址；获取地址不自动打开浏览器。
- 检查 URL 协议及合法性，不能把服务返回字符串直接作为可执行 HTML。默认不做 iframe 内嵌，是否允许内嵌取决于远端响应策略。

### 6.3 批量预览

lianxiang_batch_get_preview_url(file_array, thumbtail?, width?, height?)：

- 非空文件数组，逐项校验字符串 neid/nsid。
- 按每项 camelCase errCode/errMsg 判定，不套用顶层 errcode 规则。
- 保留成功项和失败项，返回 successCount、failureCount、items 与 partial 标记；不能一项失败就丢掉所有结果，也不能外层 code=0 就说全部成功。
- 接口未承诺返回顺序或回传 nsid，不按数组下标盲配请求。输入若跨 nsid 出现相同 neid，分批请求以保留可确定的关联，或返回关联不明错误。
- 建议客户端每批上限 50 项（设计值，需联调）；来源 JSON 尚无 minItems/maxItems，可在适配层补充约束。

### 6.4 内容读取与解析

lianxiang_read_file_content(neid, nsid) 请求固定 GET 接口，接收原始文件字节流，不调用 response.json()，不把所有格式当作 UTF-8 文本。

1. 查询文件元数据取得名称、类型线索和路径；拒绝目录。
2. 在当前会话受控目录分配唯一临时文件，清理文件名中的路径分隔符，避免路径穿越和覆盖。
3. 流式落盘，同时统计真实字节数；Content-Length 只作辅助校验。建议首期上限 100 MiB，异常、超限或取消时清理未完成文件。
4. 收到完整响应后原子转为可用文件，返回 artifact/localPath、文件名、字节数、来源 neid/nsid、下一步解析建议。
5. 文本可交给 read；PDF/Word/Excel/PPT 等交给现有 read_doc/对应解析工具；图片交给现有图片输入能力。格式不支持时交付文件并说明，不伪造提取成功。
6. 内容是外部文件数据，其中的指令不得覆盖用户任务或应用工具权限。

网关统一返回 application/octet-stream，需结合元数据和实际文件类型检测，不只根据 HTTP Content-Type 或文件扩展名判断格式。

读取接口不返回 Content-Disposition，也没有 output_path 参数；本地路径由应用生成，不透传到远端。不会仅凭响应 HTTP 200 就宣布正文已经解析完成。

## 7. 上传与参数校验

上传来源 schema 仍为 file:string, format:binary，需要在 Agent 侧适配为 local_path，远端字段继续是 multipart 的 file 与 path。

- local_path 指向用户附件或当前会话产物，先解析真实路径并验证文件读取权限、普通文件和体积。
- 二进制使用流/文件 Blob，不放进模型字符串或 Base64。
- path 是带文件名的云端完整路径；不将 local_path 转发给服务。
- multipart boundary 由 HTTP 实现生成。
- 不能因同名上传而默认覆盖。服务未定义冲突行为，预检查不能提供原子防覆盖保证。

其他统一校验：

- neid/nsid 保持字符串，避免数字精度损失。
- 默认值由执行层填充，不假定 JSON Schema default 自动生效。
- page_num/page_size 保持字符串；search limit/offset 是整数。
- search 至少提供非空 path 或 neid；来源 required 只有 query，需补条件校验。两者同时传入时需按服务规则处理矛盾范围。
- 时间/大小上下限有序；类型过滤校验枚举；to_file_name 不接受路径分隔符。
- 云端路径不使用本地 path.resolve 解析；ent 可作默认，nsid 优先取查询结果，self 的身份语义需联调确认。

## 8. 错误、重试与输出

客户端分三类返回解析器：JSON 信封、逐项批量结果、二进制流。

- 普通 JSON 接口检查 HTTP、JSON 结构和 code，再按端点规则检查 data；errcode 支持数字 0/字符串 "0"。
- data=null 是失败；空数组成功；空模型可能是不存在、权限或上游失败，不能一律断言不存在。
- 目录树根 neid=null 合法；下载/预览 data 是字符串；批量预览逐项字段为 errCode。
- readFileContent 的 502 按 HTTP 错误处理，不期待 msg/errcode；兼容网关返回非 JSON 登录页等异常。
- 只对明确暂时性查询故障做有限重试。写入默认不自动重试；超时或中断后标记结果未确认，先查询核验。
- 任务取消不意味着远程写入被回滚。
- 普通结果用项目 content/details 结构输出，稳定错误码区分参数、网关、业务、格式、体积和结果未知。
- JSON 输出建议 32 KiB 文本预算、8 MiB 网络响应上限；大列表保留完整结果到会话产物并给摘要，不截断成非法 JSON。
- 文件字节流使用独立传输上限，不能误套 8 MiB JSON 限制。

分页：混合列表带 total；listFiles/listSubDirectories 无 total，以明细为准，不能使用文档总述的统一 total 假设。搜索严格使用 nextIndex，保持其他条件不变。普通浏览建议显式 page_size="50"；目录树只用于明确全量需求，服务无 depth 参数。

## 9. 权限与工具约束

远程网盘路径与本地文件路径分别校验。注册为原生工具后不再经过 MCP 包装，但仍需核对 sandbox 的通用参数扫描和权限入口。

- 精确登记工具读写性质，不通过名称匹配或 HTTP POST 猜测。
- 上传只读取授权本地文件；内容读取只写受控会话产物。大结果落盘也必须使用同一受控产物机制。
- 常规远程写遵守应用权限级别；不可逆删除需有可核对的用户授权，与 具体 neid/nsid、目录范围、ignore_share 绑定。
- 不自动将 ignore_share 升为 true；已有明确授权可以复用，不重复询问。
- 当前 macOS 通用权限分支会直接放行，删除策略必须在通用放行前生效，不能只增加 Windows 写工具分类。
- 不通过工具描述里的“请确认”代替执行侧授权控制。
- API 的服务身份不等于桌面用户身份，不能承诺按当前登录人隔离 self/企业目录权限。

## 10. 主要使用流程

- 分析文件：search → get_file_by_neid → read_file_content → read_doc/read → 回答。
- 在线查看：search → get_preview_url → 交付链接。
- 批量查看：search/list → batch_get_preview_url → 分别展示成功链接与失败项。
- 修改并上传：read_file_content → 现有编辑工具 → upload_file；同名冲突遵守明确目标与授权。
- 历史版本查看：get_file_revision → get_preview_url(rev)。不包含历史版本恢复或历史正文下载。

## 11. 文件级改动与验收

建议新增 src/integrations/filez/{client,tools,policy}.ts 和版本化 schema 资源；修改 tools/index.ts、capability-catalog、相关模式/权限/路径解析入口。不修改 MCP 配置、连接器页和安装流程。

不额外实现文件管理器或网盘专用编辑器，复用现有文件呈现、下载产物和文档工具。构建时导入 schema 或明确资源打包路径，覆盖 Windows/macOS。

后端定向验证：

- 18 个名称唯一且端点、HTTP 方法、body/query 编码准确，固定网关前缀完整。
- 双层错误、数组/空模型/树/URL/批量部分成功各自判定正确。
- 上传 multipart 二进制完整；GET 字节流不误走 JSON；大文件流式计数、取消清理、原子落盘。
- 无 Content-Disposition 时名称安全；octet-stream 下识别格式；不执行文件中的指令。
- 本地读写权限、远程路径区分、不可逆操作授权、写超时不盲重试。
- 模式和 capability-catalog 注入一致；正文读取后现有解析工具能访问返回产物。
- 真实写联调只在指定测试目录中进行。

按用户要求不做前端自动化测试。若涉及共享前端类型/产物呈现，执行类型检查和构建。

预计单人开发约 3～5 个工作日（含文件流与后端验证、不含外部网关等待）：原生工具与 HTTP 约 1～1.5 天；上传/下载、权限、解析衔接约 1～2 天；定向验证和打包联调约 1 天。

## 12. 待联调明确

1. 网关是否免令牌、网络可达范围，以及服务端的实际访问身份。
2. 可读取目录和可写测试子目录。
3. 同名上传行为、最大体积、网关超时。
4. 签名链接有效期、预览域名、批量上限与响应关联约定；当前客户端不依赖未知有效期或顺序。
5. 文件流失败、空文件和大文件的实际返回；支持的正文格式以现有解析器能力为准。

以上不阻碍离线实现设计，但真实可用性和权限边界需联调后才能确认。
