# 图片附件直接进入多模态模型设计

## 背景

当前应用已经能够通过文件选择、拖放以及剪贴板 `Ctrl+V` 将图片保存为受管附件，并把附件记录关联到用户消息。但图片附件进入 Prompt Runtime 后只保留名称、MIME、大小、本地路径和 `contentUnavailableReason: "binary_asset"`。实际调用 Pi `AgentSession.prompt()` 时仅传入文本参数，没有传入 `PromptOptions.images`。

因此当前图片理解依赖模型先从文本化的附件元数据中发现路径，再主动调用 `read` 工具。该链路存在三个问题：Ask 模式没有 `read` 工具；Plan/Craft 模式下模型可能不调用 `read`；即使附件上传成功，模型也可能在没有看到像素的情况下直接回答，从而出现推荐外部 OCR 工具等错误结果。

Pi `AgentSession.prompt(text, options)` 已原生支持 `options.images: ImageContent[]`，Pi 的公开 `createReadTool()` 也已经包含图片格式检测、解码、方向处理、尺寸限制和自动缩放能力。本次应复用这些能力，把受管图片附件确定性地转换成首轮模型输入，而不是继续依赖模型自主选工具。

## 目标

- 用户发送包含受支持图片的消息时，在首次模型调用中直接传入图片内容。
- Ask、Plan、Craft 三种普通会话模式使用一致的图片输入行为，不依赖工具可见性。
- 复用 Pi 已有图片处理能力，避免自行维护图片解码、旋转和缩放实现。
- 保留现有附件元数据和消息历史展示，不改变附件数据库及前端发送协议。
- 只允许受管附件目录内、由附件记录明确引用的图片进入模型输入。
- 图片加载或处理失败时明确终止本轮，避免模型在未看到图片的情况下静默猜测。

## 非目标

- 不为不支持视觉输入的底层模型实现 OCR 降级、第三方 OCR 或视觉模型自动切换。
- 不把 PDF、Office、字体、SVG、ICO 等二进制附件作为原生图片输入。
- 不修改附件上传数量、25 MB 单文件上限或数据库结构。
- 不自行新增业务数据库字段保存 base64 图片；Pi 原生会话按照 SDK 的多模态消息语义保留 image block，以支持后续追问引用。
- 不改变普通文本附件的正文抽取逻辑。

## 现状

### 附件上下文

`buildAttachmentPromptItemsFromRecords()` 将 PNG、JPG、JPEG、GIF、WebP、SVG、ICO 和字体等资产标记为 `binary_asset`。其中图片没有正文，只有受管本地路径。

### Prompt 调用

`AgentProvider.executePrompt()` 构建 `PromptEnvelope` 后调用：

```ts
activeEntry.session.prompt(userPrompt, {
  expandPromptTemplates: false,
});
```

因此模型首轮只收到 `<turn_payload>` 文本。

### Pi 原生能力

Pi `AgentSession.prompt()` 的公开选项包含：

```ts
interface PromptOptions {
  expandPromptTemplates?: boolean;
  images?: ImageContent[];
}
```

Pi 公开导出的 `createReadTool(cwd)` 在读取受支持图片时，会检测真实格式、调用内置 `processImage()` 自动处理图片，并返回 `{ type: "image", data, mimeType }` 内容块。该能力和模型通过工具读取图片时使用的是同一条处理链。

## 方案

### 1. 构建受管图片输入

在 Agent 层新增一个职责单一的图片附件输入构建模块。输入为本轮 `AttachmentContextItem[]`、会话工作目录和当前模型，输出为 Pi `ImageContent[]`。

处理规则：

1. 只选择扩展名为 PNG、JPG、JPEG、GIF 或 WebP 的附件；
2. 要求附件包含 `id`、`name` 和绝对 `path`；
3. 校验规范化路径必须严格等于 `<appData>/attachments/<id>/<name>`，禁止把任意上下文路径自动作为图像发送；
4. 保持用户附件顺序；
5. 使用 `createReadTool(sessionRoot.cwd)` 执行图片读取并提取返回结果中的 `image` 内容块；
6. 没有图片附件时返回空数组，不改变纯文本调用；
7. 图片附件存在但无法读取、格式不匹配或处理结果没有图片块时抛出带附件名称的明确错误。

选择调用 Pi 的公开 `createReadTool()`，而不是复制其内部 `processImage()`，原因是后者不是包的公开导出；复用公开工具工厂可以继续获得 Pi 的格式探测、EXIF/方向处理、缩放和未来维护更新。

### 2. 模型能力校验

图片构建前检查当前 `AgentSession.model.input` 是否包含 `"image"`：

- 支持图片：继续构建并注入；
- 不支持图片：抛出明确错误，提示当前模型不支持图片输入；
- 无图片附件：不执行该校验，纯文本消息保持原行为。

不做静默降级，因为让模型只看到路径后继续回答会重现当前错误。

### 3. 注入首次模型调用

在 `executePrompt()` 已完成模型切换、Prompt Envelope 构建和 Session 重绑后，构建本轮图片输入，并把它传给现有调用：

```ts
activeEntry.session.prompt(userPrompt, {
  expandPromptTemplates: false,
  images: promptImages.length > 0 ? promptImages : undefined,
});
```

附件元数据继续保留在 `<turn_payload>` 中，模型既能获得附件名称与用户问题的对应关系，也能在同一条用户消息中直接看到图像内容。

该行为与 Mode 工具策略解耦，因此 Ask 模式即使没有 `read` 工具，也能分析用户本轮显式上传的图片。

### 4. 错误和隐私边界

- 只读取当前轮 `opts.attachments` 中的图片，不扫描工作区或附件目录。
- 路径校验失败直接阻止发送，不尝试读取目录外文件。
- 图片处理错误直接进入现有 prompt 失败处理和会话错误事件，不发起不含图片的模型请求。
- base64 数据不写入业务 SQLite、Prompt Envelope、Manifest、日志或 UI 消息正文；Pi 原生会话文件会按照 SDK 行为保存本轮多模态 user message，以维持上下文连续性。
- SVG、ICO 和字体仍保留 `binary_asset` 元数据，但不会误传为模型图片。

## 影响范围

- `src/agent/provider.ts`：在实际 `AgentSession.prompt()` 调用中传入图片。
- `src/agent/` 下新增图片附件输入构建模块。
- `test/src/agent/` 下新增对应源码级回归测试。
- `docs/architecture/prompt-runtime-v2-design.md`：补充附件图片属于模型调用载荷、而非纯文本 Prompt 的说明。
- 既有剪贴板上传、Electron IPC、附件数据库、前端展示和普通文档抽取逻辑保持不变。

## 风险

- 项目当前为动态配置的模型统一声明 `input: ["text", "image"]`；如果用户填写的实际模型不接受视觉输入，供应商仍可能返回请求错误。本次会正确传图并保留上游错误，不伪装成图片分析成功；模型能力配置精细化属于后续独立问题。
- 多张高分辨率图片会增加预处理时间、请求体和模型 token/费用；沿用现有最多 10 个附件与 25 MB 单文件上限，并复用 Pi 自动缩放。
- GIF 由 Pi 图片处理链决定静态化/转换语义，本项目不单独实现动画帧分析。
- Prompt Runtime 目前还有一个未被主 Provider 调用的 `PromptAwareHarness` 抽象；本次修改实际生产调用点 `AgentProvider.executePrompt()`，不同时重构无关抽象。
- Pi 原生会话历史保存 image block，会增加会话文件体积和后续上下文成本；现有附件数量限制、Pi 图片缩放和会话压缩机制共同控制该风险。

## 验证方式

遵循项目约束，本次默认只执行：

1. `npx tsc --project tsconfig.electron.json --noEmit`
2. `git diff --check`
3. 静态核对纯文本消息仍不携带 `images`；图片消息保持附件顺序并携带 `ImageContent[]`
4. 静态核对 Ask 模式无需激活 `read` 工具也会注入图片
5. 编写但不运行回归测试，覆盖图片筛选、路径边界、处理失败、模型不支持图片和成功注入

建议人工验收：

1. Windows 截图后 `Ctrl+V`，输入“图片里写了什么”，模型直接识别图片而不是推荐 OCR；
2. 在 Ask 模式重复上述操作，仍能识别；
3. 一条消息上传两张图片，模型能按顺序比较；
4. 使用不支持视觉的实际模型时，显示明确的供应商或能力错误，不生成猜测答案；
5. 纯文本、PDF、Word 等既有附件行为不变。

## 实施结果

- 新增 `src/agent/prompt-images.ts`，筛选 PNG、JPEG、GIF、WebP 受管附件并校验路径边界。
- 通过 Pi 公开 `createReadTool()` 复用真实格式检测、图片处理和自动缩放能力。
- `LocalPiProvider` 在首次 `AgentSession.prompt()` 调用中传入 `PromptOptions.images`，图片输入不再依赖模型主动调用 `read`，Ask、Plan、Craft 使用同一链路。
- 图片读取失败、格式不匹配或模型元数据不支持图片时，本轮明确失败，不退化为无图回答。
- 已新增源码级回归测试并完成测试源码 TypeScript 类型检查；遵循项目约束，未运行测试套件。
- 后端全量 TypeScript 类型检查仍被既有 `src/domains/skill/node/store.ts` 两处 `version` 类型错误阻断，本次新增模块未产生类型错误。
