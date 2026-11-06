# 报告设计系统

> 目标风格：**专业、克制、有分量**。像一份咨询公司交付物，不像一个花哨的运营 H5。
> 三条底线：① 留白够大 ② 层级分明 ③ 不用花哨特效。

---

## 一、调色板

全部用 CSS 变量定义在 `:root`，深色模式只覆盖变量值。**任何颜色都不允许硬编码在组件里。**

```css
:root {
  /* 中性色 —— 承载 90% 的画面 */
  --ink-900:#0f1419;  --ink-700:#2c3540;  --ink-500:#5b6675;
  --ink-300:#93a0b0;  --ink-100:#dfe4ea;  --ink-50:#f2f4f7;
  --paper:#ffffff;    --paper-2:#f8fafc;

  /* 主色 —— 深靛蓝，专业稳重 */
  --brand-700:#1b3a5c; --brand-500:#2c5f8a; --brand-300:#7ba3c4; --brand-50:#eaf2f8;

  /* 强调色 —— 琥珀金，会员/尊享的语义 */
  --accent-600:#b8860b; --accent-500:#d4a017; --accent-300:#e8c766; --accent-50:#fdf6e3;

  /* 语义色 */
  --ok:#2e7d5b;  --ok-bg:#e8f5ef;
  --warn:#b8860b; --warn-bg:#fdf6e3;
  --risk:#b3392f; --risk-bg:#fbeceb;

  /* 图表色板 —— 最多 5 色，顺序固定 */
  --c1:#2c5f8a; --c2:#d4a017; --c3:#2e7d5b; --c4:#8b6bb1; --c5:#c96f4a;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ink-900:#eef2f6; --ink-700:#c8d2dd; --ink-500:#93a0b0;
    --ink-300:#5b6675; --ink-100:#2c3540; --ink-50:#1a222c;
    --paper:#10161d;   --paper-2:#161e27;
    --brand-700:#a8c8e4; --brand-500:#7ba3c4; --brand-300:#3d6b91; --brand-50:#182836;
    --accent-600:#e8c766; --accent-500:#d4a017; --accent-300:#8a6a15; --accent-50:#2a2416;
    --ok:#5cc79a; --ok-bg:#122a21;
    --warn:#e0b84a; --warn-bg:#2a2416;
    --risk:#e88a80; --risk-bg:#2c1a18;
    --c1:#7ba3c4; --c2:#e0b84a; --c3:#5cc79a; --c4:#b39ddb; --c5:#e0977a;
  }
}
:root[data-theme="dark"] { /* 与上面 dark 块相同的变量值，供手动切换使用 */ }
```

> ⚠️ **必须同时写三处**：`:root`（浅色基线）、`@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`（跟随系统）、`:root[data-theme="dark"]`（手动切换）。
> 缺任何一处，都会出现"切换按钮失效"或"跟随系统失效"。

**用色纪律**
- 主色只用于：标题强调、链接、主要图表系列、章节序号。
- 强调金只用于：会员等级相关、关键结论高亮、"记忆点"标记。**一页不超过 3 处**。
- 语义色只用于状态判定（🟢🟡🔴），不用于装饰。

---

## 二、字体与字阶

```css
--font-sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
             "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif;
--font-serif: "Songti SC", "SimSun", Georgia, "Times New Roman", serif;
--font-mono: "SF Mono", Menlo, Consolas, "Courier New", monospace;
```

| 用途 | 字号 | 字重 | 行高 | 说明 |
|---|---|---|---|---|
| 封面主标题 | 44–56px | 700 | 1.15 | 移动端降到 32px |
| 章节标题 H2 | 28px | 700 | 1.25 | 配章节序号（大号浅色数字） |
| 小节标题 H3 | 20px | 600 | 1.35 | |
| 正文 | 16px | 400 | **1.75** | 中文行高必须够大，1.6 以下会显得拥挤 |
| 表格 / 图注 | 14px | 400 | 1.6 | |
| 标签 / 脚注 | 12–13px | 500 | 1.5 | |
| 关键数字 | 36–48px | 700 | 1.0 | 用 `font-variant-numeric: tabular-nums` |

**中文排版细节**
- 正文最大宽度 `72ch`，超过后阅读效率显著下降
- 中英混排在数字/英文两侧留 `0.15em` 间距
- 数字统一用 `tabular-nums`，表格里的数字才能对齐

---

## 三、间距与栅格

```css
--s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px;
--s6:32px; --s7:48px; --s8:64px; --s9:96px;
```

- 章节之间：`--s9`（96px）——**留白是专业感的主要来源，不要吝啬**
- 小节之间：`--s7`
- 段落之间：`--s5`
- 卡片内边距：`--s5` ~ `--s6`
- 内容区最大宽度：`1040px`，居中；侧边目录宽 `220px`

---

## 四、组件规范

### 4.1 卡片
```css
.card{
  background:var(--paper); border:1px solid var(--ink-100);
  border-radius:12px; padding:var(--s6);
  box-shadow:0 1px 2px rgba(15,20,25,.04), 0 4px 12px rgba(15,20,25,.03);
}
```
> 阴影要**极轻**。重阴影是廉价感的第一来源。

### 4.2 关键数字卡（KPI Card）
结构：`标签（小、灰） → 数字（大、粗） → 变化/说明（小、语义色）`
四个一排，移动端两个一排。

### 4.3 结论条（Callout）
左侧 3px 色条 + 浅色背景。三种：`.callout-key`（主色，核心结论）、`.callout-warn`（警示）、`.callout-risk`（风险/红线）。

### 4.4 表格
- 表头：`--ink-50` 背景、`600` 字重、`13px`、`letter-spacing:.02em`
- 行分隔：`1px solid var(--ink-100)`，**不要竖线**
- 悬停高亮行
- 数字右对齐、文字左对齐
- 外层必须包 `<div class="table-wrap" style="overflow-x:auto">`

### 4.5 状态标记
```
🟢 正常 / 安全    🟡 关注 / 需验证    🔴 危险 / 红线
```
必须**同时有颜色和文字**，不能只靠颜色（无障碍要求 + 打印黑白友好）。

### 4.6 章节编号
大号浅色数字（48px，`--ink-100`）压在标题左侧或上方，是低成本提升"设计感"的手法。

---

## 五、打印样式

```css
@media print {
  .sidebar,.theme-toggle,.back-top,.calculator-controls{display:none!important}
  body{background:#fff;color:#000;font-size:11pt}
  .card{break-inside:avoid; box-shadow:none; border:1px solid #ccc}
  section{break-before:page}
  h2,h3{break-after:avoid}
  table{break-inside:auto} tr{break-inside:avoid}
  a[href^="#"]::after{content:""}   /* 锚点链接不显示 URL */
}
```

---

## 六、常见"廉价感"来源（**逐条避免**）

| 问题 | 后果 | 正解 |
|---|---|---|
| 大面积高饱和色块 | 像促销海报 | 中性色打底，彩色只做点缀 |
| 重阴影 / 大圆角 | 像 2015 年的模板 | 极轻阴影，圆角 8–12px |
| 渐变按钮 / 发光效果 | 廉价 | 纯色 + 细边框 |
| 行高 1.4 以下的中文正文 | 拥挤难读 | 1.75 |
| 章节之间只隔 24px | 没有呼吸感 | 96px |
| 一页 8 种颜色 | 视觉噪音 | 图表 ≤5 色，页面主色 ≤3 |
| 图表没有结论 | 读者要自己猜 | 每图配一句话结论 |
| 表格加竖线 + 斑马纹 + 边框 | 像 Excel 截图 | 只保留横向分隔线 |
| 用 emoji 做装饰 | 不专业 | emoji 只用于状态标记 |
| 居中对齐大段正文 | 难读 | 正文一律左对齐 |
