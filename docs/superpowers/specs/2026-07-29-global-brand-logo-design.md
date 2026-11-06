# 全局品牌 Logo 替换设计

## 目标

使用 `frontend/public/assistant-avatar.png` 作为 Pi-a 唯一品牌源图，替换界面、浏览器和桌面应用中的旧 π Logo，并消除透明区域透出的蓝色容器背景。

## 替换范围

- ChatArea 思考状态和助手消息头像。
- FloatView 品牌头像。
- Sidebar 顶部品牌 Logo。
- SettingsModal 关于页 Logo。
- 浏览器 favicon、alternate icon 和 Apple Touch Icon。
- 前端 128、512、1024 像素应用图标。
- Deno Desktop 使用的 `resources/app-icon.png`。
- macOS `resources/app-icon.iconset` 和 `resources/app-icon.icns`。

不替换：

- 微信、钉钉、飞书等第三方平台 Logo。
- 用户头像。
- 专家头像。
- 技能卡片图标。

## 实现

- `PiLogo.tsx` 保留原组件接口，内部改为引用 `/assistant-avatar.png` 的 `<img>`，避免修改所有调用方。
- `.assistantAvatar` 和 `.float-brand` 移除蓝色渐变背景，使用透明背景；图片继续继承现有尺寸和圆角。
- `frontend/index.html` 使用 PNG favicon，不再优先加载旧 `favicon.svg`。
- `scripts/generate-icon.py` 改为从品牌源 PNG 读取并用 Lanczos 生成各尺寸图标，确保以后重新生成不会恢复旧 π 图标。
- 生成的桌面图标保持透明背景，不添加蓝色底板、渐变或阴影。
- 使用 `iconutil` 从更新后的 iconset 重新生成 ICNS。

## 验收

- 项目运行时代码中不再渲染旧 `PiLogo` SVG 图形。
- 聊天头像和浮窗透明区域不再显示蓝色底部。
- Sidebar、设置页、favicon 和桌面应用图标显示同一 PICODDY Logo。
- 所有派生 PNG 尺寸正确，ICNS 可被系统识别。
- 前端构建和 lint 通过。
