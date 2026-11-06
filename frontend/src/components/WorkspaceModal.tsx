import { useState, useEffect } from "react";
import { useStore } from "../store/useStore";
import { X, Trash2, Pencil, Check, FolderOpen } from "lucide-react";
import { WorkspaceIcon, WORKSPACE_ICON_CHOICES } from "./WorkspaceIcon";
import { pickDirectory } from "../api/client";

const ICON_CHOICES = WORKSPACE_ICON_CHOICES;

export default function WorkspaceModal() {
  const {
    showWorkspaceManager, setShowWorkspaceManager,
    workspaces, composerWorkspaceId, currentConvId, conversations,
    workspaceCreationDraft, clearWorkspaceCreationDraft,
    createWorkspace, activateWorkspace, updateWorkspace, deleteWorkspace,
  } = useStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", dirPath: "", icon: "folder" });
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createdWorkspaceId, setCreatedWorkspaceId] = useState<string | null>(null);
  const selectedWorkspaceId = currentConvId
    ? conversations.find((conversation) => conversation.id === currentConvId)
        ?.workspaceId ?? null
    : composerWorkspaceId;

  useEffect(() => {
    if (showWorkspaceManager) {
      setConfirmDel(null);
      // 创建草稿与弹窗由 Store 原子打开；消费后表单由组件本地持有。
      if (workspaceCreationDraft) {
        setEditingId(null);
        setForm({
          name: workspaceCreationDraft.name,
          dirPath: workspaceCreationDraft.dirPath,
          icon: workspaceCreationDraft.icon,
        });
        clearWorkspaceCreationDraft();
      } else {
        setEditingId(null);
        setConfirmDel(null);
        setForm({ name: "", dirPath: "", icon: "folder" });
      }
      setSaving(false);
      setSaveError(null);
      setCreatedWorkspaceId(null);
    }
  }, [showWorkspaceManager]);

  if (!showWorkspaceManager) return null;

  const startCreate = () => {
    setEditingId(null);
    setConfirmDel(null);
    setForm({ name: "", dirPath: "", icon: "folder" });
    setCreatedWorkspaceId(null);
    setSaveError(null);
  };
  const startEdit = (ws: any) => {
    setEditingId(ws.id);
    setForm({ name: ws.name, dirPath: ws.dirPath || "", icon: ws.icon || "folder" });
    setConfirmDel(null);
    setCreatedWorkspaceId(null);
    setSaveError(null);
  };
  const activateAndClose = async (workspaceId: string) => {
    await activateWorkspace(workspaceId);
    clearWorkspaceCreationDraft();
    setShowWorkspaceManager(false);
  };
  const save = async () => {
    if (saving) return;
    const name = form.name.trim();
    if (!name) {
      setSaveError("请输入空间名称");
      return;
    }
    setSaving(true);
    setSaveError(null);
    let workspaceExists = Boolean(createdWorkspaceId);
    try {
      if (editingId) {
        await updateWorkspace(editingId, {
          name,
          dirPath: form.dirPath,
          icon: form.icon,
        });
        setEditingId(null);
        setForm({ name: "", dirPath: "", icon: "folder" });
        return;
      }

      let workspaceId = createdWorkspaceId;
      if (!workspaceId) {
        const workspace = await createWorkspace(
          name,
          form.dirPath,
          form.icon,
        );
        workspaceId = workspace.id;
        workspaceExists = true;
        setCreatedWorkspaceId(workspace.id);
      }
      await activateAndClose(workspaceId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setSaveError(
        workspaceExists
          ? `空间已创建，但选中失败：${detail}`
          : detail || "创建空间失败，请重试",
      );
    } finally {
      setSaving(false);
    }
  };
  const doDelete = async (id: string) => {
    await deleteWorkspace(id);
    setConfirmDel(null);
  };

  return (
    <div className="modal-overlay" onMouseDown={() => {
      if (!saving) setShowWorkspaceManager(false);
    }}>
      <div className="modal-panel ws-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">工作空间</span>
          <button
            className="modal-close"
            disabled={saving}
            onClick={() => setShowWorkspaceManager(false)}
          ><X size={16} /></button>
        </div>

        <div className="ws-modal-body">
          {/* 列表：已有空间 */}
          <div className="ws-list">
            {workspaces.length === 0 && (
              <div className="ws-empty-hint">还没有工作空间，创建一个吧</div>
            )}
            {workspaces.map((w) => (
              <div key={w.id} className={`ws-row ${w.id === selectedWorkspaceId ? "active" : ""}`}>
                <button className="ws-row-main" disabled={saving} onClick={() => {
                  if (saving) return;
                  setSaving(true);
                  setSaveError(null);
                  void activateAndClose(w.id)
                    .catch((error) => {
                      setSaveError(
                        error instanceof Error ? error.message : String(error),
                      );
                    })
                    .finally(() => setSaving(false));
                }}>
                  {/* 目录图标 + 名 + 路径 */}
                  <span className="ws-row-icon"><WorkspaceIcon name={w.icon} /></span>
                  <span className="ws-row-text">
                    <span className="ws-row-name">{w.name}</span>
                    <span className="ws-row-dir">{w.dirPath || "未关联目录"}</span>
                  </span>
                  {w.id === selectedWorkspaceId && <Check size={14} className="ws-row-check" />}
                </button>
                <div className="ws-row-actions">
                  {confirmDel === w.id ? (
                    <span className="ws-confirm">
                      删除？<button className="ws-confirm-yes" onClick={() => doDelete(w.id)}>确认</button>
                      <button className="ws-confirm-no" onClick={() => setConfirmDel(null)}>取消</button>
                    </span>
                  ) : (
                    <>
                      <button className="ws-icon-btn" title="编辑" onClick={() => startEdit(w)}><Pencil size={13} /></button>
                      <button className="ws-icon-btn danger" title="删除" onClick={() => setConfirmDel(w.id)}><Trash2 size={13} /></button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 编辑 / 新建表单（以目录为核心） */}
          <div className="ws-form">
            <div className="ws-form-title">{editingId ? "编辑空间" : "新建工作空间"}</div>
            
            {/* 名称 — 可自动从目录名推导 */}
            <label className="ws-field">
              <span>名称</span>
              <input
                className="ws-input" value={form.name}
                placeholder="如：pi-a、ragflow"
                autoFocus
                disabled={saving || Boolean(createdWorkspaceId)}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter" && !saving) void save(); }}
              />
            </label>

            {/* 关联目录 — 核心字段 */}
            <label className="ws-field">
              <span>关联目录</span>
              <div className="ws-input-row">
                <input
                  className="ws-input" value={form.dirPath}
                  placeholder="如：选择一个本地工作目录"
                  disabled={saving || Boolean(createdWorkspaceId)}
                  onChange={(e) => setForm({ ...form, dirPath: e.target.value })}
                />
                <button type="button" className="ws-browse-btn" title="浏览"
                  disabled={saving || Boolean(createdWorkspaceId)}
                  onClick={async (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  try {
                    const data = await pickDirectory();
                    const selectedPath = data.path;
                    if (data.cancelled || !selectedPath) return;
                    const selectedName = data.name ||
                      selectedPath.split(/[\\/]/).filter(Boolean).pop() || "新空间";
                    setForm((prev) => ({
                      ...prev,
                      dirPath: selectedPath,
                      name: prev.name || selectedName,
                    }));
                  } catch (e) {
                    console.error("[pick-dir] error:", e);
                  }
                }}><FolderOpen size={14} /></button>
              </div>
            </label>

            {/* 图标 */}
            <div className="ws-field">
              <span>图标</span>
              <div className="ws-icon-grid">
                {ICON_CHOICES.map((ic) => (
                  <button
                    key={ic}
                    className={`ws-icon-pick ${form.icon === ic ? "active" : ""}`}
                    disabled={saving || Boolean(createdWorkspaceId)}
                    onClick={() => setForm({ ...form, icon: ic })}
                  ><WorkspaceIcon name={ic} /></button>
                ))}
              </div>
            </div>

            {saveError && (
              <div className="ws-form-error" role="alert">{saveError}</div>
            )}

            <div className="ws-form-actions">
              {editingId && <button className="btn-ghost" disabled={saving} onClick={startCreate}>新建</button>}
              <button className="btn-primary" disabled={saving} onClick={() => void save()}>
                {saving
                  ? "处理中…"
                  : editingId
                  ? "保存"
                  : createdWorkspaceId
                  ? "重试选中"
                  : "创建空间"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
