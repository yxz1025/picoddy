---
name: tapd-excel-template
description: Use when generating or validating TAPD-importable test case workbooks with the bundled Excel template.
description_zh: "生成并校验符合 TAPD 模板的测试用例 Excel"
license: MIT
metadata:
  category: testing
  version: "1.0.0"
---

# TAPD Excel 模板

使用包内 assets/excel_template.xlsx 和 bin/generate-test-cases.cjs。保留第一张表的 11 列顺序，不增加追溯字段；正式用例从第二行开始。等级仅使用 P0/P1/P2/P3，步骤与预期必须成对且编号连续，关联需求填写当前需求 URL。

先生成结构化 JSON，再运行生成器并回读校验 validatedCases。校验成功只代表文件格式和设计内容合规，不代表测试已执行或通过。生成 JSON、源码和输入资产不作为正式 TAPD 附件上传。
