# Composer 文本插入式技能选择设计

> 状态：已确认（2026-08-03）
> 背景：`2026-08-03-multi-skill-composer.md` 计划的 chip 方案在用户实际使用中暴露问题——技能 chip 显示在输入框上方独立一行，无法与用户描述的文字在同一行混合编排（例如用 `/skill-creator` 创建技能时，描述中要用 `/read-doc` 读取某个文档）。

## 一、目标

技能选择与用户文字在同一行自由混合编排，所见即所得：技能命令以普通文本形式存在于输入框中，位置由用户自由控制。

```
┌────────────────────────────────────────┐
│ /skill-creator 请创建技能，其中         │
│ /read-doc 读取这个文档 ｜(光标)         │
└────────────────────────────────────────┘
```

## 二、已确认决策

1. **交互形态**：文本插入——选择技能时把 `/技能名` 插入到输入框光标处，成为普通文本的一部分。
2. **移除 chip 行**：删除 `selectedSkills` state 与技能 chip 渲染，回归纯文本 slash 模型，`text` 是唯一状态源。
3. **气泡原样显示**：消息气泡显示用户输入原文（含 `/技能` 前缀），所见即所得，历史记录可追溯。

## 三、交互模型

- 输入 `/` 或 `/skill xxx` 触发菜单（现有触发逻辑不变）。
- 菜单选中技能 → 在光标位置插入 `/技能名`；若光标前一个字符不是空格则自动补一个空格；光标落在技能名之后。
- 输入 `/skill data` 后选中 → 触发词 `/skill data` 被替换为 `/data-analysis`。
- 技能名即文本：可自由移动、删除、撤销，无第二套状态。
- 系统指令（`/brainstorm`、`/plan`、`/implement`、`/goal`、`/subagent` 等）同样走光标插入。
- skill-creator 会话：无固定 chip，普通输入；技能/模式菜单入口仍隐藏（现有逻辑保留）。

## 四、状态模型

- **删除**：`selectedSkills` state、`ActiveSkillTag`、`appendSelectedSkill`/`removeSelectedSkill`、`composerSelectionModel.ts`。
- **保留**：`.composer-pending` 仅显示 connector 与附件 chip。
- `textarea` 的 `selectionStart` 提供光标位置。

## 五、发送链路

- `buildComposerPayload` 移除技能拼装（`skillNames`/`skillName` 参数），保留 connector/attachment 逻辑。
- `sendMessage(payload.text)` 原文发送；气泡原样显示。
- 附件-only 回退「请分析附件内容」保留。
- **后端零改动**：文本中的 `/技能` 由现有 `provider.ts` 正则强激活第一个技能，其余技能靠 `<skills>` 注入的元数据由模型遵循。

## 六、核心可测单元

纯函数（放 `composerMenuModel.ts`）：

```ts
insertSkillAtCursor(text: string, caret: number, skillCmd: string): {
  text: string;
  caret: number;
}
```

语义：
- `skillCmd` 传入形如 `/read-doc` 的命令串（含斜杠）。
- 插入后若插入位置前一个字符不是空格，则在技能名前补一个空格；插入后若技能名后紧跟非空格字符，则在技能名后补一个空格。
- 返回的新光标位置在技能名之后（含补的空格之前）。

测试覆盖：空文本、文本中间插入、紧贴文字插入、替换触发词（`/skill data` 场景由 Composer 调用方先替换触发词再调用本函数或组合处理）、光标位置正确性。

## 七、文件影响

| 文件 | 动作 |
|------|------|
| `frontend/src/components/Composer.tsx` | 改：菜单选中改为光标插入（`handleSelectSlashCmd`/`handleDynamicSkill`）；删除 chip 渲染与 `selectedSkills` state；`handleSend` 不再传 `skillNames` |
| `frontend/src/components/composerMenuModel.ts` | 改：删除技能拼装逻辑，新增 `insertSkillAtCursor` |
| `frontend/src/components/composerMenuModel_test.ts` | 改：删除技能拼装测试，新增 `insertSkillAtCursor` 测试 |
| `frontend/src/components/composerSelectionModel.ts` | 删除 |
| `frontend/src/components/composerSelectionModel_test.ts` | 删除 |
| 后端 | 无 |

## 八、与其他计划的关系

`2026-08-03-multi-skill-composer.md` 的 Task 1（payload `skillNames[]` 拼装）已提交但被本设计取代——拼装逻辑回退为纯文本，`skillNames` 参数移除。Task 2/3 的 chip 产物（`composerSelectionModel.ts`）删除。该计划文件标记为被本设计取代，不再执行。

## 九、验证

- 前端模型测试：`deno test --allow-read --allow-env frontend/src/components/composerMenuModel_test.ts`
- 前端构建：`npm run build`
- 手动验证：输入 `/skill data` 选中后触发词被替换且光标位置正确；文本中间插入技能；技能名可随文本编辑；发送后气泡原样显示。
- 不运行 `gen:frontend`，不触碰 `src/ui/frontend-assets.ts`（用户已有未提交改动）。
