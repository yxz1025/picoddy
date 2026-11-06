# 新建工作空间并自动选中流程设计

## 一、背景

当前工作空间选择器提供两个创建入口：

1. “新建工作空间”：打开工作空间管理弹窗，由用户填写名称、关联目录和图标。
2. “打开本地文件夹”：先选择本地目录，再打开工作空间管理弹窗并预填目录信息。

现有实现能够创建工作空间，并在部分场景设置 `composerWorkspaceId`，但创建完成后没有关闭弹窗；同时，“打开本地文件夹”通过直接修改 Zustand 内部字段传递目录，存在状态更新和弹窗打开顺序不稳定的问题。在已有会话中，界面优先读取会话绑定的 `workspaceId`，单独设置 `composerWorkspaceId` 也不能保证新空间成为当前选中空间。

## 二、目标

完成以下一致性体验：

- 用户选择本地文件夹后，工作空间弹窗稳定打开并正确预填名称和目录。
- 用户点击“创建空间”后，系统只创建一次工作空间。
- 创建成功后，新空间成为当前上下文的活动空间。
- 选中状态完成后自动关闭工作空间弹窗。
- 创建、刷新或绑定失败时保留弹窗和表单，允许用户重试。
- 新会话与已有会话使用同一个“激活空间”语义。

## 三、非目标

本次不处理以下内容：

- 工作空间目录迁移或复制。
- 自动扫描目录内容并创建索引。
- 合并重复工作空间。
- 修改后端工作空间表结构。
- 创建空间后自动发送消息或创建新会话。

## 四、现状问题

### 4.1 创建成功后弹窗未关闭

`WorkspaceModal.save()` 创建成功后只清空编辑状态和表单，没有关闭 `showWorkspaceManager`。

### 4.2 待创建目录绕过 Zustand 更新

“打开本地文件夹”当前直接执行：

```ts
useStore.getState()._pendingDirPath = directory;
```

该赋值没有通过 Zustand `set()`，无法保证订阅组件及时收到变化；而且当前调用顺序先打开弹窗、再写入目录，弹窗初始化可能读到空值。

### 4.3 选中状态存在两种来源

Composer 的活动空间遵循：

```text
已有会话：currentConversation.workspaceId
没有会话：composerWorkspaceId
```

因此创建后只设置 `composerWorkspaceId`，在已有会话场景不会改变当前显示和实际绑定。

### 4.4 缺少提交状态和错误恢复

创建按钮没有提交中状态，连续点击可能产生重复请求；创建失败也缺少明确的表单内错误反馈。

## 五、目标交互流程

### 5.1 “新建工作空间”入口

```text
点击“新建工作空间”
  → 关闭工作空间下拉框
  → 打开工作空间弹窗
  → 展示空白创建表单
  → 用户填写名称、目录和图标
  → 点击“创建空间”
```

### 5.2 “打开本地文件夹”入口

```text
点击“打开本地文件夹”
  → 打开系统目录选择器
  → 用户选择目录
  → 原子写入创建草稿并打开工作空间弹窗
  → 关闭工作空间下拉框
  → 自动预填目录名、完整路径和 folder 图标
  → 用户确认或修改
  → 点击“创建空间”
```

用户取消系统目录选择时，流程直接结束，不打开弹窗，也不改变当前空间。

### 5.3 创建与激活

```text
校验表单
  → 进入 saving 状态
  → 创建 Workspace 并取得新 ID
  → 刷新工作空间列表
  → 激活新 Workspace
      ├─ 没有当前会话：设置 composerWorkspaceId
      └─ 存在当前会话：绑定 currentConvId 与 workspaceId
  → 等待选中状态刷新完成
  → 清理创建草稿和表单
  → 关闭工作空间弹窗
```

关键顺序必须保持为：

```text
创建成功 → 激活成功 → 关闭弹窗
```

## 六、状态设计

### 6.1 创建草稿

将内部字段 `_pendingDirPath` 替换或封装为明确的创建草稿：

```ts
interface WorkspaceCreationDraft {
  source: "blank" | "local-directory";
  name: string;
  dirPath: string;
  icon: string;
}
```

Store 增加动作：

```ts
openWorkspaceCreator(draft?: WorkspaceCreationDraft): void;
clearWorkspaceCreationDraft(): void;
```

`openWorkspaceCreator()` 必须使用一次 `set()` 原子更新：

```ts
set({
  workspaceCreationDraft: draft ?? emptyDraft,
  showWorkspaceManager: true,
});
```

### 6.2 弹窗提交状态

`WorkspaceModal` 本地维护：

```ts
type WorkspaceSaveState = "idle" | "saving";

const [saveState, setSaveState] = useState<WorkspaceSaveState>("idle");
const [saveError, setSaveError] = useState<string | null>(null);
```

提交期间：

- 禁用“创建空间”按钮。
- 禁用关闭弹窗和重复提交，或在关闭前提示正在创建。
- 按钮文案显示“创建中…”。
- 清除上一次错误提示。

## 七、Store API 调整

### 7.1 创建工作空间返回实体

将：

```ts
createWorkspace(...): Promise<void>
```

调整为：

```ts
createWorkspace(...): Promise<Workspace>
```

后端 `POST /api/workspaces` 已返回完整 Workspace，不需要调整接口响应结构。

建议 `createWorkspace()` 只负责：

1. 调用创建接口。
2. 刷新 `workspaces`。
3. 返回新 Workspace。

选中行为交给单独的激活动作，避免“创建”和“绑定当前会话”形成隐式耦合。

### 7.2 统一激活工作空间

增加：

```ts
activateWorkspace(id: string): Promise<void>
```

伪代码：

```ts
activateWorkspace: async (id) => {
  const currentConvId = get().currentConvId;

  if (!currentConvId) {
    set({ composerWorkspaceId: id });
    return;
  }

  await apiPost(`/api/conversations/${currentConvId}/workspace`, {
    workspaceId: id,
  });
  await get().loadConversations();
}
```

Composer 下拉列表、WorkspaceModal 左侧列表以及新建成功后的选择，统一调用该动作。

## 八、组件修改

### 8.1 Composer.tsx

“打开本地文件夹”成功选择目录后：

1. 生成 `WorkspaceCreationDraft`。
2. 调用 `openWorkspaceCreator(draft)`。
3. 关闭工作空间下拉框。

删除直接修改 `_pendingDirPath` 的逻辑。

“新建工作空间”入口调用：

```ts
openWorkspaceCreator();
onClose();
```

### 8.2 WorkspaceModal.tsx

弹窗打开时从 `workspaceCreationDraft` 初始化表单，但不通过监听草稿清空动作再次重置表单。

创建流程伪代码：

```ts
const save = async () => {
  if (saveState === "saving") return;

  const name = form.name.trim();
  if (!name) {
    setSaveError("请输入空间名称");
    return;
  }

  setSaveState("saving");
  setSaveError(null);

  try {
    if (editingId) {
      await updateWorkspace(editingId, form);
      setSaveState("idle");
      return;
    }

    const workspace = await createWorkspace(
      name,
      form.dirPath,
      form.icon,
    );
    await activateWorkspace(workspace.id);
    clearWorkspaceCreationDraft();
    setShowWorkspaceManager(false);
  } catch (error) {
    setSaveError(toUserMessage(error));
  } finally {
    setSaveState("idle");
  }
};
```

编辑现有空间是否保存后关闭保持现状，本次仅规定新建成功后自动关闭。

### 8.3 其他调用方

`MicroappPickerModal` 当前依赖 `createWorkspace()` 的隐式选中行为。将创建行为拆分后，需要明确调整为：

```ts
const workspace = await createWorkspace(...);
setComposerWorkspaceId(workspace.id);
```

避免本次重构导致微应用工作空间绑定回归。

## 九、异常处理

### 9.1 目录选择取消

- 不打开弹窗。
- 不修改创建草稿。
- 不修改当前选中空间。

### 9.2 创建失败

- 保持弹窗打开。
- 保留名称、目录和图标。
- 展示错误提示。
- 恢复“创建空间”按钮。

### 9.3 激活或会话绑定失败

- 已创建的空间保留在列表中。
- 弹窗保持打开并选中新建空间行。
- 提示“空间已创建，但绑定当前会话失败，请重试选择”。
- 不重复创建空间。

为区分“创建失败”和“绑定失败”，组件需要在创建成功后保存 `createdWorkspaceId`。重试时仅重新执行激活，不再次调用创建接口。

### 9.4 重复提交

`saveState === "saving"` 时直接忽略后续提交，并禁用按钮和 Enter 提交。

## 十、测试方案

### 10.1 Store 单元测试

- `openWorkspaceCreator()` 一次更新草稿和弹窗状态。
- `createWorkspace()` 返回服务端生成的 Workspace。
- 没有当前会话时，`activateWorkspace()` 更新 `composerWorkspaceId`。
- 存在当前会话时，`activateWorkspace()` 调用会话绑定接口并刷新会话列表。
- 创建失败不修改选中空间。
- 绑定失败不发起第二次创建请求。

### 10.2 组件测试

- 从“打开本地文件夹”进入时正确预填名称和路径。
- 取消目录选择不会打开弹窗。
- 创建期间按钮禁用，连续点击只发送一次请求。
- 创建并激活成功后弹窗关闭。
- 创建失败后弹窗和输入内容保留。
- 绑定失败后可仅重试激活。
- 编辑已有空间保存后行为不受影响。

### 10.3 回归测试

- 工作空间下拉列表直接选择仍然有效。
- 已有会话可以切换或清除绑定空间。
- 微应用创建/绑定工作空间仍能正确设置 Composer 空间。
- 删除当前空间后 Composer 选择被清空。
- 新建会话发送第一条消息时绑定到新创建的空间。

## 十一、验收标准

- 选择本地目录后，创建弹窗每次都能正确预填目录信息。
- 点击“创建空间”后只产生一条 Workspace 记录。
- 创建成功后弹窗自动关闭。
- Composer 立即显示新空间名称。
- 再次打开下拉列表时，新空间显示选中标记。
- 已有会话场景中，会话数据库绑定同步更新。
- 创建或绑定失败时不丢失表单，且不会重复创建空间。
- 不影响编辑、删除、普通选择和微应用空间绑定流程。

## 十二、实施顺序

1. 调整 Store 类型和创建返回值。
2. 增加创建草稿与原子打开动作。
3. 增加统一 `activateWorkspace()` 动作。
4. 修改 Composer 两个创建入口。
5. 修改 WorkspaceModal 创建、关闭和错误处理。
6. 更新微应用等 `createWorkspace()` 调用方。
7. 补充 Store 和组件回归测试。
8. 运行 Electron/前端 TypeScript 检查及 `git diff --check`。

## 十三、2026-09-20 实施记录

本方案已完成实现：

- 使用 `workspaceCreationDraft` 和 `openWorkspaceCreator()` 原子传递本地目录并打开弹窗，移除对 Zustand 内部字段的直接赋值。
- `createWorkspace()` 改为返回新建的 Workspace，并在列表刷新失败时保证返回实体仍进入本地列表。
- 新增 `activateWorkspace()`，没有当前会话时更新 Composer 预选空间，已有会话时更新会话绑定。
- Composer 普通选择、工作空间弹窗列表选择和新建后的激活使用同一套目标判断。
- 新建成功或点击弹窗内已有空间，激活完成后都会自动关闭弹窗；创建或激活失败时保留弹窗并展示错误。
- 已有会话切换空间时先更新页面本地绑定，后端失败再回滚，保证弹窗关闭时主页面已经显示目标空间。
- 激活失败后的重试只重试选中，不会重复创建 Workspace。
- 创建期间禁用表单和关闭操作，防止重复提交。
- 微应用工作空间绑定已适配“创建返回 Workspace”的新契约。
- 已补充空间激活目标和微应用新建后选中的回归测试。
