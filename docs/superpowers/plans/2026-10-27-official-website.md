# PiCoddy Official Website Implementation Plan

**Goal:** 实现用户已确认的中文产品官网。

**Architecture:** website/ 为独立、无构建步骤的静态站。HTML 提供语义结构与默认内容，CSS 管理响应式与视觉，JS 仅负责演示切换和移动导航。

**Tech Stack:** HTML, CSS, JavaScript; Python HTTP server for local preview.

- [ ] 创建 website/index.html：导航、首屏、示意工作台、能力、模型与权限、启动步骤、FAQ、页脚。
- [ ] 创建 website/styles.css：暖白背景、绿色点缀、响应式双栏工作台、移动导航、焦点与 reduced-motion。
- [ ] 创建 website/app.js：四类任务演示、键盘切换、导航开关与复制启动命令。
- [ ] 创建 website/README.md：启动方式与发布前需配置的真实地址。
- [ ] 运行 JS 语法检查、静态资源与链接检查，浏览器验证桌面和手机布局及演示、复制、导航。

验证通过后保留本地可预览交付，不自动提交用户其他改动。
