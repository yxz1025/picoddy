# Markdown 代码块高亮与复制设计

## 目标

让 assistant 正文中的多行代码统一使用带语言标识的 Markdown fenced code block，并在聊天界面提供语法高亮和复制功能。

典型输入：

````markdown
```java
public class McpController {
}
```
````

## 范围

包含：

- assistant 正文中的 fenced code block。
- 语言标签、语法高亮、复制原始代码。
- 浅色和深色主题。
- 流式输出期间的轻量降级。
- 未知语言与无语言标签代码块的安全回退。

不包含：

- 行号。
- 在线运行代码。
- 代码编辑器能力。
- 自动修改用户输入。
- 将 Visualizer 的 `widget_code` 重复展示为 Markdown 代码。

## 输出规范

系统提示增加以下规则：

- 多行代码、配置、脚本和查询必须使用 fenced code block。
- 围栏必须提供准确语言标识，例如 `java`、`xml`、`yaml`、`json`、`sql`、`bash`。
- 单个类名、方法名、字段名、命令参数使用单反引号内联代码。
- 不把多行代码直接混入普通段落。
- Visualizer 继续通过 `show_widget` 展示，不在正文重复输出其 SVG/HTML 源码，除非用户明确要求查看源码。

## 前端架构

### `CodeBlock` 组件

新增 `frontend/src/components/CodeBlock.tsx`，职责单一：

- 接收 `language`、`code`、`streaming`。
- 显示语言名称和复制按钮。
- 复制时只写入原始代码，不含 Markdown 围栏。
- 复制成功后显示约 1.5 秒的成功状态。
- 未知语言或无语言标签时渲染普通等宽文本。
- 不使用 `dangerouslySetInnerHTML`。

### Markdown 接入

`ChatArea` 继续使用 `ReactMarkdown + remarkGfm`。

- 覆盖 `pre` 渲染器，从其唯一 `code` 子节点读取 `className="language-xxx"` 和文本。
- fenced code block 交给 `CodeBlock`。
- 内联 `code` 保留现有样式和行为。
- 非标准 `pre` 内容回退到原生 `<pre>`，避免破坏未知 Markdown 插件输出。

### 高亮引擎

使用 `react-syntax-highlighter` 的 `PrismLight`：

- 作为前端直接依赖安装，不复用 `pi-coding-agent` 私有传递依赖。
- 按需注册语言，避免引入完整语言包。
- 首批语言：Java、Kotlin、XML/HTML、YAML、JSON、SQL、Bash/Shell、JavaScript、TypeScript/TSX、Python、Go、Rust、CSS、Markdown。
- 提供别名映射，例如 `sh → bash`、`yml → yaml`、`html → xml`、`js → javascript`、`ts → typescript`。
- 未注册语言回退为纯文本，不触发运行时异常。

## 主题

- 代码块背景、边框、标题栏和普通文字继续使用项目 CSS 变量。
- Prism token 使用 CSS class 配色，不使用组件内固定主题对象。
- `data-theme="dark"` 下覆盖 token 颜色，实现浅色、深色即时切换。
- 不因主题切换重新解析 Markdown 内容。

## 流式行为

assistant 流式输出会频繁重新渲染。为避免每个 token 都执行语法解析：

- `streaming=true` 时显示普通代码块、语言标签和复制按钮。
- `message_end` 后 `streaming=false`，再启用 Prism 高亮。
- 未闭合的 fenced code 由 `react-markdown` 按现有行为处理，不额外猜测或修复 Markdown。

## 错误与边界

- 剪贴板 API 失败时使用现有 DOM textarea 复制回退模式。
- 高亮器不支持某语言时显示纯文本。
- 代码内容按 React 文本节点渲染，不执行其中的 HTML 或脚本。
- 超长代码块保持横向滚动；不截断、不折叠、不改变复制内容。
- 复制按钮必须有 `aria-label`，复制结果通过可访问状态文字反馈。

## 文件变更

- 新增：`frontend/src/components/CodeBlock.tsx`
- 修改：`frontend/src/components/ChatArea.tsx`
- 修改：`frontend/src/components/ChatArea.css`
- 修改：`frontend/package.json`
- 修改：`frontend/package-lock.json`
- 修改：`src/agent/engine.ts`

## 验收标准

- `java`、`xml`、`yaml`、`json`、`sql` 和 `bash` fenced code 正确高亮。
- 复制按钮复制的内容与代码块原始文本完全一致，不含围栏和尾部解析附加换行。
- 内联代码样式不变。
- 未知语言不会报错，并显示普通代码。
- 流式阶段不启用语法高亮，结束后自动高亮。
- 浅色、深色主题下均清晰可读。
- assistant 被系统提示要求使用带语言标识的 fenced code。
- 前端生产构建、类型检查和 lint 不新增错误。

## 测试策略

根据当前要求暂不新增单元测试。实施后使用以下验证：

- 前端 TypeScript 与生产构建。
- lint。
- 用包含 Java、XML、YAML、SQL、未知语言和无语言标签的 Markdown 做浏览器冒烟验证。
- 分别检查流式态、完成态、浅色主题、深色主题和复制结果。
