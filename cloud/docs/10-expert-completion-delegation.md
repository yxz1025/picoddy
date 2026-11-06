# 专家草稿、完成边界与子代理

日期：2026-10-12。续接已批准的全量对齐设计与 09 文档；仅修改 cloud/，桌面目录与数据不变。

## 本批实施与验收范围

1. 专家创建/编辑：独立 expert_creator 会话与用户私有草稿，先校验再由用户确认发布，编辑保留未开放编辑的原始元数据。验证跨用户访问、运行期修改、陈旧 revision、编辑基线变化。
2. 完成边界：注册 goal_complete，交付文件复验通过后持久声明；拒绝与业务工具混批，接受后清空工具续写最终解释。验证源文件和存储字节改变、取消和租约丢失。
3. 子代理：持久父子 run/会话、冻结工具子集、隔离沙箱与受限文件快照、汇总交付、审批与取消。验证禁止递归、幂等、跨用户、队列与生命周期。
4. 真实环境：独立 smoke 脚本检测 OSS 与 OpenSandbox，而不是用本地存储或 Mock 代替；真实配置缺失必须明确阻断。

## 已实现的行为

### 专家

- profile 包含 name、prompt、skillIds、description、tags、quickPrompts、icon、categoryId；关联技能必须属于当前用户。发布校验要求简介、图标、三条标签与三条快捷提问。
- 专家草稿独立 revision；校验结果绑定 revision。编辑会话冻结完整原始配置和基线 revision，发布事务复验。旧任务使用自己的快照，不被后续发布更改。
- Agent 只有当前会话草稿 read/write/validate，不拥有发布工具；用户 HTTP 发布必须携带期望版本，运行期不能发布。
- 浏览器沿用桌面的草稿面板样式和确认弹窗。编辑入口、DTO edit/create 标记、目标专家与基线信息均已贯通。创建类会话切至 Craft。
- 参考专家与激活专家不同：入队时读取同 owner 专家并冻结白名单 profile，在 user turn 中作为不可信参考数据，限制 prompt/编码字节预算；不激活其系统指令或技能，不覆盖普通会话持久绑定。公开 run DTO 仅返回参考 ID。

这是云端私有专家配置草稿流程，不等于企业市场审核/分发或桌面任意专家资源包文件编辑已经完成。Creator 提示词仍为云端专用规则。

### goal_complete

- schema：success、summary、proof，status 可为 completed/waiting_for_user；拒绝相互矛盾的状态。
- 所有包含 goal_complete 的混合工具批次在执行前被拒绝，避免同批先改文件再宣告完成。
- 对最新 present_files 批次校验 owner/run、数据库大小与摘要、沙箱源文件、对象存储字节；最终收尾再次校验。声明只代表机器可验证交付边界，不代替内容质量判断。
- 接受后拒绝所有业务工具，移除工具集，仅续最终解释。纯文本回答不强制生成文件；有交付但缺完成声明不能成功结束。
- success=false 不会标记成功；waiting_for_user 当前以 GOAL_WAITING_FOR_USER 结束本轮，不是无限保持执行的暂停状态。持久问答仍使用 ask_user_question。

### 子代理

- 单任务或最多 8 个只读任务、最多 4 路执行；worker 不允许批量并发。父任务总子 run 限 8 个，用户活动 run 限 10 个。
- 子代理工具集只能缩小，不能递归、提问或宣告父目标完成。单独 verifier 可执行需审批的 bash；并行 verifier 无 bash。
- 子 run 不由普通队列领取，父 worker 直接驱动子执行，避免父任务占满普通队列后子任务无法出队。
- 每个子任务独立 OpenSandbox，复制父当前 `work/`、`output/` 文件；附件仅在显式 includeAttachments 时注入，技能按冻结版本注入。其它临时路径不属于持久空间快照。
- 子任务不覆盖用户空间版本，仅将已发布产物复制到父任务 `output/delegated/<child-run>/`，由父任务审核并交付。父取消传播到所有活动子任务；租约复验阻止后续动作。
- 子审批从父视图恢复，但提交定位真实 child run；父视图收到生命周期事件后刷新子会话。
- 创建沙箱有独立时间上限；这不是全局容量预留。生产容量/资源配额和队列策略仍需要实际部署压测。

## 数据库

仅全新初始化 schema，新增 expert_drafts、会话 parent_id、run 父子标识。继续使用指纹拒绝未知旧 schema；不添加迁移，不清空既有开发或生产库。

本轮自动化只使用临时无持久卷容器 `picoddy-cloud-agent-test-20261012` / 数据库 `picoddy_cloud_test`。

验证结束后已停止并自动删除该临时容器及其测试数据；未操作用户开发/生产数据库。需要复跑数据库测试时须另起明确命名的测试库。

## 验证记录

- 临时 PostgreSQL 17 最终全套测试：234 项通过，0 失败，0 跳过。
- `npm run build` 通过；仍有前端主包超过 500 kB 的体积警告。
- 包含真实 HTTP + PostgreSQL 的专家新建/校验/发布/编辑、外用户 404、子任务审批与父取消；模型/OSS/OpenSandbox 未包含在该测试的真实外部连接中。
- 原生 AgentSession 测试验证终止工具后可无工具续写；不是远端模型验证。
- 审查发现并修复：子审批错误定位父 run、矛盾完成状态、子快照描述超出实际范围、创建等待边界、会话 PATCH 丢失编辑/父子元数据，以及禁用用户后仍可创建子任务。禁用用户现在不能续租或进入新工具，子任务创建直接拒绝。
- Chromium 交互脚本采用浏览器 API mock，只代表 UI。初次截图人工复核发现欢迎页遮挡和窄屏内容裁切，已修复并重跑通过：草稿加载、完整元数据、确认发布、revision/baseRevision、发布后只读、窄屏布局和遮挡检查。顶栏参考选择只更新 Composer 参考，不调用普通会话绑定接口；普通 assistant 的欢迎页行为保留。

## 真实联调命令与阻断

在 cloud/ 配置测试专用 `.env` 后执行：

```sh
node --env-file-if-exists=.env --import tsx scripts/live-sandbox-oss.ts
```

脚本强制 OSS 驱动；使用随机用户/空间/对象键，写入随机字节，读取验证摘要，恢复进 OpenSandbox 私有空间再验读。finally 独立执行销毁、按 runId 查漏回收和精确对象删除；失败只输出安全阶段、缺失配置名、清理状态及随机回收标识，不输出凭据。

首次 OSS 联合脚本在配置预检处阻断，未创建 OSS 对象；配置补齐后的成功记录见下方“常驻本地真实服务启动”。

独立本地 OpenSandbox 最终真实验证通过：执行镜像 `picoddyclaw-cloud-sandbox:0.1.0` 构建成功，临时 lifecycle 服务健康检查、创建沙箱、非 root 文件上传/读取、Node/Python 执行、destroy、按 runId 查漏回收、Compose down 全部通过。实际 UID/GID=10001，文件权限=600、目录权限=700。测试服务已停止，不代表正在为 Web 提供常驻沙箱服务；镜像保留作缓存。

真实联调修复了两个 Mock 未覆盖的问题：

1. SDK 1.1.1 调用 identity 文件路由，旧 execd 1.1.0 返回 404。server/execd 已统一到官方 release-1.1.1，并锁定 BOM 的 SHA-256 摘要。
2. 文件 mode 不能传 JS 的 `0o600/0o700`，它们序列化为 384/448；execd 按八进制数字文本解析。改为接口要求的 600/700，并添加失败后通过的回归与真实 stat 验证。

复跑本地独立验证（会临时挂载 Docker socket，须仅在受控开发机运行）：

```sh
docker build -f sandbox/Dockerfile -t picoddyclaw-cloud-sandbox:0.1.0 .
npm run test:sandbox:local
```

脚本只监听 127.0.0.1:8090，端口已占用则拒绝；使用随机 Compose 项目名与临时 API key，不改 `.env`，结束后清理本轮服务和沙箱，不删除缓存镜像。生产或常驻联调需要独立启动 OpenSandbox 并配置匹配的 SANDBOX_DOMAIN/API_KEY；不能将 Docker Desktop 启动状态当成服务健康状态。

本地配置参考官方 [Docker Compose](https://github.com/opensandbox-group/OpenSandbox/blob/release-1.1.0/server/docker-compose.example.yaml)、[配置规范](https://github.com/opensandbox-group/OpenSandbox/blob/release-1.1.0/server/configuration.md) 与实际核验的 [1.1.1 镜像 BOM](https://github.com/opensandbox-group/OpenSandbox/blob/release-1.1.1/docs/releases/1.1.1.yaml)。独立服务才挂载 Docker socket，业务 API/Worker/任务沙箱不挂载；这不是生产多租户隔离验收。

仍不能标记“真实模型 + OpenSandbox + OSS 联调”完成，也不能据此标记全量桌面能力对齐完成。

## 常驻本地真实服务启动（2026-10-12）

- `cloud/.env` 已切换 `STORAGE_DRIVER=oss`，地域规范化为 `oss-cn-hangzhou`，沙箱服务地址为 `http://127.0.0.1:8090`，Web 源为 `http://localhost:8080`。密钥仅保存在被 Git 忽略的本地配置，不在本文记录。
- 常驻 OpenSandbox：`docker compose --env-file .env -p picoddy-cloud-local-sandbox -f deploy/opensandbox.local.yaml up -d`（在 cloud/ 执行）。使用已有沙箱镜像，不需要重新构建。
- 独立 PostgreSQL 容器 `picoddy-cloud-local-postgres` 监听 `127.0.0.1:5432`，数据卷 `picoddy-cloud-local-database` 持久保存数据；`npm run db:init` 成功。未启动或修改其它项目的数据库容器。
- `npm run build` 成功，`npm start` 提供构建后页面及 API；`npm run worker`、`npm run scheduler` 分别运行任务与调度进程。没有启动新的 Vite，也未占用已有 5173 服务。Node 进程目前是本机会话进程，尚未配置开机自启。
- 页面 `/`、`/api/health`、`/api/ready` 均返回 200，ready 为 `ready`。
- `npm run test:live` 返回 `LIVE_SANDBOX_OSS_SMOKE_PASS bytes=4096 guardChecks=2 cleanup=complete`，验证真实 OSS 写入/读取、沙箱空间恢复与校验，并清理本次测试对象和临时任务沙箱；常驻管理服务和业务数据库保留运行。
- 新数据库账号列表为空；首次使用需创建管理员并在登录后配置模型。此次尚未验证真实模型驱动的完整用户任务，不是生产部署或公网多租户隔离验收。
