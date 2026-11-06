# Windows 目录选择闪退修复设计

## 背景

Windows 端从工作空间快捷菜单点击“打开本地文件夹”时，部分机器出现应用卡死或闪退。故障机器日志显示，每次复现都在 `windows.process.create` 启动带 `-STA` 参数的 PowerShell 后中断，没有成功、错误或超时结束记录。

源码检查发现，同一目录选择功能存在两条实现：

- 工作空间管理弹窗调用前端统一的 `pickDirectory()`，在 Electron 环境通过 IPC 使用 `dialog.showOpenDialog()`。
- Composer 工作空间快捷菜单直接请求 `/api/pick-dir`，绕过前端 IPC 路由；Windows HTTP 降级实现会通过 PowerShell、WinForms 和 Koffi/Win32 进程执行器显示目录选择器。

故障日志与第二条调用链一致。该链路在不同 Windows 环境中存在原生进程卡死或被硬终止的风险，并且原生层中断时无法进入 JavaScript 异常处理。

## 目标

- 让 Composer 中的“打开本地文件夹”在 Electron Windows 端统一使用 Electron 原生目录选择器。
- 保留取消选择、选择成功后打开工作空间管理弹窗并预填目录名称和路径的现有交互。
- 保持 macOS 和非 Electron 浏览器环境的现有目录选择行为不变。
- 避免改动当前工作区中的文件拖放功能和其他 Composer 行为。
- 增加静态回归约束，防止该入口再次直接调用 `/api/pick-dir`。

## 非目标

- 不删除浏览器开发环境需要的 `/api/pick-dir` HTTP 降级接口。
- 不在本次修改中重构通用 Windows 进程执行器。
- 不处理日志中 9 月 9 日和 11 日出现的、由不存在路径触发的 `shell.openPath()` 历史闪退；该问题属于另一条文件打开链路，应单独设计和修复。
- 不调整工作空间数据模型、数据库或目录访问权限策略。

## 现状

`frontend/src/api/client.ts` 已提供 `pickDirectory()`：Electron 环境优先调用 preload 暴露的 `pickDirectory`，再由 `dialog.pickDir` IPC handler 调用 `dialog.showOpenDialog()`；非 Electron 环境才降级到 `/api/pick-dir`。

`frontend/src/components/WorkspaceModal.tsx` 已使用该统一函数，但 `frontend/src/components/Composer.tsx` 的快捷入口仍直接使用 `fetch("/api/pick-dir")`，导致发布包在 Windows Electron 环境错误进入 HTTP/PowerShell 实现。

## 方案

1. 在 `Composer.tsx` 中复用 `frontend/src/api/client.ts` 导出的 `pickDirectory()`。
2. 通过 preload 已暴露的 `electronAPI.platform` 判断运行环境：Windows Electron 调用 `pickDirectory()`；其他平台继续使用现有 `/api/pick-dir` 请求。
3. 保持以下行为不变：
   - 用户取消时不打开管理弹窗；
   - 成功后关闭快捷菜单；
   - 将目录名称和完整路径写入 `_pendingDirPath`；
   - 继续由现有工作空间管理弹窗完成创建。
4. 增加一个源码级回归测试，验证 Composer 快捷入口只在 Windows Electron 环境使用统一目录选择函数，并保留其他平台的原有分支。测试文件遵循现有前端测试位置，不触碰当前未提交的文件拖放测试。

## 影响范围

- `frontend/src/components/Composer.tsx`
- 新增或更新与 Composer 目录选择入口对应的前端测试文件
- Windows Electron 下的目录选择调用链

不影响 macOS 行为、后端 API、preload 接口、IPC 协议、工作空间存储和非 Electron HTTP 降级能力。

## 风险

- 如果 preload 未正确加载，`pickDirectory()` 会按既有逻辑降级到 API；本次不改变该兼容行为。
- Composer 文件较大且当前可能存在并行改动，实施时必须只修改导入和目录选择回调，避免覆盖其他变更。
- Electron 原生对话框的前后层级依赖现有 `dialog.pickDir` handler；该 handler 已在 Windows 下使用无父窗口方式，并在弹出前恢复和聚焦主窗口。

## 验证方式

遵循项目约束，本次默认只执行：

1. 前端 TypeScript 类型检查：`cd frontend && npx tsc --noEmit -p tsconfig.app.json`
2. `git diff --check`
3. 静态检查 Composer 中 Windows 分支调用 `pickDirectory()`，其他平台保留原有 `/api/pick-dir` 分支
4. 检查修改差异，确认未覆盖现有文件拖放改动

回归测试源码会编写，但只有用户明确授权后才执行测试。最终仍建议用 Windows x64 安装包在故障机器上完成一次真实点击验收。

## 实施结果

- Composer 工作空间快捷入口已改为仅在 Windows Electron 环境调用统一的 `pickDirectory()`，其他平台保持原行为。
- 成功选择目录后继续沿用原交互，并为可选目录名称增加跨平台路径末级名称回退。
- 已增加源码级回归测试，约束 Windows 分支使用原生目录选择器。
- 前端 TypeScript 类型检查通过。
- `git diff --check` 通过。
- 按项目默认约束未执行测试套件，Windows 安装包真实点击验收仍待后续打包验证。
