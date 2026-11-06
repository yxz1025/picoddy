---
name: data-analysis
description: 读取表格数据（xlsx/csv）并生成分析摘要
---

# 数据分析技能

当用户要求分析数据时：

1. 用 `read_doc` 读取 xlsx/csv 文件。`read_doc` 是统一读取工具；不存在 `read_xlsx`，不要根据扩展名推导工具名。
2. 总结数据概况：行数、列名、数据范围
3. 提取关键洞察：趋势、异常值、汇总统计
4. 如用户需要生成分析结果表格，先整理好全部工作表数据，再调用 `write_xlsx`。

`write_xlsx` 必须在单次调用中同时提供 `fileName` 和至少一个 `sheets` 项；每个工作表必须包含 `name` 和二维 `rows`，`headers` 可选。不要先用只有 `fileName` 的占位调用探测工具。

最小完整参数示例：

```json
{
  "fileName": "分析结果.xlsx",
  "sheets": [
    {
      "name": "分析总览",
      "headers": ["指标", "数值"],
      "rows": [["销售额", 952]]
    }
  ]
}
```
