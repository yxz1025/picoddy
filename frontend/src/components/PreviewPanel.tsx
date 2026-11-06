import OfficePreview, { supportsOfficePreview } from "./previews/OfficePreview";
import { FileText, FileSpreadsheet, Presentation, Image, Globe, FolderOpen, Files } from "lucide-react";
import DocxPreview from "./previews/DocxPreview";
import PdfPreview from "./previews/PdfPreview";
import MdPreview from "./previews/MdPreview";
import BrowserPreview from "./previews/BrowserPreview";
import TablePreview from "./previews/TablePreview";
import PptxPreview from "./previews/PptxPreview";
import ImagePreview from "./previews/ImagePreview";
import TextPreview from "./previews/TextPreview";
import VideoPreview from "./previews/VideoPreview";
import UnsupportedPreview from "./previews/UnsupportedPreview";
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

  const artifact = normalizePresentedFile(activeFile);
  const fileName = displayName(activeFile);

  return (
    <div className="preview-panel">
      <div className="preview-file-bar">
        <div className="preview-tab-strip">
          <span className="preview-file-count" title={`${files.length} 个文件`}>
            <Files size={14} aria-hidden="true" /><span>{files.length}</span>
          </span>
          <nav className="preview-file-list" aria-label="预览文件">
            {files.map((f, index) => {
              const preview = normalizePresentedFile(f);
              const isActive = Boolean(
                (f.path && f.path === activeFile.path) ||
                (f.url && f.url === activeFile.url)
              );
              const Icon = preview.renderer === "table" ? FileSpreadsheet
                : preview.renderer === "presentation" ? Presentation
                : preview.renderer === "image" ? Image
                : preview.renderer === "browser" ? Globe : FileText;
              return (
                <button
                  key={previewListItemKey(f, index)}
                  className={`preview-file-item ${isActive ? "active" : ""}`}
                  onClick={() => onSelectFile(f)}
                  aria-current={isActive ? "page" : undefined}
                  title={preview.displayName}
                  ref={(element) => {
                    if (isActive && element) {
                      const strip = element.parentElement;
                      if (strip && (element.offsetLeft < strip.scrollLeft ||
                        element.offsetLeft + element.offsetWidth > strip.scrollLeft + strip.clientWidth)) {
                        strip.scrollLeft = element.offsetLeft;
                      }
                    }
                  }}
                >
                  <Icon size={14} className={`preview-type-icon preview-type-${preview.renderer}`} aria-hidden="true" />
                  <span className="preview-file-item-name">{preview.displayName}</span>
                </button>
              );
            })}
          </nav>
        </div>
        <div className="preview-document-toolbar">
          <span className="preview-file-name" title={fileName}>{fileName}</span>
          <span className="preview-format-label">{artifact.typeLabel}</span>
          {activeFile.path && (
            <button
              className="preview-file-item-folder"
              onClick={() => showItemInFolder(activeFile.path!)}
              title="在文件夹中显示"
              aria-label={`在文件夹中显示 ${fileName}`}
            >
              <FolderOpen size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="preview-body">
        {artifact.renderer === "browser" && (
          <BrowserPreview filePath={activeFile.path} url={activeFile.url} />
        )}
        {artifact.renderer === "image" && <ImagePreview filePath={activeFile.path ?? ""} />}
        {artifact.renderer === "pdf" && <PdfPreview filePath={activeFile.path ?? ""} />}
        {artifact.renderer === "docx" && (supportsOfficePreview(activeFile.path) ? <OfficePreview key={activeFile.path} filePath={activeFile.path!} fallback={<DocxPreview filePath={activeFile.path!} />} /> : <DocxPreview filePath={activeFile.path ?? ""} />)}
        {artifact.renderer === "table" && (supportsOfficePreview(activeFile.path) ? <OfficePreview key={activeFile.path} filePath={activeFile.path!} fallback={<TablePreview filePath={activeFile.path!} />} /> : <TablePreview filePath={activeFile.path ?? ""} />)}
        {artifact.renderer === "presentation" && (supportsOfficePreview(activeFile.path) ? <OfficePreview key={activeFile.path} filePath={activeFile.path!} fallback={<PptxPreview filePath={activeFile.path!} />} /> : <PptxPreview filePath={activeFile.path ?? ""} />)}
        {artifact.renderer === "markdown" && <MdPreview filePath={activeFile.path ?? ""} />}
        {artifact.renderer === "text" && <TextPreview filePath={activeFile.path ?? ""} />}
        {artifact.renderer === "video" && <VideoPreview filePath={activeFile.path ?? ""} />}
        {artifact.renderer === "unsupported" && (
          <UnsupportedPreview
            filePath={activeFile.path ?? ""}
            typeLabel={artifact.typeLabel}
          />
        )}
      </div>

    </div>
  );
}
