# Open Kimi PPT 内置技能对接设计

## 背景

仓库中的 `resources/open-kimi-ppt-skill-main` 是 `open-kimi-ppt-skills@1.0.0` 的完整源码包。其中可供 Agent 使用的技能位于 `skills/open-kimi-ppt`，包含 `SKILL.md`、PPTD 参考文档、分类设计指南、导出脚本和测试夹具。

当前应用已经内置一个能力较简单的 `presentation` 技能，并在新建任务页的“日常办公”分类下提供文档处理、数据分析、邮件管理等二级入口。本次接入用 `open-kimi-ppt` 完全替换旧 `presentation`，在“日常办公 → 幻灯片”提供唯一的 PPT 技能入口。

上游项目是对 Kimi Slides 能力的非官方复刻，不代表 Kimi 或 Moonshot 官方产品。内置时保留其 MIT 许可证和来源说明，不改变这一事实。

## 目标

- 将 `open-kimi-ppt` 作为受保护的内置技能随应用发布。
- 删除旧 `presentation` 内置技能及其静态命令，避免能力重叠和错误选择。
- 在新建任务页“日常办公”下增加“幻灯片”二级入口。
- 选择“幻灯片”后，在会话输入框显示“幻灯片”技能标签，对应命令 `/open-kimi-ppt`。
- 完全复用文档处理、数据分析等入口现有的选择、切换和文本保留逻辑。
- 保持技能自身的 PPTD、图片预览和 PPTX 导出能力，不在本次接入中重写其生成协议。

## 已确认决策

采用完全替换方案：删除 `presentation`，只保留 `open-kimi-ppt`。

不采用“保留旧技能但隐藏入口”的方案。隐藏入口仍会让两个语义重叠的技能进入运行时技能集合，增加模型误选、维护分叉和测试歧义。

## 资源接入

### 内置目录

从上游源码包复制 Agent 技能所需内容，形成以下目录：

```text
resources/builtin-skills/open-kimi-ppt/
├── SKILL.md
├── LICENSE.txt
├── reference/
│   ├── pptd.md
│   ├── slides_categories.md
│   ├── general-poster.md
│   ├── fonts.md
│   ├── shapes.md
│   └── slides_categories/
├── scripts/
│   ├── export_images.py
│   ├── export_pptx.py
│   └── export_host.html
└── tests/
```

复制来源固定为：

```text
resources/open-kimi-ppt-skill-main/skills/open-kimi-ppt
```

上游根目录的 `LICENSE` 复制为内置目录的 `LICENSE.txt`。技能目录名必须与 `SKILL.md` frontmatter 中的 `name: open-kimi-ppt` 一致，以满足现有内置技能构建校验。

不将上游包的 `bin/`、`editor/`、`lib/`、示例和宣传图片复制进内置技能。它们服务于独立 npm CLI 和手动编辑器，不是 Agent 执行该技能的必要组成部分，也不应扩大应用内置资源和运行权限。

### 替换旧技能

删除：

```text
resources/builtin-skills/presentation/
```

同时删除 Composer 中旧 `/presentation` 静态命令。应用不提供旧名称兼容层或别名；新任务统一使用 `/open-kimi-ppt`。

已有历史消息中的普通文本不做迁移。若历史会话中存有旧技能引用，继续按现有缺失技能处理方式展示，不为本次替换增加专用后端分支。

### 构建与安装

继续使用现有内置技能机制：

1. `resources/builtin-skills` 的确定性构建器递归收集技能文件。
2. 重新生成内置技能 manifest 与 TypeScript bundle。
3. 新 bundle digest 触发应用启动时的原子安装。
4. 技能扫描器从受保护目录发现 `open-kimi-ppt`。
5. 技能管理界面沿用现有内置标记，不允许编辑、删除或被同名用户技能覆盖。

不新增数据库记录、硬编码后端技能列表或单独安装流程。

## 新建任务页交互

### 分类布局

“日常办公”的二级入口调整为：

```text
文档处理 | 数据分析 | 幻灯片 | 邮件管理 | 更多
```

“幻灯片”使用现有图标体系中的演示文稿图标，尺寸、颜色、激活态、间距和点击区域与同级入口保持一致。继续使用当前二级菜单布局，不新增 PPT 专属卡片或弹层。

### 技能映射

在欢迎页集中映射中增加：

```text
日常办公 + 幻灯片 → /open-kimi-ppt，显示名称：幻灯片
```

`/open-kimi-ppt` 同时加入 Composer 的固定欢迎页技能集合。这样即使动态技能列表尚未加载，输入框也能立即把命令识别为技能标签并显示“幻灯片”。

### 操作流程

用户点击“日常办公 → 幻灯片”后：

1. 欢迎页通过现有 `composer:skill-selected` 事件发送技能命令。
2. Composer 在输入框开头插入“幻灯片”技能标签。
3. 若开头已有欢迎页技能标签，则用“幻灯片”替换，保留其余输入文本。
4. 再次点击当前入口时不重复插入标签。
5. 切换到文档处理或数据分析时，沿用同一逻辑替换标签。
6. 提交任务后，后端按正常技能解析流程加载 `open-kimi-ppt/SKILL.md` 及其引用资源。

该流程不增加新的事件、状态容器或会话协议。

## 技能运行边界

### 输出

技能默认生成 PPTD 目录和 `.pptx` 文件。生成文件写入当前任务允许的工作区或产物目录；内置技能目录本身保持只读。

现有 `.pptx` 产物预览和下载能力继续复用，不为 Open Kimi PPT 建立专用预览器。

### 依赖

上游脚本依赖以下运行条件：

- Python 3
- PyYAML
- Node.js 与 npm
- Chrome 或 Chromium
- `agent-browser >= 0.33.2`
- 图片检查场景可能需要 Pillow

本次接入不在应用启动阶段自动安装这些依赖，也不内置完整 npm CLI。技能运行时若缺少依赖，应输出清晰、可执行的错误说明，并沿用应用现有的命令执行和授权机制处理安装，而不是静默改变用户的全局环境。

上游 `export_pptx.py` / `export_images.py` 中涉及自动安装或升级 `agent-browser` 的行为需要在实现阶段重点验证：不得绕过现有网络和命令授权边界。若当前执行框架无法拦截，应在内置副本中将其改为依赖检查并给出安装指引，同时用测试固定该行为。

### 网络与隐私

PPTD 渲染和导出流程会使用 Kimi 的公开编辑器资源，可能访问：

- `www.kimi.com`
- `statics.moonshot.cn`

因此该技能不是纯离线能力。实现时需要确保：

- 网络请求仍受应用现有权限策略约束。
- 首次触发外部访问时向用户明确说明用途。
- 不把无关工作区文件、环境变量或凭据传给页面。
- 仅传递完成渲染所需的 PPTD 内容和资源。
- 网络不可用时返回明确错误，不把失败误报为 PPT 已生成。

## 代码改动范围

预计涉及：

- `resources/builtin-skills/open-kimi-ppt/**`：新增内置技能资源。
- `resources/builtin-skills/presentation/**`：删除旧技能。
- `frontend/src/components/ChatArea.tsx`：增加“幻灯片”二级入口。
- `frontend/src/components/welcomeSkillSelectionModel.ts`：增加固定映射。
- Composer 命令/标签定义：移除 `/presentation`，识别 `/open-kimi-ppt`。
- 对应前端模型、Composer 和内置技能构建测试。
- 生成的内置技能 manifest 与 bundle。

若实际文件位置在实现前发生变化，应遵循同一职责边界定位修改点，不新增平行实现。

## 测试与验收

### 资源与构建测试

- 内置目录名与技能 frontmatter 名称一致。
- bundle 包含 `SKILL.md`、全部 `reference/`、导出脚本、HTML host 和许可证。
- bundle 不包含上游 CLI、编辑器、示例或宣传资源。
- manifest 中不再存在 `presentation`，且存在且仅存在一个 `open-kimi-ppt`。
- 对上游关键文件记录版本或摘要，防止后续生成时无意漂移。
- 内置安装器测试验证新 digest 能安装并发现该技能。

### 前端模型与交互测试

- `日常办公 + 幻灯片` 正确解析为 `/open-kimi-ppt` 和“幻灯片”。
- 未映射入口仍返回空值。
- 点击“幻灯片”后输入框显示一个技能标签。
- 重复点击不产生重复标签。
- 从文档处理、数据分析切换到幻灯片时只替换技能标签，保留用户文本。
- 从幻灯片切换到其他固定技能时行为一致。
- 动态技能列表尚未加载时仍能正确渲染标签。
- “日常办公”的五个二级入口在现有支持宽度下不溢出、不换行错位，交互样式与同级入口一致。

### 技能脚本测试

- 运行上游无网络单元测试，验证 PPTD 基础解析和导出辅助逻辑。
- 在缺少 `agent-browser`、浏览器或 Python 包时，验证错误信息明确且不静默成功。
- 在允许联网的受控环境中完成最小 PPTD 到图片和 PPTX 的冒烟测试。
- 验证输出文件位于任务工作区，且生成的 `.pptx` 能被现有产物预览识别。

### 工程验证

- 前端 TypeScript 检查和构建通过。
- 内置技能生成检查通过。
- 后端及内置技能安装相关测试通过。
- `git diff --check` 通过，生成产物仅包含本次预期变更。

## 不在范围内

- 不内置或二次开发 `open-kimi-ppt-skills` 的独立网页编辑器。
- 不提供 `npx open-kimi-ppt-skills serve` 的产品级按钮。
- 不重写 PPTD DSL、分类设计规范或 Kimi 编辑器 SDK。
- 不为旧 `/presentation` 提供别名或兼容迁移。
- 不改变文档处理、数据分析、邮件管理和更多入口的业务逻辑。
- 不修改用户提供的 `resources/open-kimi-ppt-skill-main` 源目录。

## 实施顺序

1. 先用测试固定旧技能移除、新技能资源完整性和欢迎页映射。
2. 复制并校验上游技能资源与许可证。
3. 删除旧 `presentation` 资源和命令。
4. 接入“日常办公 → 幻灯片”映射与标签显示。
5. 重新生成内置技能 manifest 和 bundle。
6. 完成无网络测试、前端交互测试和受控联网冒烟验证。

实现必须以本设计为边界；若发现上游导出脚本需要超出现有权限模型的全局安装或数据传输，先停在依赖检查与清晰报错，不扩大权限范围。
