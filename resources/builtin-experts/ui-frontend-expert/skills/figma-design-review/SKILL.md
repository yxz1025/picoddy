---
name: figma-design-review
description: Read actual Figma design context and review requirements, visual structure and interaction states against an existing frontend repository.
---

# 设计读取与评审

适用：用户要求读取、评审或还原设计。仅询问连接器用法时直接回答已知步骤，不要求生成设计文件。

1. 确定需求资产、验收条件、目标页面、设计节点和用户请求范围。多个候选节点或连接器无法判定时请用户选择，不随意取第一个。
2. 通过宿主发现实际连接器工具及参数。存在 `requirement_preview` 的绑定目标时，用 `designTools`、`readDesign` 保留本轮读取凭据；其他环境使用真实可用的只读设计工具。
3. 按需读取节点结构、尺寸、布局、文字、图片、变量、组件与截图。有 Code Connect 映射时核对仓库实际组件是否存在，不把映射视作已验证兼容性。
4. 若桌面连接器支持读取当前选区，在范围明确时使用选区；远程模式或其他工具需要 URL／节点 ID 时准确提供。MCP 是读取通道，URL 是定位信息，二者不互相替代。
5. 核对业务路径、信息层次、响应式布局、控件状态、反馈、键盘与触摸操作。Figma 静态截图无法证明完整原型交互已读取，缺失内容必须说明。
6. 将问题分为影响主流程、影响体验和视觉细节，逐项写出需求／设计／代码位置、观察证据及建议。无证据的问题标记待确认，不给虚假的评分或通过结论。

连接失败时报告工具原始错误的安全摘要，不重复无意义重试。是否使用截图替代应符合用户授权；替代来源不满足宿主要求的 Figma 读取凭据时，明确交付登记受阻。

需要文件评审报告时使用 `../interactive-delivery/references/review-template.md`，不需要文件时直接在会话中说明。
