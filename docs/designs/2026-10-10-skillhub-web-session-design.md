# SkillHub 网页列表携带登录会话

## 背景与现状

点击技能连接器菜单会检查 SkillHub 会话并保存 SESSION/XSRF-TOKEN，但技能列表、专家列表与专家详情仅发送 Accept，没有将保存的 Cookie 接入请求。匿名请求返回空列表，不能反映登录用户的可见数据。

## 目标与方案

用户明确要求加上 Cookie。三个网页读取接口通过主进程的会话调用包装获取经检查的最新 Cookie；有效会话复用，过期沿用现有重新登录流程。HTTP 请求同时携带 SESSION 和 XSRF-TOKEN。显式 401 时仅重新检查并重试一次，空列表不触发登录或 Token 轮换。

## 非目标与影响范围

不向渲染进程暴露 Cookie，不修改 CLI 下载和命名空间的 Bearer Token 鉴权。修改 SkillHub client/auth_service 和统一 API 入口，前端路由与 IPC 不变，Windows/macOS 共用。

## 风险与验证

传入 Cookie 前检查身份与会话，避免把过期缓存用于读取。保留无 Cookie 的可注入客户端调用以便独立检查公开接口；生产网页 API 必须经过会话包装。新增请求头回归用例但不自动运行测试；执行前后端类型与差异检查。
