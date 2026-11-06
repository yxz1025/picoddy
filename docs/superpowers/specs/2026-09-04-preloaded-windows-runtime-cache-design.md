# Windows x86/x64 Python Runtime 预缓存设计

## 目标

支持 Windows x86（ia32）和 x64 两种 Electron 打包目标。构建前把两种 Python runtime 归档预下载到 `resources/runtimes/cache/`，构建时按明确的目标架构选择一份写入 `build/runtime-staging/`。缓存归档不进入应用资源，最终安装包只包含当前目标架构的一份 runtime。

## 资产

沿用 Python 3.13.15、release `20260901` 和现有 `tar.gz` install-only 格式：

| runtime key | 文件 | 大小 | SHA-256 |
|---|---|---:|---|
| `win32-ia32` | `cpython-3.13.15+20260901-i686-pc-windows-msvc-install_only.tar.gz` | 44,735,626 | `62ab9e252bb85f4538972f99eb1824d720c3f98ae1b2f7cd6988a93cba515252` |
| `win32-x64` | `cpython-3.13.15+20260901-x86_64-pc-windows-msvc-install_only.tar.gz` | 47,042,104 | `9bcc038a0bf180612ed56dec93d4977d035e80b8d9320ef51a38c287baf134b7` |

## 目录和数据流

```text
resources/runtimes/runtime-lock.json
resources/runtimes/cache/<locked archive>       # 预下载缓存，git/electron-builder 均排除
        │
        └─ prepare-runtime --platform win32 --arch <ia32|x64>
             ├─ 读取并校验 cache 中对应归档
             ├─ 复制为 build/runtime-staging/python.dat
             └─ 写入只描述当前目标的 runtime-manifest.json
                    │
                    └─ electron-builder extraResources → vendor/
```

`prepare-runtime` 仍保留远程下载能力：缓存缺失时才下载到 `resources/runtimes/cache/`，下载后必须通过锁定的大小和 SHA-256 校验。`build/runtime-staging` 只作为构建临时目录，不保存多个架构。

## 构建入口

- `npm run prepare:runtime:win:all` 预下载并校验 ia32、x64 两份缓存。
- `npm run build:win:x64` 选择 `win32-x64` 并执行 `electron-builder --win --x64`。
- `npm run build:win:ia32` 选择 `win32-ia32` 并执行 `electron-builder --win --ia32`。
- `npm run build:win` 继续作为 x64 默认入口。

## 打包约束

`electron-builder.yml` 增加 `!resources/runtimes/cache/**`，避免预下载归档进入 ASAR；现有两个 `extraResources` 仍只从 `build/runtime-staging` 发布选中的 `python.dat` 和 manifest。因此 x64 MSI 不会携带 ia32 归档，ia32 MSI 不会携带 x64 归档。

## 验证

- lock 测试覆盖两个 Windows key、文件名、大小、digest 和 executable。
- prepare-runtime 测试覆盖目标架构选择、缓存路径和 manifest key。
- 打包配置测试确认 runtime cache 被排除、extraResources 仍只指向 staging。
- 下载完成后对两份实际文件执行大小和 SHA-256 校验。
