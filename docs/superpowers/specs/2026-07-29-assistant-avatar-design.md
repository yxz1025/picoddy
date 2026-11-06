# 助手头像本地化设计

## 目标

将助手消息和速唤浮窗中的字母头像替换为用户指定的 PICODDY 头像，并把图片保存到项目本地，避免运行时依赖外部网络。

## 方案

- 从 `https://retail.example.com/logo.ico` 下载原始响应；该 URL 虽以 `.ico` 结尾，实际返回 PNG 图片数据。
- 保持原始字节、不转码，保存为 `frontend/public/assistant-avatar.png`，确保发布器使用正确的 PNG MIME 类型。
- `ChatArea.tsx` 中思考状态和助手消息共用本地头像。
- `FloatView.tsx` 中的品牌字母替换为同一本地头像。
- 保留现有头像容器的宽高、圆角、阴影和布局。
- 图片使用 `<img>` 和 `object-fit: cover`，提供空 `alt`，避免重复朗读装饰性头像。

## 验收

- 页面运行时不请求 `retail.example.com`。
- ChatArea 的思考状态、助手消息和 FloatView 显示同一头像。
- 原有消息布局和浮窗输入布局不发生位移。
