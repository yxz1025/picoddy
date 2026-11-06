import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { useStore } from "../store/useStore";
import PreviewPanel from "./PreviewPanel";
import {
  previewTargetsFromPresentedFiles,
  resolveActivePreviewTarget,
} from "../utils/artifactPresentation";
import "./ArtifactPanel.css";
import {
  clampArtifactPanelWidth,
  DEFAULT_ARTIFACT_PANEL_WIDTH,
  getArtifactPanelMaxWidth,
} from "./artifactPanelModel";

const BrowserPanel = lazy(() => import("./BrowserPanel"));
const ARTIFACT_PANEL_WIDTH_KEY = "picoddy-artifact-panel-width";

function loadArtifactPanelWidth(): number {
  if (typeof window === "undefined") return DEFAULT_ARTIFACT_PANEL_WIDTH;
  const stored = Number(window.localStorage.getItem(ARTIFACT_PANEL_WIDTH_KEY));
  return Number.isFinite(stored)
    ? clampArtifactPanelWidth(stored, window.innerWidth)
    : DEFAULT_ARTIFACT_PANEL_WIDTH;
}

export default function ArtifactPanel() {
  const {
    showArtifacts, setShowArtifacts, messages, memories, loadMemories,
    previewFile, openPreview, mode, permission, modelId, currentConvId, conversations,
    panelMode, setPanelMode, presentedFiles, activeCategory, sidebarCollapsed,
  } = useStore();
  const layout = { projectLayout: activeCategory === "project", sidebarCollapsed };
  const maxPanelWidth = getArtifactPanelMaxWidth(window.innerWidth, layout);
  const [panelWidth, setPanelWidth] = useState(loadArtifactPanelWidth);
  const resizingRef = useRef(false);

  const subagentTasks = conversations.filter((c) => c.parentId === currentConvId);

  useEffect(() => {
    if (showArtifacts && panelMode === "memories") loadMemories();
  }, [showArtifacts, panelMode]);

  useEffect(() => {
    const handleResize = () => {
      setPanelWidth((width) => clampArtifactPanelWidth(width, window.innerWidth, layout));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [activeCategory, sidebarCollapsed]);

  useEffect(() => {
    if (!resizingRef.current) return;
    window.localStorage.setItem(ARTIFACT_PANEL_WIDTH_KEY, String(panelWidth));
  }, [panelWidth]);

  if (!showArtifacts) return null;

  const previewFiles = previewTargetsFromPresentedFiles(presentedFiles);

  const hasArtifacts = previewFiles.length > 0;
  const activePreviewFile = resolveActivePreviewTarget(previewFiles, previewFile);

  // Token 估算
  const totalChars = messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
  const approxTokens = Math.round(totalChars / 3);
  const maxTokens = 128000;
  const tokenPercent = Math.min(100, Math.round((approxTokens / maxTokens) * 100));

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("artifact-panel-resizing");
  };

  const resizePanel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) return;
    const width = clampArtifactPanelWidth(
      window.innerWidth - event.clientX,
      window.innerWidth,
      layout,
    );
    setPanelWidth(width);
  };

  const finishResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) return;
    resizingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.classList.remove("artifact-panel-resizing");
    window.localStorage.setItem(ARTIFACT_PANEL_WIDTH_KEY, String(panelWidth));
  };

  return (
    <div
      className="artifact-panel"
      style={{ width: Math.min(panelWidth, maxPanelWidth), maxWidth: maxPanelWidth }}
    >
      <div
        className="artifact-panel-resizer"
        role="separator"
        aria-label="调整右侧面板宽度"
        aria-orientation="vertical"
        aria-valuemin={300}
        aria-valuemax={maxPanelWidth}
        aria-valuenow={Math.min(panelWidth, maxPanelWidth)}
        onPointerDown={startResize}
        onPointerMove={resizePanel}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
      />
      {/* Header: 模式切换 + 关闭 */}
      <div className="artifact-header">
        <div className="artifact-mode-tabs">
          {hasArtifacts && (
            <button
              className={`mode-tab ${panelMode === "preview" ? "active" : ""}`}
              onClick={() => setPanelMode("preview")}
              title="文件预览"
            >
              📦 预览
              <span className="mode-badge">{previewFiles.length}</span>
            </button>
          )}
          <button
            className={`mode-tab ${panelMode === "browser" ? "active" : ""}`}
            onClick={() => setPanelMode("browser")}
            title="内置浏览器"
          >
            🌐
          </button>
          <button
            className={`mode-tab ${panelMode === "status" ? "active" : ""}`}
            onClick={() => setPanelMode("status")}
            title="会话状态"
          >
            📊
          </button>
          <button
            className={`mode-tab ${panelMode === "memories" ? "active" : ""}`}
            onClick={() => setPanelMode("memories")}
            title="记忆"
          >
            🧠
          </button>
        </div>
        <button className="close-panel-btn" onClick={() => setShowArtifacts(false)} title="关闭">✕</button>
      </div>

      {/* Content */}
      <div className="artifact-content">
        {panelMode === "preview" && (
          previewFiles.length === 0 ? (
            <div className="artifact-empty">
              <div className="empty-icon">📁</div>
              <div>尚未生成任何文档工件</div>
              <div className="empty-sub">让 Agent 生成文件后在此预览</div>
            </div>
          ) : (
            <PreviewPanel
              files={previewFiles}
              activeFile={activePreviewFile}
              onSelectFile={(file) => openPreview(file, file.toolName, previewFiles)}
            />
          )
        )}

        {panelMode === "browser" && (
          <Suspense fallback={<div className="preview-loading">加载中...</div>}>
            <BrowserPanel />
          </Suspense>
        )}

        {panelMode === "status" && (
          <div className="status-section">
            <div className="status-card">
              <div className="status-card-title">Token</div>
              <div className="token-bar-container">
                <div className="token-bar-fill" style={{ width: `${tokenPercent}%` }} />
              </div>
              <div className="token-status-text">
                <span>~{approxTokens.toLocaleString()} tokens</span>
                <span>{tokenPercent}% / 128k</span>
              </div>
            </div>
            <div className="status-card">
              <div className="status-card-title">引擎</div>
              <div className="status-item"><span className="label">模型</span><span className="val">{modelId}</span></div>
              <div className="status-item"><span className="label">模式</span><span className="val mode-tag">{mode.toUpperCase()}</span></div>
              <div className="status-item"><span className="label">权限</span><span className="val perm-tag">{permission.toUpperCase()}</span></div>
              <div className="status-item"><span className="label">执行环境</span><span className="val active">OpenSandbox</span></div>
            </div>
            {subagentTasks.length > 0 && (
              <div className="status-card">
                <div className="status-card-title">🤖 子代理</div>
                {subagentTasks.map((st) => (
                  <div key={st.id} className="status-item" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: 12 }}>
                      <span>{st.title.replace("子任务: ", "")}</span>
                      <span className={`val ${st.status === "running" ? "active" : ""}`}>
                        {st.status === "running" ? "⏳" : st.status === "done" ? "✅" : "❌"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {panelMode === "memories" && (
          <div className="memories-list">
            {memories.length === 0 ? (
              <div className="artifact-empty">
                <div className="empty-icon">🧠</div>
                <div>暂无知识记忆</div>
              </div>
            ) : (
              memories.map((mem) => (
                <div key={mem.id} className="memory-card">
                  <div className="memory-tag">{mem.kind || "fact"}</div>
                  <div className="memory-text">{mem.content}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
