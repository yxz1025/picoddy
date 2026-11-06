# 内置 Markdown HTML 预览设计

## 目标

点击聊天产物中的 `.md` 或 `.markdown` 文件时，在当前 Electron 应用右侧预览面板内直接显示完整 Markdown 渲染结果。该能力属于项目内置能力，不依赖在线安装的 Pi 插件、不执行 `/preview` 命令、不打开系统外部浏览器。

## 现状

当前产物预览已经通过 `artifactPresentation` 按扩展名选择渲染器，Markdown 使用 `MdPreview`，由前端读取 `/api/preview` 后通过 `react-markdown` 和 `remark-gfm` 渲染。插件宿主只加载 Agent Tool，不能直接把 Pi 的 TUI 命令或浏览器窗口接入 React 预览面板。

## 设计

### 渲染链路

```text
点击 Markdown 产物
  → PreviewPanel 继续选择 MdPreview
  → 请求内置 Markdown 预览接口
  → Markdown 解析为安全 HTML
  → 在当前右侧面板的受控容器中渲染
```

Markdown 解析采用通用 Markdown AST/HTML AST 管线，而不是手写全部 AST 到 React 节点的映射。标准语法和 GFM 由解析器处理；代码高亮、数学公式、Mermaid 等扩展通过独立插件或自定义节点处理；未扩展节点沿用标准 HTML 映射。

### 能力范围

- CommonMark 和 GFM：标题、列表、嵌套列表、引用、链接、图片、表格、任务列表、删除线、脚注、自动链接。
- 代码块和常见语言高亮。
- Mermaid 图表。
- LaTeX 行内公式和块级公式。
- YAML/TOML Front Matter 的解析或安全忽略。
- Markdown 中的 HTML 经过白名单清洗，不执行任意脚本。
- 相对图片路径按 Markdown 文件所在目录解析。
- 暗色主题、长文档滚动、标题锚点和目录能力。

### 后端与前端边界

后端负责读取工作区文件、解析 Markdown、处理相对资源路径和安全策略，并返回稳定的预览数据。前端 `MdPreview` 负责加载状态、错误状态和 HTML 展示，不负责文件系统读取。

预览输出默认不落盘为 `.html` 文件。需要导出时再复用同一渲染管线生成独立 HTML；本次实现不包含导出功能。

### 安全策略

- 禁止 Markdown 内容执行 JavaScript。
- HTML 标签、属性、URL 协议采用白名单过滤。
- 相对资源只能访问当前 Markdown 文件允许的资源范围。
- Mermaid 和公式渲染失败时只降级当前块，不影响整篇文档。
- 插件安装状态不参与 Markdown 预览判定。

### 回退策略

内置 HTML 渲染失败时，保留当前 `react-markdown` 渲染作为回退；文件读取失败、空文件和非法内容分别显示明确状态。

## 测试与验收

- 类型分流：`.md` 和 `.markdown` 仍进入 Markdown 预览，其他文件渲染器不受影响。
- CommonMark/GFM：嵌套列表、表格、任务列表、脚注、引用和链接正确渲染。
- 扩展能力：代码高亮、Mermaid、LaTeX 分别验证成功和失败降级。
- 安全性：脚本标签、事件属性和危险 URL 不会执行或穿透过滤。
- 资源：相对图片能够正常加载，越权路径被拒绝。
- 交互：点击聊天产物后在当前右侧面板显示，不弹出外部浏览器。
- 回归：PDF、DOCX、表格、PPTX、图片、视频和文本预览保持现有行为。

## 非目标

- 不接入 `pi-markdown-preview` 的 TUI 命令。
- 不使用 Chromium 截图作为右侧面板内容。
- 不实现 MDX/JSX 执行能力。
- 不在本次实现中增加 PDF 或 HTML 导出按钮。
