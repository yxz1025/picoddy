# 云端后端以桌面代码为基线对齐

日期：2026-10-12。状态：用户已确认并要求开始写代码；正在实施，完成度以实际检查记录为准。

## 背景

用户要求桌面与云端分别维护，但采用相同业务架构和尽量相同的业务代码，仅在运行环境边界加入云端特性。此前 cloud/ 的独立实现不仅改变了存储和执行位置，也简化了 Agent 运行时、提示词和领域组织，需要纠正。此项优先于 OSS/预览接入。

## 代码核对结论

| 桌面基线 | 云端现状 | 对齐动作 |
| --- | --- | --- |
| application.electron.ts 装配领域和 Agent | routes.ts 集中会话、SQL、快照装配、事件流等逻辑 | 建立云端应用装配入口，HTTP 边界与领域服务拆开 |
| src/domains/*/node 与 shared | resources.ts 通用 JSON 资源、files-api.ts、skills-api.ts | 按桌面领域组织服务、数据访问及合同；不是只改目录名 |
| src/agent/engine.ts 使用 pi-coding-agent AgentSession | agent.ts 直接 new Agent | 以桌面会话引擎为基线适配 AgentSession 生命周期与事件 |
| src/agent/prompt-runtime 的 profile、snapshot、envelope 与 source | prompt.ts 拼接单一字符串 | 移植平台无关的提示词组装代码，云端 source 提供冻结资源与环境 |
| SQLite getDb、同步 store、宿主机路径 | PostgreSQL、owner_id、异步事务 | 保留云端数据库，实现相同领域操作语义，不模拟同步 SQLite |
| 本地 Shell、文件、插件、MCP | OpenSandbox 代理工具 | 保持业务工具合同，副作用只能通过云端执行边界 |
| 桌面事件与会话生命周期 | runs/events、租约与 SSE | 业务事件做显式映射，云端调度与可靠性独立保留 |

证据入口：src/agent/engine.ts、src/agent/prompt-runtime/runtime.ts、src/domains/session/node/store.ts、cloud/src/agent.ts、cloud/src/prompt.ts、cloud/src/routes.ts、cloud/src/worker.ts。

桌面架构文档存在历史描述，实际迁入必须以当前源码及安装版本为准。例如不能因文档提及 Deno 或 Express 就引入这些实现。

## 目标与非目标

目标：保持应用装配、Agent、领域、平台、基础设施这五个职责层次；可移植业务算法直接从桌面复制并记录来源，只有确有平台差异时才修改；把云端身份、异步持久化、沙箱执行和持久调度集中在明确边界。

所有文件仅在 cloud/ 内变化，不修改根目录后端、桌面前端或根依赖，不建立运行时跨目录 import，不自动提交用户工作树。

不恢复 Electron/系统钥匙串/本机控制，不改回 SQLite，不取消 Worker 与租约，不允许用户插件或技能在 API/Worker 进程加载执行。本轮不接 OSS、不实现工作目录自动同步、不将企业 SSO/TAPD/SkillHub 等未实现功能标记完成，不顺便扩展全部桌面业务。

## 方案选择

采用：在 cloud/ 内保留桌面模块结构和可移植代码，通过云端平台实现接入现有 PostgreSQL、Worker、OpenSandbox。

不采用整体原样复制后直接启动：桌面存在 getDb 单例、本机路径、模型与插件资源加载等环境假设，可能破坏用户隔离。

不采用只移动当前云端文件：不能解决 AgentSession、提示词、领域行为的真实差异。

## 目标组织

```text
cloud/src/
  application.ts             应用装配与显式依赖注入
  server.ts                  HTTP 进程启动
  worker.ts                  云端执行进程启动
  agent/
    engine.ts                桌面 AgentSession 引擎的云端适配
    prompt-runtime/          桌面提示词构建与云端 source
    tools/                   工具定义与受控执行入口
  domains/
    session/node/            会话服务、消息、数据访问
    skill/node/              用户技能、版本与快照
    attachment/node/         上传、归属和下载
    artifact/node/           发布交付物
    settings/node/           用户模型与配置
    memory/node/             用户记忆
    project/node/            现有空间元数据
    automation/node/         自动化业务
    connector/node/          MCP 配置与选择
  platform/
    sandbox.ts               OpenSandbox 执行与回收
    storage.ts               当前 local/S3；后续独立接 OSS
  infra/
    db.ts                    PostgreSQL 池与事务
    crypto.ts                服务端密钥加密
  cloud/
    auth/                    登录、用户上下文与归属
    runs/                    持久队列、租约、审批、回收
  transport/http/            路由、参数和响应适配、SSE
```

只建立实际迁入的模块，不为未实现的领域创建空目录或空服务。原扁平实现迁完后移除，调用方一次更新，不长期保留双套入口。启动脚本路径可保持稳定。

## 业务与数据边界

每次请求由认证层生成不可由请求体覆盖的 userId。领域服务和数据访问显式接收此身份；Worker 从已持久化且验证过的 run 获取身份，不使用全局“当前用户”。文件、会话、模型、技能、审批与缓存查询仍同时匹配资源 ID 和归属。

复用桌面字段语义不等于照搬数据库表：第一轮保持当前 PostgreSQL 表和已存数据可读，先抽离 SQL 到所属领域 store。桌面同步接口改为明确异步接口，业务事务在云端仍保持原子性。禁止用新接口绕开 run lease_token 校验。

保留现有浏览器 HTTP/SSE 合同；前端的 DTO 映射只有在后端提供等价合同并验证后才删除。内部 Agent 事件到云端持久事件使用单一映射，不能让新旧事件重复推动页面状态。

## AgentSession 与提示词迁入

1. 复制桌面会话引擎结构和事件归一化逻辑，使用同版本的 pi-coding-agent 及其依赖；以本地已安装类型确定接口。
2. 模型解析从全局 getModels 替换为当前 run 冻结的用户配置；密钥仅用于控制面模型请求，不写入用户工作目录。
3. 禁止默认扫描宿主机 cwd、HOME、auth.json、models.json、插件和上下文文件。资源通过明确的云端加载器注入，只允许应用自带可信扩展；用户代码只能在 OpenSandbox 中执行。
4. AgentSession 所需的本地会话文件属于控制面内部状态，不等于用户工作目录。权威会话状态仍在 PostgreSQL；启动按会话序列重建，压缩检查点和会话事件受 run 租约保护写入，避免多 Worker 覆盖。不能在尚未持久化压缩状态时声称恢复能力完成。
5. prompt-runtime 的编码、分块、预算、快照和 envelope 逻辑尽量原样迁入。environment/workspace/settings/memory/skills/expert 等 source 从云端显式上下文取值，禁止读取宿主机用户配置。
6. 桌面提示词中本机应用、绝对路径、交付物入口等环境陈述替换为云端真实能力；不把不可用工具写进模型可调用能力清单。
7. 自动压缩和重试由 AgentSession 负责，但副作用工具在重启后不自动重放；云端取消、超时、审批和租约丢失仍能中断执行并进入现有清理流程。
8. 未接入的 ask/plan/readonly 等模式继续明确拒绝，只有工具权限策略真实实现后才开放；不因迁入提示词而假装支持。

## 工具与用户代码隔离

按桌面定义整理工具名称、参数和结果形态，逐项记录云端差异。文件操作、命令、MCP、文档执行必须经 OpenSandbox；模型允许调用的工具集合来自当前任务授权快照。不得为适配桌面工具而回退到 Worker 本地 spawn 或 fs 访问用户文件。

技能仍使用不可变版本，运行中的任务不受安装更新影响。任意用户插件不能作为 AgentSession 控制面扩展加载。应用自带可信编排扩展如需调用子工具，同样经过授权、审批和审计，不得绕过云端执行门禁。

## 执行顺序与完成标准

1. 分层与领域入口：拆分装配、HTTP、会话、资源数据访问，保持现有 API 行为及数据不变。
2. 桌面业务代码复用：记录每个迁入模块的源路径、源内容哈希及差异理由，优先可独立迁入的业务规则；没有真实调用的复制不算完成。
3. AgentSession 与 prompt-runtime：迁入后替换旧 Agent 和字符串提示词路径，补齐持久状态与事件映射。
4. 工具及核心领域联通：验证选择技能/模型/MCP、发送消息、审批、发布文件、重连与取消的完整调用链。
5. 更新 cloud/ 架构、API、运维和完成度文档，明确保留的云端差异和未迁入领域，再继续 OSS/预览任务。

各步骤是同一调整的检查点，不因完成目录分层就声称整个后端对齐完成。依赖或运行时接口如果不能满足隔离与恢复要求，暂停该替换并报告证据，不静默改回独立简化实现。

## 风险与验证

重点风险：默认资源加载引入宿主机秘密、用户配置串用、同步到异步后事务失效、事件重复、上下文压缩未持久化、工具名称映射绕过审批、取消后仍写结果、迁目录漏改脚本/测试 import。

编写回归用例覆盖双用户隔离、会话与消息契约、提示词快照、事件归一化、任务租约丢失、审批恢复、工具副作用执行位置、技能版本固定、压缩恢复、取消与回收。按仓库限制，未获授权不运行测试或构建；只执行语法、TypeScript 和 diff 检查。Linux 沙箱与 Windows/macOS 控制面兼容分别记录，未做 Windows 验证不得声称通过。

记录“已迁入代码”“静态检查”“自动化测试”“真实环境验证”四种证据，不能混同。真实模型、数据库、OpenSandbox 验证及依赖下载按环境权限执行。

## 待确认

按此设计先对齐云端后端的核心业务架构与运行时，保留现有云端安全与持久调度机制；暂停 OSS 实现直到上述基础调整完成。未实施的企业功能和工作空间同步仍作为独立任务。
