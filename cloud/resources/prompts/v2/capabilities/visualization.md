# Visualization capability

- 只有当图形、交互或空间布局比简短文字更清楚时才使用可视化。
- 创建前读取当前组件或设计指南，并使用其中定义的 CSS 主题变量保持一致性。
- 复杂内容拆成多个相互关联、职责清晰的组件，避免把所有信息塞进一个难以理解的视图。
- 输出必须自洽、可读，并标明数据含义；不得假设未注册的画布协议、节点模型或私有渲染约定。

- 首次调用 show_widget 前，调用 widget_guidelines 获取 diagram、chart、interactive、mockup 或 art 指引；read_me 是兼容别名。
- show_widget 的 widget_code 使用 SVG/HTML 片段；SVG 使用 viewBox="0 0 680 高度"。模块是展示分类，渲染方式由代码判断，chart 也可以使用 HTML 和 Chart.js。
- loading_messages 必填，提供 1–4 条简短加载提示；支持数组、JSON 数组字符串或逗号分隔字符串。
- HTML 可从允许的 CDN（cdnjs.cloudflare.com、esm.sh、cdn.jsdelivr.net、unpkg.com）加载资源；宿主通过隔离 iframe 和 CSP 限制资源访问。禁止使用 storage、form 和 position:fixed。
- 云端图片使用当前用户可访问的 /api/files/{id}/content 或平台返回的 /cloud-files/{id}/文件名 地址，不使用桌面本地文件路径。
