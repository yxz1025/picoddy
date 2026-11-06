# 研发产物自动校验

使用随包 `../../scripts/validate_artifacts.py`，Python 3.9+，仅标准库。它是专家流程中的本地只读工具，不要求调用技能，也不安装依赖。脚本读取明确登记的文件，不扫描整盘、不访问网络、不执行文档中的命令、不修改产物。

## 执行时机

- 设计产物交付前、修订后执行。
- 按任务开发前重新执行，核对所用产物及引用版本。
- 部分设计仅登记本轮范围，不能以部分通过宣称完整需求通过。
- 工具不存在或 Python 不可用时，记录“自动校验未执行”及原因，可做人工检查但不能冒充自动通过。

## 结构化数据

新生成的每份产物包含一个 `artifact-check` 围栏代码块，内容为严格 JSON。正文仍使用原有 Markdown 模板；数据块是机器索引，不是第二份需求或任务正文。专家生成及修订正文时同步索引，并人工核对两者一致。

````markdown
```artifact-check
{
  "requirement_id": "REQ-1",
  "repo_id": "api",
  "document_type": "tasks",
  "version": "1",
  "acceptance_ids": ["A1"],
  "references": [
    {"repo_id": "api", "path": "docs/designs/REQ-1-api-design.md", "state": "existing", "version": "1"},
    {"repo_id": "api", "path": "src/new-service.java", "state": "planned"}
  ],
  "tasks": [
    {"id": "REQ-1-api-T001", "acceptance_ids": ["A1"], "depends_on": []}
  ]
}
```
````

所有字段必填，不适用数组用 `[]`。仅 tasks 文档登记任务；其他产物的 tasks 为空。任务 ID 沿用已有约定，跨仓库必须唯一。references 显式登记需核对的文档与代码文件；所有路径相对所属仓库根目录，允许现有 docs/designs、docs/plans 等映射。

引用状态：existing 要求文件存在；planned 明确为拟新增，报告未验证，不要求设计阶段创建代码。版本核对需要目标文档也登记在清单并有数据块；需要冻结内容时可加 `sha256`（文件原始字节的 SHA-256，小写十六进制）。批准记录引用所确认产物时应登记真实版本及快照哈希；脚本只能发现不一致，不能证明批准人或授权真实。

## 校验清单与调用

在牵头仓库已授权文档目录保存 `<需求编号>-artifact-check.json`。清单与目录映射同步维护，不强制新建目录。

```json
{
  "schema_version": 1,
  "requirement_id": "REQ-1",
  "acceptance_ids": ["A1"],
  "coverage_types": ["spec", "design", "tasks"],
  "artifacts": [
    {"repo_id": "api", "path": "docs/designs/REQ-1-api-spec.md", "document_type": "spec"},
    {"repo_id": "api", "path": "docs/designs/REQ-1-api-design.md", "document_type": "design"},
    {"repo_id": "api", "path": "docs/plans/REQ-1-api-tasks.md", "document_type": "tasks"}
  ]
}
```

acceptance_ids 来自已确认 PRD 验收基线，不得从设计或任务反推，否则无法发现漏项。跨仓库按本轮整体范围检查覆盖，不要求每个仓库重复覆盖全部验收。完整设计使用 spec/design/tasks 三类；单项或澄清阶段按实际范围缩小 coverage_types，并在交付中说明。清单必须列齐范围内的预期文件，缺失文件保留登记才能被发现。

```text
python3 <专家包路径>/scripts/validate_artifacts.py <清单路径> --repo api=<后端本地路径> --repo web=<前端本地路径>
```

Windows 可使用 `py -3` 或实际 Python 命令；路径含空格时用 shell 对应引号。机器本地路径只通过参数传入，不写入共享清单。用户自定义文件命名与本工具固定产物命名不兼容时，报告不兼容项，不擅自重命名。

## 结果解释

输出 JSON 包含 status、checked_artifacts、findings 和 limits。问题包含级别、规则编号、仓库/文件位置及说明。

| 退出码 | 状态 | 含义 |
| --- | --- | --- |
| 0 | passed | 已登记范围内的结构化检查通过 |
| 1 | failed | 存在编号/命名冲突、缺失文件、验收映射遗漏、重复任务、未知/循环依赖或过期引用 |
| 2 | invalid_input | 清单或调用参数无法处理 |
| 3 | incomplete | 存在未验证项，例如历史文档没有数据块、拟新增文件或目标版本无法核对 |

在 review 中记录命令、清单范围、运行结果与未验证项。失败项修正后重跑；incomplete 需逐项说明是否影响当前阶段，不自动阻断所有设计。脚本不修改评审、授权或执行状态。

通过只证明已登记结构的一致性，不证明：清单未漏登记、自然语言正文完整一致、代码符号/行为正确、共享接口字段语义一致、PRD 验收满足、人工审批真实或业务测试通过。这些继续由现有证据审查和实际测试负责。
