interface VideoPreviewProps {
  filePath: string;
}

export default function VideoPreview({ filePath }: VideoPreviewProps) {
  return (
    <div className="preview-video">
      <video
        controls
        preload="metadata"
        className="preview-video-player"
        src={`/api/file?path=${encodeURIComponent(filePath)}`}
      >
        当前格式无法在应用内播放。
      </video>
    </div>
  );
}
