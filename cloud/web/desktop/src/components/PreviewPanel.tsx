import CloudFilePreview from "./previews/CloudFilePreview";
import { showItemInFolder } from "../utils/openFile";
import {
  normalizePresentedFile,
  previewListItemKey,
  type PreviewTarget,
} from "../utils/artifactPresentation";
import "./PreviewPanel.css";

export type PreviewFile = PreviewTarget;

interface PreviewPanelProps {
  files: PreviewFile[];
  activeFile: PreviewFile | null;
  onSelectFile: (f: PreviewFile) => void;
}

function displayName(f: PreviewFile): string {
  return normalizePresentedFile(f).displayName;
}

export default function PreviewPanel({ files, activeFile, onSelectFile }: PreviewPanelProps) {
  if (!activeFile) {
    return (
      <div className="preview-panel">
        <div className="preview-empty-state">
          <div className="preview-empty-icon">📂</div>
          <div className="preview-empty-text">选择一个文件以预览</div>
        </div>
      </div>
    );
  }

  const fileName = displayName(activeFile);

  return (
    <div className="preview-panel">
      <div className="preview-file-bar">
        {files.length > 1 ? (
          <div className="preview-file-list">
            {files.map((f, index) => {
              const preview = normalizePresentedFile(f);
              const name = preview.displayName;
              const isActive =
                (f.path && f.path === activeFile.path) ||
                (f.url && f.url === activeFile.url);
              return (
                <div
                  key={previewListItemKey(f, index)}
                  className={`preview-file-item ${isActive ? "active" : ""}`}
                >
                  <button
                    className="preview-file-item-name"
                    onClick={() => onSelectFile(f)}
                    title="点击预览"
                  >
                    {name}
                  </button>
                  {f.path && (
                    <button
                      className="preview-file-item-folder"
                      onClick={() => showItemInFolder(f.path!)}
                      title="在文件夹中显示"
                    >
                      📂
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="preview-file-single">
            <span className="preview-file-name">{fileName}</span>
            {activeFile.path && (
              <button
                className="preview-file-item-folder"
                onClick={() => showItemInFolder(activeFile.path!)}
                title="在文件夹中显示"
                aria-label={`在文件夹中显示 ${fileName}`}
              >
                📂
              </button>
            )}
          </div>
        )}
      </div>

      <div className="preview-body">
        {activeFile.url && /^https?:\/\//i.test(activeFile.url) ? (
          <div className="preview-empty-state">
            <p>外部网页不会自动加载。确认地址后在新标签页打开。</p>
            <a href={activeFile.url} target="_blank" rel="noopener noreferrer">{activeFile.url}</a>
          </div>
        ) : <CloudFilePreview path={activeFile.path ?? ""} name={fileName} />}
      </div>

    </div>
  );
}
