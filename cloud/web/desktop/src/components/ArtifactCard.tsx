import { useState } from "react";
import type { ArtifactKind, ArtifactViewModel } from "../utils/artifactPresentation";
import {
  AlignLeft,
  Database,
  File,
  FileCode,
  FileText,
  Film,
  FolderOpen,
  Globe,
  Image,
  Presentation,
  Table2,
} from "lucide-react";

interface ArtifactCardProps {
  artifact: ArtifactViewModel;
  onOpen: () => void;
  onShowInFolder?: () => void;
}

const ICONS: Record<ArtifactKind, typeof Globe> = {
  web: Globe,
  image: Image,
  document: FileText,
  spreadsheet: Table2,
  presentation: Presentation,
  video: Film,
  code: FileCode,
  data: Database,
  text: AlignLeft,
  unknown: File,
};

export default function ArtifactCard({
  artifact,
  onOpen,
  onShowInFolder,
}: ArtifactCardProps) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const Icon = ICONS[artifact.kind] ?? File;
  const subtitle = [artifact.typeLabel, artifact.sizeLabel].filter(Boolean).join(" · ");
  const showThumbnail = Boolean(artifact.thumbnailUrl) && !thumbnailFailed;

  return (
    <article className={`artifact-card artifact-card--${artifact.tone}`}>
      <button
        type="button"
        className="artifact-card__main"
        onClick={onOpen}
        title={`打开 ${artifact.displayName}`}
      >
        <span className="artifact-card__preview" aria-hidden="true">
          {showThumbnail ? (
            <img
              className="artifact-card__thumbnail"
              src={artifact.thumbnailUrl}
              alt=""
              loading="lazy"
              onError={() => setThumbnailFailed(true)}
            />
          ) : (
            <span className="artifact-card__icon-shell">
              <Icon size={18} />
            </span>
          )}
        </span>
        <span className="artifact-card__meta">
          <span className="artifact-card__title">{artifact.displayName}</span>
          <span className="artifact-card__subtitle">{subtitle || "文件"}</span>
        </span>
      </button>
      {artifact.source.path && onShowInFolder && (
        <button
          type="button"
          className="artifact-card__folder"
          onClick={onShowInFolder}
          title={`在文件夹中显示 ${artifact.displayName}`}
          aria-label={`在文件夹中显示 ${artifact.displayName}`}
        >
          <FolderOpen size={16} />
        </button>
      )}
    </article>
  );
}
