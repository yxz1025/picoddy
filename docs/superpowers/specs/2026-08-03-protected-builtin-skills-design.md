# 受保护内置技能包设计

## 目标

将 PiCoddy-a 当前散落在 TypeScript 字符串和 `skill-creator` 专用生成模块中的内置技能，迁移为真实、标准的技能目录。构建时生成确定性清单与 gzip 压缩载荷，启动时原子释放到独立系统目录，并继续由现有 `src/agent/skills.ts` 扫描和渐进加载。

同时修复 Agent 以用户主目录作为工作根、因而能够修改 PiCoddy-a 源码的问题。应用代码、安装目录和系统内置技能必须成为不可由 Agent 绕过的受保护路径，macOS 和 Windows 均需覆盖。

## 范围

本次迁移包含以下六个现有内置技能：

- `weekly-report`
- `data-analysis`
- `presentation`
- `polish-writing`
- `doc-qa`
- `skill-creator`

本次不新增技能索引服务、不新增技能数据库、不改变 MCP 工具隔离策略，也不改变普通技能的触发协议。

## 技能源码结构

真实技能目录是内置技能唯一可维护源码：

```text
resources/builtin-skills/
├── weekly-report/SKILL.md
├── data-analysis/SKILL.md
├── presentation/SKILL.md
├── polish-writing/SKILL.md
├── doc-qa/SKILL.md
└── skill-creator/
    ├── SKILL.md
    ├── agents/openai.yaml
    ├── scripts/
    ├── references/
    ├── assets/
    └── license.txt
```

`SKILL.md` 只保存核心流程和资源导航。大体量说明放入 `references/`，确定性能力放入 `scripts/`，模板、图片和其他输出资源放入 `assets/`。构建产物不是技能源码，禁止人工修改。

## 构建格式

新增 `scripts/build-builtin-skills.ts`，递归扫描 `resources/builtin-skills` 并生成：

```text
src/agent/builtin_skills/builtin-skills.manifest.generated.json
src/agent/builtin_skills/builtin-skills.bundle.generated.ts
```

构建器必须：

1. 只接受普通目录和普通文件，拒绝符号链接。
2. 拒绝绝对路径、`..`、空段、NUL 和路径越界。
3. 校验每个一级目录存在合法 `SKILL.md`，目录名和 frontmatter `name` 一致。
4. 拒绝重复技能名和大小写折叠后冲突的名称，以兼容 Windows。
5. 将压缩包内部路径统一为 `/` 分隔符。
6. 按内部路径稳定排序，为每个文件记录字节数和 SHA-256。
7. 生成包含格式版本、技能列表、文件清单和整体 bundle digest 的 manifest。
8. 将文件包序列化为确定性 JSON，再使用 `CompressionStream("gzip")` 压缩。
9. generated TypeScript 只保存 manifest 和单个 gzip Base64 载荷，不保存人工维护的技能字符串。
10. 相同输入重复构建必须得到相同 manifest、bundle digest 和压缩载荷。

构建任务在 macOS、Windows 桌面构建前以及相关测试中运行。旧的 `skill_creator.generated.ts`、专用 embed 脚本和专用 seed 实现由统一构建与释放流程取代。

## 运行时目录与原子释放

`PlatformPaths` 增加跨平台系统路径：

```text
systemDir
builtinSkillsRootDir
builtinSkillsDir
```

对应实际位置：

```text
macOS:  ~/.pi-a/system/builtin-skills/current
Windows: %LOCALAPPDATA%\Pi-a\system\builtin-skills\current
```

启动时由统一内置技能包安装器执行：

1. 创建系统技能根目录，检查各祖先不是符号链接。
2. 读取 `current/.picoddy-builtin-manifest.json`。
3. manifest digest 与内嵌版本一致时直接复用，不重复释放。
4. 不一致时解压到同一父目录下的唯一 staging 目录。
5. 每个目标路径再次执行边界与符号链接检查。
6. 写完后重新校验文件数量、大小和 SHA-256。
7. 写入完整 manifest marker。
8. 将现有 `current` 改名为唯一 backup，再将 staging 改名为 `current`。
9. 新版本激活成功后删除 backup。
10. 任一步失败时恢复旧 `current`；启动恢复逻辑清理或回滚中断事务。

Windows 不依赖目录符号链接；macOS 与 Windows 都使用同目录 rename。macOS 对系统技能文件设置只读权限，Windows 设置只读属性作为辅助措施。真正的安全边界由应用路径策略保证，而不是仅依赖文件属性。

## 现有 skills.ts 多根扫描

`src/agent/skills.ts` 继续作为唯一技能发现和提示词入口，不新增统一技能索引。

`ensureSkillsDir()` 的职责调整为：

1. 确保用户技能目录存在。
2. 安装或验证内置技能 bundle。

`loadSkillsPrompt()` 通过现有 `loadSkills()` 同时扫描：

```ts
skillPaths: [
  platformPaths.builtinSkillsDir,
  platformPaths.skillsDir,
]
```

内置根目录排在用户目录之前。同名技能由内置技能获胜，并产生可诊断冲突；用户技能不能覆盖受保护技能。

渐进加载保持原行为：系统提示只包含技能名称、描述和 `SKILL.md` 路径；Agent 匹配到任务后才通过只读工具读取 `SKILL.md`，并根据其中指引按需读取 `references/`、执行 `scripts/` 或使用 `assets/`。普通技能正文不得在启动时或每次提示构建时整体注入。

`skill-creator` 会话仍主动加载其完整 `SKILL.md`，但内容改为从受保护系统技能目录读取，并继续附加 PiCoddy-a 草稿工具约束。

## 技能管理 API

现有技能 store 分别扫描系统内置根目录和用户技能目录，并合并成 UI 列表：

- 系统目录条目标记 `builtin: true`。
- 用户目录条目标记 `builtin: false`。
- 内置技能允许查看，不允许编辑、删除或被同名用户技能覆盖。
- 用户若希望定制内置技能，必须复制为不同技能名的用户技能。
- 技能草稿和安装逻辑只允许写入用户技能目录，绝不能把系统根目录作为安装目标。

内置技能识别不再依赖硬编码名称集合或 `skill-creator` 专用 marker，而以真实扫描来源为准。

## 应用自身保护

### 受保护根目录

增加跨平台路径策略函数，永久保护：

- `platformPaths.installationDir`
- `platformPaths.builtinSkillsRootDir`
- 开发模式下检测出的 PiCoddy-a 仓库根目录
- 应用运行代码和内嵌前端资源所在目录

仓库根通过从模块真实路径或当前工作目录向上查找同时包含 `deno.json`、`application.ts`、`src/agent` 的目录确定。打包环境无法得到真实源码目录时不创建虚假保护路径。

路径比较规则：

- macOS 使用规范化绝对路径，保留大小写语义。
- Windows 使用 `win32.resolve`，统一分隔符、去除非根尾分隔符并按不区分大小写比较。
- 已存在路径及其祖先执行 `lstat`/真实路径检查，拒绝符号链接绕过。
- 保护根本身及其任意后代都不可写。

### 会话工作根

Craft/Plan 工具不再以整个用户主目录作为 cwd：

- 会话绑定有效工作空间时，使用工作空间目录。
- 没有工作空间时，使用 `platformPaths.artifactsDir`。
- 工作空间位于受保护根中时，只提供只读文件工具，不提供 `write`、`edit` 或 shell。

通用 `write` 和 `edit` 在实际文件操作前再次检查目标路径。权限级别 L3 和用户确认都不能越过受保护路径。

### Shell

Shell 的 cwd 使用同一会话工作根：

- macOS 将受保护根作为永久 deny 规则加入文件写沙箱。
- Windows 继续使用现有 `CreateProcessW + CREATE_NO_WINDOW` 执行器，并在执行前规范化检查命令中的显式路径。
- 工作空间处于受保护根时不向 Agent 注入 shell。
- 没有工作空间时 shell 只能在工件目录执行。
- 保护路径拒绝属于硬拒绝，不进入确认流程。

这些措施首先消除应用从源码仓库启动时以仓库为 cwd、又把整个 HOME 暴露给 Agent 的问题。Windows 任意 shell 的更强 OS 级隔离不在本次范围内，但显式路径、自身工作空间和通用文件工具均必须受保护。

## 错误处理

- 内置 bundle 缺失、解压失败、摘要不匹配或恢复失败时，启动必须在 `skills-loaded` 之前失败并给出明确日志，不能静默退化为无内置技能。
- 单个用户技能损坏只产生诊断，不影响系统内置技能加载。
- 同名用户技能被忽略并报告冲突，不覆盖内置技能。
- 内置技能 API 写操作返回明确的只读错误。
- 受保护路径写操作返回结构化拒绝原因，并写入工具审计日志。

## 测试与验收

### 构建测试

- 六个真实技能全部进入 manifest。
- 相同输入连续构建产物一致。
- Windows 和 macOS 风格源路径产生相同内部路径。
- 符号链接、路径越界、重复名称、非法 frontmatter 被拒绝。
- bundle 可解压，所有文件摘要与 manifest 一致。

### 安装测试

- 空系统目录首次安装成功。
- 相同 digest 第二次启动不重写文件。
- 新 digest 使用 staging 原子替换。
- 解压、校验或 rename 故障后恢复旧版本。
- Windows 路径不依赖符号链接。

### 扫描与渐进加载测试

- `skills.ts` 同时扫描内置和用户目录。
- 六个内置技能均可发现。
- 同名用户技能不能覆盖内置技能。
- 系统提示包含名称、描述和路径，不包含技能正文或 reference 正文。
- `skill-creator` 会话从新系统目录读取完整技能正文。

### 保护测试

- macOS 和 Windows 的保护根及子路径判断正确。
- `../`、绝对路径、大小写变化和分隔符变化不能绕过。
- 无工作空间会话使用工件目录，不使用 HOME 或仓库 cwd。
- PiCoddy-a 仓库被选为工作空间时只提供只读工具。
- `write`、`edit` 和显式 shell 路径修改源码、安装目录或内置技能均被拒绝。
- 普通用户工作空间和工件目录仍可写。

### 完整验收命令

- 运行新增内置技能构建、安装、扫描和路径策略测试。
- 运行现有 `skill_creator_context_test.ts`、技能 store、技能草稿和权限测试。
- 执行 Deno 类型检查。
- 构建前端并重新生成嵌入资源。
- 启动应用，确认启动日志到达 `skills-loaded`。
- 调用技能列表接口，确认六个系统技能标记为内置且路径位于系统根目录。

