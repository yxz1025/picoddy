# SkillHub 跨平台安装可靠性设计

## 背景

普通技能与专家安装共用 `installSkillHubSkillWithCli`。当前实现未向 ClawHub CLI 指定稳定工作目录，重复执行 `login --token` 会写入 CLI 全局配置，非 `global` 技能更新依赖平台特定的 `rename` 错误码，并且接收的版本没有传给 CLI。这些问题会让相同安装包在不同电脑、不同启动方式或已有安装状态下表现不一致。

## 目标

- macOS 和 Windows 使用应用管理的可写目录运行 SkillHub CLI。
- 不修改用户的 ClawHub 全局登录配置。
- 安装目录中当前显示技能的最新已发布版本。
- 首次安装、重复安装和更新失败回滚在两个平台保持一致。
- 对外错误不泄露 Token、请求头或完整命令输出，同时能区分常见失败类型。

## 非目标

- 不替换 ClawHub CLI 或自行实现下载协议。
- 不改变 SkillHub 目录接口和前端交互。
- 不迁移或删除用户现有技能、专家及 ClawHub 全局配置。

## 设计

### 受管 CLI 目录

安装器使用 `platformPaths.appDataDir/skillhub-runtime` 作为固定工作目录，并在调用 CLI 前创建该目录。

- macOS 默认解析为 `~/.pi-a/skillhub-runtime`。
- Windows 默认解析为 `%LOCALAPPDATA%\\Pi-a\\skillhub-runtime`。

安装命令显式传递 `--workdir`，不再依赖 Electron 进程的当前目录、Finder 启动行为或 OpenClaw workspace 是否存在。

### 鉴权与版本

保留安装前的 `login --token` 验证，因为 ClawHub CLI 0.23.3 的安装命令只从配置文件读取 Token。登录和安装子进程都通过 `CLAWHUB_CONFIG_PATH` 使用 `<appData>/skillhub-runtime/clawhub-config.json`，避免写入 macOS `Library/Application Support/clawhub` 或 Windows roaming AppData 下的全局配置。

当前 SkillHub 服务的 `/api/v1/skills/<slug>/versions/<version>` 与 ClawHub CLI 0.23.3 不兼容，会返回 HTTP 500。安装命令因此不传 `--version`，由技能元数据解析最新已发布版本，避免触发故障的指定版本接口；前端传入的版本仍用于输入校验和专家缓存标识。

### 跨平台目录替换

非 `global` 技能下载到 `<namespace>--<slug>` 后，安装器将其规范化为 `<slug>`。替换不再根据 `EEXIST`、`ENOTEMPTY` 或 `EPERM` 分支决定行为，而采用统一事务步骤：

1. 若目标目录存在，将目标重命名为同一文件系统中的临时备份。
2. 将下载目录重命名为目标目录。
3. 成功后删除备份。
4. 任一步失败时恢复旧目标，并保留原始错误。

所有临时名称位于目标根目录中，避免跨文件系统 `rename`。

### 错误处理

CLI 退出码、进程启动错误码和经过脱敏的 `stderr` 用于映射稳定错误。错误文本不得包含 Token、Authorization 请求头或完整堆栈。无法分类的异常继续使用通用错误，但主进程保留不含敏感信息的诊断信息。

专家安装继续复用同一个 CLI 安装器；专家包校验、缓存索引原子更新和旧缓存回滚逻辑保持不变。

## 测试

- 登录和安装 CLI 参数包含固定的绝对 `--workdir`，两个命令使用相同的应用内配置文件，安装不触发故障的指定版本接口。
- `platformPaths` 在 macOS 和 Windows 输入下生成各自的受管目录。
- 非 `global` 技能首次安装成功。
- 目标目录已存在时完成替换。
- 新目录替换失败时恢复旧目录。
- 专家安装把发布版本原样传给共享安装器，并保持缓存更新与回滚测试通过。
- CLI 典型权限/目录错误被安全分类，敏感 Token 不出现在错误信息中。
- 运行 SkillHub、专家缓存、IPC 及前端相关回归测试。

## 验收标准

- 从 Finder 启动且没有 OpenClaw 配置的 macOS 可以安装技能和专家。
- 当前可正常安装的 Windows 环境继续正常工作。
- 已存在同名非 `global` 技能时可更新，不出现 `ENOTEMPTY` 导致的通用安装失败。
- 应用不创建或修改 ClawHub 全局登录配置。
- 专家缓存版本与实际下载版本一致。
