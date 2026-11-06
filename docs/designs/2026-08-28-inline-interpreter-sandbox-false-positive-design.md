# 内联解释器脚本沙箱误报修复设计

## 背景

打包客户端的普通会话在使用 `bash` 执行只读 Python 数据分析脚本时返回：

```text
[Pi-Sandbox] protected path hard denial: shell command targets application-managed files
```

真实会话记录表明，同一附件、同一工作目录和同一 Python 运行时下，只读取 Excel 并打印工作表信息的命令可以成功；脚本增加 `rows.append(row)` 后立即被沙箱拒绝。命令没有写入应用安装目录、内置技能目录或 `~/.pi-a/system`，也没有修改输入附件。

该问题在打包客户端中被发现，但与 ASAR、Electron 资源路径和 macOS 文件权限无关。拒绝发生在 shell 命令执行之前的静态词法检查阶段。

## 目标

- 允许 Python、Node、Deno 等内联脚本执行纯内存的 `append`、`replace` 等普通数据处理操作。
- 继续拒绝内联脚本对应用安装目录、内置技能目录、`~/.pi-a/system` 等受保护根目录的真实文件写入。
- 继续对无法解析目标的真实文件系统写操作失败关闭。
- 不因修复误报而关闭 `ProtectedPathPolicy`、降低路径包含检查或放行动态文件写入。
- 为本次真实命令形态补充回归测试源码，但遵循项目约束，不自动运行测试套件。

## 非目标

- 不修改 macOS TCC、`sandbox-exec` 或系统权限配置。
- 不修改会话工作目录、附件目录或 artifacts 目录布局。
- 不允许 Agent 修改应用管理文件。
- 不实现完整的 Python、JavaScript、Ruby 或 Perl AST 静态分析器。
- 不在本次顺带调整环境变量检测、shell 条件表达式或其他独立的保守拦截规则。
- 不修改受管 CLI 连接器、MCP 或打包资源布局。

## 现状与根因

`protectShellTool()` 在调用真实 `bash` 工具前依次执行：

1. `inspectToolCallForPlatform()` 进行词法检查；
2. `commandReferencesProtectedWrite()` 调用 `parseShellWriteTargets()`；
3. `addInterpreterFallbackTargets()` 扫描 `python -c`、`node -e` 等内联脚本；
4. `INTERPRETER_WRITE_SEMANTICS` 判断脚本是否包含写入语义；
5. 如果判断为写入语义但找不到明确路径，则设置 `unsafeDynamicTarget = true`；
6. 词法检查将任何 `unsafeDynamicTarget` 作为受保护路径硬拒绝。

当前写入语义正则包含无调用对象约束的裸关键词：

```ts
/(?:\bwrite|append|unlink|remove|rename|replace|mkdir|rmdir|chmod|chown|open\s*\(...)/i
```

因此以下纯内存代码会被误判：

```py
rows.append(row)
name.replace("a", "b")
```

因为这些脚本通常不包含绝对输出路径，解析器又将它们升级为“动态文件写入”，最终产生用户看到的 hard denial。

这解释了真实会话中的确定差异：

- `openpyxl.load_workbook(...); print(...)`：成功；
- 相同代码增加 `rows.append(row)`：失败。

## 方案比较

### 方案一：按语言识别明确文件系统写入 API（采用）

将通用裸关键词替换为少量、明确的文件系统调用模式：

- Python：带写模式的 `open()`，以及 `os`、`pathlib.Path`、`shutil` 的写入/删除/移动 API；
- Node：`fs` 的 `writeFile`、`appendFile`、`open`、`createWriteStream`、`rm`、`unlink`、`rename`、`mkdir` 等 API；
- Deno：`Deno.writeFile`、`writeTextFile`、`open`、`remove`、`rename`、`mkdir` 等 API；
- Ruby/Perl：只保留能明确表达文件打开写模式或文件系统变更的模式。

优点：修复真实误报，保持动态真实写入失败关闭，不增加运行时依赖。缺点：正则不是完整语言解析器，需要用回归用例持续维护明确 API 集合。

### 方案二：发现 `append`、`replace` 时只检查脚本中的绝对路径

不再在“找不到绝对路径”时标记动态写入。

优点：改动最小。缺点：`open(path, "w")`、`fs.writeFile(target, ...)` 等动态路径写入会被直接放行，削弱应用目录保护，不采用。

### 方案三：引入各语言 AST 解析器

分别解析 Python、JavaScript/TypeScript、Ruby 和 Perl 代码，追踪调用对象及参数来源。

优点：理论上语义最精确。缺点：依赖与维护成本高，无法可靠覆盖 shell 拼接、动态 import、反射和多语言片段；对当前问题过度设计，不采用。

## 采用方案

### 1. 拆分“文件系统写入语义”和“普通方法名”

删除对裸 `append`、`replace`、`remove`、`write` 等词的通用匹配。判断必须至少满足以下一类条件：

- 明确的文件打开写模式，例如 `open(path, "w")`、`open(path, "a")`、`open(path, "x")` 或带 `+` 的写模式；
- 明确命名空间/类型上的文件系统 API，例如 `os.remove()`、`Path.write_text()`、`fs.writeFileSync()`、`Deno.remove()`；
- 明确的文件流创建或文件树变更 API。

`list.append()`、`str.replace()`、集合 `remove()`、内存缓冲区 `write()` 不再单凭方法名触发文件系统写入判断。

### 2. 保持动态真实写入失败关闭

当脚本命中明确文件系统写入 API 时，继续沿用现有行为：

- 能提取绝对路径：按 `ProtectedPathPolicy` 判断目标是否位于受保护根；
- 目标来自变量、表达式或无法提取：保持 `unsafeDynamicTarget = true`，拒绝执行；
- 目标明确位于普通会话工作区或 artifacts：允许通过现有 resolved-path 二次检查；
- 目标位于应用安装目录或 `~/.pi-a/system`：继续 hard denial。

本次不改变 `assertWritableTarget()`、canonical path、符号链接和 resolved-path 防线。

### 3. 建立语言分组的可读匹配器

不继续扩充一个难以审计的总正则。将判断拆成小型纯函数或按语言分组的受限正则，并由 `interpreterScripts()` 同时返回解释器类型和脚本文本。这样可以明确每种语言允许识别的文件系统 API，避免不同语言的普通方法名互相污染。

### 4. 回归覆盖

在根目录 `test/` 下按源码镜像补充 `path_policy` 回归测试源码，至少覆盖：

允许：

- 真实会话中的 `rows.append(row)` Excel 只读分析脚本；
- `name.replace(...)`、集合 `remove(...)` 等纯内存操作；
- 同一脚本从 attachments 读取并向 stdout 打印。

拒绝：

- `open('/Applications/.../file', 'w')`；
- `Path('/Applications/...').write_text(...)`；
- `os.remove('/Applications/...')`；
- `fs.writeFileSync('/Applications/...', ...)`；
- `Deno.writeTextFile('/Applications/...', ...)`；
- 明确文件系统写入 API 使用动态目标变量。

测试源码只用于锁定语义；按当前项目要求不自动执行。

## 数据流

```text
Agent bash 工具调用
  -> protectShellTool
  -> parseShellWriteTargets
  -> 识别解释器与内联脚本
  -> 明确文件系统写入 API？
       否：继续检查 shell 其他写入目标，纯内存调用不触发
       是：提取/判定写入路径
            -> 动态或受保护：hard denial
            -> 普通路径：resolved-path 二次校验后执行
```

## 错误处理

- 真正的受保护路径写入继续返回原稳定错误：
  `protected path hard denial: shell command targets application-managed files`。
- 纯内存操作不再产生沙箱错误，实际解释器错误按原 bash 工具结果返回。
- 不把完整命令、附件内容或环境变量增加到生产日志。
- 本次不修改前端错误展示。

## 影响范围

- `src/platform/path_policy.ts`：解释器内联脚本的文件系统写入识别。
- `test/src/platform/path_policy.test.ts`：新增回归测试源码。
- `docs/designs/2026-08-28-inline-interpreter-sandbox-false-positive-design.md`：本设计。
- `docs/README.md`：实施时增加设计索引。

不影响 `src/agent/session_root.ts`、附件存储、artifacts 路径、Electron 打包配置、连接器 Registry 或前端组件。

## 风险与控制

### 漏掉某个文件系统 API

风险：受限正则无法覆盖所有第三方库的写入封装。

控制：沙箱本来就不能证明任意内联代码的全部副作用；本层只识别确定的标准文件系统 API，实际进程仍受会话 cwd、权限策略和 macOS `sandbox-exec`（启用时）约束。后续新增标准 API 必须附带拒绝回归用例。

### 过度放宽动态写入

风险：为消除误报而允许 `open(path, 'w')` 一类动态目标。

控制：只有纯内存方法从写入语义集合移除；明确文件系统 API 的动态目标仍然 hard denial。

### 继续产生相似误报

风险：某些第三方库方法名与文件 API 相同。

控制：优先要求命名空间、类型或写模式上下文，避免裸方法名；回归覆盖本次真实命令全文的最小等价形态。

### 打包环境与开发环境差异

风险：误以为修复只适用于 ASAR。

控制：修复位于平台无关的纯解析器，不依赖 `app.isPackaged`；开发和打包使用同一判定逻辑。

## 验证方式

遵循项目“禁止自动运行测试套件”的约束，实施后只执行：

1. `npx tsc --project tsconfig.electron.json --noEmit`；
2. 对新增回归测试源码执行 TypeScript 严格语法/类型检查，但不运行测试；
3. 静态检查允许用例不包含被识别的文件系统写入模式；
4. 静态检查拒绝用例仍命中明确文件系统 API 与动态目标保护；
5. `git diff --check`。

用户后续手工验收：

- 在打包客户端中重新执行同类 Excel 只读分析，包含 `rows.append(row)` 时不再误报；
- 使用临时测试会话尝试写入应用安装目录，仍被 hard denial；
- 普通 artifacts 输出仍可执行；
- 附件输入文件保持不变。

## 完成定义

真实会话中的只读 Python 数据分析脚本不再因为 `list.append()` 等纯内存方法被误判；明确文件系统 API 对动态目标或受保护根目录的写入继续被拒绝，且未降低现有路径、符号链接与 resolved-path 防线。
