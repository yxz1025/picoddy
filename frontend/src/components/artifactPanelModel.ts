export const DEFAULT_ARTIFACT_PANEL_WIDTH = 360;
export const MIN_ARTIFACT_PANEL_WIDTH = 300;
export const ARTIFACT_PANEL_MAX_VIEWPORT_RATIO = 0.6;
const PROJECT_CONVERSATION_MIN_WIDTH = 440;
const EXPANDED_SIDEBAR_WIDTH = 260;
const COLLAPSED_SIDEBAR_WIDTH = 0;

export function getDefaultArtifactPanelWidth(viewportWidth: number): number {
  return clampArtifactPanelWidth(Math.round(viewportWidth * 0.42), viewportWidth);
}

export interface ArtifactPanelLayout {
  projectLayout?: boolean;
  sidebarCollapsed?: boolean;
}

export function shouldAutoOpenArtifactPanel(category?: string): boolean {
  return category !== "skill_creator";
}

export function getArtifactPanelMaxWidth(
  viewportWidth: number,
  layout?: ArtifactPanelLayout,
): number {
  const viewportLimit = Math.max(
    MIN_ARTIFACT_PANEL_WIDTH,
    Math.floor(viewportWidth * ARTIFACT_PANEL_MAX_VIEWPORT_RATIO),
  );
  if (!layout) return viewportLimit;
  const sidebarWidth = layout?.sidebarCollapsed
    ? COLLAPSED_SIDEBAR_WIDTH
    : EXPANDED_SIDEBAR_WIDTH;
  return Math.max(
    MIN_ARTIFACT_PANEL_WIDTH,
    Math.min(viewportLimit, viewportWidth - sidebarWidth - PROJECT_CONVERSATION_MIN_WIDTH),
  );
}

export function clampArtifactPanelWidth(
  width: number,
  viewportWidth: number,
  layout?: ArtifactPanelLayout,
): number {
  const maxWidth = getArtifactPanelMaxWidth(viewportWidth, layout);
  return Math.min(maxWidth, Math.max(MIN_ARTIFACT_PANEL_WIDTH, Math.round(width)));
}
