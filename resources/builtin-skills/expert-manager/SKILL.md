---
name: expert-manager
description: |
  Pi-a 专家包的全生命周期运营：转化（从开源仓库或本地项目创建专家包）、修改已有专家、合规检查与质量审查。
  触发词：创建专家、转化专家、转成专家、生成专家包、导入专家、convert expert、修改专家、编辑专家、更新专家、modify expert、检查专家、审查专家包、专家合规、专家运营、expert ops。
---

# Pi-a 专家包管理器

创建和维护 Pi-a 的单 Agent 专家包。一个专家包只包含一个主 Agent；不支持多角色团队结构。

支持两种输入模式：

1. **交互模式**：通过提问收集信息后生成。
2. **资料转化模式**：从用户提供的文档、流程或提示词提取信息并转化。

### `<selected_expert_skills>` 上下文

运行时可能提供 `<selected_expert_skills>`，其中列出用户为该专家选择的 Skill 根目录。它们是专家包的一部分：每个已选根目录必须被物化到 `<expert>/skills/<name>`，并在 `plugin.json` 与主 Agent frontmatter 中以相同顺序声明。

`expert-manager` 本身只负责上述生命周期，**绝不能被物化为专家的已选 Skill**。不要实现第二套初始化、注册或打包服务；始终复用本 Skill 提供的既有脚本。

## 工作流程

```text
收集并确认 Agent 定义
  -> scripts/init_expert.py
  -> 编写 Agent 与 plugin 内容
  -> 物化已选 Skills
  -> scripts/validate_expert.py
  -> scripts/register_expert.py
  -> 可选 scripts/package_expert.py
```

专家目录固定为 Pi-a 项目配置目录下的 `plugins/marketplaces/my-experts/plugins`：macOS/Linux 默认 `~/.pi-a/plugins/marketplaces/my-experts/plugins`，Windows 默认 `%LOCALAPPDATA%\\Pi-a\\plugins\\marketplaces\\my-experts\\plugins`。不要在其他路径创建专家包。

### 收集与确认

在创建前确认：

1. 专家名称：kebab-case 唯一标识。
2. 专家领域、核心能力和工作流程。
3. 中英文展示名、职业头衔、能力描述、首次对话提示。
4. 行业分类、可选标签与推荐提示词；数量按实际内容决定，缺省或空值视为空列表。
5. 是否需要附带 Skill、`bin/` 资源和适用的许可证信息；每个专家包都保留 `license/` 目录，第三方资源许可证放入其中。

资料转化时，读取资料后提取角色定义、能力、流程、输出规范、约束、脚本和参考资料；缺失的展示信息须向用户确认。

### 初始化与编辑

```bash
python3 scripts/init_expert.py <expert-name> --path <PI_A_PROJECT_CONFIG_DIR>/plugins/marketplaces/my-experts/plugins
```

模板包含 `[TODO]` 占位符，并创建 `skills/`、`license/` 目录及默认 `license/LICENSE.txt`。随后填写 `.picoddy-plugin/plugin.json`、`agents/<expert-name>.md`、许可证版权信息和需要的资源。按 `references/plugin-json-spec.md` 与 `references/agent-md-spec.md` 编写内容。

若提供了已选 Skills，将每个根目录物化到 `skills/<name>/`，在 `plugin.json` 的 `skills` 与主 Agent frontmatter 的 `skills` 中按相同顺序声明。不要物化 `expert-manager`。

修改既有专家时，编辑会话会提供受控的 `expert_draft_list`、`expert_draft_read`、`expert_draft_write`、`expert_draft_delete`、`expert_draft_validate` 与 `expert_draft_publish` 工具。先完整读取草稿，只修改用户要求的内容；不得使用通用 `write`、`edit`、`bash`，也不得直接访问已安装目录。不得改动 `plugin.json` 的 `name`、`agentName`、专家目录名或主 Agent 文件名；如需改名，应创建新的专家包。

### 校验、注册与分享

```bash
python3 scripts/validate_expert.py <path/to/expert-dir>
python3 scripts/register_expert.py <path/to/expert-dir>
python3 scripts/package_expert.py <path/to/expert-dir> [output-dir]
```

创建模式必须按上述脚本顺序完成校验和注册。编辑模式必须先调用 `expert_draft_validate`，向用户确认发布，再调用 `expert_draft_publish`；该工具会再次使用 authoritative validator 并通过受控注册流程原子替换已安装版本。不要自行移动、覆盖或注册专家目录。

注册前必须校验。校验加注册会将 Agent 专家安装到固定的 Pi-a 专家市场；包内 Skills 会随专家一起加载。打包只创建可分享的 ZIP，不会撤销注册。修改现有专家后也必须重新校验并注册。

## 展示字段规则

| 展示 | 对应字段 | 规则 |
|---|---|---|
| 名字（职业） | `profession` | 卡片标题，应体现职业定位。 |
| 花名 | `displayName` | 可按用户要求修改。 |
| 行业分类 | `categoryId` | 根据核心能力选择。 |
| 能力介绍 | `displayDescription` | 中文 40–50 字，突出核心能力。 |
| 擅长领域 | `tags` | 可选中英文标签数组，允许空数组，数量不限三条。 |
| 试试这样问我 | `quickPrompts` | 可选提示词数组，允许空数组，无须与默认引导语绑定。 |

## 行业分类

根据主要输出物和服务对象选择最核心的一项：

| categoryId | 分类名称 |
|---|---|
| 01-ProductDesign | 产品设计 |
| 02-Engineering | 技术工程 |
| 03-GameSpatial | 游戏空间 |
| 04-DataAI | 数据智能 |
| 05-MarketingGrowth | 营销增长 |
| 06-ContentCreative | 内容创作 |
| 07-SalesCommerce | 销售商务 |
| 08-FinanceInvestment | 金融投资 |
| 09-OperationsHR | 运营人力 |
| 10-ProjectQuality | 项目质量 |
| 11-SecurityCompliance | 法务安全 |
| 12-IndustryConsultant | 行业顾问 |

## 关键规则

1. `name` 必须是 kebab-case。
2. `agentName` 必须等于主 Agent MD 文件名（不含 `.md`）。
3. `agents` 必须声明主 Agent 的相对路径。
4. `expertType` 始终为 `"agent"`。
5. `tags` 与 `quickPrompts` 可缺省、为 null 或空数组；有内容时校验各项格式，数量不限制为三条。`defaultInitPrompt` 可缺省且不要求等于首条推荐语。
6. Agent frontmatter 不得声明 `tools`。
7. 同名目录已存在时，不要重新初始化；先读取内容，完成校验并注册。

## References

- `references/plugin-json-spec.md` — plugin.json 字段规范和模板
- `references/agent-md-spec.md` — Agent MD frontmatter 与正文结构
