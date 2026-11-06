# 七牛发布操作速查

首次配置与一键发布见[七牛发布手册](自动更新构建与发布升级手册.md)。下载域名在首次发布命令中由 `--url` 指定，重试和灰度操作默认沿用该构建目录记录的域名。

## 上传或刷新失败后重试

保留原构建目录，在仓库根目录执行：

```sh
npm run release:qiniu:publish -- --plan "build/releases/本次输出目录/feed-staging/publish.json"
```

此命令读取 `.env.qiniu` 的凭据和 Bucket，以及原 `ship.json` 的发布地址与基线；不必重新输入域名。若 `.env.qiniu` 的 QINIU_UPDATE_URL 与原地址不同，会拒绝操作；不要用另一 Bucket 或域名重放旧计划。

已经上传的制品只有源站摘要和 CDN 下载内容均匹配时才复用，不覆盖同版本不同内容。若清单已写入但刷新失败，重试只补充缓存设置与刷新，不回滚清单。不要重建同版本包来重试上传。

若源站校验通过但下载内容出现 `Published checksum mismatch` 或 `Published size mismatch`，脚本会提交该制品 URL 的 CDN 刷新并停止本次清单发布。错误包含文件 URL、大小，以及完整下载时的 SHA-512 对比。等待刷新生效后用原 `publish.json` 重试；刷新失败时检查 CDN 配置或刷新额度。重试仍会校验普通下载地址，不以带随机参数的下载成功作为发布依据。

## 扩大灰度

```sh
npm run release:qiniu:publish -- --plan "build/releases/本次输出目录/feed-staging/publish.json" --percentage 20
```

该命令会修改并发布灰度比例，再刷新 CDN。之后可用相同方式改为 50 或 100。脚本要求本地清单与当前线上内容相同，防止误改其他发布；若操作中断，使用不带 --percentage 的原计划重试。

## 撤回

```sh
npm run release:qiniu:publish -- --plan "build/releases/本次输出目录/feed-staging/publish.json" --revoke
```

该命令会设置 revoked 和 0% 并发布、刷新 CDN，不能仅修改本地 YAML。撤回不卸载已经更新的客户端；发布更高版本修复，不重新上传同版本包。已撤回版本不能直接调大灰度重新推广。

## 域名与对象 Key

例如指定 `--url https://cdn.example.com/picoddy/`，对应：

```text
下载地址：https://cdn.example.com/picoddy/feeds/stable/win32/x64/user/latest.yml
七牛 Key：picoddyclaw/feeds/stable/win32/x64/user/latest.yml
安装包 Key：picoddyclaw/releases/<版本>/<平台>/<架构>/<范围>/<文件名>
```

路径前缀也属于 Key，不要配置 CDN 回源路径重写。Mac 清单为 latest-mac.yml，beta 通道为 beta.yml / beta-mac.yml。所有清单和包必须使用同一个下载源。

## 发布失败与锁

脚本查询七牛源站摘要，不使用可能过期的 CDN ETag 作覆盖依据。制品通过 insertOnly 防止覆盖；清单更新使用七牛存储中的 `<清单Key>.publish-lock` 协作锁，再核对原摘要。

- 这个锁协调使用本脚本的发布者，不是七牛原生 If-Match；不要同时在控制台或其他工具覆盖清单。
- 取得锁失败时先检查是否有其他发布。正常结束会释放；清单写入结果不确定或进程崩溃时保留锁，不自动过期抢占。
- 残留锁只能在确认相关发布进程全部停止、线上清单状态已核对后，在七牛控制台删除。不要删除安装包或用户数据。
- 本地 `feed-staging/qiniu-publication.json` 记录发布/刷新阶段，`ship.json` 记录原地址、Bucket 和基线，灰度操作另存 qiniu-intent.json；均不存密钥。
- 清单已写入但缓存设置/刷新失败时，用户可能已看到更新，不要把命令报错理解为“线上完全未改变”。刷新提交成功也不代表全球缓存已生效。

代码测试使用模拟七牛服务，不等于真实 Bucket 和 CDN 联调。上线前用实际域名完成至少一次旧版到新版升级，核对下载、UAC/Mac 覆盖、数据保留及启动健康。

## 其他发布方式

原 `release:ship` / `release:feed publish` 仍用于通用条件 PUT 服务，不能对七牛 CDN 域名直接调用。七牛请使用本页的 release:qiniu 系列命令。

接口依据：[七牛 Node SDK](https://developer.qiniu.com/kodo/sdk/nodejs)、[上传策略](https://developer.qiniu.com/kodo/manual/put-policy)、[源站元信息](https://developer.qiniu.com/kodo/1308/stat)。

### 发布后同步源码版本

`release:ship` / `release:qiniu` 成功后，将指定的发布版本同步到根目录 `package.json` 和 `package-lock.json`（包含根包记录）。七牛原计划重试成功也会同步。构建、上传或 CDN 刷新提交失败时不修改本地版本；撤回发布不修改版本，旧计划重试不会降低已有源码版本。远端成功但本地写入失败时会单独提示，不应重新构建发布。
