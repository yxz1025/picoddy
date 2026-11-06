# 可视化保真修复与表现形式改进

## 目标

参考本机 `/Applications/WorkBuddy.app/Contents/Resources/app.asar` 的实际代码，让会话可视化保留原始几何形状，并根据内容选择合适的视觉形式。

## 已确认的证据

- `frontend/src/components/widgetExport.ts` 的 `prepareSvgForPng` 全局删除 width/height 属性。用带 120×60 rect 和 24×24 内嵌 SVG 的输入执行后，两者尺寸均消失；应只修改根 SVG 的输出像素尺寸。
- `WidgetRenderer.tsx` 手写清洗白名单缺少 markerUnits、patternUnits、patternTransform、maskUnits、clipPathUnits、vector-effect 等属性，会改变箭头、图案、遮罩与描边的渲染语义；style 标签也被完全删除。
- SVG 被直接注入宿主文档。多个组件使用同名 marker/gradient/clipPath ID 时，片段引用可能跨组件解析。
- `.widget-svg svg` 的宽高规则同时作用于内嵌 SVG，应只作用于根 SVG，内部图标保持原始尺寸。
- `design_guides.ts` 指定所有流程节点采用相同圆角矩形和强调色，没有根据内容选择结构图、原理示意、时间线或交互步骤的规则；所有图表强制 SVG，代码限制为 8192 字符。

## 本机 WorkBuddy 参考

从当前安装包提取的 server.js 中，`rEe` 提供公共设计系统、9 组色阶、SVG 规则及按模块加载的图形指引；`uEe` 注册 show_widget，`lEe` 校验片段和 680 宽 viewBox。

其图形指引区分流程图、结构图、原理示意和 HTML stepper；图表指引包含 Chart.js 与 D3。其前端 `aS` 使用 DOMPurify 的 SVG / SVG filters profile，禁止 script 和 foreignObject，并保留标准 SVG 属性。应借鉴这些设计原则，具体工具名称和网络能力仍按本项目约束实现。

## 已批准范围更新

用户随后要求完全按本机 WorkBuddy 设计开发。参考版本为 WorkBuddy Desktop 5.7.7。实施范围已包含四个公共 CDN、Chart.js/D3 指引、点击追问、本地图片端点适配、SVG/HTML 自动识别和 HTML/Canvas 截图导出；移除原先 8KB 与硬编码颜色限制。以下方案选择保留为最初讨论记录，以本段更新为准。本项目继续使用现有 IPC 与会话持久化适配，不复制腾讯私有服务和遥测。

## 最初方案选择

1. **推荐：先保真修复，再完善本地视觉设计契约。** 修复导出和清洗，隔离 SVG 样式及 ID，补齐多形态设计指引与色阶，支持自包含的 HTML 图表。无需引入外部 CDN。
2. 仅修复渲染：改动最小，但视觉形式单一的问题仍存在。
3. 全面复制 WorkBuddy 的 CDN 图表与宿主交互协议：能力更广，但涉及 CSP、联网和宿主消息协议，超出本次核心问题。

## 推荐设计

### 渲染与导出

- PNG 栅格化仅重写根 SVG 的 width/height；保留所有子元素尺寸、viewBox 和几何属性。
- 采用成熟 SVG 清洗能力，保留标准几何、marker、渐变、pattern、mask 和 clipPath 语义；脚本、事件和外部资源继续按当前边界处理。
- 每个 SVG 在独立渲染文档内显示，注入主题与基础视觉样式，防止宿主 CSS、组件样式与重复 ID 相互影响；外层按 viewBox 比例分配高度，宽度变化时等比缩放。HTML 继续使用现有沙箱。
- 导出与会话显示共用主题和基础样式，避免会话正常、下载后失去类样式。基础样式显式内联到独立 SVG 文档。
- 无法解析的内容呈现明确错误，保留复制原始代码入口。

### 生成端

- 固定 680 宽作为坐标基准，按最底元素计算高度；不改变工作坐标，不使用非等比拉伸。
- 添加图形选择规则：流程用顺序/分支图，包含关系用结构图，机理解释用原理示意，循环步骤用交互 stepper，对比用卡片，变化趋势与分布选择对应数据图表。
- 提供一套统一的文字、节点、连线、辅助线和语义色阶样式，减少模型重复编写样式。节点形状表达语义：处理、判断、存储、输入输出分别选择合适形状。
- 给出完整箭头 marker 示例：显式 viewBox、refX/refY、markerUnits、方向和尺寸；连接路径必须 fill="none"，避免折线路径被填成多边形。
- 中文节点按实际字符宽度预留空间并使用 tspan 换行；连线从节点边界起止，先画连线再画节点，避免箭头穿过文字。
- chart 接受 SVG 或自包含 HTML/Canvas；Canvas 主题色从计算样式解析。保留现有离线运行方式。
- 代码上限调整为 32KB，让复杂图和交互拥有合理空间；颜色规则允许定义组件色阶，普通界面仍优先使用主题语义变量。

## 验收

- 回归测试首先证明当前导出会删除子元素尺寸，修复后保留 rect、嵌套 SVG、marker 等全部尺寸。
- 浏览器验证：markerUnits、自定义 pattern、遮罩、内嵌图标、同名 marker 的多组件场景，在宽窄容器和浅深主题下保持几何与颜色。
- 比较会话显示与 SVG/PNG 下载结果，确认文字、箭头和基础类样式一致。
- 验证原有 HTML 交互仍可工作，新增 chart HTML 路由与校验一致。
- 运行相关测试和前端构建；记录无法验证的环境限制。

## 范围

本次包含渲染与导出修复、设计指引和必要的工具约束调整。外部 CDN、远程数据加载、地图服务和新宿主交互协议留待独立需求。
