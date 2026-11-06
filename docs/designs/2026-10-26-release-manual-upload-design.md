# 本地构建后手动上传发布

## 背景

七牛自动发布会先查询线上更新清单并取得 ETag，再构建、上传制品、校验源站及 CDN，最后发布更新清单。网络传输若持续超时，用户希望可以仅在本地构建，然后通过人工渠道上传。

## 目标

- 增加 build-only/manual-upload 模式，构建与现有自动发布使用相同的构建产物和 feed staging 逻辑。
- 手动模式不初始化发布客户端、不要求发布凭据、不访问线上清单，也不进行任何远端写入。
- 输出可审阅的上传清单，列出本地文件、目标 URL、七牛对象 Key、大小、SHA-512 和上传顺序。
- 先上传不可变安装包及 blockmap，确认下载地址可用后，最后人工上传 `latest-mac.yml` 等更新清单，避免客户端看到尚未就绪的制品。
- 手动模式不自动同步源码版本号。记录 build-only 模式，避免将它误认为发布成功。

## 命令与产物

拟在 `release:qiniu` 增加 `--manual-upload` 参数。仍要求 `--url` 或 `QINIU_UPDATE_URL`，用于生成正确的 feed URL 和对象 Key；不读取七牛密钥，不访问网络。平台、架构、scope、channel、notes 参数保持现有含义。

构建完成后，沿用 `feed-staging/publish.json` 和 `latest-mac.yml`，额外写入 `manual-upload.md`。该说明逐个列出 `publish.json` 中的制品对象，并将 feed 清单明确标记为最后上传。控制台打印产物目录和人工上传说明路径后退出，不调用 `publishSaved`/七牛 SDK，不修改线上内容或本地 package 版本。

## 非目标

- 不自动化控制七牛控制台或其他人工上传工具。
- 不为人工上传提供原子更新或发布锁。人工上传清单绕过脚本 CAS/协作锁；因此需要明确提醒避免与并发发布冲突，并人工核对目标 Bucket、Key 及在线版本。
- 不改现有自动发布、失败重试、灰度、撤回路径。
- 不重试本次 3.4.4 上传；用户已取消该操作。

## 风险

人工上传缺少脚本持有的发布锁、条件写入、源站 SHA-512 校验和 CDN 刷新步骤。手册要求最后上传 feed，随后确认 CDN 可下载所有制品且 feed 内容已生效。误选 Bucket、Key 或上传顺序可能造成发布中断。

## 验证

用户已确认设计并授权实施。已在 `scripts/release/ship.mjs` 增加 `--manual-upload`：仅 qiniu provider 可用，绕过七牛发布器初始化和线上 feed 查询，沿用本地构建与 `publish.json` 生成；产出 `manual-upload.md`，列出制品与 feed 的本地路径、对象 Key、URL、大小和 SHA-512，要求先上传制品、最后上传 feed。`ship.json` 标记 `mode: manual-upload` 且不含 ETag。该路径不会调用远端发布、版本同步或构建测试。手册已补充使用方法与绕过保护的说明。
