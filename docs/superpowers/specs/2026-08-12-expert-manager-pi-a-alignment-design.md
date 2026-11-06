# Expert Manager Pi-a 原生化设计

**日期：** 2026-08-12  
**状态：** 已批准，待实施  
**范围：** 专家模型、专家创建、专家包校验/注册/打包、包内 Skill 运行时

## 1. 背景

当前 `expert-manager` 已能在 Pi-a 的固定用户目录中初始化、注册并扫描本地专家，但仍混合了 WorkBuddy 专家协议与 Pi-a 运行时能力。主要问题包括：Team 模板依赖 Pi-a 不存在的 `TeamCreate`、`Agent` 和 `SendMessage` 工具；包内 Skill 只被复制和声明，没有从专家包加载；打包脚本与测试错配；校验、注册和实际安装扫描规则不一致；头像流程强制依赖未注册的 ImageGen；注册脚本保留旧 marketplace 和 `.workbuddy-plugin` 兼容入口。

本设计将专家能力收敛为 Pi-a 原生的单 Agent 模型，保留 Python 生命周期脚本，并让专家包内 Skill 成为真正的自包含运行能力。

## 2. 目标

1. 整个项目只支持单 Agent 专家，不再创建、展示、扫描或运行 Team 专家。
2. 已安装专家从自身 `skills/` 安全加载 Skill 正文，不依赖全局同名 Skill。
3. Python 初始化、校验、注册、打包脚本与 Pi-a 当前扫描器使用一致协议。
4. 打包过程具备路径隔离、大小限制、临时文件清理和原子发布能力。
5. 头像为可选资源；缺失时使用现有确定性文字头像，不依赖 ImageGen。
6. 移除可执行路径中的 WorkBuddy 兼容逻辑和产品文案，同时保留必要的第三方许可证归属。
7. 保持安装与分享语义分离：校验并注册成功即安装成功，ZIP 打包失败不回滚已安装专家。

## 3. 非目标

- 不实现新的多角色或团队调度框架。
- 不引入嵌入式 Python 或 Python 自动安装器。
- 不接入图片生成模型或网络头像服务。
- 不删除用户磁盘上已经存在的 Team 专家目录；它们只是不再被扫描和展示。
- 不保留 `.workbuddy-plugin`、任意 marketplace 目录或 WorkBuddy 环境变量兼容。
- 不把专家包内 Skill 安装到全局 `~/.pi-a/skills`。

## 4. 方案选择

采用增量原生化方案：保留 `expert-manager` 的 Python 生命周期所有权，在现有专家扫描器和运行时中增加包内 Skill 解析与注入。

未选择的方案：

- 全部改写为 TypeScript 服务：跨平台一致性更强，但改动范围过大，并会替换已经投入使用的 Python 生命周期。
- 保留 WorkBuddy 兼容层：改动较少，但会继续维护双协议，与仓库不保留兼容层的原则冲突。

## 5. 单 Agent 专家模型

### 5.1 类型与目录

`ExpertType` 只允许字面量 `"agent"`。专家 manifest 继续保留 `expertType` 字段，且唯一合法值为 `"agent"`，用于磁盘协议的显式校验。

合法专家目录保持不变：

```text
<appDataDir>/plugins/marketplaces/my-experts/
├── .picoddy-plugin/marketplace.json
├── plugins/<expert-name>/
│   ├── .picoddy-plugin/plugin.json
│   ├── agents/<agent-name>.md
│   ├── skills/<skill-name>/
│   └── avatars/                    # 可选
└── packages/<expert-name>.zip
```

`.picoddy-plugin` 是 Pi-a 当前实际读取的协议目录，保留该名称。`.workbuddy-plugin` 不再接受。

### 5.2 移除 Team

- 删除前端专家类型页签、Team 数量、Team 筛选和“专家团”文案。
- 创建卡片只表达“创建专家”。
- 删除 `expert_center.json` 中 `expertType: "team"` 的条目。
- 删除 Team 初始化模板、Team settings、成员模板和团队参考文档。
- 注册、校验和安装扫描遇到 `expertType: "team"` 时返回明确错误。
- 历史 Team 目录保留在用户磁盘，不执行自动删除或迁移。
- 已绑定到被移除 Team 的历史会话按现有“专家不可用”错误路径处理，不增加兼容回退。

## 6. 包内 Skill 自包含运行时

### 6.1 磁盘声明

`plugin.json.skills` 必须是有序数组：

```json
{
  "skills": [
    "./skills/data-analysis",
    "./skills/weekly-report"
  ]
}
```

主 Agent Markdown frontmatter 必须以相同顺序声明：

```yaml
skills: [data-analysis, weekly-report]
```

每个目录必须包含根级普通文件 `SKILL.md`。Skill 名只能使用小写 kebab-case；`expert-manager` 是保留名。

### 6.2 扫描与安全边界

安装扫描器对每个声明的 Skill 执行以下检查：

1. 路径严格匹配 `./skills/<safe-kebab-name>`。
2. 目录是专家 `skills/` 的直接子目录，解析后仍位于专家根内。
3. Skill 根、子目录、文件和 `SKILL.md` 都不是符号链接。
4. 文件树只包含普通目录和普通文件。
5. `SKILL.md` frontmatter 合法，`name` 与目录名完全一致，且没有 `disabled: true`。
6. 拒绝保留名 `expert-manager`、重复名和未声明的路径逃逸。
7. 计算完整普通文件树的 SHA-256 revision，排序规则与创建阶段一致。
8. 对 Skill 文件数、树总字节数、单个 `SKILL.md` 字节数和所有 Skill 正文总字节数设置硬限制。

扫描失败的专家不会进入 installed overlay，并返回边界化诊断，不进行部分加载。

### 6.3 内部模型

公开的 `ExpertSummary` 不返回 Skill 正文或本地路径。内部 `ExpertManifest` 增加包内 Skill 结构：

```ts
interface InstalledExpertSkill {
  name: string;
  root: string;
  body: string;
  revision: string;
}
```

数组顺序与 `plugin.json.skills` 完全一致。Registry 克隆这些结构，避免调用者修改内部快照。

### 6.4 系统上下文

创建已安装专家会话时，运行时在 `<expert_specialization>` 内追加每个包内 Skill：

```xml
<active_expert_skill name="data-analysis" root="..." revision="...">
  SKILL.md 正文
</active_expert_skill>
```

动态值必须进行 XML 转义，控制字符必须移除。包内 Skill 不再与全局 Skill 名单求交集；即使全局同名 Skill 不存在，专家仍使用自身快照。系统核心安全、工具权限和工作区边界继续高于专家及 Skill 指令。

运行时不静默丢弃或截断某个 Skill。若 Agent 正文与全部包内 Skill 无法放入定义的专家上下文预算，安装扫描直接拒绝该包。

## 7. Python 生命周期

### 7.1 初始化

`init_expert.py` 只接受：

```text
init_expert.py <expert-name> --path <fixed-expert-plugins-dir>
```

移除 `--type` 和所有 Team 分支。脚本只创建：

- `.picoddy-plugin/plugin.json`
- `agents/<expert-name>.md`
- `README.md`

`avatar` 不作为必填模板字段，默认不创建占位头像。用户后续可提供 PNG、JPG/JPEG 或 WebP，扫描器继续执行路径、类型和 512 KiB 上限检查。

### 7.2 校验

`validate_expert.py` 成为注册和打包的共同权威校验器。规则至少包括：

- 专家必须是固定 plugins 目录的直接子目录。
- 只接受 `.picoddy-plugin/plugin.json`。
- `expertType` 必须是 `agent`。
- `name`、目录名、`plugin` 和 `agentName` 一致且为小写 kebab-case。
- 主 Agent 是普通非链接文件，已在 `agents` 数组声明，正文非空且不含 `[TODO]`。
- 展示字段中英文完整；`categoryId` 合法；tags 和 quickPrompts 各为 3 项。
- `defaultInitPrompt` 必须与第一条 quickPrompt 完全一致，违规为 error。
- 包内 Skill 规则与 TypeScript 安装扫描器一致。
- 不允许 `hooks/`、`commands/` 和 `.lsp.json`。

为避免注册器与扫描器得出不同结论，测试使用同一组合法/非法 fixtures 同时验证 Python 和 TypeScript 行为。

### 7.3 注册

`register_expert.py`：

- 删除 `.workbuddy-plugin` 查找。
- 删除 `--marketplace-dir`。
- 只允许注册默认 plugins 目录的直接子目录。
- 调用完整 `validate_expert()`，不维护第二套较弱的完整度校验。
- `marketplace.json` 只写 `name`、`source`、`description` 所需字段。
- 使用同目录临时文件、flush/fsync 和原子替换更新 marketplace。
- 删除 `.created-by-session` 写入；会话 ID 仍可用于运行时日志，但不写入专家包。

### 7.4 打包

`package_expert.py`：

- 打包前调用完整校验。
- 输出目录不能等于专家目录，也不能解析到专家目录内部。
- 排除根级 `dist/`、缓存、临时文件和不需要的隐藏文件。
- 先写同目录唯一临时 ZIP，成功且大小不超过限制后原子替换最终 ZIP。
- 失败、异常或超限时删除临时文件，不留下半成品。
- ZIP 条目始终位于 `<expert-name>/` 下，并使用 POSIX 分隔符。

安装成功定义为校验和注册成功。`package_expert.py` 只生成分享归档；打包失败时保留已安装专家并明确报告分享包失败。

### 7.5 批量脚本

删除 `batch_create.py`。当前脚本在初始化后没有内容生成回调，却立即校验 `[TODO]` 模板，无法完成新专家创建。批量创建没有独立产品入口，本次不设计替代脚本。

## 8. 头像行为

- 删除 `expert-manager` 对 ImageGen 的强制要求和“已自动生成”声明。
- 删除 `avatar-spec.md` 或将剩余格式要求合并到主规范，避免保留不可执行工作流。
- `avatar` 缺失、文件不存在或不合法时，Installed Expert 使用现有确定性文字头像。
- 不因头像缺失阻止校验、注册或安装。

## 9. 跨平台与 Python 可用性

- Python 脚本保持标准库实现，不新增第三方依赖。
- 脚本内部调用同级脚本时使用 `sys.executable`。
- 文档给出 macOS/Linux 的 `python3` 和 Windows 的 `python` 调用方式，不假定 Windows 存在 `python3` 命令。
- 如果系统没有可用 Python，创建流程返回明确环境错误。本次不捆绑 Python 运行时。
- 目录计算与 `platformPaths.appDataDir` 保持一致：非 Windows 使用 `~/.pi-a`，Windows 使用 `%LOCALAPPDATA%/Pi-a`。

## 10. 品牌与兼容清理

- 面向用户和运行时的 WorkBuddy/CodeBuddy 文案改为 Pi-a。
- 删除 `.workbuddy-plugin`、WorkBuddy 环境变量和任意 marketplace 路径说明。
- 内置 Skill 自身的插件元数据改为 Pi-a 描述，移除无消费者的 `workbuddy` 扩展块。
- `.picoddy-plugin` 作为当前磁盘协议保留。
- `LICENSE.txt` 原样保留，第三方版权和许可不因产品改名而删除。

## 11. 错误处理

- 创建、校验、注册、打包各阶段返回非零状态和单一明确错误，不把 warning 当成功条件。
- 注册前失败：不得写入 marketplace。
- 注册原子替换失败：保留旧 marketplace。
- 注册成功、打包失败：专家保持安装状态，仅报告分享包失败。
- 已安装专家扫描失败：该专家不进入新 installed overlay，并返回诊断；marketplace 整体不可用时继续保留上一份有效快照。
- 包内 Skill 加载失败：整个专家拒绝加载，不降级为缺 Skill 的部分专家。

## 12. 测试策略

所有行为变更使用红—绿—重构循环。

### 12.1 Python

- `test_project_paths.py`：macOS/Linux 与 Windows 路径。
- 初始化测试：只生成 Agent，拒绝旧 `--type team` 和非固定目录。
- 校验测试：Agent manifest、展示字段、Prompt 一致性、TODO、头像可选。
- Skill 测试：顺序、frontmatter、路径逃逸、链接、特殊文件、数量与字节限制。
- 注册测试：固定目录、拒绝 `.workbuddy-plugin`、完整校验、原子更新和失败保留旧文件。
- 打包测试：现有四项回归，加上临时文件清理、ZIP 条目和大小边界。

### 12.2 TypeScript

- 类型和 Registry 测试：只接受 Agent，深拷贝包内 Skill。
- installed catalog 测试：拒绝 Team，安全读取包内 Skill，不泄露正文到摘要。
- runtime profile 测试：注入包内 Skill 正文、XML 转义、全局同名 Skill 不影响、预算超限拒绝。
- 前端测试：删除专家团页签和文案，创建卡片始终创建单 Agent 专家。
- builtin bundle 测试：删除文件和更新元数据后重新生成 manifest/bundle。

### 12.3 验证命令

实施计划必须包含以下最终验证：

```bash
python3 resources/builtin-skills/expert-manager/scripts/test_project_paths.py
python3 resources/builtin-skills/expert-manager/scripts/test_validate_expert_skills.py
python3 resources/builtin-skills/expert-manager/scripts/test_package_expert.py
node --import tsx --test src/agent/experts/*.test.ts src/agent/expert_manager_context.test.ts src/agent/expert_selected_skills.test.ts
npx tsc --project tsconfig.electron.json --noEmit
npm run gen:builtin-skills
git diff --check
```

如新增更细分的 Python 测试文件，它们必须加入最终验证命令。

## 13. 验收标准

1. UI、类型、目录协议和运行时不再出现可执行的 Team 专家路径。
2. `expertType: "team"` 的目录或 catalog 条目不会进入专家列表。
3. 合法单 Agent 专家能够初始化、校验、注册、扫描和开始会话。
4. 删除全局同名 Skill 后，专家仍能从自身包内 Skill 获得完整指令。
5. 包内 Skill 任一安全检查失败时，专家整体拒绝加载。
6. Python 校验通过的包不会因同一字段规则被 TypeScript 扫描器拒绝。
7. 打包测试全部通过，打包失败不留下临时 ZIP 或破坏既有分享包。
8. 缺少头像不会阻止安装，前端显示确定性降级头像。
9. 注册成功但打包失败时，专家仍在“我的专家”中可用，界面不宣称分享包成功。
10. 所有相关 Python、Node 测试、TypeScript 类型检查和生成文件校验通过。
