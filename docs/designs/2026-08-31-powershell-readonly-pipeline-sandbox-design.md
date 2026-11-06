# PowerShell 只读管道沙箱误报修复设计

## 背景

Windows 打包客户端中，Agent 使用以下形态分析用户上传的 CSV：

```powershell
powershell -NoProfile -Command "$rows = Get-Content -Encoding UTF8 '...\\Pi-a\\attachments\\...\\aolairelab.csv'; ..."
```

脚本只读取附件、在内存中筛选和分组，并通过 `Write-Host` 输出结果，但在命令执行前被 Pi-Sandbox 拒绝：

```text
[Pi-Sandbox] protected path hard denial: shell command targets application-managed files
```

附件目录属于应用管理目录，必须禁止 Shell 修改；但只读访问本来应当允许，否则 Agent 无法用系统自带工具分析尚未复制到工作区的附件。

## 目标

- 允许 `powershell` / `pwsh -Command` 中明确的只读附件分析管道。
- 正确认识 PowerShell 的 `$name = <command>` 赋值前缀，不把变量名当成可执行程序。
- 将 `Get-Content`、`Where-Object`、`ForEach-Object`、`Select-Object`、`Sort-Object`、`Group-Object` 和 `Write-Host` 等无文件写入的 cmdlet 作为只读数据处理命令审查。
- 继续拒绝 `Set-Content`、`Add-Content`、`Out-File`、`Remove-Item`、`Move-Item`、`Copy-Item` 等对应用管理目录的写入或变更。
- 继续对动态、无法确定目标的真实文件写操作失败关闭。

## 非目标

- 不允许 Agent 修改 `attachments`、`artifacts/sessions`、应用安装目录或内置资源。
- 不把所有 PowerShell 命令视为安全，也不建立完整 PowerShell AST 解释器。
- 不改变 L1/L2/L3 权限确认规则。
- 不通过自动复制附件到工作区绕开根因。
- 不修改附件存储路径、数据库或上传协议。

## 现状与根因

`src/platform/path_policy.ts` 会递归抽取 `powershell -Command` 的脚本内容，并尝试判断其中的写入目标。当前有两处组合误判：

1. 外层 `powershell` 不在解释器包装器的专门处理分支中，会进入“未知程序”兜底扫描；`-Command` 后的整段脚本因此被当作潜在路径参数，其中出现的附件路径被视为潜在写目标。
2. 内层 PowerShell 的 `$rows = Get-Content ...` 被分词后，`$rows` 被当成命令起点；真正的 `Get-Content` 没有作为命令起点审查，附件输入路径继续落入未知写入兜底。

后续 `Where-Object { $_... }`、`ForEach-Object` 等脚本块还包含 PowerShell 自动变量。若按未知命令扫描参数，自动变量会被误认为动态文件目标，产生同类硬拒绝。

因此拒绝发生在静态词法审查阶段，与 CSV 编码、文件内容和 Windows 文件权限无关。

## 采用方案

### 1. 将 PowerShell 命令包装器作为已解析边界

识别 `powershell` / `pwsh` 的 `-Command`、`-C` 参数。脚本正文继续通过现有 `wrappedCommandFragments()` 递归审查，但外层包装器不再把整段脚本文本交给未知程序的路径参数兜底扫描。

包装器自身除脚本正文以外的参数仍按保守规则处理；不支持或无法提取的命令形态不自动获得只读豁免。

### 2. 识别 PowerShell 变量赋值前缀

在命令位置计算中识别 `$name =` 形态，使等号后的第一个命令成为真正的命令起点。例如：

```powershell
$rows = Get-Content 'input.csv'
```

应审查 `Get-Content`，而不是把 `$rows` 当成未知可执行程序。仅识别简单变量赋值，不尝试求值表达式或展开任意动态代码。

内层脚本递归审查时同时标记为 PowerShell 语法，不把 `(...)` 当作 POSIX 子 Shell。括号内的 `$data.Count`、`$names | Sort-Object` 等表达式仍随所属 cmdlet 审查，但不会单独退化成未知命令和动态路径。PowerShell 的 `$()` 子表达式仍保留递归审查。

### 3. 扩充经审计的 PowerShell 只读数据 cmdlet

在 Windows 规则中增加最小只读集合：

- 文件输入与存在性检查：`Get-Content`、`Get-Item`、`Get-ItemProperty`、`Test-Path`、`Select-String`；
- 内存管道处理：`Where-Object`、`ForEach-Object`、`Select-Object`、`Sort-Object`、`Group-Object`、`Measure-Object`；
- 标准输出：`Write-Host`、`Write-Output`。

这些命令只跳过“未知程序可能写入路径”的兜底推断，不跳过全局重定向、显式输出参数以及已知写命令扫描。脚本块中的 `$_`、`$PSItem` 和普通变量因此不会被当成动态文件目标。

### 4. 保持写命令和动态写入失败关闭

现有 Windows 写命令集合继续负责提取目标路径。补充或确认以下命令的写入语义：

- `Set-Content` / `Add-Content` / `Clear-Content`；
- `Out-File`；
- `Remove-Item` / `Move-Item` / `Copy-Item` / `Rename-Item`；
- `New-Item` 及链接能力目标。

写目标位于应用管理目录时仍返回原 hard denial；写目标来自未解析变量或表达式时仍标记 `unsafeDynamicTarget`。

### 5. 与内联解释器误报设计保持分层

本设计只处理 PowerShell 包装器、赋值和只读管道识别。Python/Node/Deno 的 `append`、`replace` 普通内存方法误报仍由 `2026-08-28-inline-interpreter-sandbox-false-positive-design.md` 负责，避免把两种根因混成一个宽泛白名单。

## 影响范围

- `src/platform/path_policy.ts`：PowerShell 包装器、命令位置和只读 cmdlet 审查。
- `test/src/platform/path_policy.test.ts`：新增 PowerShell 只读/写入回归测试源码；若该镜像测试文件尚不存在则创建。
- `docs/05-OS自动化与权限.md`：补充“受保护目录只读允许、写入拒绝”的当前规则。
- `docs/README.md`：增加本设计索引。

不影响附件服务、数据库、IPC、前端和打包路径。

## 风险与控制

### 把有副作用的 PowerShell 命令错误列为只读

控制：只纳入语义明确、不会写文件系统的 cmdlet；不以 `Get-*` 或 `Write-*` 前缀整体放行。`Write-Host` / `Write-Output` 仅写标准输出，不代表文件写入。

### 包装器跳过导致内层脚本漏审

控制：仅在成功提取 `-Command` 脚本并递归审查时跳过外层脚本文本；无法提取的包装器保持保守兜底。嵌套脚本的重定向和已知写命令仍由递归结果合并。

### PowerShell 语法覆盖不完整

控制：首版只支持真实问题所需的简单赋值和管道；复杂动态调用、调用运算符、脚本文件或编码命令不获得新的豁免。

## 验证方式

按项目约束，本次实施默认只执行 TypeScript 类型检查和 `git diff --check`，不自动运行测试套件。回归测试源码至少覆盖：

- 允许：用户本次 `Get-Content` + `Where-Object` + `ForEach-Object` + `Sort-Object` + `Group-Object` + `Write-Host` 命令读取受保护附件。
- 允许：同一命令使用 `pwsh -Command`。
- 拒绝：`Set-Content`、`Add-Content`、`Out-File` 写入受保护附件路径。
- 拒绝：`Remove-Item`、`Move-Item`、`Copy-Item` 变更受保护路径。
- 拒绝：写命令使用无法解析的动态目标。
- 允许：同类只读管道读取普通工作区文件。

若用户明确授权，再运行对应的定向回归测试。
