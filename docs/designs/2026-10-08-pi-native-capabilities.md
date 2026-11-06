# Pi 原生能力接入与流程边界

日期：2026-10-08。承接 Pi 1.0.4 依赖升级。本次改动未提交或发布。

## 接入结果

| 能力 | 实现 | 保留的产品约束 |
| --- | --- | --- |
| Codemode | Pi createCodemodeExtension，QuickJS worker 执行 | 只包装当前会话允许的工具；脚本嵌套调用仍经过权限、受保护路径、审计和取消链路 |
| 动态工具搜索 | Pi createToolSearchExtension，原生排序和按需激活 | 允许注册的工具与当前激活的工具分开；不允许搜索或调用未选择的插件工具 |
| 原生图片生成 | ModelRuntime.generateImages，generate_image 工具承接 | 按 write 检查权限；保存到指定交付文件；不覆盖已有文件；仍需 present_files 展示，费用进入原用量日志 |
| 虚拟模型路由 | 原生插件 registerVirtualModel；原生路由状态与物理模型分发 | 在原模型选择器中明确选择路由模型；不设置默认路由、不擅自切换已选模型 |
| 标准 MCP 与 OAuth | Pi 配置校验、McpServerConnection、原生结果转换、凭据存储、PKCE 登录和刷新 | 保留原配置编辑入口、连接器名称、按需连接方式、企业托管配置及授权流程 |

Codemode 的 models 快捷入口关闭，图片生成通过受写权限控制的 generate_image 调用。这样不会出现脚本直接发起付费模型调用却绕过产品权限的问题。Pi 仍负责实际图片推理与凭据解析，产品层只负责权限和交付文件。

present_files、goal_complete、ask_user 保持 model-only，不暴露给脚本调用，确保展示、结束声明与交互保持独立。ask 模式没有业务工具时，也不会因为这次接入获得 Codemode 或图片生成工具。

## 使用方式

### 脚本与工具搜索

已有工具的会话自动获得 Codemode 和 tool_search，无需切换操作入口。现有 MCP 默认为 direct，保持原有调用方式。需要按需加载的服务器可以在原 MCP 配置编辑器中设置：

```json
{
  "mcpServers": {
    "docs": {
      "url": "https://your-server.example/mcp",
      "exposure": "deferred",
      "toolExposure": { "delete_*": "hidden" }
    }
  }
}
```

direct / deferred / codemode / hidden 使用原生语义；hidden 工具不进入会话。工具搜索不会扩大用户选择的连接器范围。

### 图片

模型设置中增加 OpenRouter 原生服务商，可使用原 API Key 设置入口配置凭据。图片模型目录与生成由 Pi 提供，支持的其他原生图片 provider 也可以通过现有插件机制注册。仅配置普通聊天模型不等于具备图片生成能力。

具备文件写入和交付工具的会话可以使用 generate_image，参数为 prompt、path，以及可选 provider/model。只有恰好一个可用图片模型时才自动选择，否则返回可选模型列表要求明确指定。成功返回文件路径和图片，并沿用 present_files 交付；不会把临时图片冒充已交付成果。

### 虚拟模型

使用现有已安装插件的 Pi 扩展注册虚拟模型。无工具、仅注册模型的插件现在也会加载。插件声明的 provider/id/name 出现在现有模型选择器与默认模型设置中，虚拟条目不会被保存成物理模型配置。

路由函数直接使用 Pi registerVirtualModel API；目标模型和路由策略由插件明确声明，没有新增关键词猜测、自动降级或按价格擅自切换的策略。每次实际请求由 Pi 选择物理模型，原用量日志记录实际响应中的服务商和模型。路由状态进入原生会话，重开仍使用同一个原生 SessionManager。

### MCP OAuth

标准 HTTP MCP 服务器卡片提供“授权连接”“取消授权”“退出授权”。授权 URL 在原生库完成发现/注册后显示，用户打开链接完成浏览器登录；状态通过同一 HTTP/IPC API 更新。

配置支持 Pi 原生 oauth 字段（clientId、callbackUrl、clientRegistration、scope、authServerMetadataUrl 等）。凭据位于应用数据目录的 mcp-auth.json，使用 Pi 文件锁与按服务器名称/URL 隔离的存储；连接器编辑仍使用原 mcp.json，并保留串行原子写入和企业配置保护。

边界：不自动加载工作目录中的 .pi/mcp.json，也不自动连接新服务器。当前产品没有项目级 MCP 信任/选择流程，直接打开 Pi 的自动发现会改变已有行为。TAPD、零售应用、CLI 连接器继续走原业务授权；旧 SSE 继续使用官方 MCP SDK，因为 Pi 没有该传输。标准 MCP 的配置语义、连接与 OAuth 复用 Pi，企业配置所有权由产品保留。

## 验证

### 历史会话恢复修复（用户报错后补充）

升级时增加的内部 ID 相等校验不成立：应用对话 ID 与 Pi 内部会话 ID 可以不同，已有数据库的 core_session_path 才是二者的映射。现已移除该误拦截，保留原生会话目录边界和 Pi 文件格式校验，不改写历史 ID 或文件。Pi 首条消息前不落盘，空会话重开按原应用 ID 创建；若已有消息但文件缺失，则明确报错，避免静默清空上下文。

新增回归先复现失败，修复后与会话重载、原生恢复/压缩、事件订阅组合共 16/16 通过，TypeScript 检查通过。只读检查本地数据发现 4 个不同内部 ID 的原生会话和 49 个未落盘空会话。旧自定义格式仍不能继续聊天；原历史查看和文件保留。此限制不应被理解为“历史会话完全不受影响”。运行中的后端需要重启加载修复；此前构建的应用包不包含本次修复。

- TypeScript 检查和前端生产构建通过。
- 原生能力、会话重载、完成边界和 HTTP/IPC 映射专项组合：35/35 通过。
- 补充原生核心组合：4/4 通过，包含 MCP 配置校验、隐藏工具和脚本结构化结果。
- 全量后端：667 项，628 通过、31 失败、1 取消、7 跳过。归一化测试名称与上一轮 664 项基线比较，无新增失败或取消。
- 前端既有测试：148 项，147 通过、1 个已有失败；新增 OAuth IPC 用例在专项组合通过。
- 服务测试：33/33 通过。
- macOS arm64 打包与包内原生会话、图片处理、Codemode worker 执行通过。复用验证脚本：scripts/testing/pi-native-runtime-smoke.cjs。
- 模型测试使用 Pi fauxProvider 和本地图片 provider；OAuth 使用真实本地 HTTP/回调服务，验证 S256 PKCE、凭据隔离、退出和取消，不使用生产账号。

原始日志保存在 /private/tmp/pi-native-*.log。应用包位于 /private/tmp/pi-native-package/mac-arm64/PiCoddyClaw.app。

没有 Windows 真机运行证据；代码使用 Node 路径与传输 API，图片权限用例包含 Windows 策略接口，但不等同于 Windows 安装验收。没有实际付费图片生成或企业生产授权验收。已有业务测试失败没有因本次接入而消失，不能据此宣称所有生产功能全部通过。
