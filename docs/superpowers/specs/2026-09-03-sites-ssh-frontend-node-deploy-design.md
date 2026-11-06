# Sites SSH 前端/Node.js 发布设计

## 状态与范围

状态：设计已确认；本阶段只产出设计，不执行实时部署。

Sites 是纯发布技能，不创建项目、不修改源代码、不负责本地预览。用户选择 Sites 技能后提供已有项目目录，明确要求发布，工具完成本地打包、SSH 上传、远端 Docker 构建、Harbor 推送、Kubernetes 发布、入口 Nginx 路由更新，最后返回访问链接。

只支持：

- 静态前端项目（Vite、Vue、React 等，构建产物为 `dist`/`build`）；
- Node.js HTTP 项目（必须能够通过 `PORT` 环境变量监听 HTTP 服务）。

明确不支持 Java/Maven/Gradle、小程序以及不能作为单端口 HTTP 服务运行的项目。不会把不支持项目静默降级成静态页面。

## 现有流水线分析

目标项目的 [Jenkinsfile](/Users/xiaozhongyuan/Documents/product/jic-fashion-shopping/K8s-Deploy/Jenkinsfile) 当前执行 Git checkout、Maven 构建、Docker build/push、`kubectl config use-context` 和 `kubectl apply`。生产 Deployment 文件定义了 9315 端口的 Deployment 与 ClusterIP Service，入口没有外部访问路由。

该流水线不能直接作为 Sites 的实现：

- Maven/Java 阶段超出 Sites 支持范围；
- Jenkinsfile 中存在硬编码 Harbor 登录凭证，必须移除并轮换；
- 通过 `sed -i` 修改工作区里的 YAML，不适合作为并发、可回滚的通用发布机制；
- 生产文件中的镜像仍是 `latest`，不能精确回滚；
- 当前 Nginx/K8s 之间的网络暴露关系需要由远端部署配置明确声明。

Sites 只复用其“构建 → 推镜像 → 发布 → 健康检查”的思想，不复用 Java 构建和明文凭证。

## 用户体验与 Tool 契约

用户流程：

```text
选择 Sites 技能
→ 提供已有项目文件夹路径并要求发布
→ 工具检查目录与项目类型
→ 本地安全打包
→ SSH/SFTP 上传
→ 远端 Docker/K8s/Nginx 发布
→ 返回访问链接
```

内置 AgentTool 名称建议为 `sites_deploy`。输入只暴露：

```text
action                deploy | unpublish（默认 deploy）
directory             项目绝对路径
runtime               auto | static | node（默认 auto）
userAskedToPublish    是否在当前消息明确要求发布
```

应用名、slug、版本、端口、构建命令、SSH、Harbor、K8s 和 Nginx 参数全部由宿主自动推导或从管理员部署的配置档案读取，不让用户每次填写。

同一路径重复发布时复用稳定 slug 和 Service；更新线上内容仍要求当前消息明确授权。取消发布使用同一 Tool 的 `action: unpublish`，先移除入口路由，再删除 Deployment/Service。

成功结果只返回：

```json
{
  "status": "ready",
  "url": "http://skillhub.example.com/sites/<slug>/",
  "version": "sha-<12位摘要>"
}
```

失败结果返回 `stage`、脱敏错误和是否完成回滚；不返回私钥、Token、完整 SSH 命令或远端敏感路径。

## 客户端模块

建议新增：

```text
src/agent/tools/sites_deploy.ts
src/domains/sites/node/types.ts
src/domains/sites/node/service.ts
src/domains/sites/node/project_detector.ts
src/domains/sites/node/archive.ts
src/domains/sites/node/ssh_transport.ts
src/domains/sites/node/remote_deployer.ts
src/domains/sites/node/store.ts
resources/builtin-skills/sites/SKILL.md
```

`sites_deploy.ts` 只做 AgentTool 参数校验、会话授权和结果适配；业务编排放在 `SitesService`。SSH 私钥通过 macOS Keychain/Windows Credential Manager 等系统密钥存储读取，绝不进入模型上下文。

项目目录必须落在当前会话工作区内，并使用 `realpath` 阻止软链接逃逸。打包默认排除：

```text
.git、node_modules、dist、build、out、coverage、缓存目录
.env、.env.*、*.pem、*.key、id_rsa*、.DS_Store
```

同时限制单文件大小、压缩包总大小和特殊文件类型。上传源码而不是本地 `node_modules` 或已有镜像。

## 项目探测与构建约定

### 静态前端

- 读取 lockfile 选择 npm/pnpm/yarn；生产构建优先使用 frozen/ci 模式；
- 自动查找 `build` 脚本和 `dist`/`build` 产物；
- Vite 自动传入 `/sites/<slug>/` base；CRA 自动设置 `PUBLIC_URL`；
- 无法安全判断构建方式时返回原因，不修改源项目；
- 远端生成多阶段 Dockerfile，运行阶段使用 Nginx。

### Node.js HTTP

- 必须存在可执行的 `start` 脚本或明确入口；
- 远端注入 `PORT`，应用必须绑定 `0.0.0.0`；
- 端口默认从项目配置读取，缺失时使用受控默认值；
- 远端生成 Node 运行镜像，或仅在项目自带 Dockerfile 且通过安全检查时使用它；
- 健康检查默认访问 `/`，可由受控 `.sites.json` 指定健康路径。

可选 `.sites.json` 只用于非标准项目，不能包含任意远程 shell：

```json
{
  "runtime": "static",
  "buildScript": "build",
  "outputDirectory": "dist",
  "port": 8080,
  "healthPath": "/"
}
```

## 远端运行时安装与脚本契约

管理员在远端执行一次 `install-sites-runtime.sh`，建立：

```text
/opt/picoddy-sites/bin/
  deploy-site.sh
  unpublish-site.sh
  deployment-status.sh
  install-sites-runtime.sh
/opt/picoddy-sites/config/sites.env
/opt/picoddy-sites/incoming/
/opt/picoddy-sites/releases/
/opt/picoddy-sites/manifests/
/opt/picoddy-sites/nginx-routes/
/opt/picoddy-sites/state/
/opt/picoddy-sites/logs/
/opt/picoddy-sites/locks/
```

后续实现阶段需交付完整可执行脚本。脚本接口固定为：

```text
deploy-site.sh --manifest /opt/picoddy-sites/incoming/<release-id>/manifest.json
unpublish-site.sh --slug <slug>
deployment-status.sh --slug <slug>
```

客户端只调用上述固定脚本，不直接传入 `docker`、`kubectl`、`nginx` 或任意 shell 片段。脚本从 `sites.env` 和经过 schema 校验的 manifest 读取参数。

manifest 至少包含：

```text
releaseId、slug、runtime、imageTag、buildScript、outputDirectory、port、healthPath
```

远端配置还需声明 Harbor registry/namespace、K8s context/namespace、可被入口 Nginx 访问的节点地址、现有 Nginx 容器名和路由挂载目录。配置文件权限为 `600`；发布账号仅允许执行发布脚本及必要的 Docker/Kubectl 操作。

## Docker、Kubernetes 与 Nginx

每个应用独立创建：

```text
Deployment/sites-<slug>
Service/sites-<slug>（NodePort）
```

Deployment 使用不可变镜像 tag、RollingUpdate（`maxUnavailable: 0`、`maxSurge: 1`）、readiness/liveness probe、资源限制和镜像拉取 secret。首次创建 Service 时由 Kubernetes 分配 NodePort，后续发布复用该 Service 和 NodePort。

共享入口 Nginx 只负责路由。最终链接格式：

```text
http://skillhub.example.com/sites/<slug>/
```

每个应用生成独立路由文件，`proxy_pass` 使用带结尾 `/` 的形式剥离 `/sites/<slug>/` 前缀，并转发 `X-Forwarded-*` 和 WebSocket headers。现有 Nginx 容器必须将远端路由目录 bind mount 进去并 include；不使用 `docker cp` 修改容器内部临时文件。

路由更新为原子操作：临时文件 → rename → `nginx -t` → reload；验证失败恢复旧文件。

## 发布事务与回滚

部署顺序：

1. 获取 slug 级文件锁；
2. 校验 manifest 和压缩包；
3. 解压到独立 release 目录；
4. Docker build；
5. Harbor push；
6. 创建/复用 Service；
7. 更新 Deployment 镜像；
8. 等待 `kubectl rollout status`；
9. 读取 NodePort；
10. 原子更新 Nginx 路由并 reload；
11. 请求最终 URL 做健康检查；
12. 写入状态和发布历史。

失败处理：

- 构建/推送失败：线上不变；
- rollout 失败：`kubectl rollout undo` 并等待旧版本恢复；
- Nginx 校验失败：恢复旧路由；
- URL 健康检查失败：回滚 Deployment 和路由；
- 首次发布失败：删除新增资源和路由；
- 回滚失败：返回 `rollback_failed`，保留诊断日志，停止自动重试。

取消发布先删除路由并 reload，成功后再删除 Deployment/Service；任何一步失败都要保持可恢复状态。

## 持久化与管理

本地 SQLite 保存：

```text
workspace_id、local_directory、slug、runtime、remote_app_id、release_id、image_tag、node_port、url、status、content_hash、created_at、updated_at
```

使用 `local_directory + deployment profile` 定位应用；内容摘要用于判断版本和幂等。后续 UI 可据此展示“我发布的应用”、当前版本、历史版本、下线和重新发布。

## 权限、审计与日志

发布属于外部可见的破坏性操作：首次发布和覆盖线上版本都必须在当轮明确授权。L1 只读模式禁止调用；默认模式和完整模式由 Sites 自己执行发布确认闸门。所有操作记录 releaseId、slug、阶段、耗时和结果，不记录私钥、Authorization header、Harbor 密码或完整敏感命令。

远端日志按 releaseId 保存，客户端只取脱敏尾部。日志阶段至少包括 `validate`、`pack`、`upload`、`build`、`push`、`k8s_apply`、`rollout`、`nginx`、`healthcheck`、`rollback`。

## 测试设计

客户端单元测试：

- Java/小程序拒绝；
- static/Node 探测；
- lockfile 和 slug 生成；
- 路径边界、软链接和敏感文件排除；
- 首次发布/重发布确认；
- Tool metadata 和 capability assignment。

远端脚本测试：

- manifest schema 和非法参数拒绝；
- Docker 构建失败不修改线上；
- rollout 失败自动回滚；
- `nginx -t` 失败恢复旧路由；
- 首次发布和重复发布幂等；
- unpublish 幂等。

集成测试使用临时 K8s namespace、测试 Harbor 仓库和独立 Nginx 配置，不连接生产 context。成功标准是最终 URL 可访问、重复发布 URL 不变、失败发布线上旧版本仍可访问。

## 后续实现拆分

1. 实现本地探测、打包和 Tool；
2. 实现 SSH/SFTP transport 和远端 manifest；
3. 交付并在测试服务器安装四个远端脚本；
4. 实现静态前端镜像和 Nginx 路由；
5. 实现 Node.js 镜像；
6. 接入 K8s rollout/rollback 和 SQLite 历史；
7. 在测试 namespace 验证后再开放生产 profile。

本设计不包含实时 SSH、Docker、Harbor 或 Kubernetes 操作。
