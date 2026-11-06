# SkillHub 技能目录与一键安装设计

## 目标

在“专家 - 技能 - 连接器”页面中，用自建 SkillHub 的实时技能目录替换“推荐 SkillHub 套件”下的硬编码模板列表，并支持用户点击“+”通过官方 SkillHub CLI 完成本地安装。

本次只改造“推荐 SkillHub 套件”。上方精选技能、已安装技能管理、专家和连接器功能保持不变。

## 当前状态

当前页面从 `frontend/src/components/ExpertPanel.tsx` 中的 `TEMPLATE_SKILLS` 渲染推荐套件，点击“+”会把硬编码正文直接保存为用户技能。

自建 SkillHub 提供网页目录接口，同时官方 CLI 提供安装协议：

- `GET /api/web/skills?sort=newest&page=0&size=12`：获取技能列表。
- `CLAWHUB_REGISTRY=<url> clawhub login --token <token>` 后执行
  `clawhub install <slug> --dir <path>`：通过 CLI API 下载、校验并安装完整技能包。

网页账号登录和 `/api/web/.../download` 只属于手工下载链路，不用于应用内一键安装。

## 方案选择

采用主进程读取网页目录、调用官方 CLI 安装的方案。渲染进程只调用本地 IPC/API，不直接连接远端服务或执行命令。

这样可以：

- 不依赖网页账号、密码或 `SESSION` cookie。
- 避免开发环境依赖 Vite 代理、生产环境受跨域策略影响。
- 由官方 CLI 处理 CLI API、技能包校验、完整目录安装和安装记录。
- 固定 CLI 版本随应用打包，不依赖用户预装全局命令，也不在点击时通过 `npx` 临时下载。

不采用前端直连方案，因为它需要在渲染进程处理账号和 session，并且生产环境存在跨域问题。不采用静态快照方案，因为它无法反映自建仓库的最新内容。

## 架构与职责

### SkillHub 客户端

Node 侧 SkillHub 集成拆成目录客户端和 CLI 安装器：

- 默认使用文档中的自建 SkillHub 地址 `http://skillhub.example.com`，并允许主进程通过 `SKILLHUB_BASE_URL` 覆盖。
- 目录客户端遍历 `total` 指示的所有分页，并把远端响应收敛成应用需要的类型。
- CLI 安装器执行随包分发的 `clawhub`，先执行一次 `login --token`，再用 slug、`platformPaths.skillsDir` 和 registry 安装；本地目录只使用 slug，版本由 registry 返回的 latest published version 决定。
- CLI 通过 `execFile`/`spawn` 的参数数组执行，不拼接 shell 命令；stdin 关闭，stdout/stderr 限长并设置超时。
- Electron 运行时设置 `ELECTRON_RUN_AS_NODE=1` 执行 CLI 的 Node 入口，开发环境和打包环境使用同一路径。
- 可选的 `SKILLHUB_TOKEN` 仅通过子进程环境变量传入，以支持私有技能；不传到渲染进程或日志。

CLI 将完整技能包安装到 `~/.pi-a/skills/<slug>`，保留 references、scripts、assets 和 `.skillhub/metadata.json`。安装成功后应用重新扫描现有技能目录，并以 CLI 实际写入的 `SKILL.md` frontmatter 返回 `SkillMeta`。

### 本地 API 与 IPC

新增两个本地能力：

- `GET /api/skillhub/skills`：读取最新一页 SkillHub 技能。
- `POST /api/skillhub/install`：接收 `namespace`、`slug`、`version`，调用官方 CLI 安装并返回已安装技能。

`frontend/src/api/client.ts`、preload 白名单和 `src/electron/ipc-handlers.ts` 同步增加对应 IPC 路由。浏览器模式仍可通过 HTTP 调用同一路由，Vite 的 `/api` 继续只代理本机后端。

安装接口不向渲染进程传递压缩包，也不调用网页账号登录接口。

### CLI 插件标准

CLI 不直接散落在各业务模块中。`src/platform/cli/runtime.ts` 提供统一运行时：

- `CliPluginManifest` 描述稳定的 `id`、版本、npm 包、入口和能力集合。
- `createCliPluginRegistry` 只注册应用内置且经过审核的 manifest；当前
  `src/platform/cli/plugins.ts` 仅注册 SkillHub。
- `runBundledCli` 统一使用 Electron 的 Node 模式、参数数组、禁止 shell、超时、输出上限和环境变量清洗。
- 业务适配器只负责 CLI 参数、结果协议和错误码映射，不重复实现进程安全逻辑。

首版不从远端动态加载 CLI 插件，也不执行用户提供的命令。后续若开放第三方插件，应在 manifest 签名、来源白名单和权限审核基础上扩展注册表，而不是放宽当前运行时边界。

## 前端状态与交互

`useSkillStore` 增加 SkillHub 目录状态：

- `skillHubSkills`：远端技能列表。
- `skillHubLoading`：首次或重试加载状态。
- `skillHubError`：可展示的加载错误。
- `installingSkillHubIds`：正在安装的技能标识集合，防止重复点击。
- `loadSkillHubSkills()`：加载列表。
- `installSkillHubSkill(skill)`：触发安装，成功后刷新本地技能列表。

页面进入技能页时加载远端列表。“推荐 SkillHub 套件”保留现有卡片布局，但数据源改为 `skillHubSkills`：

- 标题显示 `displayName`，缺失时回退到 `slug`。
- 描述显示 `summary`。
- 搜索匹配名称、描述和 namespace。
- 分类标签使用远端 `namespace`，首项仍为“全部”。
- 未安装显示“+”；安装中禁用按钮并显示旋转状态；已安装显示勾选和启用状态。
- 本次不让 SkillHub 卡片上的勾选执行卸载。卸载继续由“我安装的”区域承担，避免误触并保持职责清晰。

安装状态通过本地技能 `name` 与远端 `slug` 比较确定。后端导入后返回的最终技能名称仍以 zip 内 `SKILL.md` frontmatter 为准；若它与 slug 不一致，安装成功后使用返回名称刷新并识别状态。

## 数据流

目录加载：

```text
ExpertPanel
  -> useSkillStore.loadSkillHubSkills
  -> IPC/GET /api/skillhub/skills
  -> SkillHub GET /api/web/skills
  -> 标准化列表
  -> 推荐 SkillHub 套件卡片
```

点击安装：

```text
点击“+”
  -> IPC/POST /api/skillhub/install
  -> 官方 SkillHub CLI install namespace/slug
  -> CLI API 下载、校验完整技能包
  -> CLI 写入 ~/.pi-a/skills/<slug>/ 并记录 metadata
  -> 刷新 /api/skills
  -> 卡片显示已安装
```

## 错误处理

- 列表加载失败：推荐区域显示错误和重试入口，不影响本地技能、专家或连接器功能。
- 缺少发布版本：对应卡片不可安装，并提示“暂无可安装版本”。
- CLI 鉴权失败：显示安全的鉴权提示和 CLI request ID，不泄露 token。
- CLI 网络、参数、文件系统错误：按退出码映射成清晰提示，保留未安装状态并允许重试。
- CLI 输出异常、超时或安装后没有可扫描技能：按安装失败处理，不把原始命令或环境变量返回前端。
- 重复点击：同一技能安装期间按钮禁用；不同技能可独立安装。
- 同名内置技能：显示由系统管理，不允许覆盖。

## 测试策略

按测试先行实现：

- SkillHub 目录客户端测试：列表映射、全量分页、非成功响应和非法分页数据。
- CLI 安装器测试：精确参数数组、固定安装目录/registry、可选 token、退出码映射、超时与安装结果扫描。
- API/IPC 路由测试：参数映射和返回值透传。
- 前端状态模型测试：加载成功/失败、安装去重、安装后刷新本地技能。
- 前端构建与主进程 TypeScript 类型检查。

## 验收标准

- 推荐 SkillHub 套件不再显示硬编码模板，能够显示自建 SkillHub 最新一页技能。
- 搜索和 namespace 分类作用于远端数据。
- 点击“+”能够通过随包分发的官方 CLI 完成指定版本安装和本地列表刷新。
- 完整技能目录（包括 references、scripts、assets）得到保留。
- 安装后的技能出现在“我安装的”，并能被现有技能加载机制加入提示词。
- 失败有清晰反馈，且不会生成残缺技能目录或覆盖内置技能。
- Electron 生产路径不依赖 Vite 的远端代理。
