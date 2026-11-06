# Cloud 内置 MCP 全面检查与统一接入设计

## 背景与目标

用户要求逐项检查其它内置 MCP，保持桌面功能一致，后续新增连接器可以直接配置。仅接通通用 GET/POST /api/mcp 不能作为内置卡片验收：卡片还调用预设、安装、配置和专有授权接口。目标是使内置入口与手动配置共用同一个资源、凭据、连接和任务运行时，避免每增加一个标准 MCP 就修改路由。

## 已核对现状

| 内置 MCP | 桌面/迁入卡片合同 | Cloud 当前缺口 | 修正方向 |
| --- | --- | --- | --- |
| AI 知识库 | POST /api/mcp/presets/knowledge → 标准 OAuth → 选择调用 | 之前前端拦截且后端未注册预设；本轮已补上 | 固定测试环境 resource/issuer、DCR 与 mcp:tools scope；授权完成探测；凭据按用户加密 |
| GitLab | GET /api/mcp/builtin/npm/gitlab；POST install/configure；服务地址与 PAT 表单 | 专用路由均未注册；卡片初始状态加载失败 | 数据驱动的 npm 预设与字段表单，版本对齐 @masuratech/gitlab-mcp-server@1.0.0 |
| Jenkins | 同 npm 合同；URL、用户名、API Token 表单 | 专用路由均未注册 | 同一 npm 预设服务，版本对齐 @kud/mcp-jenkins@2.3.0 |
| TAPD | 安装、创建授权、轮询、确认/取消、grants、重新授权和解绑 | 全部专有授权路径缺失，不能以标准 MCP OAuth 替代 | 保留企业 broker 协议，云端独立用户身份、challenge、grants 与临时凭据；不恢复已移除的项目/需求面板 |
| Figma | POST /api/mcp/presets/figma {mode:desktop}；127.0.0.1:3845/mcp | 路由缺失且本机地址指向沙箱，而非用户电脑 | 优先官方远程 MCP；本机中继需要另外的电脑连接能力，不能把修改 URL 视为等价迁移 |

核对入口：cloud/web/desktop/src/components 下五张内置卡片；frontend/src/api/client.ts 的 MCP 路由；src/agent/builtin_npm_mcp.ts、knowledge_mcp.ts、figma_mcp.ts、builtin_mcp.ts；src/domains/tapd-auth/node/{client,config,identity,service}.ts。Cloud 不运行时导入桌面模块。

Figma 选型核对：官方远程地址 https://mcp.figma.com/mcp 不能替代桌面当前选中图层状态，且当前有客户端准入。依据：https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/。用户最终明确本轮不接入 Figma；保留卡片并显示暂不可用，不实现远程 MCP 或本机中继。

## 统一方案（已确认）

2026-10-14 用户确认补齐方案，随后明确“figma先不对接”。本轮排除 Figma 接入和电脑中继，仅将其卡片标为暂不可用；其余方案按本文实施。继续保持桌面源码独立，验证授权沿用确认的验收范围。

### 1. 同一事实源与配置驱动

- 继续使用 resources 中用户级 connector 配置与加密 secret；内置卡片和聊天框均从同一连接器视图读取，不建立第二套连接器列表。
- 固定预设注册表保存名称、传输、版本、环境变量字段、说明和授权类型。卡片按钮调用通用预设服务，沿用桌面路径作为 UI 合同，但共享实现；不让浏览器任意指定内置包名、版本或信任等级。
- 标准 MCP 支持 stdio/HTTP/SSE、args/env/headers、启停、OAuth 客户端配置。新增符合这些合同的服务只需在配置中添加条目，不需要新建专用后端 API。不保证企业私有授权协议仅凭标准 JSON 即可接入。
- 前端不得在通用适配层硬编码拒绝未逐项列举的 MCP 路径；已知预设与内置接口完整转发，未知接口由后端返回真实 404。

### 2. GitLab/Jenkins 的依赖与凭据

- 将桌面已锁定包安装到 Linux 执行镜像，在沙箱验证真实版本和入口。API/Worker 不执行 npm 或用户进程。
- install 表示准备/验证执行环境与当前用户预设，不能固定返回 installed=true。status 按实际运行时检查、当前用户配置和字段完整性返回状态。
- configure 校验声明字段和 URL；Token 加密保存，空 Token 表示保留既有值。前端只回读非秘密字段和 hasToken，不回读 Token。
- 同名手动配置冲突时拒绝覆盖。配置变化清除旧探测结果，聊天框选中后仍使用真实 UUID。

### 3. 标准 OAuth 与 Figma

- 复用已接通的 OAuth 开始、取消、回调、退出和刷新；协议网络请求仍在沙箱。用户亲自同意第三方授权。
- 远程 Figma 方案只在确认后实现，提供文件/节点链接输入和可见的提供方准入失败原因。需要预注册 clientId 时使用现有配置字段，不借用桌面或其它客户端身份。
- 若用户选择本机中继，另行设计用户电脑到 Cloud 的认证、生命周期和 MCP 转发，不把沙箱 loopback 当作用户电脑地址。

### 4. TAPD 专有授权适配

- 保留桌面的固定 broker https://gateway.example.com/tapd/v1/integrations/tapd 及 attempts/grants/credentials 合同，真实状态不能以空数组或固定成功替代。
- Cloud 为每个用户生成独立 deviceId 和 client secret，加密存储；授权挑战绑定 owner 与当前 session，一次性确认/取消。任务调用前重新核对 grant、workspace、revision 和有效期。
- broker 授权网络操作及 TAPD MCP 运行仍位于受控沙箱；原始令牌不进入模型、浏览器或命令字符串。多账号/授权过期/解绑保持桌面行为，用户需亲自完成浏览器授权。
- 所需 TAPD Python MCP 与版本在执行环境验证；不读取桌面设备身份、系统钥匙串，也不恢复已明确移除的项目工作流。

### 5. 任务实际能力与声明一致

- 配置暴露字段应有对应运行时行为：仅激活本次选择的连接器，按工具暴露策略过滤，不能保存 hidden 却让通用 MCP 网关照样调用。
- 保持任务内 MCP 会话与缓存可复用；不同任务/用户不共享凭据、协议进程或工具元数据。断开、编辑和退出授权使旧代次失效。
- direct/deferred/codemode 等暴露策略与桌面工具注入合同逐项验证，不把“已传 connectorIds”当成全部运行能力等价。

## 非目标

不改桌面代码，不共享桌面数据库或凭据，不自动迁移/清空业务库，不让用户 MCP 在控制面执行，不代替用户第三方登录。标准配置不能承诺访问用户电脑上的本地 MCP；未获 Figma 准入或企业 broker 不支持云端身份时明确报告阻断。

## 影响与风险

改动限 cloud 的预设注册表、连接器领域、HTTP 适配、沙箱执行镜像/运行时、卡片与 Agent 装配。复用现有 resources.data/secret，不增加数据库迁移。TAPD 多用户授权的持久状态与并发需要重点审查；Figma 远程模式具有供应商准入及能力差异。Windows/macOS 客户端通过相同 Cloud HTTP 使用，平台命令只在 Linux 沙箱；Windows 实机验证须单独记录。

## 验收

- 对五张内置卡片实际发出的全部路径建立主应用路由覆盖，不只测试独立函数。
- 浏览器逐张验证初始状态、添加/安装、配置保留、授权、失败重试、断开/解绑、删除和聊天框选择发送。
- 隔离沙箱验证锁定包、stdio/HTTP/SSE、标准 OAuth 与受控 TAPD broker；真实账号授权由用户操作，不能用模拟结果宣称第三方联调完成。
- 验证多连接器选择、同名 UUID、未选择拒绝、编辑/撤销后旧凭据不能使用、同任务缓存保持及暴露策略。
- 执行已授权的回归、类型检查和 Web/执行镜像构建，确认所有卡片不再因 Cloud 漏路由而失败。需要外部平台准入或授权时明确保留验收边界。

## 本轮实施与证据

- GitLab/Jenkins/TAPD 专用路径由主应用注册，前端 MCP 路径完整转发。npm 配置与自定义 MCP 使用同一 connector 资源；新标准 MCP 无需新增 API。
- GitLab/Jenkins npm 版本与桌面对齐；TAPD 8.0.81 要求 Python >=3.13，故使用独立 Python 3.13.15/uv 0.12.13 环境，文档处理保持原 Python 3.11 环境。
- TAPD 状态放在其 connector 加密 secret，不进入资源 DTO。授权 attempt 持久化并绑定 owner/session，确认和取消先核对 broker 当前状态；调用前取实时项目及临时凭据，纯项目列表不签发 token。配置编辑和运行时按资源 UUID/revision 核对。
- 59 项针对性回归、两套类型检查和 Web 构建通过；执行镜像构建完成；临时沙箱验证三个包版本并发现 GitLab 25、Jenkins 38、TAPD 44 工具。TAPD 的启动账号接口是受控本地 fixture，未使用真实业务账号或保存测试资源。
- 模拟浏览器验证 npm 配置/保留 Token、TAPD 确认/解绑、Figma 禁用、标准 OAuth 与连接管理；审查指出的 hidden 原型继承、空项目发现、schema 项目参数、重复确认及 stderr 泄露已修正。
- 本轮仅验证 generic MCP 网关的选择隔离和 hidden 策略；桌面的 direct/deferred/codemode 专用工具注入、通用 MCP 持久协议进程/缓存仍未对齐，不把元数据保存当作这些策略验收完成。真实第三方账号授权和 Windows 实机尚未验收。
