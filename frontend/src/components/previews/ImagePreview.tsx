interface ImagePreviewProps {
  filePath: string;
}

export default function ImagePreview({ filePath }: ImagePreviewProps) {
  const src = `/api/file?path=${encodeURIComponent(filePath)}`;
  return (
    <div className="preview-image">
      <img src={src} alt="预览" className="preview-image-img" />
    </div>
  );
}
