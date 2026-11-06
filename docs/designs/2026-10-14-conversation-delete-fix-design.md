# 任务删除失效修复设计

## 背景

2026-10-14 本机 16:05 的 operations.jsonl 多次记录 ipc.session.delete 失败：Cannot find module src/agent/core_session.ts。按钮事件和 IPC 请求已经触发，但后端在导入已不存在的模块时中断，尚未执行实际删除。前端未处理删除异常，用户看不到失败原因。

## 目标

- 修复任务列表和空间内会话共用的删除流程。
- 释放运行时并清理该会话记录的历史文件、工作记忆、消息与关联数据。
- 删除失败时显示现有应用内提示框；成功删除当前会话后恢复可输入的欢迎状态。

## 非目标

不恢复旧 core_session 模块，不新增依赖，不迁移数据库，不删除工作空间、附件源文件或用户生成的交付物，不修改安装目录或直接删除用户实际会话验证。

## 现状

- Sidebar.tsx 的 ConvItem 调用 useStore.deleteConversation，任务和空间复用该入口。
- application.electron.ts 的 DELETE /api/conv/:id 导入失效的 coreSessionManager。
- session_cleanup.ts 已有释放运行时、清理外部文件、清理工作记忆、清理连接器子会话和删除 SQLite 行的编排。
- provider.ts 的 openNativeSessionManager 使用 conversations.core_session_path 映射 Pi 原生历史文件，目录为应用数据目录的 pi-agent/sessions；dispose 仅释放运行时，不删除历史文件。
- useStore 已提供 showUiAlert，可复用 AppDialog 展示错误。

## 方案

1. 在现有 session_cleanup.ts 中提供会话历史文件清理函数，通过 getCoreSessionPath 读取映射；使用 Node 文件 API 删除该文件。无映射或文件已不存在时正常继续，其他文件错误继续向上抛出。校验目标为应用管理的会话目录内文件；兼顾已有 core-sessions 历史目录，拒绝越界和目录目标，不使用递归删除，不根据会话 ID 猜测文件名。检查实际路径，避免父目录链接使目标越出受管目录。
2. DELETE 接口移除 core_session.ts 动态导入，将 removeCore 接到上述函数，复用 provider.dispose 和原有清理编排。父、子会话均走相同文件清理函数，保留 SQLite 元数据最后删除的顺序，文件删除失败时保留记录供重试。
3. 前端在共用删除入口处理请求失败，复用 showUiAlert 显示“删除失败”和原因，保留当前列表与会话。不增加新的提示系统。成功删除后立即从本地列表移除目标并使旧列表请求失效；删除当前会话时复用 resetToWelcome 重置 busy、taskStatus 及输入区关联，再刷新会话列表。既有 loadConversations 内部处理刷新异常，刷新失败仍保留本地已删除结果，避免将已删除误报为删除失败。
4. 补充小范围回归测试源码，覆盖正常文件、未创建文件、空路径、越界/目录/链接目标、清理失败保留元数据，以及删除接口不再引用失效模块。按项目约束，未经另行授权不执行测试。

## 影响范围

application.electron.ts、src/agent/session_cleanup.ts、frontend/src/store/useStore.ts、相关回归测试源码与 docs/15-Pi-Agent与Electron前端IPC交互协议.md。既有 IPC 名称、preload 白名单和 HTTP 路径保持一致。

## 风险

### 本地验证发现的编译服务问题

用户验证时，开发版在按需加载删除模块时返回 esbuild 的 `The service is no longer running`。main.mjs 已对安装包禁用 esbuild 同步工作线程，但开发模式提前返回而未设置此选项。将同一选项移到 tsx 注册之前，覆盖开发版和安装版，避免开发版再次使用该工作线程模式。重启后检查应用就绪和只读按需加载接口；不删除用户会话验证。

- Windows 文件占用会导致清理失败，必须提示原因并保留会话记录，不能静默忽略。
- 清理运行时后会话已停止；文件删除失败时用户可重试删除，但不承诺继续原运行任务。
- 文件系统与 SQLite 无跨系统事务；保持外部文件先处理、元数据后处理，失败不能误报成功。
- 代码修复不会自动更新当前已安装的 3.3.1；需后续授权构建、安装并重启应用才能验证安装版行为。

## 验证方式

默认只执行前后端 TypeScript 类型检查与 git diff --check。回归测试、Windows x64 构建、打包和应用启动验证需用户明确授权；不对用户真实会话执行破坏性验证。交付时如有既有类型错误须单独说明，不将静态检查等同于实际删除验证。
