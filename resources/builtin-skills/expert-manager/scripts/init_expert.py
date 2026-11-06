#!/usr/bin/env python3
"""Create a Pi-a Agent expert package.

Usage:
    init_expert.py <expert-name> --path <plugins-dir>
"""

import re
import sys
from pathlib import Path

from project_paths import get_expert_plugins_dir


MAX_EXPERT_NAME_LENGTH = 64
SAFE_EXPERT_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


AGENT_PLUGIN_JSON = """{
  "schemaVersion": 2,
  "name": "%(name)s",
  "version": "1.0.0",
  "description": "[TODO: English one-line description]",
  "author": {
    "name": "[TODO: author name]",
    "email": "[TODO: author email]"
  },
  "agents": ["./agents/%(agent_name)s.md"],
  "skills": [],
  "expertType": "agent",
  "agentName": "%(agent_name)s",
  "displayName": {
    "en": "[TODO: English display name]",
    "zh": "[TODO: 中文显示名称]"
  },
  "profession": {
    "en": "[TODO: English profession]",
    "zh": "[TODO: 中文职业头衔]"
  },
  "displayDescription": {
    "en": "[TODO: English detailed description]",
    "zh": "[TODO: 中文详细描述，40-50字]"
  },
  "categoryId": "[TODO: XX-CategoryName]",
  "defaultInitPrompt": {
    "zh": "[TODO: 中文首次对话提示]",
    "en": "[TODO: English first prompt]"
  },
  "plugin": "%(name)s",
  "tags": [
    { "en": "[TODO: Tag1]", "zh": "[TODO: 标签1]" },
    { "en": "[TODO: Tag2]", "zh": "[TODO: 标签2]" },
    { "en": "[TODO: Tag3]", "zh": "[TODO: 标签3]" }
  ],
  "quickPrompts": [
    { "en": "[TODO: Prompt1]", "zh": "[TODO: 提示词1]" },
    { "en": "[TODO: Prompt2]", "zh": "[TODO: 提示词2]" },
    { "en": "[TODO: Prompt3]", "zh": "[TODO: 提示词3]" }
  ]
}
"""

AGENT_MD_TEMPLATE = """---
name: %(agent_name)s
description: "[TODO: English description for AI to determine when to activate]"
displayName:
  en: "[TODO: English display name]"
  zh: "[TODO: 中文显示名称]"
profession:
  en: "[TODO: English profession title]"
  zh: "[TODO: 中文职业头衔]"
maxTurns: 50
skills: []
---

# [TODO: 角色名称] - [TODO: 人名]

[TODO: 角色描述，说明这是谁，擅长什么]

## 核心能力
1. **[TODO: 能力1]**：[TODO: 描述]
2. **[TODO: 能力2]**：[TODO: 描述]
3. **[TODO: 能力3]**：[TODO: 描述]

## 工作流程
1. [TODO: 步骤1]
2. [TODO: 步骤2]
3. [TODO: 步骤3]

## 输出规范
- [TODO: 规范1]
- [TODO: 规范2]

## 注意事项
- [TODO: 约束或边界条件]
"""

README_TEMPLATE = """# %(title)s

[TODO: 一句话描述]

## 功能

[TODO: 详细功能说明]

## 使用示例

- [TODO: 示例提示词1]
- [TODO: 示例提示词2]
- [TODO: 示例提示词3]

## 安装

将专家包目录放到专家目录下：

```
%(expert_plugins_dir)s/%(name)s/
```

许可证文件位于 `license/LICENSE.txt`，发布前请将其中的版权占位符替换为实际作者或组织信息；第三方资源的许可证也应放在该目录。

然后运行注册命令使其可见：

```bash
python3 scripts/register_expert.py <expert-dir>
```

## 打包分享

```bash
python3 scripts/package_expert.py <expert-dir> [output-dir]
```
"""

LICENSE_TEMPLATE = """MIT License

Copyright (c) [TODO: year] [TODO: author or organization]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this expert package and associated documentation files (the \"Software\"),
to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""


def title_case(name):
    return " ".join(word.capitalize() for word in name.split("-"))


def init_agent(expert_dir, name, plugins_dir):
    agent_name = name
    plugin_dir = expert_dir / ".picoddy-plugin"
    plugin_dir.mkdir()
    (plugin_dir / "plugin.json").write_text(
        AGENT_PLUGIN_JSON % {"name": name, "agent_name": agent_name}, encoding="utf-8"
    )

    agents_dir = expert_dir / "agents"
    agents_dir.mkdir()
    (expert_dir / "skills").mkdir()
    license_dir = expert_dir / "license"
    license_dir.mkdir()
    (license_dir / "LICENSE.txt").write_text(LICENSE_TEMPLATE, encoding="utf-8")
    (agents_dir / f"{agent_name}.md").write_text(
        AGENT_MD_TEMPLATE % {"agent_name": agent_name}, encoding="utf-8"
    )

    (expert_dir / "README.md").write_text(
        README_TEMPLATE
        % {
            "title": title_case(name),
            "name": name,
            "expert_plugins_dir": str(plugins_dir),
        },
        encoding="utf-8",
    )


def main(argv=None, expected_plugins_dir=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 3 or args[1] != "--path":
        print("Usage: init_expert.py <expert-name> --path <plugins-dir>")
        return 1

    name, output_path = args[0], args[2]
    expected_path = (
        Path(expected_plugins_dir) if expected_plugins_dir is not None else get_expert_plugins_dir()
    )
    resolved_path = Path(output_path).expanduser().resolve()
    if resolved_path != expected_path.expanduser().resolve():
        print(f"Error: --path must be the expert plugins directory: {expected_path}")
        return 1
    if len(name) > MAX_EXPERT_NAME_LENGTH or not SAFE_EXPERT_NAME.fullmatch(name):
        print(f"Error: name '{name}' must be kebab-case")
        return 1

    expert_dir = resolved_path / name
    if expert_dir.exists():
        print(f"Error: directory already exists: {expert_dir}")
        return 1

    expert_dir.mkdir(parents=True)
    init_agent(expert_dir, name, expected_path)
    print(f"Agent expert '{name}' initialized at {expert_dir}")
    print("Next: fill the package, materialize selected Skills, validate, register, and optionally package.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
