import { TriangleAlert } from "lucide-react";
import ArtifactCard from "./ArtifactCard";
import "./PresentFilesBatch.css";
import {
  normalizePresentedFiles,
  type ArtifactViewModel,
  type DeliveryBatch,
} from "../utils/artifactPresentation";

interface PresentFilesBatchProps {
  batch: DeliveryBatch;
  onOpenArtifact: (artifact: ArtifactViewModel) => void;
  onShowArtifactInFolder: (artifact: ArtifactViewModel) => void;
}

export default function PresentFilesBatch({
  batch,
  onOpenArtifact,
  onShowArtifactInFolder,
}: PresentFilesBatchProps) {
  const artifacts = normalizePresentedFiles(batch.files);

  if (artifacts.length === 0) return null;

  return (
    <section className="present-files-batch" aria-label="交付物">
      <div className="present-files-batch__header">
        <div className="present-files-batch__heading">
          <span className="present-files-batch__title">交付物</span>
          <span className="present-files-batch__count">{artifacts.length} 项</span>
        </div>
        {batch.explanation && (
          <p className="present-files-batch__explanation">{batch.explanation}</p>
        )}
      </div>

      {batch.problems.length > 0 && (
        <div className="present-files-batch__problems" role="alert">
          <TriangleAlert size={16} />
          <div className="present-files-batch__problems-copy">
            {batch.problems.map((problem, index) => (
              <p key={`${problem}-${index}`}>{problem}</p>
            ))}
          </div>
        </div>
      )}

      <div className="present-files-batch__grid">
        {artifacts.map((artifact, index) => (
          <ArtifactCard
            key={`${artifact.key}:${index}`}
            artifact={artifact}
            onOpen={() => onOpenArtifact(artifact)}
            onShowInFolder={() => onShowArtifactInFolder(artifact)}
          />
        ))}
      </div>
    </section>
  );
}
