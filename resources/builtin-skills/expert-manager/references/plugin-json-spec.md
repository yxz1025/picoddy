# plugin.json 字段规范

## 基础字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | kebab-case 唯一标识。 |
| `version` | string | 语义化版本号。 |
| `description` | string | 英文一句话描述。 |
| `author` | `{name, email}` | 可选作者信息。 |
| `agents` | string[] | 只声明主 Agent 文件，例如 `./agents/my-expert.md`。 |
| `skills` | string[] | 可选，声明包内的直接 Skill 根目录。 |

## 专家与展示字段

| 字段 | 说明 |
|---|---|
| `expertType` | 固定为 `"agent"`。 |
| `agentName` | 主 Agent 名称，等于 `agents/` 下 MD 文件名（不含 `.md`）。 |
| `displayName` | `{en, zh}` 展示名称。 |
| `profession` | `{en, zh}` 职业或定位。 |
| `displayDescription` | `{en, zh}` 展示描述；中文 40–50 字。 |
| `categoryId` | 行业分类 ID。 |
| `defaultInitPrompt` | 可选 `{en, zh}` 默认引导语，不要求与 `quickPrompts` 相同。 |
| `plugin` | 值必须等于 `name`。 |
| `tags` | 可选 `{en, zh}` 标签数组，缺省、null 或空数组表示没有标签，数量不限三条。 |
| `quickPrompts` | 可选 `{en, zh}` 提示词数组，缺省、null 或空数组表示没有提示词，数量不限三条。 |

## 可选头像

`avatar` 可选，值为包内图片的相对路径。使用 PNG 或 JPG，建议 512×512 px，单张不超过 500KB。专家作者可自行提供或替换头像；未声明时不需要创建头像资源。

## 模板

```json
{
  "name": "{kebab-case-name}",
  "version": "1.0.0",
  "description": "{English one-line description}",
  "author": {
    "name": "{author-name}",
    "email": "{author-email}"
  },
  "agents": ["./agents/{kebab-case-name}.md"],
  "skills": ["./skills/{skill-name}"],
  "expertType": "agent",
  "agentName": "{kebab-case-name}",
  "displayName": {
    "en": "{English display name}",
    "zh": "{中文显示名称}"
  },
  "profession": {
    "en": "{English profession}",
    "zh": "{中文职业头衔}"
  },
  "displayDescription": {
    "en": "{English detailed description}",
    "zh": "{中文详细描述，40-50字}"
  },
  "categoryId": "{XX-CategoryName}",
  "defaultInitPrompt": {
    "zh": "{中文首次对话提示}",
    "en": "{English first prompt}"
  },
  "plugin": "{kebab-case-name}",
  "tags": [
    { "en": "{Tag1 EN}", "zh": "{标签1}" },
    { "en": "{Tag2 EN}", "zh": "{标签2}" },
    { "en": "{Tag3 EN}", "zh": "{标签3}" }
  ],
  "quickPrompts": [
    { "en": "{Prompt1 EN}", "zh": "{提示词1}" },
    { "en": "{Prompt2 EN}", "zh": "{提示词2}" },
    { "en": "{Prompt3 EN}", "zh": "{提示词3}" }
  ]
}
```

省略 `skills` 或 `avatar` 均表示专家包不声明相应资源。
