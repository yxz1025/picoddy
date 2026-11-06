import type { ComponentType } from "react";
import { Folder, Home, Briefcase, Rocket, BarChart3, Brain, Palette, Wrench, FileText, Star, FlaskConical, FolderOpen } from "lucide-react";

const ICON_MAP: Record<string, ComponentType<{ size?: number }>> = {
  folder: Folder,
  home: Home,
  briefcase: Briefcase,
  rocket: Rocket,
  chart: BarChart3,
  brain: Brain,
  palette: Palette,
  wrench: Wrench,
  file: FileText,
  star: Star,
  flask: FlaskConical,
  folderOpen: FolderOpen,
};

export const WORKSPACE_ICON_CHOICES = Object.keys(ICON_MAP);

export function WorkspaceIcon({ name, size = 14 }: { name?: string | null; size?: number }) {
  const Comp = (name && ICON_MAP[name]) || Folder;
  return <Comp size={size} />;
}
