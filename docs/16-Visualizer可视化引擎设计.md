# Visualizer 可视化引擎设计

> 对标参考：WorkBuddy s19 Visualizer — "不只是文字，还能画图"
> 核心思想：agent 的输出不是终端纯文本，而是流式注入的 SVG 图表和 HTML widget，在对话流中原地渲染
> 文档目的：为 picoddy 实现 Visualizer 提供完整设计（两工具协议 + 渲染管线 + 持久化 + 安全）

---

## 目录

1. [背景与目标](#1-背景与目标)
2. [现状能力盘点](#2-现状能力盘点)
3. [设计总览](#3-设计总览)
4. [后端设计](#4-后端设计)
5. [前端设计](#5-前端设计)
6. [安全设计](#6-安全设计)
7. [持久化与重载](#7-持久化与重载)
8. [数据流全链路](#8-数据流全链路)
9. [实施计划](#9-实施计划)
10. [验证方案](#10-验证方案)
11. [风险与边界](#11-风险与边界)

---

## 1. 背景与目标

### 问题

到 present_files 为止，agent 的交付都是"文件"。但很多场景下，用户要的是一张图：

- 让 agent 设计系统架构 → 它输出 500 行文字，不如一张架构图 3 秒看懂
- 让 agent 比较三个方案 → 冗长的 markdown 表格，不如柱状图直观
- 让 agent 解释数据流 → 歪歪扭扭的 ASCII 图

WorkBuddy 的 Visualizer 解决这个问题：**它不是图片生成（不调 DALL-E），而是代码可视化** —— 让 agent 直接生成 SVG / HTML 代码，流式注入对话，在 UI 中原地渲染。agent 既是思考者，也是设计师。

### 目标

1. agent 能通过 `show_widget` 工具把 SVG 图表 / HTML widget 内联渲染到对话流
2. 支持多 widget 叙事：文字 → widget → 文字 → widget，复杂主题拆成多个小图
3. 主题感知：浅色 / 深色主题下 widget 自动适配（复用现有 CSS 变量体系）
4. 渲染安全：模型生成的 HTML 代码必须沙箱隔离
5. 持久化可重载：刷新会话后 widget 仍能恢复渲染

### 非目标

- 不做图片生成（PNG/JPG）—— 那是 ImageGen 的范畴
- 不做画布编辑器 —— 只在对话流中展示
- 不引入图表库（ECharts/Recharts）—— widget 由模型直接写 SVG/HTML，前端零依赖

---

## 2. 现状能力盘点

当前项目已有以下能力，Visualizer 直接复用，无需重造：

| 现有能力 | 位置 | 复用方式 |
|---------|------|---------|
| present_files 工具 + 交付卡片 | `src/agent/tools/present_files.ts`、ChatArea `PresentFilesCards` | 双源解析模式、tool 返回 details 结构 |
| 工具注册 | `src/agent/tools/index.ts` `getFullTools`/`getReadOnlyTools` | 新增工具挂载点 |
| 系统提示注入 | `src/agent/engine.ts` `SYSTEM_PROMPT` + `<result_presentation>` | 新增 `<visualization>` 段 |
| 事件流 | `normalizeHarnessEvent`（`tool_execution_end` → `{...event, output: result}`）→ provider → SSE | 零改动，details 随 output 透传 |
| 主题系统 | `frontend/src/store/appStore.ts` tokens（`:root[data-theme="dark"]` 双主题 CSS 变量） | widget 用 `var(--xxx)` 引用，自动跟随主题 |
| 消息渲染 | ChatArea `groupToolMessages` + `PresentFilesCards` 独立块 | 新增 `kind: "widget"` 分支 |
| store 事件处理 | `useStore.ts` `handleEvent` `tool_execution_end` 分支 | 新增 show_widget 分支 |

### 关键机制（已验证的 present_files 双源模式）

```
实时路径：tool_execution_end → SSE → handleEvent → output.details.xxx → store
重载路径：DB 中 tool message content（JSON 含 details）→ 渲染时 JSON.parse 解析
```

Visualizer 的持久化必须沿用此模式，且需要补齐一个缺口（见 §7）。

---

## 3. 设计总览

### 3.1 两工具协议（对齐 WorkBuddy）

| 工具 | 作用 | 何时调用 |
|------|------|---------|
| `read_me` | 加载设计指引（CSS 变量语义、布局规则、字号规范、示例片段） | 首次 `show_widget` 前 MUST 调用；换模块时再调 |
| `show_widget` | 渲染 SVG 或 HTML widget（title + widget_code + loading_messages） | 需要可视化输出时 |

### 3.2 模块系统

五个设计模块，各有独立指引：

| 模块 | 用途 | 典型场景 |
|------|------|---------|
| `diagram` | 架构图、流程图 | 系统设计、数据流 |
| `mockup` | UI 原型 | 界面设计、布局预览 |
| `interactive` | 交互式 widget | 可操作的数据探索 |
| `chart` | 数据图表 | 趋势、对比、分布 |
| `art` | 装饰性图形 | 概念可视化、创意 |

### 3.3 渲染管线

```
1. agent 调用 read_me(modules=["diagram"]) → 获取设计指引
2. agent 按指引生成 SVG/HTML 代码（颜色用 var(--xxx) 引用）
3. agent 调用 show_widget(title, widget_code, loading_messages)
4. tool_execution_end 事件携带 details.widget 经 SSE 到前端
5. 前端 WidgetRenderer 在对话流中原地渲染
6. 用户看到内联可视化；切主题时 widget 自动变色
```

### 3.4 与 present_files 的分工

| 维度 | present_files | show_widget |
|------|--------------|-------------|
| 内容 | 文件交付（path/url） | 代码可视化（SVG/HTML 片段） |
| 位置 | 任务结尾，一次交付 | 对话中任意位置，可多次 |
| 渲染 | 预览面板（右侧） | 对话流内联（消息间） |
| 关系 | 最终成果 | 过程说明 / 辅助理解 |

**边界**：widget 不是文件，不写盘；如果用户要保留 widget，另存为 .svg/.html 文件（工具提供下载/复制）。

---

## 4. 后端设计

### 4.1 新增文件

```
src/agent/tools/
├── read_me.ts         # readMeTool：加载设计指引
├── show_widget.ts     # showWidgetTool：渲染 widget（返回 details.widget）
└── design_guides.ts   # 五模块设计指引数据 + 主题变量语义表
```

### 4.2 read_me 工具

```typescript
const readMeSchema = Type.Object({
  modules: Type.Array(
    Type.Union([
      Type.Literal("diagram"),
      Type.Literal("mockup"),
      Type.Literal("interactive"),
      Type.Literal("chart"),
      Type.Literal("art"),
    ]),
    { description: "需要的设计模块列表" },
  ),
});

export const readMeTool: AgentTool<typeof readMeSchema, any> = {
  name: "read_me",
  label: "加载可视化设计指引",
  description:
    "返回 show_widget 所需的设计指引（主题 CSS 变量语义、布局规则、字号规范、示例片段）。首次 show_widget 前必须调用；需要不同模块时再调用。不要在回复中提及此调用——这是内部准备步骤。",
  parameters: readMeSchema,
  execute: async (_id, p) => {
    const guides = p.modules.map((m) => DESIGN_GUIDES[m]);
    return {
      content: [{ type: "text", text: `已加载设计指引：${p.modules.join(", ")}` }],
      details: { guides },
    };
  },
};
```

### 4.3 show_widget 工具

```typescript
const showWidgetSchema = Type.Object({
  title: Type.String({ description: "widget 标识，用于引用和下载文件名" }),
  widget_code: Type.String({
    description:
      "原始 SVG 或 HTML 片段。SVG 必须以 <svg> 开头，viewBox 以 '0 0 680' 开头；HTML 不含 <!DOCTYPE>/<html>/<head>/<body>，可含 <style> 和 <script>。颜色一律用 CSS 变量 var(--xxx) 引用。",
  }),
  module: Type.Optional(Type.Union([...五个模块...])),
  loading_messages: Type.Optional(Type.Array(Type.String(), { maxItems: 4 })),
});
```

execute 返回：

```typescript
{
  content: [{ type: "text", text: `已渲染可视化内容「${p.title}」。` }],
  details: {
    widget: {
      title: p.title,
      widget_code: p.widget_code,
      module: p.module ?? "diagram",
      loading_messages: p.loading_messages ?? [],
    },
  },
}
```

### 4.4 设计指引数据（design_guides.ts）

#### 4.4.1 主题变量语义表（对齐 appStore.ts tokens，作为 read_me 返回内容）

| 变量 | 语义 | 使用场景 |
|------|------|---------|
| `var(--bg)` | 页面背景 | widget 底色 |
| `var(--bg-subtle)` | 次级背景 | 分组容器、间隔带 |
| `var(--text)` | 主文字 | 标题、数值 |
| `var(--text-2)` | 次级文字 | 说明文字 |
| `var(--text-3)` | 弱文字 | 标签、刻度 |
| `var(--accent)` | 强调色 | 主元素、激活状态、线条 |
| `var(--accent-soft)` | 强调淡底 | 节点填充（opacity 效果） |
| `var(--border)` | 边框 | 节点描边、分隔线 |
| `var(--green)` | 成功/正面 | 状态标注 |
| `var(--amber)` | 警告 | 需要注意的节点 |
| `var(--red)` | 失败/负面 | 错误标注 |

**核心决策：后端不复制色板。** widget_code 中颜色一律用 `var(--xxx)` 引用，前端渲染时由宿主 CSS 变量自动解析。主题切换时 widget 自动变色（SVG 内联模式天然继承；HTML iframe 模式注入变量快照，见 §5.4）。

#### 4.4.2 模块指引结构

```typescript
interface DesignGuide {
  module: string;
  css_vars: string[];        // 该模块可用的变量语义（变量名 + 用途）
  rules: string[];           // 布局规则（必守）
  typography: Record<string, string>; // 字号规范
  examples: string[];        // 1-2 个最小示例片段
}
```

**diagram 模块 rules（对齐 WorkBuddy）**：

```
- SVG viewBox 必须以 "0 0 680" 开头（如 0 0 680 400）
- 节点用圆角矩形 rx=8，填充 var(--accent-soft)，描边 var(--accent)
- 连线用 marker 箭头（stroke var(--text-3)）
- 单图最多 7 个节点，超过拆多图
- 节点文字 font-size 14，fill var(--text)
- 标签 font-size 12，fill var(--text-3)
- 标题 font-size 20 bold，fill var(--text)
```

**chart 模块 rules**：

```
- 系列颜色统一用 var(--accent) / var(--green) / var(--amber) / var(--red)
- 坐标轴必须标注，轴文字 fill var(--text-3)
- 网格线 stroke var(--border)，细线
- 数值标签 font-size 12，fill var(--text-2)
- 数据源文字标注在图底部
```

**mockup / interactive / art 模块**：类似结构，mockup 强调容器与间距（width 680，padding 24，圆角 var(--r)），interactive 允许 `<script>` 且注明事件命名规范，art 只约束 viewBox 与变量使用。

### 4.5 系统提示注入（engine.ts）

在 `SYSTEM_PROMPT` 的 `<result_presentation>` 后新增 `<visualization>` 段：

```
<visualization>
你可以在回答中直接内联可视化内容（SVG 图表 / HTML widget），它们会渲染在对话流中：
- read_me(modules=["diagram", ...])：首次 show_widget 前必须调用，获取设计指引（CSS 变量、布局规则）；换模块时再调用。这是内部准备步骤，不要向用户提及。
- show_widget(title, widget_code, loading_messages)：渲染可视化 widget。
- widget_code 必须是纯 SVG/HTML 片段：SVG viewBox 以 "0 0 680" 开头；HTML 不含 <html>/<head>/<body>/<!DOCTYPE>。
- 颜色一律用 CSS 变量（var(--accent)、var(--text)、var(--text-3) 等），绝不硬编码十六进制颜色。
- 复杂主题拆成多个小 widget（每个 ≤7 节点），中间用文字串联叙事。
- 需要强调的数据变化、对比、分布，优先用图表而非文字表格。
</visualization>
```

同时 `buildSystemPrompt` 与 `systemPromptForPlatform` 无需改动（SYSTEM_PROMPT 单一入口自动带上）。

### 4.6 工具注册（tools/index.ts）

`getFullTools` 与 `getReadOnlyTools` 各追加：

```typescript
import { readMeTool } from "./read_me.ts";
import { showWidgetTool } from "./show_widget.ts";

// getFullTools return 数组内（presentFilesTool 附近）：
readMeTool,
showWidgetTool,

// getReadOnlyTools return 数组内：
readMeTool,
showWidgetTool,
```

两个工具均无文件写入副作用，不参与 `protectWritableTool` 包装。

---

## 5. 前端设计

### 5.1 store 变更（useStore.ts）

**Message 接口**新增可选字段：

```typescript
export interface WidgetData {
  title: string;
  widget_code: string;
  module?: string;
  loading_messages?: string[];
}

export interface Message {
  // ...现有字段
  widget?: WidgetData;   // 实时路径：tool_execution_end 注入
}
```

**handleEvent 的 tool_execution_end 分支**追加（现 present_files 分支旁）：

```typescript
// show_widget 交付：widget 数据注入消息，随消息流内联渲染
if (!ev.isError && ev.toolName === "show_widget") {
  const widget = ev.output?.details?.widget as WidgetData | undefined;
  if (widget?.widget_code) {
    patch.messages = (msgs).map((m) =>
      m.id === ev.toolCallId ? { ...m, widget } : m
    );
  }
}
```

**重载路径**：ChatArea 渲染时对 `toolName === "show_widget"` 的消息尝试 JSON.parse content 取 `details.widget`（同 `parsePresentedFiles` 模式，见 §7）。

### 5.2 消息渲染（ChatArea.tsx）

`groupToolMessages` 追加分支（present_files 旁）：

```typescript
// show_widget 独立渲染内联 widget，不进"已处理"折叠记录
if (message.toolName === "show_widget" && !message.isError) {
  flushTools();
  items.push({ kind: "widget", id: `widget-${message.id}`, message });
  continue;
}
```

`ChatRenderItem` 新增 `{ kind: "widget"; id; message }`。

渲染位置效果：

```
[user] 帮我画一个系统架构图
[assistant] 好的，我来画一下 API 与数据库的架构。
[tool-group] 运行了 2 个操作 (read_me, show_widget)   ← read_me 折叠进工具记录
[widget]  ┌──────────────────────────────┐
         │  System Architecture         │
         │  [内联渲染的 SVG 图表]        │
         └──────────────────────────────┘
[assistant] 如图所示，请求先经过 API 层，再落到数据库……
```

read_me 调用留在工具折叠记录里（内部准备步骤），show_widget 单独成块。

### 5.3 WidgetRenderer 组件（新）

```
frontend/src/components/WidgetRenderer.tsx  # 渲染器（SVG 内联 / HTML iframe）
frontend/src/components/WidgetRenderer.css  # widget 卡片样式
```

```tsx
interface WidgetRendererProps {
  widget: WidgetData;
}

function WidgetRenderer({ widget }: WidgetRendererProps) {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [msgIndex, setMsgIndex] = useState(0);

  // 1. loading 过渡：loading_messages 依次轮换（每条约 700ms），缺省显示"正在渲染…"
  // 2. 检测类型：
  //    widget_code.trimStart().startsWith("<svg") → SVG 内联渲染（sanitize 后注入）
  //    否则 → HTML iframe（srcdoc + sandbox，注入主题变量快照）
  // 3. 渲染失败 → error 态（显示错误 + 复制原始代码按钮）

  return (
    <figure className="widget-card">
      <figcaption className="widget-header">
        <span className="widget-title">{widget.title}</span>
        <button onClick={copyCode}>复制代码</button>
      </figcaption>
      {phase === "loading" ? <LoadingMsgs messages={...} /> : phase === "error" ? <ErrorBox /> : <WidgetBody />}
    </figure>
  );
}
```

**SVG 内联渲染**（推荐，主题自动跟随）：

```typescript
function renderSvg(code: string): string {
  // DOMParser 解析 → 白名单校验（见 §6）→ 序列化
  const doc = new DOMParser().parseFromString(code, "image/svg+xml");
  const svg = doc.documentElement;
  sanitizeNode(svg);          // 递归剥离 script / 事件属性 / javascript: URL
  return svg.outerHTML;       // 注入容器，宿主 CSS 变量天然可用
}
```

**HTML iframe 渲染**：

```tsx
<iframe
  className="widget-frame"
  sandbox="allow-scripts"           // 无 allow-same-origin / allow-top-navigation / allow-popups
  srcdoc={buildSrcdoc(widget.widget_code)}  // widget_code + 内联主题变量 :root 快照
  onLoad={autoFitHeight}            // 读 contentDocument.body.scrollHeight 自适应高度
/>
```

**主题切换跟随**：App 层监听 `theme` 变化 → iframe 重渲染（`key={theme}` 强制重建）；SVG 内联无需处理（CSS 变量自动生效）。

### 5.4 主题变量快照注入（HTML iframe）

iframe 的 srcdoc 不继承宿主 CSS 变量，需显式注入。从 `getComputedStyle(document.documentElement)` 收集 `--` 前缀变量生成快照：

```typescript
function buildSrcdoc(widgetCode: string): string {
  const styles = getComputedStyle(document.documentElement);
  const vars = Array.from({ length: styles.length }, (_, i) => styles.item(i))
    .filter((name) => name.startsWith("--"));
  const cssVars = vars
    .map((name) => `${name}: ${styles.getPropertyValue(name)};`)
    .join("\n");
  return `<!DOCTYPE html>
<html><head><style>
  :root { ${cssVars} }
  body { margin: 0; font-family: var(--font); background: var(--bg); }
</style></head>
<body>${widgetCode}</body></html>`;
}
```

### 5.5 多 widget 叙事流

同 WorkBuddy：不限制每轮 show_widget 次数。模型按"文字 → widget → 文字"节奏组织回复，前端按消息顺序自然呈现。无需额外状态。

---

## 6. 安全设计

模型生成的代码不可信，渲染前必须校验/隔离：

### 6.1 SVG 内联 — 白名单净化

```typescript
const SVG_TAGS = new Set(["svg", "g", "rect", "circle", "ellipse", "line", "path",
  "polygon", "polyline", "text", "textPath", "tspan", "defs", "marker", "linearGradient",
  "radialGradient", "stop", "use", "clipPath", "filter", "pattern", "title", "desc", "style"]);
const SVG_ALLOWED_ATTRS = /^(x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|d|points|fill|fill-opacity|stroke|stroke-width|stroke-opacity|opacity|font-size|font-weight|font-family|text-anchor|transform|viewBox|preserveAspectRatio|xmlns|marker-end|marker-start|gradientUnits|offset|stop-color|style)$/;

function sanitizeNode(node: Element): boolean {
  if (!SVG_TAGS.has(node.tagName.toLowerCase())) return false;  // 丢弃未知标签（含 script）
  for (const attr of Array.from(node.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on")) { node.removeAttribute(attr.name); continue; }  // 事件属性
    if (name === "href" || name === "xlink:href") {
      if (!/^#/.test(attr.value)) { node.removeAttribute(attr.name); continue; } // 只允许内部引用
    }
    if (!SVG_ALLOWED_ATTRS.test(name)) node.removeAttribute(attr.name);
  }
  Array.from(node.children).forEach((child) => { if (!sanitizeNode(child as Element)) child.remove(); });
  return true;
}
```

注意：`dangerouslySetInnerHTML` 只用于 **净化后** 的 SVG 字符串；HTML widget 一律走 iframe，绝不内联。

### 6.2 HTML widget — sandbox iframe

```
sandbox="allow-scripts"
- 无 allow-same-origin → 脚本拿不到宿主 DOM / cookie / localStorage
- 无 allow-top-navigation → 不能跳转页面
- 无 allow-popups → 不能弹窗
- script 可运行（interactive 模块需要），但被锁在隔离环境
```

若后续需要"导出为文件"功能，widget 可加"在新标签预览"按钮（通过 preload 的 window.open 或保存到磁盘），仍需走现有 `openFileInSystem` 通道。

### 6.3 其他

- `widget_code` 长度上限 8KB（show_widget execute 校验，超出报错），防 prompt 膨胀与巨型 DOM
- loading_messages 最多 4 条，每条 ≤ 40 字符

---

## 7. 持久化与重载

### 7.1 现状缺口（必须补）

当前持久化链路 `getToolOutputString`（application.electron.ts / provider.ts / useStore.ts 三处同名函数）只保留 `content` 中的 text，**details 全部丢弃**。present_files 的重载依赖 `content` 恰好为 JSON（详情见 §2 双源模式）。

show_widget 的重载必须保留 `details.widget`，做法（对齐 present_files 已验证模式）：

**持久化钩子**（application.electron.ts `getQueue` 订阅、provider.ts `attachPersistence` 两处）对 `tool_execution_end` 追加：

```typescript
} else if (event.type === "tool_execution_end") {
  const toolCallId = (event as any).toolCallId;
  const argsStr = toolCallId ? toolArgsMap.get(toolCallId) : undefined;
  if (toolCallId) toolArgsMap.delete(toolCallId);
  const output = (event as any).output;
  const isWidget = (event as any).toolName === "show_widget" && !(event as any).isError;
  // 富交付工具（show_widget）存完整 JSON（含 details.widget），其余保持 text
  const outputStr = isWidget
    ? JSON.stringify(output)
    : getToolOutputString(output);
  appendMessage(sessionId, "tool", outputStr, {
    toolName: (event as any).toolName,
    toolArgs: argsStr,
    isError: (event as any).isError,
  });
}
```

（`getToolOutputString` 对纯 JSON 的兼容处理见 7.3。）

### 7.2 前端双源解析（对齐 parsePresentedFiles）

ChatArea 渲染 widget 块时：

```typescript
function parseWidgetData(message: Message): WidgetData | undefined {
  if (message.widget) return message.widget;          // 实时路径（store 注入）
  if (message.content) {
    try {
      const parsed = JSON.parse(message.content);
      const widget = parsed?.details?.widget;
      if (widget?.widget_code) return widget;         // 重载路径（DB JSON）
    } catch { /* 实时路径 content 为纯文本 */ }
  }
  return undefined;
}
```

### 7.3 兼容性

- 实时路径下 message.content 仍是纯文本（SSE 事件未持久化时前端内存状态），渲染走 `message.widget`
- 重载路径下 content 是 JSON，`parseWidgetData` 解析 details.widget
- 若 widget 缺失（旧数据），渲染块显示占位"（可视化内容不可用）"而非崩溃

---

## 8. 数据流全链路

```
agent 生成
  read_me(modules=["diagram"]) → details.guides（设计指引）
  show_widget(title, widget_code, loading_messages)
    │
    ▼ execute 返回
  { content: [{type:"text", text}], details: { widget: {...} } }
    │
    ▼ AgentHarness（pi-agent-core agent-loop）
  tool_execution_end { toolName: "show_widget", result, isError }
    │
    ▼ normalizeHarnessEvent（src/agent/engine.ts）
  { ...event, output: result }   // details 随 output 透传
    │
    ├─→ application.electron.ts getQueue 订阅
    │      ├─ 持久化：JSON.stringify(output)（show_widget 特例）
    │      └─ 入队 → SSE /api/events/:id/stream
    │
    ▼ 前端 useStore handleEvent（tool_execution_end）
  message.widget = output.details.widget
    │
    ▼ ChatArea groupToolMessages → kind: "widget"
  WidgetRenderer
    ├─ SVG 片段 → sanitize → 内联注入（CSS 变量自动跟随主题）
    └─ HTML 片段 → srcdoc iframe（注入主题变量快照 + sandbox）
```

---

## 9. 实施计划

遵循项目"先跑通最小端到端，再往上加"原则，分四个阶段：

### 阶段一：后端工具（零前端依赖，可独立测试）

- [ ] `design_guides.ts`：五模块指引 + 变量语义表
- [ ] `read_me.ts`：readMeTool
- [ ] `show_widget.ts`：showWidgetTool（8KB 校验 + 返回 details.widget）
- [ ] `tools/index.ts`：getFullTools / getReadOnlyTools 注册
- [ ] `engine.ts`：SYSTEM_PROMPT 注入 `<visualization>` 段

验证：`npx tsc --project tsconfig.electron.json --noEmit`；用 API 层测试工具（mock 会话调用 read_me/show_widget 检查返回结构）。

### 阶段二：持久化

- [ ] application.electron.ts / provider.ts 持久化钩子：show_widget 存完整 JSON
- [ ] 回归确认 present_files 行为不变（双源解析兼容）

验证：跑一轮 present_files 测试 + 一轮 show_widget 测试，查 DB content 格式。

### 阶段三：前端渲染

- [ ] `useStore.ts`：Message.widget 字段 + handleEvent show_widget 分支
- [ ] `WidgetRenderer.tsx` + `.css`：SVG 内联（sanitize）/ HTML iframe（srcdoc + 变量快照 + 自适应高度）
- [ ] `ChatArea.tsx`：groupToolMessages `kind: "widget"` 分支 + parseWidgetData
- [ ] 主题跟随：theme 变化时 iframe 重建

验证：`cd frontend && npx tsc --noEmit`；手动触发 mock widget 检查渲染。

### 阶段四：E2E 验证

- [x] 让模型画架构图 / 柱状图 / 流程图 / 对比表，验证 read_me → show_widget 全链路
- [x] 刷新会话验证重载恢复
- [x] 切换深色主题验证 widget 变色
- [x] XSS 注入测试（widget_code 带 `<script>` / onload 属性 → 不执行）
- [x] 清理测试会话

---

## 10. 验证方案

### 10.1 提示词样例（E2E 手测）

1. "画一个 API、Cache、Database 的系统架构图" → 期望 read_me(diagram) → show_widget(SVG)
2. "用柱状图比较 Python、Go、Rust 的性能" → 期望 read_me(chart) → show_widget(SVG)
3. "把 agent 循环画成流程图" → 期望多节点 SVG
4. "做一个 REST vs GraphQL 的对比 widget" → 期望 HTML widget（表格 + 样式）
5. "分三步讲解这个系统，每步配一张图" → 期望多 widget 叙事（文字 → widget × 3）

### 10.2 断言清单

| 检查项 | 断言 |
|--------|------|
| read_me 前置调用 | show_widget 出现前有 read_me 调用记录 |
| widget_code 合法 | SVG 以 `<svg` 开头且 viewBox `0 0 680` 开头；HTML 无 DOCTYPE/html/head/body |
| 渲染成功 | 对话流中出现 widget 卡片，SVG 图形可见 |
| 主题感知 | 切深色主题后 widget 文字/线条颜色变化（SVG 自动；iframe 重建） |
| 重载 | 刷新页面后 widget 仍渲染 |
| 安全 | widget_code 含 `<script>`/`onclick` 时不执行、无 console 错误 |
| 回归 | present_files / 预览面板 / 消息流无回归（0 console errors） |

---

## 11. 风险与边界

| 风险 | 影响 | 对策 |
|------|------|------|
| 模型生成的 SVG 易错位、不可维护 | 图表质量参差 | read_me 强约束（固定 viewBox、≤7 节点、圆角矩形、箭头 marker）；多 widget 叙事优于单图硬塞 |
| HTML widget 注入恶意脚本 | 安全 | sandbox iframe 隔离；SVG 白名单净化；事件属性剥离 |
| 持久化丢 details | 重载后 widget 消失 | 阶段二补齐（show_widget 存完整 JSON）；双源解析兜底 |
| iframe 不跟随主题切换 | 深色主题下白底刺眼 | 注入变量快照 + theme 变化重建 |
| widget_code 过大 | token 浪费、DOM 卡顿 | 8KB 上限校验 |
| 模型忘记 read_me | 颜色乱用、风格不统一 | 系统提示强约束 + 工具描述 MUST 语义；渲染端对裸十六进制颜色仍可渲染（不阻断） |

---

## 附录：与 WorkBuddy 的差异点

| 维度 | WorkBuddy | 本项目设计 | 理由 |
|------|-----------|-----------|------|
| 主题感知 | 后端返回色板（get_theme_colors） | CSS 变量引用（var(--xxx)），前端宿主解析 | 复用现有 appStore tokens；切主题自动变色；后端零色板维护 |
| 渲染安全 | 未公开细节 | SVG 白名单净化 + HTML sandbox iframe | 模型代码不可信，必须隔离 |
| 持久化 | 未公开细节 | 双源模式（实时 details + DB JSON） | 沿用 present_files 已验证模式 |
| 模块系统 | diagram/mockup/interactive/chart/art | 同（5 模块） | 对齐，便于复用指引设计 |
