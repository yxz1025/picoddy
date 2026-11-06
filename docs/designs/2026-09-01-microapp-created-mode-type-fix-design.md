# 微应用创建完成模式类型修复设计

## 背景

Windows 构建在前端 TypeScript 检查阶段失败。`MicroappPickerModal` 创建成功后会切换到 `"created"` 模式，界面也包含对应的成功视图，但 `mode` 状态类型只声明了 `"list" | "create"`。

## 目标

- 修复 `setMode("created")` 及两个 `mode === "created"` 判断的 TypeScript 错误。
- 保留现有“列表 → 创建 → 创建完成”交互流程。
- 让前端构建能够继续检查后续代码。

## 非目标

- 不调整微应用创建、工作区绑定或 Git 分支逻辑。
- 不修改成功页样式和文案。
- 不顺带处理其他构建或类型错误。

## 现状与根因

当前状态声明为：

```tsx
useState<"list" | "create">("list")
```

实际状态机还包含 `"created"`。TypeScript 因此拒绝赋值，并将成功视图判断识别为不可能成立的比较。

## 方案

将 `mode` 的联合类型扩展为：

```tsx
"list" | "create" | "created"
```

不增加新状态变量，不删除现有成功分支。组件较小且该类型只在组件内部使用，无需额外抽取公共类型。

## 影响范围

- `frontend/src/components/MicroappPickerModal.tsx`
- 本设计文档及 `docs/README.md` 索引

## 风险

风险很低。该修改只是让静态类型与已经存在的运行时状态保持一致，不改变状态切换时机。

## 验证方式

- 执行前端 TypeScript 类型检查或前端构建。
- 执行 `git diff --check`。
- 不自动运行测试套件。
