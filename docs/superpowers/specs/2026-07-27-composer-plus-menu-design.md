# Composer “＋” 多级菜单与附件系统设计

## 目标

在 Pi-a 对话输入区实现接近 WorkBuddy 的“＋”多级菜单，完整连接现有的模式、专家、技能和 MCP 连接器能力，并补齐跨平台文件附件的选择、上传、持久化、解析和会话回显链路。

## 范围

本次包含：

- “＋”按钮的主菜单与五类入口：添加文件、模式、专家、技能、连接器。
- 主菜单及子菜单的鼠标、键盘和窗口边界交互。
- 使用浏览器标准文件选择控件调用当前操作系统的原生文件选择器。
- 附件上传、私有存储、SQLite 元数据、消息关联、模型上下文注入和历史消息回显。
- 动态读取已安装技能、专家和 MCP 状态。
- 已连接 MCP 的单次任务优先使用提示。

本次不包含：

- 图片 OCR、音视频转写或图片多模态输入。
- 云端附件同步。
- MCP 工具的会话级物理隔离；当前仍使用全局已连接 MCP 工具集。
- 专家在已有会话中热切换；选择专家固定创建新会话。

## 方案选择

采用独立的 `ComposerPlusMenu` 组件，由 Composer 持有本次消息的附件、技能和连接器标签状态。菜单通过现有 Zustand Store 与后端 API 获取动态数据。

未采用的方案：

- 全部内联到 `Composer.tsx`：实现较快，但会让现有组件继续膨胀，难以独立测试。
- 重构为全局统一命令注册表：长期价值较高，但会扩大到命令面板和设置页，不适合本次功能范围。

## 前端架构

### ComposerPlusMenu

职责：

- 渲染主菜单和右侧子菜单。
- 管理展开项、焦点索引、菜单定位和关闭行为。
- 提供以下回调：
  - `onFilesSelected(files)`
  - `onModeSelected(mode)`
  - `onExpertSelected(expert)`
  - `onSkillSelected(skill)`
  - `onConnectorSelected(connector)`
  - `onOpenConnectorManager()`

主菜单项：

1. 添加文件
2. 模式
3. 专家
4. 技能
5. 连接器

交互要求：

- 点击“＋”打开或关闭菜单。
- 悬停或点击带箭头的项目打开右侧子菜单。
- `ArrowUp`、`ArrowDown` 移动焦点。
- `ArrowRight` 进入子菜单，`ArrowLeft` 返回主菜单。
- `Enter` 执行当前项，`Escape` 关闭。
- 点击菜单外部关闭。
- 根据视口空间自动向左或向右展开子菜单，避免裁切。
- 使用语义化按钮、`aria-expanded`、`aria-haspopup` 和可见焦点样式。

### Composer 消息状态

Composer 新增：

```ts
interface PendingAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  extension: string;
  status: "uploading" | "ready" | "error";
  error?: string;
}

interface ActiveConnectorTag {
  name: string;
  toolCount: number;
}
```

现有 `ActiveSkillTag` 保留，但技能来源改为 `/api/skills` 动态数据；硬编码斜杠菜单仍可保留系统模式和动作。

输入区顶部按顺序显示：

1. 附件标签
2. 专用技能标签
3. 连接器优先标签

标签均支持删除。发送成功后清空；上传中禁止发送；上传失败的标签不进入请求。

### 五类行为

#### 添加文件

- 使用隐藏的 `<input type="file" multiple>`。
- `accept` 覆盖文档、表格、演示、PDF、文本及常见代码文件。
- 文件选中后立即逐个上传，显示上传中状态。
- 单条消息最多 10 个附件；单文件最大 25 MB。

#### 模式

子菜单复用当前 `RunMode`：

- Ask
- Plan
- Craft

选择后调用现有 `setMode`，菜单关闭。

#### 专家

- 数据来自 `useSkillStore.loadExperts()`。
- 显示专家头像、名称和简短描述。
- 选择后调用现有 `startExpertChat()`，新建并绑定专家会话。

#### 技能

- 数据来自 `useSkillStore.loadSkills()`。
- 只展示 `disabled === false` 的技能。
- 选择后在 Composer 显示技能标签。
- 发送时在文本前添加 `/<skill.name>`，沿用后端斜杠技能强激活协议。

#### 连接器

- 数据来自 `useSkillStore.loadMcp()`。
- 展示配置中的全部 MCP，并标记已连接、未连接或已禁用。
- 选择已连接 MCP 后添加连接器标签。
- 发送时加入内部提示：

```xml
<preferred_connector name="connector-name">
本次任务优先使用该连接器提供的 MCP 工具。
</preferred_connector>
```

- 点击未连接或已禁用项时打开“专家·技能·连接器”页面的连接器 Tab。

## 后端附件架构

### 存储

附件文件保存到：

```text
~/.pi-a/attachments/<attachment-id>/<sanitized-original-name>
```

SQLite 新增：

```sql
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  extension TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE message_attachments (
  message_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, attachment_id),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
);
```

### API

#### `POST /api/attachments`

请求为 `multipart/form-data`，字段名 `files`，支持多文件。

返回：

```json
{
  "attachments": [
    {
      "id": "uuid",
      "name": "SKILL.md",
      "size": 1204,
      "mimeType": "text/markdown",
      "extension": "md"
    }
  ]
}
```

服务端必须再次校验文件数量、大小、扩展名和安全文件名。写入采用 UUID 目录，禁止客户端提供目标路径。

#### `DELETE /api/attachments/:id`

仅删除尚未关联消息的附件。用于用户在发送前移除附件。

#### `POST /api/prompt`

新增可选字段：

```json
{
  "attachmentIds": ["uuid"],
  "preferredConnector": "connector-name"
}
```

处理顺序：

1. 验证所有附件 ID 存在。
2. 读取附件元数据并用 `readDoc` 提取内容。
3. 拒绝 `readDoc.kind === "error"` 的附件。
4. 将内容包装为 `<referenced_file>` 并添加到 `processedText`。
5. 保存用户消息并写入 `message_attachments`。
6. 把连接器优先提示加入模型输入，但不污染用户可见文本。

#### 会话消息查询

消息返回结构增加：

```json
{
  "attachments": [
    {
      "id": "uuid",
      "name": "SKILL.md",
      "size": 1204,
      "mimeType": "text/markdown",
      "extension": "md"
    }
  ]
}
```

ChatArea 在用户消息下方回显只读附件标签。

## 支持格式

首版允许：

- 文档：`pdf`、`docx`
- 表格：`xlsx`、`csv`
- 演示：`pptx`
- 文本：`txt`、`md`、`markdown`、`json`
- 常见代码与配置：`ts`、`tsx`、`js`、`jsx`、`py`、`java`、`go`、`rs`、`c`、`cpp`、`h`、`css`、`html`、`xml`、`yaml`、`yml`、`toml`、`sql`、`sh`

未知和二进制格式不进入模型上下文。图片、音频和视频明确提示当前版本暂不支持内容解析。

## 错误处理

- 文件数量超过 10：前端阻止并显示错误。
- 单文件超过 25 MB：前后端同时拒绝。
- 上传中断：附件标签转为错误状态，可删除或重试。
- 解析失败：保留用户输入，不发送模型请求，并展示具体失败文件。
- 专家、技能或 MCP 加载失败：子菜单显示错误与重试入口，不阻塞其他菜单。
- 专家新会话创建失败：保留当前会话并显示错误。
- 未连接 MCP：不创建优先标签，转到连接器管理。

## 视觉规范

- 延续 Pi-a 现有 CSS 变量，不引入新的主题体系。
- 主菜单宽度 220 px，圆角 14 px；子菜单最小宽度 260 px、最大宽度 340 px。
- 菜单使用细边框、柔和阴影与轻微背景模糊。
- 图标尺寸 18 px，行高 44 px。
- 主菜单打开采用 120–160 ms 的缩放和透明度过渡。
- 附件标签使用紧凑圆角矩形，文件类型图标独立着色；上传中显示轻量旋转指示。
- 亮色和暗色主题均保持 WCAG AA 级文字对比度。

## 测试策略

### 后端

- 多文件上传成功。
- 文件数量和大小限制。
- 路径穿越与非法文件名防护。
- 附件元数据写入和消息关联。
- 支持格式通过 `readDoc` 注入模型上下文。
- 解析失败时不调用 Agent。
- 删除未关联附件；拒绝删除已关联附件。

### 前端

- 点击“＋”打开主菜单。
- 悬停、点击和键盘进入五类子菜单。
- Esc 和外部点击关闭。
- 文件选择、上传状态、删除与数量限制。
- 模式正确更新。
- 专家创建新会话。
- 动态技能创建技能标签并形成斜杠消息。
- 已连接 MCP 创建标签；未连接 MCP 打开管理页。

### 端到端

用 Playwright 验证：

1. 主菜单与各子菜单实际可见。
2. 上传一个 `SKILL.md` 后出现附件标签。
3. 选择 `data-analysis` 后出现技能标签。
4. 发送后请求包含附件 ID 和斜杠技能。
5. 会话历史回显附件。
6. 亮色、暗色主题截图无裁切或遮挡。

## 验收标准

- 红圈“＋”按钮不再是无行为按钮。
- 五个菜单入口均由真实数据驱动并具有可观察结果。
- 文件选择器在 macOS、Windows 和 Linux 使用各自原生界面。
- 附件可上传、删除、发送、解析、持久化和历史回显。
- 专家选择固定创建新会话。
- 技能选择可靠触发后端斜杠技能协议。
- 连接器状态准确，已连接项可表达本次任务优先级。
- 所有新增测试通过，前端构建和 Deno 类型检查通过。
