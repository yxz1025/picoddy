# Agent MD 规范

## Frontmatter

主 Agent 必须与 `plugin.json` 的 `agentName` 和 `agents` 声明一致。不得在 frontmatter 中添加 `tools` 字段，工具权限由系统统一分配。

```yaml
---
name: {与文件名一致的业务名称}
description: {英文描述，用于判断何时激活}
displayName:
  en: "{English display name}"
  zh: "{中文显示名称}"
profession:
  en: "{English profession title}"
  zh: "{中文职业头衔}"
skills: [{skill-name}] # 可选；顺序须与 plugin.json 一致
maxTurns: 50
---
```

如果不附带 Skills，省略 `skills` 字段。

## 正文结构

```markdown
# {角色名称} - {人名}

{角色描述，说明这是谁，擅长什么}

## 核心能力
1. **{能力1}**：{描述}
2. **{能力2}**：{描述}
3. **{能力3}**：{描述}

## 工作流程
1. {步骤1}
2. {步骤2}
3. {步骤3}

## 输出规范
- {规范1}
- {规范2}
- {规范3}

## 注意事项
- {约束或边界条件}
```

正文应清楚定义角色、能力范围、处理步骤和输出结构。不要保留 `[TODO]` 占位符。
