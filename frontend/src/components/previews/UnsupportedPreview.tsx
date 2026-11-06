interface UnsupportedPreviewProps {
  filePath: string;
  typeLabel: string;
}

const TYPE_ICONS: Record<string, string> = {
  docx: "📄", xlsx: "📊", pptx: "🎨", pdf: "📕",
  md: "📝", txt: "📃", html: "🌐", csv: "📊",
  png: "🖼", jpg: "🖼", jpeg: "🖼", gif: "🖼",
  svg: "🖼", json: "📋", xml: "📋",
};

export default function UnsupportedPreview({ filePath, typeLabel }: UnsupportedPreviewProps) {
  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  const normalizedType = typeLabel.trim().toLowerCase();
  const icon = TYPE_ICONS[normalizedType] || "📑";

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(filePath);
    } catch {
      // 降级：不处理
    }
  };

  return (
    <div className="preview-unsupported">
      <div className="preview-unsupported-icon">{icon}</div>
      <div className="preview-unsupported-name">{fileName}</div>
      <div className="preview-unsupported-ext">{typeLabel || "文件"} · 当前格式暂不支持内置内容渲染</div>
      <div className="preview-unsupported-actions">
        <button className="preview-action-btn" onClick={handleCopyPath}>
          复制文件路径
        </button>
      </div>
    </div>
  );
}
