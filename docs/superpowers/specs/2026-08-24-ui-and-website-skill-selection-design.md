# UI 设计与网站开发技能选择设计

> 2026-10-10 更新：欢迎页主分类及子分类快捷入口已按用户要求移除，本文相关入口说明保留为历史设计。当前欢迎页仅显示标题和副标题，技能仍可通过输入框选择。详见 [移除设计](../../designs/2026-10-10-welcome-remove-shortcuts-design.md)。

## 目标

在新建任务欢迎页中，为“设计创意 → UI 设计”接入官方 npm 包 `@sentiolabs/pi-frontend-design` 提供的内置技能 `frontend-design`，并修复“代码开发 → 网站开发”选中后未在输入框中展示现有 `frontend-create` 技能标签的问题。

## 用户行为

- 选择“设计创意 → UI 设计”时，输入框开头展示 `/frontend-design` 技能标签，标签文案为“UI 设计”。
- 选择“代码开发 → 网站开发”时，输入框开头展示 `/frontend-create` 技能标签，标签文案为“网站开发”。
- 两个入口互斥。用户从一个入口切换到另一个入口时，新的技能标签替换输入框开头已有的技能标签，保留其余输入内容。
- 再次点击当前已选入口时不重复添加标签。
- “文档处理”和“数据分析”的现有选择行为保持不变。

## 前端设计

新增一个面向欢迎页的技能选择模型，集中维护主分类、二级分类到技能命令和显示名称的映射。`WelcomeScreen` 根据当前主分类和二级分类查询该模型，并继续通过现有 `composer:skill-selected` 事件通知 `Composer`。

固定欢迎页技能命令必须加入 `Composer` 的已知命令和显示名称集合。这样即使用户尚未打开“+”菜单、动态技能列表尚未加载，`/frontend-design` 与 `/frontend-create` 也能立即渲染为行内技能标签。

## 内置技能设计

新增标准技能目录：

```text
resources/builtin-skills/frontend-design/
├── SKILL.md
└── LICENSE.txt
```

技能内容固定采用 `@sentiolabs/pi-frontend-design@0.1.1` 中 `skills/frontend-design/SKILL.md` 的原始内容，技能名称为 `frontend-design`；同时保留包内 Apache-2.0 许可证。`pi-frontend-design` 是 npm 包名，不作为技能命令名。

该技能不新增运行时工具、MCP 服务或插件入口，因此使用现有受保护内置技能机制。构建后重新生成：

- `src/agent/builtin_skills/builtin-skills.manifest.generated.json`
- `src/agent/builtin_skills/builtin-skills.bundle.generated.ts`

## 后端与启动行为

后端继续通过 `resources/builtin-skills` 的确定性构建、启动时原子安装以及 `skills.ts` 多根扫描发现新技能。不新增硬编码技能列表、数据库记录或兼容层。

新 bundle digest 会促使应用启动时安装并激活包含 `frontend-design` 的新内置技能版本。该技能在技能管理界面中标记为内置，不允许编辑、删除或被同名用户技能覆盖。

## 测试与验证

- 模型测试覆盖四个已有或新增的欢迎页技能入口，并验证无技能入口返回空值。
- Composer 回归测试覆盖两个前端技能命令及其显示名称，确保无需动态技能列表也能识别。
- 内置技能构建测试与生成产物验证包含 `frontend-design/SKILL.md` 和许可证，并校验官方 SKILL 文件摘要。
- 前端 TypeScript 检查和构建通过。
- 实际页面验证“UI 设计”和“网站开发”都会展示正确且互斥的技能标签，输入框原有文本保持不丢失。

## 不在范围内

- 不替换或重命名 `frontend-create`。
- 不把 `@sentiolabs/pi-frontend-design` 做成 Pi 扩展插件；仅把包内声明的技能作为受保护内置技能发布。
- 不改变场景卡片、技能管理界面或会话后端协议。
- 不处理与本功能无关的 Prompt Pack 治理审计失败。
