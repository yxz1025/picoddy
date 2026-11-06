# 需求历史入口选中态

## 背景与现状
需求页面属于 project 分类，侧栏直接按分类高亮项目，历史记录没有独立选中状态。历史 selection 是导航请求，不能代表当前显示页面。

## 目标
打开需求时高亮对应历史条目，项目列表和设置高亮项目。点击项目返回需求列表。

## 非目标
不修改会话恢复、授权、启动、产物或历史存储格式。

## 方案
历史 store 增加临时 activeRequirementId 和 overviewRequest。ProjectPanel 根据实际显示的需求同步 activeRequirementId，卸载清空。历史条目结合当前分类和账号判断 active，复用任务列表样式。项目按钮发出 overviewRequest 并清除旧历史导航请求，避免重新进入旧需求。移除入口不改变当前页面，项目选中态回退。

## 影响范围
projectHistory、ProjectPanel、RecentRequirements、Sidebar，均为渲染进程跨平台代码。

## 风险与验证
导航请求与显示状态分离，避免返回列表仍高亮旧需求；账号切换清空临时状态。执行 TypeScript 与 diff 格式检查，不运行测试或构建。人工验证历史进入、切换需求、返回列表、点击项目、切换其他分类。
