import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CopyPlus,
  File,
  Folder,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
} from "lucide-react";
import {
  createDraftRevision,
  getDraftByConversation,
  installDraft,
  listDraftFiles,
  listInstalledSkillFiles,
  readDraftFile,
  readInstalledSkillFile,
  type SkillDraft,
  type SkillDraftFile,
  type SkillDraftReadResponse,
  validateDraft,
} from "../api/skillDrafts";
import { ApiError } from "../api/client";
import { useSkillStore } from "../store/useSkillStore";
import { useStore } from "../store/useStore";
import { shouldShowSkillDraftPanel } from "./skillDraftModel";
import "./SkillDraftPanel.css";

type PanelState =
  | "idle"
  | "loading"
  | "revising"
  | "validating"
  | "installing";
type NoticeTone = "default" | "success" | "warning";
type ContentView = "draft" | "installed";

interface SkillDraftPanelProps {
  conversationId: string;
  busy: boolean;
  messageCount: number;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === "SKILL_CONFLICT") {
      return "已存在同名技能。请在对话中修改草稿的技能名称，重新校验后再安装。";
    }
    if (error.code === "INSTALLED_SKILL_CHANGED") {
      return "已安装版本在修订期间被修改。为避免覆盖新内容，请重新创建修订版。";
    }
    return error.message || fallback;
  }
  return fallback;
}

export default function SkillDraftPanel({
  conversationId,
  busy,
  messageCount,
}: SkillDraftPanelProps) {
  const loadSkills = useSkillStore((state) => state.loadSkills);
  const setShowInstalledSkills = useSkillStore(
    (state) => state.setShowInstalledSkills,
  );
  const setCategory = useStore((state) => state.setCategory);
  const setExpertPanelTab = useStore((state) => state.setExpertPanelTab);
  const requestUiConfirm = useStore((state) => state.requestUiConfirm);
  const [panelState, setPanelState] = useState<PanelState>("idle");
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [contentView, setContentView] = useState<ContentView>("draft");
  const [files, setFiles] = useState<SkillDraftFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<SkillDraftReadResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("default");
  const [refreshing, setRefreshing] = useState(false);
  const draftGeneration = useRef(0);
  const previewGeneration = useRef(0);
  const actionGeneration = useRef(0);
  const selectedPathRef = useRef<string | null>(null);
  const contentViewRef = useRef<ContentView>("draft");
  const previousBusy = useRef(busy);
  const previousMessageCount = useRef(messageCount);
  const refreshExpected = (previousBusy.current && !busy) ||
    (!busy && previousMessageCount.current !== messageCount);
  const refreshBlocked = refreshing || refreshExpected;

  const loadPreview = useCallback(
    async (
      draftId: string,
      path: string,
      generation: number,
      view: ContentView,
    ) => {
      try {
        const result = view === "installed"
          ? await readInstalledSkillFile(draftId, path)
          : await readDraftFile(draftId, path);
        if (previewGeneration.current !== generation) return;
        setPreview(result);
      } catch (error) {
        if (previewGeneration.current !== generation) return;
        setPreview(null);
        setNoticeTone("default");
        setNotice(
          errorMessage(
            error,
            view === "installed"
              ? "无法读取已安装文件，请稍后重试。"
              : "无法读取草稿文件，请稍后重试。",
          ),
        );
      }
    },
    [],
  );

  const refresh = useCallback(
    async (showLoading = false) => {
      const generation = ++draftGeneration.current;
      setRefreshing(true);
      setDraft((current) =>
        current
          ? {
            ...current,
            status: current.status === "installed" ? "installed" : "editing",
            validation: undefined,
          }
          : current
      );
      if (showLoading) setPanelState("loading");
      setNotice(null);
      setNoticeTone("default");
      try {
        const nextDraft = await getDraftByConversation(conversationId);
        const installedAvailable = nextDraft.status === "installed" ||
          Boolean(nextDraft.revisionOf);
        const nextView = nextDraft.status === "installed"
          ? "installed"
          : contentViewRef.current === "installed" && installedAvailable
          ? "installed"
          : "draft";
        const nextFiles = nextView === "installed"
          ? await listInstalledSkillFiles(nextDraft.id)
          : await listDraftFiles(nextDraft.id);
        if (draftGeneration.current !== generation) return;

        const nextSelected = nextFiles.find((item) =>
          item.path === selectedPathRef.current
        )?.path ??
          nextFiles.find((item) => item.path === "SKILL.md")?.path ??
          nextFiles[0]?.path ??
          null;
        setDraft(nextDraft);
        setContentView(nextView);
        contentViewRef.current = nextView;
        setFiles(nextFiles);
        setSelectedPath(nextSelected);
        selectedPathRef.current = nextSelected;
        setPreview(null);
        if (nextSelected) {
          const previewToken = ++previewGeneration.current;
          await loadPreview(
            nextDraft.id,
            nextSelected,
            previewToken,
            nextView,
          );
        }
      } catch (error) {
        if (draftGeneration.current !== generation) return;
        if (error instanceof ApiError && error.status === 404) {
          setDraft(null);
          setFiles([]);
          setSelectedPath(null);
          selectedPathRef.current = null;
          setPreview(null);
          setNotice("尚未生成技能草稿。描述你的需求后，草稿文件会显示在这里。");
        } else {
          setDraft((current) =>
            current
              ? {
                ...current,
                status: current.status === "installed"
                  ? "installed"
                  : "editing",
                validation: undefined,
              }
              : current
          );
          setNotice(errorMessage(error, "草稿加载失败，请稍后重试。"));
        }
      } finally {
        if (draftGeneration.current === generation) {
          setRefreshing(false);
          if (showLoading) setPanelState("idle");
        }
      }
    },
    [conversationId, loadPreview],
  );

  useEffect(() => {
    draftGeneration.current += 1;
    previewGeneration.current += 1;
    actionGeneration.current += 1;
    setDraft(null);
    setFiles([]);
    setContentView("draft");
    contentViewRef.current = "draft";
    setSelectedPath(null);
    selectedPathRef.current = null;
    setPreview(null);
    setNotice(null);
    setNoticeTone("default");
    setRefreshing(false);
    setPanelState("idle");
    void refresh(true);
    return () => {
      draftGeneration.current += 1;
      previewGeneration.current += 1;
      actionGeneration.current += 1;
    };
  }, [conversationId, refresh]);

  useEffect(() => {
    const generationFinished = previousBusy.current && !busy;
    const settledMessageAdded = !busy &&
      previousMessageCount.current !== messageCount;
    previousBusy.current = busy;
    previousMessageCount.current = messageCount;
    if (generationFinished || settledMessageAdded) void refresh();
  }, [busy, messageCount, refresh]);

  const selectFile = async (file: SkillDraftFile) => {
    if (
      !draft ||
      refreshBlocked ||
      panelState !== "idle" ||
      file.path === selectedPath
    ) return;
    const generation = ++previewGeneration.current;
    setSelectedPath(file.path);
    selectedPathRef.current = file.path;
    setPreview(null);
    setNotice(null);
    setNoticeTone("default");
    await loadPreview(draft.id, file.path, generation, contentView);
  };

  const showContentView = async (view: ContentView) => {
    if (
      !draft || view === contentView || refreshBlocked ||
      panelState !== "idle"
    ) return;
    const generation = ++previewGeneration.current;
    setPanelState("loading");
    setNotice(null);
    setNoticeTone("default");
    try {
      const nextFiles = view === "installed"
        ? await listInstalledSkillFiles(draft.id)
        : await listDraftFiles(draft.id);
      if (previewGeneration.current !== generation) return;
      const nextSelected = nextFiles.find((item) =>
        item.path === "SKILL.md"
      )?.path ??
        nextFiles[0]?.path ??
        null;
      setContentView(view);
      contentViewRef.current = view;
      setFiles(nextFiles);
      setSelectedPath(nextSelected);
      selectedPathRef.current = nextSelected;
      setPreview(null);
      if (nextSelected) {
        await loadPreview(draft.id, nextSelected, generation, view);
      }
    } catch (error) {
      if (previewGeneration.current === generation) {
        setNotice(
          errorMessage(
            error,
            view === "installed"
              ? "无法读取已安装内容，请稍后重试。"
              : "无法读取修订草稿，请稍后重试。",
          ),
        );
      }
    } finally {
      if (previewGeneration.current === generation) setPanelState("idle");
    }
  };

  const handleCreateRevision = async () => {
    if (
      !draft || draft.status !== "installed" || refreshBlocked ||
      panelState !== "idle"
    ) return;
    const skillName = draft.skillName || "该技能";
    if (
      !(await requestUiConfirm({
        title: "创建修订版",
        message:
          `将复制已安装技能「${skillName}」的全部文件，生成新的可编辑草稿。已安装版本在重新校验并确认更新前不会改变。`,
        confirmLabel: "创建修订版",
      }))
    ) {
      return;
    }
    const generation = ++actionGeneration.current;
    setPanelState("revising");
    setNotice(null);
    setNoticeTone("default");
    try {
      const nextDraft = await createDraftRevision(draft.id);
      const nextFiles = await listDraftFiles(draft.id);
      if (actionGeneration.current !== generation) return;
      const nextSelected = nextFiles.find((item) =>
        item.path === "SKILL.md"
      )?.path ??
        nextFiles[0]?.path ??
        null;
      setDraft(nextDraft);
      setContentView("draft");
      contentViewRef.current = "draft";
      setFiles(nextFiles);
      setSelectedPath(nextSelected);
      selectedPathRef.current = nextSelected;
      setPreview(null);
      if (nextSelected) {
        const previewToken = ++previewGeneration.current;
        await loadPreview(draft.id, nextSelected, previewToken, "draft");
      }
      setNoticeTone("success");
      setNotice("修订草稿已从当前已安装版本创建，可继续在对话中修改。");
    } catch (error) {
      if (actionGeneration.current === generation) {
        setNotice(
          errorMessage(error, "创建修订版失败，请稍后重试。"),
        );
      }
    } finally {
      if (actionGeneration.current === generation) setPanelState("idle");
    }
  };

  const handleValidate = async () => {
    if (!draft || refreshBlocked || panelState !== "idle") return;
    const generation = ++actionGeneration.current;
    setPanelState("validating");
    setNotice(null);
    setNoticeTone("default");
    try {
      const validation = await validateDraft(draft.id);
      if (actionGeneration.current !== generation) return;
      setDraft((current) =>
        current
          ? {
            ...current,
            status: validation.valid ? "valid" : "editing",
            validation,
          }
          : current
      );
    } catch (error) {
      if (actionGeneration.current === generation) {
        setNoticeTone("default");
        setNotice(errorMessage(error, "草稿校验失败，请稍后重试。"));
      }
    } finally {
      if (actionGeneration.current === generation) setPanelState("idle");
    }
  };

  const handleInstall = async () => {
    if (
      !draft ||
      draft.status !== "valid" ||
      !draft.validation?.valid ||
      refreshBlocked ||
      panelState !== "idle"
    ) return;
    const skillName = draft.skillName || "未命名技能";
    const isRevision = Boolean(draft.revisionOf);
    if (
      !(await requestUiConfirm({
        title: isRevision ? "更新已安装技能" : "安装技能",
        message: isRevision
          ? `确认使用已校验的修订草稿更新技能「${skillName}」？更新将以原子方式替换，失败时保留原版本。`
          : `确认安装技能「${skillName}」？安装后可在技能页查看和管理。`,
        confirmLabel: isRevision ? "确认更新" : "确认安装",
      }))
    ) {
      return;
    }

    const generation = ++actionGeneration.current;
    setPanelState("installing");
    setNotice(null);
    setNoticeTone("default");
    try {
      const installed = await installDraft(draft.id);
      if (actionGeneration.current !== generation) return;
      const installedFiles = await listInstalledSkillFiles(draft.id);
      if (actionGeneration.current !== generation) return;
      const nextSelected = installedFiles.find((item) =>
        item.path === "SKILL.md"
      )?.path ??
        installedFiles[0]?.path ??
        null;
      setDraft((current) =>
        current
          ? {
            ...current,
            status: "installed",
            skillName: installed.name,
            revisionOf: undefined,
            revisionBaseDigest: undefined,
            revisionCreatedAt: undefined,
          }
          : current
      );
      setContentView("installed");
      contentViewRef.current = "installed";
      setFiles(installedFiles);
      setSelectedPath(nextSelected);
      selectedPathRef.current = nextSelected;
      setPreview(null);
      if (nextSelected) {
        const previewToken = ++previewGeneration.current;
        await loadPreview(draft.id, nextSelected, previewToken, "installed");
      }
      const skillsLoaded = await loadSkills();
      if (actionGeneration.current !== generation) return;
      if (skillsLoaded) {
        setNoticeTone("success");
        setNotice(
          isRevision
            ? `技能「${installed.name}」已更新，原修订草稿已归档为安装结果。`
            : `技能「${installed.name}」已安装。`,
        );
      } else {
        setNoticeTone("warning");
        setNotice("技能已安装，但列表刷新失败，请重新加载");
      }
    } catch (error) {
      if (actionGeneration.current === generation) {
        setNoticeTone("default");
        setNotice(errorMessage(error, "技能安装失败，请稍后重试。"));
      }
    } finally {
      if (actionGeneration.current === generation) setPanelState("idle");
    }
  };

  const openInstalledSkills = () => {
    setShowInstalledSkills(true);
    setExpertPanelTab("skill");
    setCategory("expert");
  };

  const validation = draft?.validation;
  const isRevision = Boolean(draft?.revisionOf);
  const hasInstalledVersion = draft?.status === "installed" || isRevision;
  const installReady = !refreshBlocked &&
    draft?.status === "valid" &&
    validation?.valid &&
    panelState === "idle";
  const selectedFile = files.find((file) => file.path === selectedPath);
  const fileTreeRows = useMemo(() => {
    const folders = new Set<string>();
    const rows: Array<
      | { kind: "folder"; path: string; name: string; depth: number }
      | { kind: "file"; file: SkillDraftFile; name: string; depth: number }
    > = [];
    for (
      const file of [...files].sort((left, right) =>
        left.path.localeCompare(right.path)
      )
    ) {
      const parts = file.path.split("/");
      for (let index = 0; index < parts.length - 1; index += 1) {
        const folderPath = parts.slice(0, index + 1).join("/");
        if (!folders.has(folderPath)) {
          folders.add(folderPath);
          rows.push({
            kind: "folder",
            path: folderPath,
            name: parts[index],
            depth: index,
          });
        }
      }
      rows.push({
        kind: "file",
        file,
        name: parts[parts.length - 1],
        depth: parts.length - 1,
      });
    }
    return rows;
  }, [files]);

  if (!shouldShowSkillDraftPanel(draft)) return null;

  return (
    <aside className="skill-draft-panel" aria-label="技能草稿">
      <div className="skill-draft-header">
        <div>
          <span className="skill-draft-eyebrow">SKILL CREATOR</span>
          <h2>技能草稿</h2>
        </div>
        <span
          className={`skill-draft-status skill-draft-status--${
            isRevision ? "revision" : draft?.status ?? "empty"
          }`}
        >
          {draft?.status === "installed"
            ? "已安装"
            : isRevision && draft?.status === "valid"
            ? "修订已通过"
            : isRevision
            ? "修订中"
            : draft?.status === "valid"
            ? "已通过"
            : draft
            ? "编辑中"
            : "等待生成"}
        </span>
      </div>

      <div className="skill-draft-content">
        {panelState === "loading" && !draft
          ? (
            <div className="skill-draft-empty" role="status">
              <LoaderCircle className="skill-draft-spin" size={18} />
              <span>正在读取草稿…</span>
            </div>
          )
          : (
            <>
              <div className="skill-draft-meta">
                <strong>
                  {draft?.skillName || draft?.revisionOf || "尚未命名"}
                </strong>
                {draft && (
                  <span>
                    更新于 {new Date(draft.updatedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </div>

              {draft && (
                <div className="skill-draft-version-context">
                  {isRevision
                    ? (
                      <>
                        <strong>
                          正在修订已安装技能「{draft.revisionOf}」
                        </strong>
                        <span>
                          草稿可编辑；已安装版本保持不变，直到校验后确认更新。
                        </span>
                      </>
                    )
                    : draft.status === "installed"
                    ? (
                      <>
                        <strong>当前展示真实已安装内容</strong>
                        <span>创建修订版后才会生成新的可编辑副本。</span>
                      </>
                    )
                    : (
                      <>
                        <strong>当前展示未安装草稿</strong>
                        <span>校验通过并确认安装前，不会写入技能目录。</span>
                      </>
                    )}
                </div>
              )}

              {isRevision && hasInstalledVersion && (
                <div
                  className="skill-draft-version-tabs"
                  role="tablist"
                  aria-label="技能内容版本"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={contentView === "draft"}
                    className={contentView === "draft" ? "is-active" : ""}
                    disabled={refreshBlocked || panelState !== "idle"}
                    onClick={() => void showContentView("draft")}
                  >
                    修订草稿
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={contentView === "installed"}
                    className={contentView === "installed" ? "is-active" : ""}
                    disabled={refreshBlocked || panelState !== "idle"}
                    onClick={() => void showContentView("installed")}
                  >
                    已安装版本
                  </button>
                </div>
              )}

              {notice && (
                <div
                  className={`skill-draft-notice skill-draft-notice--${noticeTone}`}
                  role="status"
                >
                  {noticeTone === "success"
                    ? <CheckCircle2 size={14} />
                    : <AlertTriangle size={14} />}
                  <span>{notice}</span>
                </div>
              )}

              <section className="skill-draft-section skill-draft-files">
                <div className="skill-draft-section-title">
                  <span>
                    {contentView === "installed" ? "已安装文件" : "草稿文件"}
                  </span>
                  <small>{files.length}</small>
                </div>
                <ul className="skill-draft-file-list" role="list">
                  {files.length === 0 && (
                    <li className="skill-draft-file-empty">
                      {contentView === "installed"
                        ? "已安装版本没有可展示的文件"
                        : "草稿生成后将在此展示文件结构"}
                    </li>
                  )}
                  {fileTreeRows.map((row) => {
                    if (row.kind === "folder") {
                      return (
                        <li
                          className="skill-draft-folder"
                          key={`folder-${row.path}`}
                          style={{ paddingLeft: 10 + row.depth * 16 }}
                        >
                          <Folder size={13} />
                          <span>{row.name}</span>
                        </li>
                      );
                    }
                    const file = row.file;
                    const isSelected = file.path === selectedPath;
                    return (
                      <li key={file.path}>
                        <button
                          type="button"
                          className={`skill-draft-file ${
                            isSelected ? "is-selected" : ""
                          }`}
                          style={{ paddingLeft: 10 + row.depth * 16 }}
                          disabled={refreshBlocked || panelState !== "idle"}
                          aria-pressed={isSelected}
                          onClick={() => void selectFile(file)}
                          title={file.path}
                        >
                          <File size={13} />
                          <span>{row.name}</span>
                          <small>{formatBytes(file.size)}</small>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="skill-draft-section skill-draft-preview">
                <div className="skill-draft-section-title">
                  <span>{selectedPath || "预览"}</span>
                  {selectedFile && (
                    <small>{formatBytes(selectedFile.size)}</small>
                  )}
                </div>
                {selectedFile?.binary
                  ? (
                    <div className="skill-draft-binary">
                      <File size={20} />
                      <strong>{selectedFile.path.split("/").pop()}</strong>
                      <span>二进制文件 · {formatBytes(selectedFile.size)}</span>
                    </div>
                  )
                  : preview
                  ? <pre tabIndex={0}>{preview.text || ""}</pre>
                  : (
                    <div className="skill-draft-preview-empty">
                      {selectedPath ? "正在读取文件…" : "选择文件以查看内容"}
                    </div>
                  )}
              </section>

              {validation && contentView === "draft" && (
                <section className="skill-draft-section skill-draft-validation">
                  <div className="skill-draft-section-title">
                    <span>校验结果</span>
                    <small
                      className={validation.valid ? "is-valid" : "is-invalid"}
                    >
                      {validation.valid
                        ? "通过"
                        : `${validation.errors.length} 个错误`}
                    </small>
                  </div>
                  {validation.valid && validation.warnings.length === 0 && (
                    <div className="skill-draft-validation-ok">
                      <Check size={14} /> 草稿结构与内容校验通过
                    </div>
                  )}
                  {validation.errors.map((item, index) => (
                    <div
                      className="skill-draft-validation-item is-error"
                      key={`error-${item.code}-${index}`}
                    >
                      <strong>{item.path || item.code}</strong>
                      <span>{item.message}</span>
                    </div>
                  ))}
                  {validation.warnings.map((item, index) => (
                    <div
                      className="skill-draft-validation-item is-warning"
                      key={`warning-${item.code}-${index}`}
                    >
                      <strong>{item.path || item.code}</strong>
                      <span>{item.message}</span>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
      </div>

      <div className="skill-draft-actions">
        {draft?.status === "installed"
          ? (
            <>
              <button
                type="button"
                className="skill-draft-secondary"
                disabled={refreshBlocked || panelState !== "idle" || busy}
                onClick={() => void handleCreateRevision()}
              >
                {panelState === "revising"
                  ? <LoaderCircle className="skill-draft-spin" size={14} />
                  : <CopyPlus size={14} />}
                {panelState === "revising" ? "复制中…" : "创建修订版"}
              </button>
              <button
                type="button"
                className="skill-draft-primary"
                disabled={panelState !== "idle"}
                onClick={openInstalledSkills}
              >
                <PackageCheck size={15} />
                查看技能
              </button>
            </>
          )
          : (
            <>
              <button
                type="button"
                className="skill-draft-secondary"
                disabled={!draft || refreshBlocked || panelState !== "idle" ||
                  busy}
                onClick={() => void handleValidate()}
              >
                {panelState === "validating"
                  ? <LoaderCircle className="skill-draft-spin" size={14} />
                  : <RefreshCw size={14} />}
                {panelState === "validating" ? "校验中…" : "重新校验"}
              </button>
              <button
                type="button"
                className="skill-draft-primary"
                disabled={!installReady || refreshBlocked || busy}
                onClick={() => void handleInstall()}
              >
                {panelState === "installing"
                  ? <LoaderCircle className="skill-draft-spin" size={14} />
                  : <PackageCheck size={15} />}
                {panelState === "installing"
                  ? isRevision ? "更新中…" : "安装中…"
                  : isRevision
                  ? "校验后更新"
                  : "完成并安装"}
              </button>
            </>
          )}
      </div>
    </aside>
  );
}
