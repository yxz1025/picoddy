# MCP 按需连接与会话工具隔离处理记忆

## 2026-09-23 前端选择状态更新

以下历史记录中“发送后清除选择”的界面行为已由当前实现替代：发送后保留选择，按 conversationId 在前端内存保存，切换会话恢复各自选择，手动取消同步更新。新会话默认不选；欢迎页主动选择的连接器随首次发送绑定到新会话。删除会话清理选择，应用重启后不恢复。恢复选择不会主动连接服务，每次发送仍显式提交当前会话选择，后端工具隔离不变。参见 [设计](./designs/2026-09-23-conversation-connector-selection-design.md)。

## 目标

将 MCP 从“应用启动时连接全部服务”调整为：

1. 启动时只读取和准备 MCP 配置，不连接服务。
2. 用户明确选择某个 MCP 后，只连接该服务。
3. 当前消息只获得所选 MCP 的工具。
4. 下一条消息未再次选择时，不继承 MCP 工具。
5. 已建立的连接可复用，避免反复启动子进程或握手。

## 核心实现

### 后端连接层

文件：`src/agent/mcp.ts`

- `connectMcpServerByName(name)` 按配置名称连接一个 MCP。
- `toolsForMcpServer(name)` 按需连接并返回该 MCP 的工具。
- 使用连接缓存复用已有连接。
- 使用 pending promise 合并同一 MCP 的并发连接请求。
- 使用 generation 防止配置刷新后旧异步连接重新写回缓存。
- 未配置、已禁用或连接失败时返回明确错误，不回退到其他 MCP。
- `connectAllMcpServers()` 仅保留给诊断脚本，不用于应用启动和普通会话。

### 工具注入层

文件：

- `src/agent/tools/index.ts`
- `src/agent/provider.ts`

MCP 工具不再保存在全局工具数组中。每次执行消息时，通过
`PromptOptions.mcpTools` 显式传入当前任务选择的 MCP 工具。

- Craft 模式可使用本次显式传入的 MCP 工具。
- Ask、Plan、技能创建模式不注入 MCP 工具。
- 下一条未选择 MCP 的消息不会继承上一条消息的 MCP 工具。

### API 层

文件：`application.ts`

- `POST /api/mcp/connect`
  - 请求：`{"name":"MCP 配置名"}`
  - 只连接指定 MCP。
- `POST /api/mcp`
  - 保存配置后断开旧连接。
  - 不自动重连全部 MCP。
- `POST /api/prompt`
  - 根据 `preferredConnector` 获取对应 MCP 工具。
  - 只传给当前一次 provider 执行。

应用启动只执行 `ensureMcpConfig()`。

### 前端选择层

文件：

- `frontend/src/components/Composer.tsx`
- `frontend/src/components/ComposerPlusMenu.tsx`
- `frontend/src/store/useSkillStore.ts`

连接器菜单同时显示已配置和已连接的 MCP：

- 未连接但已启用：显示“选择后连接”，点击后连接。
- 已连接：直接选中并复用连接。
- 已禁用：不能选择。
- 连接失败：停留在菜单并显示错误。
- 消息发送成功后清除本次选择，下一次需要重新选择。

### 自动化任务

文件：`src/domains/automation/node/scheduler.ts`

自动化配置的 `connector` 字段会在任务执行时按需连接对应 MCP，
并只向本次自动化执行注入该 MCP 的工具。

## 正常加载顺序

1. 启动应用并读取 MCP 配置。
2. 用户打开连接器菜单。
3. 用户选择一个已启用 MCP。
4. 前端调用 `/api/mcp/connect`。
5. 后端连接该 MCP、读取工具列表并缓存连接。
6. 用户发送消息，同时提交 `preferredConnector`。
7. 后端从缓存取得工具并注入当前 Craft 任务。
8. 消息完成后，前端清除本次连接器选择。

## 验证重点

- 启动时不应出现 MCP 子进程，也不应连接远程 MCP。
- 配置多个 MCP 后，选择其中一个只连接该服务。
- 当前任务的工具列表只出现所选 MCP 的工具。
- 下一条未选择 MCP 的任务不出现 MCP 工具。
- 修改配置后已有连接断开，且不自动重连。
- 同一 MCP 的重复选择复用连接。
- 自动化任务只加载 `connector` 指定的 MCP。

## 当前边界

- `mcp.json` 中的 `timeout` 尚未应用到 SDK 连接过程。
- 技能 `openai.yaml` 声明的 MCP 依赖尚未自动映射为连接选择。
- MCP 连接在进程内缓存，尚未实现空闲超时释放。
- Plan、Ask 和技能创建模式有意不开放 MCP。后续如需开放，应继续采用
  “每次任务显式传入”的方式，不能恢复全局注入。
