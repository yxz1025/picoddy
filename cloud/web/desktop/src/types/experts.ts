/**
 * Safe expert metadata exposed to the renderer.
 *
 * The prompt body is intentionally not part of this DTO.  Prompt resolution
 * remains a main-process/backend concern so the renderer cannot accidentally
 * persist or display the expert's system instructions.
 */
export type ExpertCatalogSource = "builtin" | "installed" | "catalog";
export type ExpertType = "agent";

export interface ExpertSummary {
  id: string;
  name: string;
  expertType: ExpertType;
  nickname?: string;
  categoryId: string;
  description: string;
  icon: string;
  tags: string[];
  quickPrompts: string[];
  badge?: string;
  catalogSource: ExpertCatalogSource;
  revision: string;
  available: boolean;
}
