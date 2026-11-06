# 陈列任务批量下载：74 分钟执行耗时调查

调查日期：2026-10-23。仅分析现存日志与源码，未重跑业务编码、依赖安装或修改运行配置。

后续源码修改见 [逐项优化设计与实施记录](designs/2026-10-23-agent-coding-latency-design.md)。补充纠正：Pi 模型目录将 qwen3.8-flash 的 off 标为不支持，修复能力注册后应映射到其最低支持级别 low，而不是声称可以关闭该模型推理；初始调查没有捕获出站请求。用户要求暂不测试，实际速度改善尚未测量。

## 对象与证据

- TAPD 需求：1140830665001025206。
- Pi 会话：`~/.pi-a/pi-agent/sessions/2026-10-23T06-15-49-734Z_1ff8126e-f6e7-46a5-9513-9902b6ecf75a.jsonl`。
- 编码输入：北京时间 16:38:22.535；最终回复：17:53:06.493。原始消息跨度 74 分 43.958 秒，与界面 74 分 46 秒基本吻合。
- 本轮实际 assistant 消息模型均为 `qwen3.8-flash`。不能用会话最初的 model_change（另一模型）代替本轮实际记录。

## 耗时拆分

按相邻消息落盘时间差归类，工具结果与前一个工具调用之间计入工具区间，assistant 消息与前一事件之间计入模型侧区间。该方法不能把模型侧区间进一步精确拆成排队、首 token 等待、推理、生成和重试退避。

| 区间 | 耗时 |
| --- | --- |
| 模型侧区间，含错误与重试等待 | 3472.871 秒（57 分 52.871 秒） |
| 工具执行区间 | 1011.054 秒（16 分 51.054 秒） |
| 其中两次 npm install | 350.474 + 600.069 秒（15 分 50.543 秒） |

共 80 条 assistant 记录：71 条 toolUse、1 条最终 stop、8 条 error。72 次成功响应区间平均 47.10 秒，中位数 34.57 秒。78 次顶层工具调用：bash 40、edit 15、write 11、requirement_preview 7、goal_complete 3、present_files 2。

8 次错误均为 `Request timed out.`，错误出现前区间合计约 81.84 秒；随后存在 context_edit 删除错误记录并继续执行。不能将这些 context_edit 视为历史上下文压缩，本会话未出现 compaction 条目。

## 已确认的额外开销与实现问题

1. **依赖安装长时间阻塞。** 第一次 npm install 因内网包下载 ECONNRESET，耗时约 350 秒；随后再次安装，显式增加 fetch 重试，直到 600 秒工具超时。两次占整轮约 21%。
2. **上下文和推理输出较大。** 首次成功响应报告输入 135724 tokens（input + cacheRead），最终响应输入 224968 tokens。全轮输出 79383 tokens，其中 reasoning 43893。累计 input 904604、cacheRead 13085440，后者是跨请求重复读取量，不是独立上下文长度，也不能直接当计费量。已有设计讨论和源码读取历史沿用到了编码轮。
3. **推理能力声明存在缺口。** `src/agent/models.ts:124` 将注册模型统一声明为 `reasoning: false`。依赖的 `pi-ai/dist/api/openai-completions.js` Qwen 分支仅在 `model.reasoning` 为真时发送 `enable_thinking`。因此本地能力标记为 false 并不等于明确关闭服务端推理；日志确实返回了大量 reasoning tokens。未捕获本次原始 HTTP 请求，不能进一步断言上游所有参数及默认行为。
4. **预览工具参数契约不完整。** `src/domains/preview/node/tools.ts` 将 target 声明为 `Type.Any()`，描述未列出 configure 必需的 repositoryId。本轮四次 configure 均传入 JSON 字符串且缺少 repositoryId；执行器却直接读取 `p.target.repositoryId`，因此都被拒绝。两次 deliver 未提供有效 targetId，也失败。这六次失败不能解释成用户没有勾选仓库或真实环境权限拒绝。首次 list 至最后一次 configure 约 4 分 1 秒。
5. **完成阶段另有无效往返。** present_files 一次路径拼写错误；goal_complete 两次缺少必填参数。最后成功完成声明后，项目追加收尾输入，再生成最终回复，耗时约 33 秒。

## 与 Pi 的一致性边界

当前仓库 package.json 固定使用 `@earendil-works/pi-coding-agent@1.0.4`。`src/agent/engine.ts:225` 直接调用 createAgentSession，模型/工具循环、重试和自动压缩由原生 SDK 管理。`src/agent/tools/index.ts:186` 使用原生 createCodingTools；macOS bash 的运行环境由应用包装。

但完整运行行为并非纯 Pi CLI：应用自行注册模型与能力、注入专家/需求/技能提示词、挂载权限与工具钩子、提供预览/交付/完成工具，并增加完成边界和收尾轮次。本轮不支持“Pi 内核自身让文件操作变慢”的判断，也没有同模型、同 endpoint、同历史、同任务的 CLI 对照测量，不能声称与 Pi CLI 的速度差已得到量化。

## 建议的后续修改顺序

1. 修正模型能力与思考开关的映射，检查实际出站请求，确保用户选择能影响服务端参数。
2. 将预览配置改为完整结构化 schema，明确 repositoryId 与各动作必填字段；对无效参数给出具体原因，避免重复尝试。
3. 对依赖安装网络失败使用有界重试，禁止失败后盲目增加重试次数；明确报告验证阻塞。
4. 编码阶段控制历史上下文，保留设计结论与相关代码证据，避免把更大上下文窗口当成性能目标。
5. 增加每次模型请求的首 token、输出、重试和工具耗时指标，再进行同配置 Pi CLI 对照。

本次没有修改业务代码或运行配置，也没有运行测试套件。以上优化收益尚未通过修复后的对照实验验证。
