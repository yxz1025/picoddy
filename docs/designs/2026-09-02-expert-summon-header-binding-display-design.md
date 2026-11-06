# 专家召唤后会话头部绑定显示修复设计

> 状态：已实施；静态检查完成，回归测试与 Electron 冒烟待授权执行

## 背景

从 SkillHub 专家市场点击“召唤”后，后端已经创建新会话并完成专家绑定，但进入新会话时右上角仍可能显示“选择专家”，没有显示已激活专家。

当前前端 `startExpertChat()` 在绑定成功后调用 `loadConversations()`，再通过 `presentActiveExpert()` 为新会话补入 `expertId` 和专家摘要。`loadConversations()` 没有请求代次保护：如果页面上一个更早发起的会话列表请求在补入专家状态之后才返回，它会用绑定前的旧响应覆盖整个 `conversations`，导致头部根据空 `expertId` 渲染“选择专家”。

## 目标

- 专家绑定成功并进入新会话后，头部立即稳定显示专家名称和“已激活”。
- 后续会话列表刷新继续以服务端持久化绑定为准。
- 消除旧会话列表请求覆盖新状态的竞态。
- 保持 SkillHub 市场专家、内置专家和“我的专家”使用同一流程。

## 非目标

- 不修改专家绑定数据库结构。
- 不修改 ExpertBindingService、Prompt Runtime 或专家缓存架构。
- 不新增平台分支、轮询、延时、重试或双轨兼容逻辑。
- 不调整会话头部视觉样式和专家选择交互。

## 现状

当前链路：

```text
召唤市场专家
  → 安装/命中缓存
  → POST /api/conv
  → PUT /api/conversations/:id/expert
  → loadConversations()
  → presentActiveExpert()
  → selectConversation()
```

绑定接口已经返回 `{ binding, expert }`，但前端忽略返回值，只使用调用前解析出的专家摘要。与此同时，任意在途 `loadConversations()` 都可以无条件覆盖整个会话列表。

## 方案

### 1. 会话列表采用最新请求生效

在 `useStore.ts` 为 `loadConversations()` 增加进程内单调递增 generation：

1. 每次开始加载时取得当前 generation。
2. 响应返回后仅当它仍是最新 generation 时写入 `conversations`。
3. 更早请求即使更晚返回，也直接丢弃结果。

这与现有 `selectConversation()` 的 `selectionGeneration` 模式一致，不引入新的状态层或取消机制。

### 2. 使用绑定接口权威响应更新新会话

`startExpertChat()` 读取 PUT 接口返回的 `binding` 和 `expert`：

- 用返回的 `expertId`、`revision`、`catalogSource` 写入新会话展示状态。
- 用返回的 `expert` 作为头部摘要；只有接口未返回摘要时才使用调用前已解析摘要。
- 列表刷新后调用现有 `presentActiveExpert()`，保留服务端返回的其他会话字段。

不改变接口协议，因为后端当前已经返回这些字段。

### 3. 回归测试

- 扩展专家会话状态模型测试，验证权威绑定字段会随专家摘要合并到刷新后的会话。
- 为会话列表最新请求规则提取小型纯函数或可控状态辅助逻辑，验证旧 generation 不可覆盖新 generation。
- 保留现有“刷新列表未包含新会话时仍展示新会话”的行为。

## 影响范围

- `frontend/src/store/useStore.ts`
- `frontend/src/store/useSkillStore.ts`
- `frontend/src/store/expertConversationModel.ts`
- 对应前端回归测试源码

后端、数据库、Electron IPC/preload、专家缓存和样式均不修改。

## 风险

- 如果 generation 判断放置错误，可能误丢弃最新列表响应。通过单调递增且仅在提交响应前比较规避。
- 绑定接口摘要为空时可能缺少头像或名称。保留当前已解析专家摘要作为单一降级值，不新增网络重试。
- 会话列表刷新与新会话本地展示字段合并时可能丢失服务端字段。继续复用 `presentActiveExpert()` 的“服务端会话字段优先”合并语义。

## 验证方式

- 前端 TypeScript 类型检查。
- `git diff --check`。
- 经用户授权后运行相关前端状态测试。
- 重启 Electron，分别从 SkillHub 专家市场、内置专家和“我的专家”召唤，确认进入新会话后右上角显示专家名称及“已激活”，刷新页面后仍保持。
