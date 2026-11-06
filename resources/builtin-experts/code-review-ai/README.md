# 代码审查专家

AI 驱动的架构审查与代码质量分析专家包（Pi-a Agent 专家，schemaVersion 2），对代码变更做架构、安全、性能与可维护性审查，输出带行号定位和修复建议的分级评审意见。

## 结构

- `.picoddy-plugin/plugin.json`：v2 专家清单
- `agents/code-review-ai.md`：主 Agent，架构评审人设、能力与响应方式
- `skills/ai-review/`：AI 辅助代码评审工作流（静态分析、OWASP Top 10、性能回归、评审意见生成与 CI/CD 集成）

## 来源与许可

内容重建自 https://github.com/wshobson/agents 的 architect-review 与 ai-review 资产（MIT License, Copyright (c) 2024 Seth Hobson），许可证文本见 `license/LICENSE.txt`。
