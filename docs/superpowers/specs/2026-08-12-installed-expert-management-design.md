# 已安装专家管理与会话引导设计

> 状态：已确认
> 日期：2026-08-12

## 目标

让“我的专家”中的已安装 Agent 专家具备完整的查看、修改、打开文件夹和卸载能力，并在用户召唤专家后，用该专家自己的推荐提示引导首次输入。修改继续沿用 `expert-manager` 的对话式交互，但通过受控草稿和原子替换保护当前可用版本。

本设计只覆盖 `catalogSource === "installed"` 且来自 `my-experts` marketplace 的 Agent 专家。内置和远程目录专家不提供修改、打开文件夹或卸载操作。专家团不在范围内；不增加分享功能。

## 用户流程

### 专家卡片

已安装专家卡片保留“召唤专家”主操作，右上角增加“…”菜单。菜单固定包含：

1. 查看专家
2. 修改专家
3. 打开文件夹
4. 卸载专家

菜单操作与卡片主操作相互独立；点击“…”不会召唤专家。菜单支持键盘焦点、Escape 关闭和点击外部关闭。

### 查看专家

“查看专家”打开详情弹窗。弹窗按已确认的参考界面展示：

- 头像；
- 职业名称和花名；
- “召唤专家”按钮；
- 专家介绍；
- 三个标签；
- “专家帮你做”区域中的三条推荐提示词。

点击弹窗中的“召唤专家”，创建并绑定新的专家会话。输入框优先预填第一条 `quickPrompts`；如果没有有效推荐提示词，则回退到 `description`。内容是普通可编辑文本，不自动发送。

点击任一推荐提示词，也创建并绑定新的专家会话，并将被点击的提示词预填到输入框，不自动发送。关闭弹窗不产生会话或数据变更。

### 修改专家

“修改专家”创建一个新的 `expert_creator` 会话并打开聊天页。输入框第一行展示可删除的 `expert-manager` 标签，其后预填普通可编辑文本：

```text
帮我修改专家：[expert-id]，增加/优化[请补充你希望新增/优化的技能或知识领域等]方面的能力
```

编辑会话在后端绑定明确的目标专家 ID 和目标 revision，不能仅凭用户文本选择磁盘目录。`expert-manager` 先读取原专家完整内容，再把它复制为该会话的受控编辑草稿。模型只修改草稿，不直接写已安装目录。

保存流程固定为：

```text
读取并锁定原 revision
  → 修改会话草稿
  → validate_expert.py 校验草稿
  → 再次检查目标 revision 未变化
  → 原子替换已安装专家目录
  → register_expert.py 刷新 marketplace 注册
  → 刷新 ExpertRegistry
```

更新必须保持专家目录名、`plugin.json.name`、`agentName` 和主 Agent 文件名不变。需要改名时应创建新专家。校验、revision 冲突、替换或注册失败时保留原专家版本可用，并向会话返回明确错误；不得产生两个同 ID 专家。

更新成功后专家 ID 不变，revision 更新。新会话使用新 revision；已经开始的旧会话仍按其绑定 revision 处理，不在后台静默换角色。

### 打开文件夹

前端只传专家 ID。后端从已注册 marketplace 重新解析该 ID，确认它是 `my-experts/plugins` 下不含符号链接的直接子目录，再调用系统文件管理器打开。前端不能传入任意本地路径。

### 卸载专家

卸载直接复用技能列表已经使用的全局 `AppDialog` 与 `requestUiConfirm`，以 `tone="danger"` 显示危险操作确认框，不新增专家专用确认组件。文案明确说明历史消息会保留，但相关会话将切换为普通会话。

确认后，后端在单一受控操作中：

1. 校验目标仍是已安装专家，并获取当前 revision；
2. 拒绝正在修改或正在执行管理操作的同一专家；
3. 从 marketplace 注册表移除该专家；
4. 将专家目录移动到应用内部、同文件系统的可恢复回收目录，而不是直接永久删除；
5. 清除所有 `expert_id` 等于目标 ID 的会话绑定列；
6. 为这些历史会话写入一次性“专家已卸载”提示状态；
7. 刷新 ExpertRegistry 和前端已安装专家列表。

历史消息和会话本身保留。历史会话再次打开后按普通会话运行，并显示一次：

```text
原专家已卸载，已切换为普通会话
```

提示被消费后不重复显示。卸载操作不删除历史消息、附件、产物或会话文件。若 marketplace 更新失败，不移动目录；若目录移动后数据库事务失败，则尝试恢复目录和注册信息并返回失败，不报告卸载成功。

## 数据与领域边界

### 已安装专家定位

后端新增只接受 expert ID 的已安装专家管理服务。该服务复用已安装专家扫描器的目录边界：

```text
<appDataDir>/plugins/marketplaces/my-experts/
├── .picoddy-plugin/marketplace.json
├── plugins/<expert-id>/
├── packages/
└── .trash/<expert-id>-<timestamp>-<revision>/
```

所有修改、打开和卸载操作都必须从 marketplace 注册项反向解析目标目录，并重复执行以下检查：

- ID 为合法 kebab-case；
- 注册 source 为 `./plugins/<expert-id>`；
- 真实路径仍位于 `plugins` 根目录内；
- 目标是普通目录且不是符号链接；
- `plugin.json.name` 与 expert ID 一致；
- `expertType` 为 `agent`。

### 会话绑定

`ExpertCatalogSource` 已包含 `installed`，数据库读取层、会话 DTO、绑定存储和 IPC/HTTP 返回值必须完整保留该值，不能降成 `null`。

卸载时使用后端数据库事务批量清理匹配 expert ID 的三列：

- `expert_id`
- `expert_revision`
- `expert_catalog_source`

同时把受影响会话的 `expert_notice` 写为 `uninstalled`。会话读取 API 返回该提示后，在同一次受控操作中清空字段；前端将它渲染为系统提示条，不伪造用户/助手消息，以免污染模型上下文。

### 编辑会话上下文

`conversations` 为 `expert_creator` 增加以下管理元数据列：

- `operation`: `create | edit`
- `targetExpertId`
- `targetRevision`
- `draftRoot`

创建会话写入 `operation=create`，其余目标列为空；修改会话写入完整的 `operation=edit`、目标 ID、目标 revision 与后端生成的草稿根。这些数据不能从输入框文本推断。`ExpertManagerContext` 根据 operation 输出创建或编辑约束。编辑模式只暴露受控草稿根；发布动作由后端管理服务完成，普通 bash/write 工具不能直接修改应用管理目录。

## API 与 IPC

HTTP 与 Electron IPC 继续进入同一业务实现。新增能力：

- `GET /api/experts/:id`：返回安全摘要，用于详情弹窗；不返回系统提示正文或本地路径。
- 召唤专家沿用现有 `POST /api/conv` 和会话专家绑定 API；renderer store 在两步都成功后写入 composer bootstrap，不新增 chat API。
- `POST /api/experts/:id/edit-session`：创建受控编辑会话，返回会话和 composer bootstrap。
- `POST /api/experts/:id/open-folder`：按 ID 后端解析并打开目录。
- `DELETE /api/experts/:id`：执行受控、可恢复卸载并返回受影响会话数量。

IPC allowlist 和 renderer 路由必须覆盖这些操作。错误返回保持结构化 code/message，避免 Electron 报错退化为 `[object Object]`。

复用范围只包括前端确认弹窗和请求交互。技能删除后端会永久删除单个用户技能目录，不能承担专家 marketplace 更新、可恢复移动、会话解绑、运行时释放和 registry 刷新，因此专家卸载仍由独立的专家管理服务实现。

## 前端状态与输入框 bootstrap

现有一次性 composer bootstrap 扩展为通用结构：

```ts
type ComposerBootstrap = {
  conversationId: string;
  text: string;
  expertManagerToken?: boolean;
};
```

- 创建专家：预填创建模板并显示 `expert-manager` 标签；
- 修改专家：预填修改模板并显示 `expert-manager` 标签；
- 召唤专家：预填推荐提示或 description，不显示 `expert-manager` 标签。

bootstrap 只由匹配 conversation ID 的 Composer 消费一次。切换会话不会把一个专家的引导语带到另一个会话；引导语不会自动发送，也不会写入消息历史，直至用户主动发送。

## 并发和错误处理

- 同一专家的修改、卸载和注册使用互斥锁串行执行。
- 编辑发布前后比较 revision；不一致时返回冲突，要求重新打开修改会话。
- 正在运行的绑定会话不阻止卸载，但卸载会先请求 provider 释放对应运行时；无法安全停止时卸载失败，不留下半解绑状态。
- 已打开的详情弹窗若发现专家被其他操作卸载，关闭弹窗、刷新列表并显示提示。
- 打开文件夹失败只影响该操作，不修改专家状态。
- 头像缺失继续使用确定性文字头像。
- 空的 quickPrompt 不展示；无推荐提示时仍可通过“召唤专家”使用 description 引导。

## 视觉与可访问性

沿用 ExpertPanel 现有主题变量，支持深色和浅色主题，不硬编码蓝色强调色。详情弹窗、菜单和确认框需要：

- 明确的 `dialog/menu` 语义；
- 焦点圈、Escape 关闭和焦点回收；
- 菜单不被卡片点击事件穿透；
- 卸载项使用危险色，但其余操作保持中性；
- 窄窗口下弹窗可滚动，推荐提示词保持可点击的整行区域；
- 遵守 `prefers-reduced-motion`。

## 验证范围

按当前项目要求，不执行自动化测试。本功能完成时只进行：

- 创建、查看、修改、打开文件夹、卸载、历史会话重开的流程走查；
- Electron 与前端 TypeScript 检查；
- Python 脚本语法检查（如修改专家管理脚本）；
- JSON/manifest 格式检查；
- `git diff --check`。

## 非目标

- 不增加分享入口或分享服务；
- 不支持专家团；
- 不允许修改专家 ID；
- 不永久清空回收目录；
- 不为内置或远程目录专家开放文件夹和卸载操作；
- 不将专家提示正文或本地绝对路径返回 renderer。
