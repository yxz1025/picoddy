# Node 24 发布摘要兼容修复

## 背景与现状

用户授权发布 3.3.2，发布手册指定 Node 24。实际构建在 scripts/build-builtin-skills.ts 的摘要函数失败：Uint8Array.toHex is not a function，尚未进入上传阶段。

## 目标与非目标

让既有 SHA-256 摘要转换兼容 Node 24；不改变摘要算法、内置技能内容、发布格式或依赖。

## 方案与影响范围

将 new Uint8Array(value).toHex() 替换为 Buffer.from(value).toString("hex")。该文件已使用 Buffer 生成 Base64，复用同一 Node 原生能力。同步发布手册说明，提交并推送后执行原发布命令。

## 风险与验证

两种转换均生成小写十六进制摘要，不改变输出格式。使用用户已授权的实际发布构建验证，不自动执行测试套件；若后续阶段失败，保留产物及发布计划供重试，不覆盖同版本线上清单。
