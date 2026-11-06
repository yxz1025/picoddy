# 内联 SVG 图表配方

> 全部为**纯内联 SVG**，无任何外部依赖。
> 颜色一律用 CSS 变量（`var(--c1)` 等），这样深浅色模式自动适配。
> 每段代码可直接复制到报告中，替换数据即可。
>
> **通用规则**
> - 根元素加 `viewBox` + `width="100%"` + `role="img"` + `<title>`，保证响应式与无障碍
> - 文字用 `fill="currentColor"`，颜色继承自父容器
> - 数据标签直接标在图上，不要让读者去对轴
> - 每张图外面包一个 `<figure>`，配 `<figcaption>` 写**一句话结论**

```html
<figure class="chart">
  <h4 class="chart-title">图 X：标题</h4>
  <!-- SVG 放这里 -->
  <figcaption>结论：一句话说清这张图说明了什么。</figcaption>
</figure>
```

---

## 1. 漏斗图（生命周期转化）

```html
<svg viewBox="0 0 640 260" width="100%" role="img" aria-label="生命周期转化漏斗">
  <title>会员生命周期转化漏斗</title>
  <g font-size="13" fill="currentColor" font-family="inherit">
    <!-- 每层：x 起点内缩，宽度按比例。data: 100/62/38/24/15 -->
    <rect x="20"  y="10"  width="600" height="38" rx="4" fill="var(--c1)" opacity=".95"/>
    <text x="34"  y="34" fill="#fff">注册用户　100,000</text>
    <text x="600" y="34" text-anchor="end" fill="#fff">100%</text>

    <rect x="134" y="58"  width="372" height="38" rx="4" fill="var(--c1)" opacity=".78"/>
    <text x="148" y="82" fill="#fff">完成首购　62,000</text>
    <text x="492" y="82" text-anchor="end" fill="#fff">62%</text>

    <rect x="206" y="106" width="228" height="38" rx="4" fill="var(--c1)" opacity=".61"/>
    <text x="220" y="130" fill="#fff">二次购买　38,000</text>
    <text x="420" y="130" text-anchor="end" fill="#fff">38%</text>

    <rect x="248" y="154" width="144" height="38" rx="4" fill="var(--c1)" opacity=".44"/>
    <text x="262" y="178" fill="#fff">稳定复购　24,000</text>
    <text x="378" y="178" text-anchor="end" fill="#fff">24%</text>

    <rect x="275" y="202" width="90" height="38" rx="4" fill="var(--c2)"/>
    <text x="289" y="226" fill="#3a2c05">高价值　15,000</text>
  </g>
  <!-- 流失标注 -->
  <g font-size="12" fill="var(--risk)" font-family="inherit">
    <text x="632" y="82" text-anchor="end">▼ 38% 流失</text>
  </g>
</svg>
```
> **要点**：每一层标注绝对值和百分比；把**最大的那一级流失**用红色标出来，这是全图最重要的信息。

---

## 2. 等级金字塔

```html
<svg viewBox="0 0 560 240" width="100%" role="img" aria-label="会员等级分布金字塔">
  <title>会员等级人数分布</title>
  <g font-family="inherit" font-size="13">
    <polygon points="280,10 340,70 220,70" fill="var(--c2)"/>
    <text x="356" y="48" fill="currentColor">黑卡　3.2%　（1,280 人）</text>

    <polygon points="220,72 340,72 380,132 180,132" fill="var(--c1)" opacity=".85"/>
    <text x="396" y="108" fill="currentColor">金卡　12.5%　（5,000 人）</text>

    <polygon points="180,134 380,134 430,214 130,214" fill="var(--c1)" opacity=".5"/>
    <text x="446" y="180" fill="currentColor">银卡　84.3%　（33,720 人）</text>
  </g>
</svg>
```
> **判读提示**：最低档占比 >92% 时，图形会变成"平底铁饼"——这是第一级门槛过高的视觉信号，应在图注中直接点出。

---

## 3. 四象限散点（权益感知/成本定位）

```html
<svg viewBox="0 0 480 400" width="100%" role="img" aria-label="权益感知价值与成本四象限">
  <title>权益四象限定位</title>
  <!-- 网格与坐标轴 -->
  <line x1="240" y1="30" x2="240" y2="360" stroke="var(--ink-100)" stroke-width="1"/>
  <line x1="60" y1="195" x2="450" y2="195" stroke="var(--ink-100)" stroke-width="1"/>
  <!-- 象限底色 -->
  <rect x="60"  y="30"  width="180" height="165" fill="var(--ok-bg)" opacity=".5"/>
  <rect x="240" y="200" width="210" height="160" fill="var(--risk-bg)" opacity=".5"/>
  <!-- 象限标签 -->
  <g font-size="12" fill="var(--ink-500)" font-family="inherit">
    <text x="70"  y="48">★★★ 主力区（高感知·低成本）</text>
    <text x="252" y="48">★★ 稀缺区（高感知·高成本）</text>
    <text x="70"  y="352">✗ 淘汰区</text>
    <text x="252" y="352">⚠ 陷阱区（低感知·高成本）</text>
  </g>
  <!-- 数据点：cx=成本, cy=感知(反向) -->
  <g font-size="12" fill="currentColor" font-family="inherit">
    <circle cx="120" cy="80"  r="7" fill="var(--c3)"/><text x="132" y="84">免运费</text>
    <circle cx="150" cy="110" r="7" fill="var(--c3)"/><text x="162" y="114">生日礼</text>
    <circle cx="110" cy="140" r="7" fill="var(--c3)"/><text x="122" y="144">优先购</text>
    <circle cx="330" cy="95"  r="7" fill="var(--c2)"/><text x="342" y="99">专属顾问</text>
    <circle cx="360" cy="290" r="7" fill="var(--risk)"/><text x="372" y="294">全场9.5折</text>
  </g>
  <!-- 轴标签 -->
  <g font-size="12" fill="var(--ink-500)" font-family="inherit">
    <text x="455" y="199" text-anchor="end">成本 →</text>
    <text x="60"  y="24">↑ 感知价值</text>
  </g>
</svg>
```

---

## 4. 环形图（积分出口结构 / 成本构成）

```html
<!-- 用 stroke-dasharray 画环，周长 = 2πr。r=70 → 周长≈439.8 -->
<svg viewBox="0 0 240 240" width="240" role="img" aria-label="积分出口结构">
  <title>积分兑换出口结构</title>
  <g transform="translate(120,120) rotate(-90)" fill="none" stroke-width="28">
    <circle r="70" stroke="var(--c1)" stroke-dasharray="153.9 285.9"/>              <!-- 35% -->
    <circle r="70" stroke="var(--c2)" stroke-dasharray="109.9 329.9" stroke-dashoffset="-153.9"/> <!-- 25% -->
    <circle r="70" stroke="var(--c3)" stroke-dasharray="87.9 351.9"  stroke-dashoffset="-263.8"/> <!-- 20% -->
    <circle r="70" stroke="var(--c4)" stroke-dasharray="52.8 387.0"  stroke-dashoffset="-351.7"/> <!-- 12% -->
    <circle r="70" stroke="var(--c5)" stroke-dasharray="35.2 404.6"  stroke-dashoffset="-404.5"/> <!-- 8%  -->
  </g>
  <text x="120" y="114" text-anchor="middle" font-size="26" font-weight="700" fill="currentColor">58%</text>
  <text x="120" y="136" text-anchor="middle" font-size="12" fill="var(--ink-500)">积分核销率</text>
</svg>
```
> 计算：`该段长度 = 周长 × 占比`，`offset = -(前面所有段长度之和)`。周长 = `2 × π × r`。
> **图例另写在 SVG 外的 HTML 里**（用带色块的列表），比塞进 SVG 更易维护。

---

## 5. 分组柱状（三情景成本对比）

```html
<svg viewBox="0 0 560 280" width="100%" role="img" aria-label="三情景权益成本对比">
  <title>保守/基准/压力三情景成本对比</title>
  <!-- 基线 -->
  <line x1="60" y1="230" x2="540" y2="230" stroke="var(--ink-100)"/>
  <g font-size="12" font-family="inherit">
    <!-- 组1：银卡 -->
    <rect x="90"  y="170" width="34" height="60"  fill="var(--c1)" opacity=".45"/>
    <rect x="128" y="140" width="34" height="90"  fill="var(--c1)" opacity=".75"/>
    <rect x="166" y="90"  width="34" height="140" fill="var(--c1)"/>
    <text x="145" y="250" text-anchor="middle" fill="currentColor">银卡</text>
    <text x="183" y="82"  text-anchor="middle" fill="currentColor">230</text>
    <!-- 组2：金卡 -->
    <rect x="300" y="150" width="34" height="80"  fill="var(--c2)" opacity=".45"/>
    <rect x="338" y="110" width="34" height="120" fill="var(--c2)" opacity=".75"/>
    <rect x="376" y="50"  width="34" height="180" fill="var(--c2)"/>
    <text x="355" y="250" text-anchor="middle" fill="currentColor">金卡</text>
    <text x="393" y="42"  text-anchor="middle" fill="currentColor">312</text>
  </g>
  <g font-size="12" fill="var(--ink-500)" font-family="inherit">
    <text x="60" y="24">单会员年化权益成本（元）</text>
    <text x="460" y="180">■ 保守　■ 基准　■ 压力</text>
  </g>
</svg>
```
> **要点**：压力情景用满色、基准 0.75、保守 0.45 透明度，同一色系表达"同一指标的三种情景"。

---

## 6. RFM 九宫格热力

```html
<svg viewBox="0 0 380 340" width="100%" role="img" aria-label="RFM 分群热力图">
  <title>RFM 分群人数分布</title>
  <g font-size="12" font-family="inherit">
    <!-- 每格：fill-opacity 表示人数密度；数值直接标在格内 -->
    <rect x="80"  y="40"  width="90" height="80" fill="var(--c1)" fill-opacity=".85"/>
    <text x="125" y="78"  text-anchor="middle" fill="#fff" font-weight="600">12,400</text>
    <text x="125" y="96"  text-anchor="middle" fill="#fff" font-size="11">重要价值</text>

    <rect x="172" y="40"  width="90" height="80" fill="var(--c1)" fill-opacity=".45"/>
    <text x="217" y="78"  text-anchor="middle" fill="currentColor" font-weight="600">5,800</text>
    <text x="217" y="96"  text-anchor="middle" fill="currentColor" font-size="11">重要发展</text>

    <rect x="80"  y="122" width="90" height="80" fill="var(--risk)" fill-opacity=".55"/>
    <text x="125" y="160" text-anchor="middle" fill="#fff" font-weight="600">3,200</text>
    <text x="125" y="178" text-anchor="middle" fill="#fff" font-size="11">重要保持 ⚠</text>
    <!-- 其余格同理 -->
  </g>
  <g font-size="12" fill="var(--ink-500)" font-family="inherit">
    <text x="40" y="86" text-anchor="end">高 F</text>
    <text x="40" y="168" text-anchor="end">低 F</text>
    <text x="125" y="32" text-anchor="middle">高 R</text>
    <text x="217" y="32" text-anchor="middle">低 R</text>
  </g>
</svg>
```
> **要点**：把**最需要行动的那一格**（通常是"重要保持客户"）用警示色标出，并在图注中写明动作。

---

## 7. 年度日历甘特

```html
<svg viewBox="0 0 720 240" width="100%" role="img" aria-label="年度会员营销日历">
  <title>年度会员营销日历</title>
  <!-- 月份轴：每月 55px，从 x=90 开始 -->
  <g font-size="11" fill="var(--ink-500)" font-family="inherit">
    <text x="117" y="24" text-anchor="middle">1月</text>
    <text x="172" y="24" text-anchor="middle">2月</text>
    <!-- …12月 -->
  </g>
  <g font-size="12" font-family="inherit">
    <text x="82" y="52" text-anchor="end" fill="currentColor">常态·会员日</text>
    <rect x="90" y="40" width="660" height="16" rx="3" fill="var(--c1)" opacity=".22"/>

    <text x="82" y="82" text-anchor="end" fill="currentColor">618 大促</text>
    <rect x="365" y="70" width="80" height="16" rx="3" fill="var(--c2)"/>

    <text x="82" y="112" text-anchor="end" fill="currentColor">周年庆</text>
    <rect x="475" y="100" width="55" height="16" rx="3" fill="var(--c3)"/>

    <text x="82" y="142" text-anchor="end" fill="currentColor">双11 + 年度账单</text>
    <rect x="640" y="130" width="110" height="16" rx="3" fill="var(--c2)"/>
  </g>
</svg>
```

---

## 8. 积分五池流向图（本报告的标志性图表）

```html
<svg viewBox="0 0 680 300" width="100%" role="img" aria-label="积分负债五池模型">
  <title>积分五池流向</title>
  <g font-family="inherit" font-size="13">
    <!-- 发行池 -->
    <rect x="20" y="110" width="130" height="70" rx="8" fill="var(--c1)" opacity=".9"/>
    <text x="85" y="140" text-anchor="middle" fill="#fff" font-weight="600">累计发行</text>
    <text x="85" y="162" text-anchor="middle" fill="#fff">1.2 亿分</text>

    <!-- 流通池（负债） -->
    <rect x="220" y="100" width="150" height="90" rx="8" fill="var(--c2)"/>
    <text x="295" y="132" text-anchor="middle" fill="#3a2c05" font-weight="600">流通池（负债）</text>
    <text x="295" y="156" text-anchor="middle" fill="#3a2c05">5,700 万分</text>
    <text x="295" y="176" text-anchor="middle" fill="#3a2c05" font-size="11">≈ 57 万元名义负债</text>

    <!-- 三个出口 -->
    <rect x="450" y="30"  width="140" height="56" rx="8" fill="var(--c3)" opacity=".85"/>
    <text x="520" y="54"  text-anchor="middle" fill="#fff">已核销 5,500 万</text>
    <text x="520" y="72"  text-anchor="middle" fill="#fff" font-size="11">真实成本发生</text>

    <rect x="450" y="118" width="140" height="56" rx="8" fill="var(--c4)" opacity=".85"/>
    <text x="520" y="142" text-anchor="middle" fill="#fff">沉淀 约 30%</text>
    <text x="520" y="160" text-anchor="middle" fill="#fff" font-size="11">预计永不使用</text>

    <rect x="450" y="206" width="140" height="56" rx="8" fill="var(--ink-300)"/>
    <text x="520" y="230" text-anchor="middle" fill="#fff">已清零 800 万</text>
    <text x="520" y="248" text-anchor="middle" fill="#fff" font-size="11">转回收益</text>
  </g>
  <!-- 流向箭头 -->
  <defs>
    <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-300)"/>
    </marker>
  </defs>
  <g stroke="var(--ink-300)" stroke-width="2" fill="none" marker-end="url(#ar)">
    <path d="M150,145 L215,145"/>
    <path d="M370,130 C410,130 410,60 445,60"/>
    <path d="M370,145 L445,145"/>
    <path d="M370,160 C410,160 410,232 445,232"/>
  </g>
</svg>
```
> 这张图把"积分是负债"这件事一次说清楚。**建议放在第 6 章开头，作为整章的锚**。

---

## 通用注意事项

1. **深色模式**：SVG 内的文字用 `fill="currentColor"`，色块用 CSS 变量。写死 `#333` 的文字在深色模式下会看不见。
2. **响应式**：`width="100%"` + `viewBox`，不要写死 `width="600"`（除非是环形图这类固定尺寸的小图）。
3. **移动端**：图表过宽时外层包 `<div style="overflow-x:auto">`，并设一个 `min-width`。
4. **打印**：确认 `@media print` 下 SVG 未被隐藏，且颜色在黑白打印下仍可区分（靠透明度层次而非色相区分）。
5. **无障碍**：`role="img"` + `<title>` + `aria-label`，关键信息同时用文字表述一遍。
