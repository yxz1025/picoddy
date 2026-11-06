# 云端 MCP 执行审批与完全访问模式对齐

## 最新有效决定（用户直接指定）

2026-10-14 用户明确要求“MCP就应该全部放行执行”，覆盖下方最初确认的风险分类策略。完全访问 craft 下，本轮已选、已授权、未禁用且工具可见的 MCP 所有发现和调用直接执行，不因名称、annotations、未知风险或写操作弹出执行审批。删除 MCP 专用风险分类和 approve 回调，避免残留分支。保持 owner/UUID/revision/当前授权、工具存在性、hidden、租约和 readonly/plan/ask 的现有约束；Shell、OAuth 登录不变。旧审批记录不批量改写。用户当前指令已经明确授权该策略变更，不再重复要求确认。

验证更新为：只读、一般写、destructive、未知 annotations、高风险名称均审批0；授权在发现与调用间变化仍拒绝；只读/计划/问答模式仍不暴露业务 MCP。临时沙箱只用受控测试工具，禁止以真实业务写入来验证自动执行。无需重建镜像，变更只在 Worker 审批策略和说明。

以下保留之前设计与验收历史，不代表当前风险分类策略。

最终策略验证：28 项相关回归、两套类型检查与差异格式检查通过；临时真实沙箱的 query/routine_write/delete_item/unknown 四个工具全部直接调用且审批0，沙箱已清理，无真实业务工具调用。已在确认无活动任务后重启 Worker 加载最终规则。

## 背景与现状

用户已经完成知识库 OAuth 并在聊天框选择连接器，但 list_accessible_projects 仍出现执行审批。cloud/src/agent/tools/index.ts 对所有 MCP call 无条件 approve，并对 stdio list approve，没有判断任务 permission。OAuth 是账号授权，approve 是额外任务执行审批；截图不是知识库再次要求登录，而是云端工具层硬编码。

## 目标与非目标

已授权、已选择的知识库查询自动执行，完全访问模式的常规 MCP 调用不再逐次弹窗。仍核对 owner/UUID/revision/当前授权和 hidden；不自动同意提供方 OAuth，不自动处理目前已生成的审批，不改变 Shell/其它工具权限或绕过只读/计划模式。

## 方案（2026-10-14 用户已确认）

1. 先列出服务端工具及安全 annotations，sandbox MCP runner 保留 annotations。模型不能通过输入声明 readOnlyHint 或修改判定。
2. craft + full 下：远程工具发现自动执行；声明 readOnlyHint=true 的调用自动执行。固定知识库预设中已核对为查询的工具也可按固定合同自动执行，具体合同从真实工具发现结果核对，不能按模型生成名称猜测。
3. craft + full 下：一般写操作按桌面常规操作自动执行；destructiveHint=true 及项目既定高风险动作保留执行审批。缺少可靠工具信息时先发现；无法判定操作类型时保留审批，不能把所有未知调用当作查询。
4. stdio 发现会执行进程，必须限定到本次用户显式选择、未禁用的连接器，在任务沙箱执行。完全访问下自动启动所选连接器；未选、配置变更、撤销、hidden 和租约失效均拒绝。
5. readonly/plan/ask 保持当前禁用业务 MCP 的策略；本次不扩大可执行工具范围。更新工具说明，移除所有调用都需要审批的陈述。

## 影响与风险

修改只在 cloud 工具审批判定、服务端工具发现、安全元数据传递、提示词和回归。自动执行增加用户已选 MCP 的自主调用范围，因此与上一轮只修管理/OAuth 的设计相比属于实质性权限行为变化，按 AGENT.md 先确认。本次不改库结构、不清业务数据；高风险判定须有固定规则及未知信息拒绝分支。

## 验证

已选/未选、full/readonly/plan/ask、查询/一般写/破坏性/未知、撤销/编辑与 hidden 都做针对性回归。受控 MCP 验证查询无 approval 事件、高风险仍暂停；只读检查真实知识库 schema，不对业务数据执行测试写入。沿用已授权的类型检查、测试和构建，最后重启 Worker 加载判定。

## 实施记录

自动判定为 readOnlyHint=true 且不触发高风险规则，或 readOnlyHint=false/destructiveHint=false 且不触发高风险规则；其它情况审批。高风险规则覆盖删除、对外发送/发布/上传、付款转账及授权/系统权限调整，名称先拆 camelCase 与分隔符。判定只使用 SDK 实际 listTools 输出，call 前确认唯一同名工具；模型附加字段不能覆盖 connector 或 annotations。TAPD 特殊项目查询也经统一判定，然后在服务器可信适配器里重新核对当前 owner/UUID/revision/配置与实时 grants。

只读发现实际知识库的 list_accessible_projects/search_knowledge/read_evidence/answer_question 均为 readOnlyHint=true、destructiveHint=false，无需额外白名单或猜测名称。临时受控 MCP 验证 query/routine_write 无审批，delete/unknown 各进入一次审批；无真实业务工具调用、无业务测试资源写入。沙箱镜像已重建，Web/类型与针对性回归通过；代码审查复查无阻断。此前已生成审批不批量修改、不自动恢复执行。
