# prd.md 公司规范改造 实现计划

> **执行状态：已完成（2026-09-18）**，含终审修复。提交序列：`3dcd068`（规范原文）→ `da216fb` + `3b83e54`（模板重写 + 审查修复）→ `7447167`、`daaceb6`、`e4e6799`、`40ac807`（同步与版本号）→ `a6e69d4`（终审修复）。下方勾选框为执行时的工作清单，未回填。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让技能包输出的 `prd.md` 严格遵循公司《产品PRD规范》结构，同时保留插件原有的原型交付与追溯信息。

**Architecture:** 重写 `product-delivery` 的 PRD 模板为公司规范正文骨架 + 附录 A–F；规范原文随包保存保证技能包自包含；同步更新引用模板的三个技能/agent 文件与版本号。

**Tech Stack:** Markdown 文档；git 提交；验证手段为 grep/read 结构核对（无代码测试）。

**规格来源:** `docs/superpowers/specs/2026-09-18-company-prd-template-design.md`

**约定:** 所有路径相对仓库子目录 `product-design--product-management/`（即当前工作目录）；git 命令在仓库内直接执行。

---

### Task 1: 随包保存规范原文

**Files:**
- Create: `skills/product-delivery/references/company-prd-spec.md`

- [ ] **Step 1: 复制原文**

```bash
cp /Users/xiaozhongyuan/Downloads/产品PRD规范.md \
   skills/product-delivery/references/company-prd-spec.md
```

- [ ] **Step 2: 验证内容一致**

Run: `diff /Users/xiaozhongyuan/Downloads/产品PRD规范.md skills/product-delivery/references/company-prd-spec.md && echo SAME`
Expected: 输出 `SAME`；若 diff 仅提示 `\ No newline at end of file` 类末尾换行差异，视为一致并在交付说明中注明。

- [ ] **Step 3: 验证标题章节完整**

Run: `grep -n "^#### 1、相关链接\|^#### 2、文档说明\|^#### 3、需求相关方\|^##### 一、需求背景\|^##### 六、数据埋点" skills/product-delivery/references/company-prd-spec.md`
Expected: 命中 5 行（相关链接/文档说明/需求相关方/需求背景/数据埋点）

- [ ] **Step 4: Commit**

```bash
git add skills/product-delivery/references/company-prd-spec.md
git commit -m "docs: 随包保存公司《产品PRD规范》原文"
```

---

### Task 2: 重写 PRD 模板为公司规范骨架 + 附录 A–F

**Files:**
- Modify: `skills/product-delivery/references/prd-template.md`（整文件重写）

- [ ] **Step 1: 写入完整新内容**

> 实施记录：本条已于 2026-09-18 执行（`da216fb`），随后按质量审查修订并提交为 `3b83e54`（9 处：补齐公司规范「（必有）」「（视需求情况可选）」标记、页面 ID 关联键与入口/返回/状态保留规则、修正相对路径为 `../../frontend/SKILL.md` 等）。**当前有效内容以 `3b83e54` 的文件为准**；下方为初版内容，仅供追溯。

将 `skills/product-delivery/references/prd-template.md` 全文替换为：

````markdown
# PRD 交付模板

正文四节严格遵循公司《产品PRD规范》（原文见 [company-prd-spec.md](company-prd-spec.md)），可单独复制进钉钉在线文档。交付元信息、需求与验收对照、页面与组件映射、字段契约、角色权限、风险待确认项放入附录 A–F，供本地交付与原型追溯使用，不随正文进钉钉。

填写真实信息；未知项按规则写「待补充」（链接）、「待填写」（人员）、「本次不涉及」（无该场景的章节），不编造人名、指标、批准或验证结果。

## <需求名称>

标题与 TAPD 需求名称保持一致。

## 1、相关链接

- TAPD链接：
- 蓝湖设计稿链接：
- 业务需求文档链接：
- 数据调研分析链接：

当次提供了就填真实链接；未提供的写「待补充」；确认不涉及的可整行省略。

## 2、文档说明

| 序号 | 说明 | 日期 | 产品经理 |
| --- | --- | --- | --- |
| 1 | 完成产品文档 | <实际交付日期> | 待填写 |
| 2 | <本次调整内容> | <实际日期> | <提供者或待填写> |

第一行固定为「完成产品文档」，日期用实际交付日；后续每次需求调整追加一行，说明列写清调整内容。

## 3、需求相关方

1. 需求方：
2. PM：
3. PD：
4. 交互：
5. UI：
6. 前端：
7. 服务端：
8. 测试：

每项填实际人员；未提供写「待填写」。

## 4、需求正文

### 一、需求背景

问题是什么、谁受影响、不解决的代价。区分事实与假设；有调研、工单或数据就引用，没有就写「待确认」。

### 二、需求价值

用户价值与业务价值分别说明；成功指标给出基线与目标，缺失的写「待确认」。

### 三、需求清单

从 1–N 的需求：

| 产品域 | 模块 | 需求 |
| --- | --- | --- |
| <产品域> | <模块> | 【新增】<需求描述> |
|  | <模块> | 【改造】<需求描述> |

从 0–1 的需求：给产品架构/拆解说明或产品范围说明；无法给图时用文字范围说明代替并注明。

非目标（本次不做）：逐条列出并简述原因，防止范围蔓延。

### 四、流程图/状态机

存在状态流转、多系统数据交互或纯接口对接（无界面）时必须给出（Mermaid 流程图或状态表）；否则整节写「本次不涉及」。

### 五、需求描述

有界面的需求必须有；纯逻辑或接口对接类可整节写「本次不涉及」。

按页面分节，每节结构：

#### <页面名称>（对应 REQ-XXX）

- 标记点 1：【新增】<描述>——原型：<页面 ID/锚点>
- 标记点 2：【改造】<描述>——原型：<页面 ID/锚点>

覆盖加载、空数据、错误、无权限、只读、成功状态；异常与边界单独列出。纯后台规则标注「原型不可验证」，不能用 UI 点击证明服务端行为。钉钉定稿时在标记点位置补对应截图。

### 六、数据埋点

有行为埋点或数据表抽取要求时必须给出（事件/触发时机/参数，或固定表头说明）；否则整节写「本次不涉及」。

---

## 附录 A 需求与验收对照

| 需求 ID | 用户故事/业务规则 | 优先级 | 验收 ID 与 Given/When/Then | 原型页面/锚点 | 依赖/未决项 |
| --- | --- | --- | --- | --- | --- |

需求用稳定编号（REQ-001），验收用 AC-001；修订时不重新编号旧条目。包含正常、失败、权限、边界场景。

## 附录 B 页面与组件映射

| 页面 ID | 对应需求 | 页面模式 P | 组件 C | 交互 I | 原型定位 | 与规范的差异及确认状态 |
| --- | --- | --- | --- | --- | --- | --- |

引用 `../frontend/` 的 P/C/I 编号；新增组件标注「新增候选」及待确认事项，不冒充既有组件。

## 附录 C 字段与组件契约

| 页面/字段 | 业务含义 | 组件 | 显示值 | 存储值及类型 | 初始值/空值 | 单选/多选 | 校验/边界 | 联动清理规则 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

明确 `id`、`code`、手机号区别，数值 `0` 不等于空；日期格式/时区/范围端点按业务定义；搭配师单选不能直接当员工多选。

## 附录 D 角色与权限

| 角色 | 页面访问 | 操作/数据范围 | 无权限呈现 | 原型模拟方式 |
| --- | --- | --- | --- | --- |

## 附录 E 原型说明与评审联动

- 交付 ID / 版本 / 状态（草案/待评审/已确认）
- 前端规范名称/版本/审批状态、适用系统
- 原型打开方法、资源目录、模拟数据范围
- 保存/刷新/重置行为说明（本地演示数据，不调用生产接口）
- 演示控制（空态/失败/无权限切换）说明
- 评审记录路径：`review.md`
- 钉钉：本版不接入；文档链接、文档版本留空
- 版本变更影响：相对前版的需求/原型变化、受影响需重审或复测的验收 ID（旧版通过结论不自动继承）

## 附录 F 风险与待确认项

| 问题 ID | 问题/假设 | 影响的需求 | 是否阻塞 | 待确认角色/负责人 | 状态与实际决定 |
| --- | --- | --- | --- | --- | --- |

多系统/多仓库影响列为产品边界和依赖，未知映射待研发确认。
````

- [ ] **Step 2: 验证公司规范四节齐全**

Run: `grep -n "^## 1、相关链接（必有）$\|^## 2、文档说明（必有）$\|^## 3、需求相关方$\|^## 4、需求正文$" skills/product-delivery/references/prd-template.md`
Expected: 命中 4 行

- [ ] **Step 3: 验证正文六节与附录 A–F 齐全**

Run: `grep -c "^### [一二三四五六]、\|^## 附录 [A-F] " skills/product-delivery/references/prd-template.md`
Expected: 输出 `12`

- [ ] **Step 4: 验证填写口径出现**

Run: `grep -c "待补充\|待填写\|本次不涉及" skills/product-delivery/references/prd-template.md`
Expected: 输出 ≥ 8

- [ ] **Step 5: Commit**

```bash
git add skills/product-delivery/references/prd-template.md
git commit -m "feat: PRD 模板改为公司规范正文骨架 + 附录 A–F"
```

---

### Task 3: 同步 product-delivery/SKILL.md

**Files:**
- Modify: `skills/product-delivery/SKILL.md:15`（钉钉一行）、`:19`（交付流程第 1 步）、`:24`（第 6 步）

- [ ] **Step 1: 修改第 15 行钉钉口径**

原文本：
`- MCP 是可选信息来源，不是产出文件的前提。第一版不创建、上传或同步钉钉文档，不自动写 TAPD；PRD 中记录钉钉状态为“本版不接入”，链接和版本留空。`

替换为：
`- MCP 是可选信息来源，不是产出文件的前提。第一版不创建、上传或同步钉钉文档，不自动写 TAPD；PRD 中记录钉钉状态为「本版不接入」，相关链接未提供时写「待补充」。`

- [ ] **Step 2: 修改交付流程第 1 步**

原文本：
`1. **定义需求**：结合 \`../feature-spec/SKILL.md\`，读取 [PRD 模板](references/prd-template.md)，形成业务范围、页面、字段、权限、验收标准和未决事项。需求使用稳定编号（如 REQ-001）、验收项使用 AC-001，修订时不重新编号旧需求。`

替换为：
`1. **定义需求**：结合 \`../feature-spec/SKILL.md\`，读取 [PRD 模板](references/prd-template.md)，形成业务范围、页面、字段、权限、验收标准和未决事项。prd.md 正文四节（相关链接、文档说明、需求相关方、需求正文六节）严格遵循公司《产品PRD规范》（原文见 [company-prd-spec.md](references/company-prd-spec.md)），可单独复制进钉钉；需求与验收对照、页面与组件映射、字段契约、角色权限、原型与评审信息、风险待确认项放入附录 A–F。链接未提供写「待补充」，人员未提供写「待填写」，不得编造；本版仍不接入钉钉。需求使用稳定编号（如 REQ-001）、验收项使用 AC-001，修订时不重新编号旧需求。`

- [ ] **Step 3: 修改第 6 步一致性交付**

原文本：
`6. **一致性交付**：PRD、原型可见标识和评审记录使用同一交付 ID/版本；`

替换为：
`6. **一致性交付**：PRD（附录 E）、原型可见标识和评审记录使用同一交付 ID/版本；`

- [ ] **Step 4: 验证**

Run: `grep -n "company-prd-spec\|待补充\|附录 A–F\|附录 E）" skills/product-delivery/SKILL.md`
Expected: 命中 3 行（钉钉口径行含「待补充」；流程第 1 步行同时含 `company-prd-spec`、`待补充`、`附录 A–F`；第 6 步行含「附录 E）」），且 `grep -c "链接和版本留空" skills/product-delivery/SKILL.md` 输出 `0`

- [ ] **Step 5: Commit**

```bash
git add skills/product-delivery/SKILL.md
git commit -m "feat: product-delivery 流程同步公司 PRD 规范结构"
```

---

### Task 4: 同步 feature-spec/SKILL.md

**Files:**
- Modify: `skills/feature-spec/SKILL.md:12`（PRD Structure 首段）

- [ ] **Step 1: 替换首段**

原文本（第 12 行整段）：
`For a file-based PRD or a PRD accompanying an interactive prototype, read \`../product-delivery/references/prd-template.md\` for delivery metadata, stable requirement/acceptance IDs, page-to-component mapping, field value contracts, permissions and version traceability. Retain the product reasoning below; do not pad goals or non-goals to meet a fixed count. For full product delivery, use \`../product-delivery/SKILL.md\` and the bundled \`../frontend/SKILL.md\`. A PRD-only request does not authorize creating a prototype or publishing documents.`

替换为：
`For a file-based PRD or a PRD accompanying an interactive prototype, read \`../product-delivery/references/prd-template.md\`. The four main sections follow the company PRD standard (\`../product-delivery/references/company-prd-spec.md\`) and can be pasted into DingTalk directly; delivery metadata, stable requirement/acceptance IDs, page-to-component mapping, field value contracts, permissions and version traceability live in Appendices A–F. Map the product reasoning below onto that structure: the Problem Statement and Goals fill 需求背景 / 需求价值, Non-Goals go under 需求清单, and requirements with acceptance criteria fill Appendix A. Retain the product reasoning below; do not pad goals or non-goals to meet a fixed count. For full product delivery, use \`../product-delivery/SKILL.md\` and the bundled \`../frontend/SKILL.md\`. A PRD-only request does not authorize creating a prototype or publishing documents.`

- [ ] **Step 2: 验证**

Run: `grep -n "company-prd-spec\|需求清单\|Appendix A" skills/feature-spec/SKILL.md`
Expected: 命中 1 行且包含上述关键词

- [ ] **Step 3: Commit**

```bash
git add skills/feature-spec/SKILL.md
git commit -m "docs: feature-spec 对齐公司 PRD 模板结构"
```

---

### Task 5: 同步 agents/product-management-expert.md

**Files:**
- Modify: `agents/product-management-expert.md:37`（产品阶段文件交付段）

- [ ] **Step 1: 补充规范说明**

原文本：
`当用户需要 PRD 配套原型、完整产品交付或更新评审包时，先读取 \`../skills/product-delivery/SKILL.md\`，再按其指引组合 \`feature-spec\` 与 \`frontend\`。默认实际输出 \`prd.md\`、\`prototype/index.html\` 和 \`review.md\`，不止在聊天中描述原型；第一版不接入钉钉。`

替换为：
`当用户需要 PRD 配套原型、完整产品交付或更新评审包时，先读取 \`../skills/product-delivery/SKILL.md\`，再按其指引组合 \`feature-spec\` 与 \`frontend\`。默认实际输出 \`prd.md\`、\`prototype/index.html\` 和 \`review.md\`，不止在聊天中描述原型；prd.md 正文遵循公司《产品PRD规范》，交付信息放附录 A–F；第一版不接入钉钉。`

- [ ] **Step 2: 验证**

Run: `grep -n "公司《产品PRD规范》" agents/product-management-expert.md`
Expected: 命中 1 行

- [ ] **Step 3: Commit**

```bash
git add agents/product-management-expert.md
git commit -m "docs: 产品通补充公司 PRD 规范说明"
```

---

### Task 6: README 说明段与版本号

**Files:**
- Modify: `README.md`（安装节，新增 1.3.0 段）
- Modify: `.picoddy-plugin/plugin.json:3`（version）

- [ ] **Step 1: README 新增 1.3.0 段**

在第 9 行段落 `新增 \`product-delivery\` 技能……` 之前插入：

```markdown
### 1.3.0：PRD 遵循公司规范

`prd.md` 正文改为公司《产品PRD规范》结构（相关链接 / 文档说明 / 需求相关方 / 需求正文六节），可直接复制进钉钉在线文档；需求与验收对照、页面与组件映射、字段契约、角色权限、原型与评审信息、风险待确认项放附录 A–F，供本地交付与原型追溯。相关链接未提供写「待补充」，人员未提供写「待填写」，不编造。规范原文随包保存在 `skills/product-delivery/references/company-prd-spec.md`。本版仍不接入钉钉。

```

（即在 `## 安装` 标题之后、原 `### 1.1.0：产品阶段交付与交互原型` 之前）

- [ ] **Step 2: 版本号 1.2.1 → 1.3.0**

修改 `.picoddy-plugin/plugin.json` 第 3 行：
`  "version": "1.2.1",` → `  "version": "1.3.0",`

- [ ] **Step 3: 验证**

Run: `grep -n '"version"' .picoddy-plugin/plugin.json && grep -n "### 1.3.0" README.md`
Expected: 分别输出 `"version": "1.3.0",` 和 `### 1.3.0：PRD 遵循公司规范`

- [ ] **Step 4: Commit**

```bash
git add README.md .picoddy-plugin/plugin.json
git commit -m "docs: 插件 1.3.0 说明与版本号"
```

---

### Task 7: 终验（对照设计文档验收标准）

**Files:**
- 只读检查，无文件改动

- [ ] **Step 1: 验收标准 1——必填项不空**

Run: `grep -n "待补充\|待填写\|本次不涉及" skills/product-delivery/references/prd-template.md | wc -l`
Expected: ≥ 8

- [ ] **Step 2: 验收标准 2——附录 A–F 与 REQ/AC、P/C/I 完整**

Run: `grep -n "REQ-001\|AC-001\|C-01\|P-01\|I-01\|PAGE-01" skills/product-delivery/references/prd-template.md`
Expected: 命中 3 行（附录 A 的 REQ-001/AC-001 规则行、附录 B 的 P/C/I 引用示例行、正文页面 ID 示例行）

- [ ] **Step 3: 验收标准 3——无旧结构残留描述**

Run: `grep -rn "链接和版本留空" skills/ agents/ README.md`
Expected: 无输出

Run: `grep -n "^## 文档信息\|^## 背景、目标与边界\|^## 版本变更" skills/product-delivery/references/prd-template.md`
Expected: 无输出

- [ ] **Step 4: 验收标准 4——规范原文一致**

Run: `diff /Users/xiaozhongyuan/Downloads/产品PRD规范.md skills/product-delivery/references/company-prd-spec.md`
Expected: 无输出（或仅换行符差异）

- [ ] **Step 5: 验收标准 5——版本号**

Run: `grep -n '"version": "1.3.0"' .picoddy-plugin/plugin.json`
Expected: 命中 1 行

- [ ] **Step 6: 汇总验证结果**

把 1–5 的实际输出（含未通过项）写入交付说明，不通过项不勾选。
