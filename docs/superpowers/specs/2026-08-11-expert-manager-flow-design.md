# Expert Manager 创建流程设计

> 状态：已确认  
> 日期：2026-08-11

## 目标

实现与 WorkBuddy 一致的“我的专家 → 创建专家 → 会话内自动选中 expert-manager → 后端生成并注册专家包”闭环。

## 用户流程

1. 用户进入“专家管理”的“我的专家”视图。
2. 页面按“专家 / 专家团”展示已注册到 `my-experts` marketplace 的专家包，并提供搜索。
3. 列表末尾固定展示“创建专家”卡片。
4. 点击后创建 `expert_creator` 会话，切回聊天页。
5. 输入框自动插入 `/expert-manager` 技能标签，并预填创建模板：
   `帮我创建一个 XXX 专家，擅长 XXXXX。我的经验是：[请补充你的行业背景、相关经验]`
6. 用户补齐信息并发送。该会话后端强制激活官方 `expert-manager` 技能。
7. 技能按规范完成信息收集、初始化、生成、头像、校验、注册和打包。
8. 注册完成后，“我的专家”重新扫描 marketplace；新专家可立即发起专家会话。

## 架构

### 内置技能

`resources/builtin-skills/expert-manager` 纳入受保护内置技能 bundle。创建会话不依赖前端文本触发：后端根据 `conversation.category === "expert_creator"` 读取 bundle 中的官方 `SKILL.md` 并追加 `<active_skill name="expert-manager">` 上下文。输入框中的技能标签用于让用户明确知道当前能力已选中。

### 已安装专家目录

后端以以下目录为唯一事实源：

```text
<PI_A_PROJECT_CONFIG_DIR>/plugins/marketplaces/my-experts/
├── .picoddy-plugin/marketplace.json
├── plugins/<expert-name>/
└── packages/<expert-name>.zip
```

项目配置根使用 `platformPaths.appDataDir`：macOS/Linux 默认 `~/.pi-a`，Windows 默认 `%LOCALAPPDATA%\\Pi-a`。不读取 `WORKBUDDY_CONFIG_DIR`。只读取 `marketplace.json` 中已注册且位于 `plugins/` 内的普通目录；忽略越界路径、符号链接、无效 JSON、缺少 Agent 文件或关键字段不合法的包。

### 动态专家目录

`ExpertRegistry` 增加 `installed` 来源和可替换的 installed overlay。优先级为：

```text
builtin > installed > catalog
```

扫描成功后原子替换 installed overlay。扫描失败保留上一份有效快照，避免一次损坏让全部已安装专家从会话运行时消失。

已安装专家的主 Agent Markdown 作为专家提示正文；摘要 API 不返回正文。revision 由 plugin.json 与 Agent Markdown 的内容哈希生成，因此会话绑定仍可精确记录版本。

### API

- `GET /api/experts`：现有完整专家目录，保持兼容。
- `GET /api/experts/installed`：刷新并返回已注册专家包摘要。
- `GET /api/experts/:id`：同时支持 builtin、catalog 和 installed。

HTTP 与 Electron IPC 使用同一业务路径。

### 创建会话

前端创建 category 为 `expert_creator` 的会话，并把一次性 composer bootstrap 写入 renderer store。Composer 在切换到对应会话后消费 bootstrap，把 `/expert-manager` 渲染为不可混淆的技能 pill，并保留后续引导文本。

后端 `ExpertManagerContext` 提供：

- 官方技能正文；
- 当前 conversation/session id；
- 官方技能根目录；
- 固定专家目录和打包目录；
- 必须执行 `init → validate → register → package` 的约束。

注册步骤必须传入当前 session id。任何校验或注册失败都不得进入已安装列表。

## UI

专家页沿用项目现有暗色设计系统，不复制截图像素：

- 顶部提供“专家 / 专家团”切换、数量和搜索；
- 卡片展示头像、职业、花名、40–50 字描述和三个标签；
- “创建专家”卡片与普通卡片同尺寸，提供明确的键盘焦点和 loading 状态；
- 空状态、加载失败和创建会话失败都可见；
- 点击已安装专家卡片创建并绑定专家会话。

## 失败边界

- `expert-manager` bundle 不可读：阻止 `expert_creator` 会话退化为普通聊天。
- marketplace 或专家包不合法：返回诊断，不展示半成品。
- 会话已创建但导航失败：保留会话并提示用户可从侧栏恢复。
- 新专家注册后刷新失败：保留上一份有效 registry，并提示刷新失败。
- 头像缺失：使用确定性的文字渐变头像，不阻止专家使用。

## 非目标

- 本次不实现专家市场下载、卸载、编辑器和审核后台。
- 不绕过现有工具权限确认。
- 不允许未注册目录直接出现在“我的专家”。
