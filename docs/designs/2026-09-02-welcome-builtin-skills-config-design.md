# 欢迎页内置技能 JSON 配置设计

## 1. 背景

欢迎页当前固定展示“日常办公”“代码开发”“设计创意”三个主分类。主分类、二级入口、图标以及入口到技能命令的映射分散硬编码在 `ChatArea.tsx`、`welcomeSkillSelectionModel.ts` 和相关图标映射中。

这种实现导致调整某个分类展示的内置技能时必须修改 React/TypeScript 源码，也容易出现入口、技能标签显示名称和图标映射不一致。项目已有的 `builtin-skills.manifest.generated.json` 是构建生成的内置技能安装与完整性清单，不适合作为可编辑的 UI 配置。

## 2. 目标

- 使用一个源码 JSON 统一配置“日常办公”“代码开发”“设计创意”下展示的内置技能。
- 配置决定技能的显示名称、图标和排列顺序。
- 点击配置技能后，复用现有逻辑把 `/技能名` 渲染为 Composer 输入框中的技能标签。
- 不为技能自动附加提示词，不改变用户输入框中的其他内容。
- 配置只能引用 `resources/builtin-skills/` 中真实存在的内置技能。
- 保留“智慧后台管理系统开发”的微应用选择器交互。
- 消除欢迎页技能入口的重复硬编码，使 JSON 成为展示配置的唯一事实来源。

## 3. 非目标

- 不允许用户在设置页或运行时修改该配置。
- 不新增后端 API、IPC、数据库表或远程配置服务。
- 不改变内置技能的构建、安装、版本指针和保护路径机制。
- 不修改 `/skill` 动态技能列表及技能管理界面的展示规则。
- 不支持在配置中写任意 React 组件、可执行代码或自由格式提示词。
- 不把 `builtin-skills.manifest.generated.json` 改造成 UI 配置文件。

## 4. 现状

### 4.1 欢迎页入口

`ChatArea.tsx` 中的 `mainTabs` 和 `subTabsMap` 直接声明三个主分类及其二级入口，图标使用导入的 Lucide React 组件。

### 4.2 技能映射

`welcomeSkillSelectionModel.ts` 中的 `WELCOME_FIXED_SKILLS` 和 `WELCOME_SKILLS_BY_ENTRY` 分别维护技能命令、显示名称和“主分类 + 二级入口”映射。Composer 再读取 `WELCOME_FIXED_SKILLS`，保证动态技能尚未加载时也能立即识别并渲染固定技能标签。

### 4.3 内置技能清单

`scripts/build-builtin-skills.ts` 扫描 `resources/builtin-skills/` 下的全部技能目录，生成 `builtin-skills.manifest.generated.json` 和 bundle。该 JSON 记录技能文件、摘要和 bundle digest，属于生成产物，不能手工维护，也不表达欢迎页展示意图。

### 4.4 重复场景数据

`ChatArea.tsx` 仍保留未参与当前欢迎页渲染的 `SCENARIOS` 数据，`welcomeScenarioModel.ts` 也保留“代码开发 → 日常开发”的旧场景结构。它们不是当前技能入口的有效事实来源，配置化时应删除或收敛，避免继续形成第二套入口定义。

## 5. 方案比较

### 5.1 方案 A：前端源码 JSON（采用）

在前端源码中增加一个版本化 JSON，由纯 TypeScript 模型负责解析、校验和转换为欢迎页及 Composer 所需的数据。

优点：配置位置明确、无需运行时服务、可随应用版本发布、能直接驱动当前前端交互。缺点：修改后仍需重新构建应用，但这与“代码中的 JSON 配置”目标一致。

### 5.2 方案 B：扩展内置技能生成清单

给 `builtin-skills.manifest.generated.json` 增加分类、图标等 UI 元数据。

不采用。生成清单承担安装完整性协议，把 UI 展示意图加入其中会耦合构建器、安装器与前端；而且生成产物不应成为人工配置入口。

### 5.3 方案 C：后端运行时配置 API

把展示配置存入数据库或资源文件，由前端启动后通过 API 加载。

不采用。当前没有运营后台或用户级动态配置需求，引入 API、缓存、错误恢复和启动加载状态会增加不必要复杂度。

## 6. 配置协议

新增源码配置：

```text
frontend/src/config/welcome-builtin-skills.json
```

建议结构：

```json
{
  "schemaVersion": 1,
  "categories": [
    {
      "id": "office",
      "label": "日常办公",
      "icon": "briefcase",
      "skills": [
        {
          "name": "document-processing",
          "label": "文档处理",
          "icon": "file-text"
        },
        {
          "name": "data-analysis",
          "label": "数据分析",
          "icon": "bar-chart"
        }
      ]
    },
    {
      "id": "development",
      "label": "代码开发",
      "icon": "code",
      "skills": [
        {
          "name": "microapp-admin",
          "label": "智慧后台管理系统开发",
          "icon": "layout-dashboard",
          "interaction": "microapp-picker"
        },
        {
          "name": "frontend-create",
          "label": "网站开发",
          "icon": "globe"
        }
      ]
    },
    {
      "id": "creative",
      "label": "设计创意",
      "icon": "palette",
      "skills": [
        {
          "name": "frontend-design",
          "label": "UI 设计",
          "icon": "layout"
        }
      ]
    }
  ]
}
```

协议约束：

- `schemaVersion` 首版只接受 `1`，不兼容未知版本。
- `categories` 中必须且只能出现 `office`、`development`、`creative`，保持三个产品主分类稳定；数组顺序决定主分类顺序。
- `skills` 数组顺序决定分类内的展示顺序，允许空数组表示该分类暂不展示技能。
- `name` 使用不带 `/` 的内置技能名；前端统一派生 `/name` 命令。
- `label` 是界面和输入框标签的显示名称。
- `icon` 只能引用前端图标注册表中的稳定 ID。
- `interaction` 可省略，省略时为普通 Composer 技能选择；首版唯一特殊值为 `microapp-picker`。
- 配置不提供 `prompt`、`command`、`companionCommands` 或任意行为脚本字段。
- 分类 ID、技能名在各自作用域内必须唯一。

## 7. 前端结构

### 7.1 配置解析模型

新增纯模型 `frontend/src/components/welcomeBuiltinSkillConfig.ts`，在其中集中完成：

- 将导入的 JSON 视为未知数据并做严格结构校验；
- 校验 schema 版本、固定分类 ID、字符串非空、技能名格式、唯一性、图标 ID 和交互类型；
- 生成欢迎页分类列表；
- 生成 `WelcomeSkillSelection`；
- 生成 Composer 启动时可识别的固定技能命令与显示名称。

不在 `ChatArea.tsx` 中直接读取和解释原始 JSON，避免 UI 组件承担配置协议校验。

### 7.2 图标注册表

JSON 只保存图标 ID。前端维护一个封闭的 `Record<WelcomeIconId, LucideIcon>` 注册表，将 `briefcase`、`file-text`、`globe` 等稳定 ID 映射到 Lucide 图标组件。

配置解析阶段拒绝未知图标 ID；渲染阶段仍保留统一默认图标作为防御性兜底，不能因为单个图标异常导致整个欢迎页崩溃。

### 7.3 欢迎页渲染

`WelcomeScreen` 从解析后的模型得到：

- 主分类标签及图标；
- 当前分类的技能入口及图标；
- 默认选中的第一个分类和其第一个技能；
- 点击技能对应的 `WelcomeSkillSelection`。

删除 `mainTabs`、`subTabsMap` 和入口映射中的重复业务常量。分类技能为空时展示空状态，不回退到硬编码技能。

## 8. 点击与输入框行为

普通技能点击链路保持为：

```text
JSON 技能项
  → WelcomeSkillSelection { command: "/<name>", label }
  → composer:skill-selected
  → applyWelcomeSkillToComposer()
  → Composer 输入框技能标签
```

行为要求：

- 点击后仅插入技能命令标签，不追加提示词或可见空格。
- 页面初始选中或切换主分类时只更新视觉选中状态，不自动向输入框插入技能；只有用户点击具体技能入口才触发插入。
- 再次点击同一技能不重复插入。
- 切换到另一技能时，沿用现有逻辑替换输入框开头已有的技能标签并保留其余文本。
- 配置技能在异步技能列表加载前也能立即被 Composer 识别并显示配置的 `label`。
- 技能进入后端时仍使用既有 `/skill-name` invocation，不新增协议。

当 `interaction` 为 `microapp-picker` 时，先打开现有微应用选择器；用户选择或创建微应用后，再发送同一个 `WelcomeSkillSelection`，最终仍由现有 Composer 链路插入技能标签。

## 9. 配置与内置资源一致性

欢迎页配置只允许引用受保护内置技能。新增 `scripts/validate-welcome-builtin-skills.ts`，复用前端纯配置解析模型，并对照 `resources/builtin-skills/<name>/SKILL.md` 检查：

- 技能目录存在；
- `SKILL.md` 存在；
- frontmatter `name` 与 JSON 的 `name` 一致；
- 所有配置项均为内置技能，不接受用户安装技能或插件命令。

`package.json` 增加独立校验命令，并将它同时接入根目录的 `build:frontend` 和 `gen:builtin-skills` 前置步骤，使常规桌面构建和内置技能重新生成都会在配置不一致时失败。运行时前端不读取本地文件系统。

## 10. 错误处理

- JSON 语法错误、schema 版本错误、重复 ID、未知图标或未知交互类型：构建/类型验证失败。
- 引用不存在的内置技能或 frontmatter 名称不一致：资源一致性校验失败。
- 分类技能数组为空：正常渲染空状态。
- 防御性运行时解析失败：记录明确错误并展示不可交互的欢迎页错误状态，不静默恢复旧硬编码列表。
- 不增加兼容旧硬编码结构的 fallback 或双轨逻辑。

## 11. 影响范围

- 新增 `frontend/src/config/welcome-builtin-skills.json`。
- 新增 `frontend/src/components/welcomeBuiltinSkillConfig.ts`，严格解析 JSON 并输出纯配置模型。
- 修改 `frontend/src/components/welcomeSkillSelectionModel.ts`，由纯配置模型派生选择模型与固定技能集合。
- 修改 `frontend/src/components/ChatArea.tsx`，配置驱动主分类和技能入口。
- 修改 `frontend/src/components/composerSkillIcons.ts` 或增加专用欢迎页图标注册表。
- 修改 `frontend/src/components/Composer.tsx` 的固定技能识别来源，但保留现有标签插入逻辑。
- 删除或收敛 `ChatArea.tsx` 中未使用的 `SCENARIOS` 和 `welcomeScenarioModel.ts` 旧数据。
- 新增 `scripts/validate-welcome-builtin-skills.ts` 及配置解析、技能点击、图标和资源一致性测试源码。
- 修改 `package.json`，增加配置校验命令，并接入 `build:frontend` 与 `gen:builtin-skills` 前置步骤；不修改内置技能 manifest 协议。
- 更新 `docs/superpowers/specs/2026-08-24-ui-and-website-skill-selection-design.md` 的当前实现说明，避免旧文档继续描述硬编码模型。

## 12. 风险

- JSON 无法直接保存 React 图标组件，因此图标注册表仍是代码；通过稳定 ID 和严格校验控制边界。
- 如果只在前端校验 JSON 结构而不对照内置资源，拼写错误会产生无法执行的标签；必须保留发布前资源一致性校验。
- 删除旧场景数据时可能影响已有测试引用；应同步迁移测试到新的配置模型，不保留失效导出。
- 特殊交互若继续增加，单个 `interaction` 字段可能演变成行为配置系统；首版只支持现有 `microapp-picker`，新增类型必须重新设计。
- 配置调整可能改变默认选中项；默认值必须完全由数组顺序决定，并在测试中锁定。

## 13. 验证方式

遵循项目约束，实施后默认只执行：

- JSON 语法与配置 schema 校验；
- 内置技能目录和 frontmatter 一致性校验；
- `npx tsc --project tsconfig.electron.json --noEmit`；
- `cd frontend && npx tsc --noEmit -p tsconfig.app.json`；
- `git diff --check`。

编写但不自动运行的回归测试覆盖：

- 三个固定主分类均从 JSON 产生；
- 每个分类的技能名称、顺序和图标来自 JSON；
- 普通技能点击生成正确的 `/name` 和显示标签；
- 点击技能不生成提示词；
- 重复选择、技能替换及保留普通文本行为与现状一致；
- `microapp-picker` 保留先选择微应用、后插入技能标签的流程；
- 未知图标、重复技能、未知技能和无效 schema 被拒绝；
- 配置技能在动态技能列表加载前仍能渲染为输入框标签。

测试套件和实际 UI 行为验证仅在用户明确授权后执行。

## 14. 完成定义

欢迎页“日常办公”“代码开发”“设计创意”的技能入口全部由一个源码 JSON 驱动；修改 JSON 即可控制每个分类展示的内置技能、显示名称、图标和顺序。点击任意普通配置技能后，输入框按现有规则显示对应技能标签且不附加提示词；特殊微应用入口保留既有选择器流程。前端不再保留另一套有效的硬编码技能入口，错误配置会在发布前被确定性拒绝。
