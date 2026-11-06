interface PdfPreviewProps {
  filePath: string;
}

export default function PdfPreview({ filePath }: PdfPreviewProps) {
  return (
    <div className="preview-pdf">
      <iframe
        src={`/api/file?path=${encodeURIComponent(filePath)}`}
        className="preview-pdf-frame"
        title="PDF 预览"
      />
    </div>
  );
}
