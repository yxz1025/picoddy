import "./DocPreviewWidget.css";

interface DocPreviewWidgetProps {
  title?: string;
  sections?: { heading: string; body: string }[];
  filePath?: string;
}

export default function DocPreviewWidget({
  title = "Word 文档预览",
  sections = [
    {
      heading: "一、工作概要",
      body:
        "本周完成了 PiCoddy 项目的整体架构演进与全功能构建，确定了基于 Electron 的全栈轻量路线。",
    },
    {
      heading: "二、核心成果",
      body:
        "完成了 pi AgentHarness 底座与 29 个工具链的无缝挂载，验证通过端到端链路。",
    },
  ],
  filePath,
}: DocPreviewWidgetProps) {
  return (
    <div className="doc-preview-widget">
      <div className="doc-preview-header">
        <div className="doc-preview-title">
          <span>📄</span>
          <span>{title}</span>
        </div>
        {filePath && (
          <button
            className="doc-open-btn"
            onClick={() => window.open(`file://${filePath}`)}
          >
            ↗ 打开 Word 文档
          </button>
        )}
      </div>

      <div className="doc-page-paper">
        <div className="doc-page-title">{title}</div>
        {sections.map((sec, idx) => (
          <div key={idx} className="doc-sec">
            <div className="doc-sec-heading">{sec.heading}</div>
            <div className="doc-sec-body">{sec.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
