# Cloud 内置 pi-web-access 接入设计

## 背景与目标

用户希望云端直接使用 pi-web-access。现有 browser 通过 Chromium 读取页面，每次自动生成 output/browser.png，导致纯文字联网任务也进入截图持久化链路。目标是复用官方搜索和正文提取能力，为普通会话默认提供联网工具，同时消除阅读网页时自动生成交付图片的行为。

## 现状与依据

- Cloud 的 createCloudSession 使用显式 customTools 与受控 ResourceLoader，没有加载桌面扩展；现有沙箱已有 MCP SDK、Node 24 和 Chromium。
- 官方提供 stdio MCP，暴露 web_search、fetch_content、get_search_content、source_check。无需完整 Pi 安装。官方说明：https://github.com/nicobailon/pi-web-access#use-from-other-agents-mcp。
- MCP 模式缓存最近 50 个结果于进程内，退出后丢失。现有 runSandboxMcp 每次调用创建和关闭会话，直接套用会使 responseId 失效。
- MCP 模式不包含 Pi 专有的 curator、当前 Pi 模型/ChatGPT 登录搜索、fetch_content answer 模式及直接图片抓取，不承诺完整扩展等价。
- npm 元数据返回 0.40.0，但网页缓存中的 main/package.json 显示 0.39.0。实施时读取发布包源码核对 MCP 入口与行为，再锁定经验证的发布版本，不使用运行时 npx latest 下载。

## 方案选择

1. 推荐：官方 MCP 在任务沙箱常驻，Cloud 注册四个内置工具并代理调用。复用官方接口，不要求用户手动添加或选择连接器。
2. 完整 Pi 扩展加载：可保留更多 Pi 专有能力，但当前 AgentSession 位于 Worker，会使插件网络请求和临时文件落在控制面；为保持边界需要额外远程化，范围更大。
3. 拷贝包内部函数：依赖未承诺的内部接口且需要跟随上游维护，不采用。

## 实施方案（已确认）

- 在执行镜像安装锁定版本 pi-web-access，调用其正式 MCP 可执行入口。网络请求、子进程、缓存与下载均留在任务沙箱。
- 每个 run 懒启动一个桥接进程，持有一个 MCP Client 和官方 stdio server，复用至 run 结束。桥接只监听沙箱 loopback，由受控 sandbox.exec 调用；不向外暴露端口。请求参数经文件传递，避免 shell 拼接；限制请求/响应大小、超时并支持取消。
- 用官方 tools/list schema 注册四个同名内置工具，更新 Cloud 工具分类、只读策略和提示词能力目录。桥接持有进程内缓存，确保搜索后 get_search_content 使用同一 responseId；不同 run 不共享缓存。
- 初始使用官方提供的无 Key Exa MCP 路径，并验证目标执行网络可达。普通对话模型 Key 不自动用作搜索 Key；若该路线不可用，明确报告搜索失败，不把无 Key 路线描述为可用性保证。后续需要其他供应商时再设计配置，不读取或复制桌面登录凭据。
- 搜索与正文提取不主动生成截图或写入 output。保留 browser 用于明确需要浏览器的页面任务；将其内部截图改为显式可选，未请求截图时只返回页面文字和链接。用户明确需要图片时才保存交付图片。
- 临时目录使用沙箱任务私有目录，不进入 work/output 自动回写清单。任务取消和沙箱销毁结束 MCP 进程，不允许跨用户共享进程。
- 搜索结果含标题、URL、摘要或正文，提示模型对新闻核对发布日期并引用具体文章，而非只列频道链接。

## 非目标

不迁移桌面数据，不修改桌面端，不接入浏览器个人 Cookie，不将搜索服务放在 API/Worker 主机执行，不保证 Pi 专有能力在 MCP 模式可用。此接入消除自动截图链路，但不等于证明或修复所有工作区回写异常；既有失败任务不改成成功。

## 影响与风险

修改限 cloud 执行镜像、任务级桥接、工具注册/分类、提示词以及 browser runtime。进程重启会丢失官方缓存，应返回明确错误而非读取其他任务缓存。无 Key 搜索依赖上游服务和网络；供应商错误保留安全分类。Cloud 控制面使用平台无关的 TypeScript，执行镜像仍为 Linux；Windows 主机通过相同远程沙箱接口使用，不依赖本机 shell 或路径。

## 验证

类型与差异检查；隔离环境覆盖工具发现、连续搜索/缓存读取、跨 run 隔离、取消及超时。真实沙箱验证搜索、URL 抓取和新闻日期引用，确认纯文字任务无 output/browser.png，并正常结束。构建镜像及自动化测试按授权执行；Windows 实机没有证据前不宣称通过。

## 实施中发现的本地环境差异（待补充确认）

真实 OpenSandbox 中工具发现、Exa 搜索、同进程缓存读取及无输出文件检查成功。正文读取被上游 SSRF 检查拒绝：当前本机 TUN 代理把 example.com 解析到 198.18.3.25。包官方错误信息明确要求 fake-IP 环境配置 ssrf.allowRanges=["198.18.0.0/15"]。普通私网、loopback 与 metadata 仍应禁止。

拟增加 WEB_ACCESS_ALLOW_FAKE_IP 本地开发显式开关：默认关闭；仅 PUBLIC_ORIGIN 和 SANDBOX_DOMAIN 均为 loopback 开发端点时允许启用，非本地配置拒绝启动。服务端将该布尔设置传给受控沙箱桥接，桥接只把固定的 198.18.0.0/15 写入本次任务的 web-search.json，不接受浏览器或模型指定 CIDR。本地 .env 启用以适配已确认的 TUN/fake-IP 环境；生产保持上游默认限制。此变更涉及网络访问判断，应先确认再实现。

## 实施记录

用户已明确“确认”主体方案，代码与锁定 0.40.0 的执行镜像已完成，空闲 Worker 已重启加载。36 项相关回归、两套 Cloud TypeScript 检查通过。真实 OpenSandbox 搜索与缓存读取成功；正文读取仍被本地 fake-IP 校验阻止，无 Key Exa 搜索也观察到一次无结果错误，未保证上游稳定性。无自动交付图片检查通过。尚未重跑原新闻会话、未做 Windows 实机验证，原历史失败记录保留。
