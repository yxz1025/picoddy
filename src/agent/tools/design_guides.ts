// Keep guidance aligned with the locally installed 参考设计 visualizer.
import { RENDERING_GUIDANCE as G } from "./rendering_guidance.ts";
export type WidgetModule = "diagram" | "mockup" | "interactive" | "chart" | "art";
export const WIDGET_MODULES: readonly WidgetModule[] = ["diagram", "mockup", "interactive", "chart", "art"];
export interface DesignGuide { module: WidgetModule; content: string }
export const DESIGN_GUIDES: Record<WidgetModule, DesignGuide> = {
  diagram: { module: "diagram", content: G.diagram },
  mockup: { module: "mockup", content: G.interactive },
  interactive: { module: "interactive", content: G.interactive },
  chart: { module: "chart", content: `${G.chart}\n\n${G.maps}` },
  art: { module: "art", content: G.art },
};
export function normalizeWidgetModules(value: string[] | string): WidgetModule[] {
  let values: unknown = value;
  if (typeof value === "string") {
    try { values = JSON.parse(value); } catch { values = value.split(/[\s,]+/); }
  }
  return [...new Set((Array.isArray(values) ? values : []).filter((v): v is WidgetModule => WIDGET_MODULES.includes(v as WidgetModule)))];
}
export function formatDesignGuides(guides: DesignGuide[]): string {
  const modules = guides.map(g => g.module);
  const parts: string[] = [G.core, G.palette];
  if (modules.some(m => m === "diagram" || m === "art")) parts.push(G.svg);
  if (modules.some(m => ["mockup", "interactive", "chart"].includes(m))) parts.push(G.ui);
  parts.push(...guides.map(g => g.content));
  // The installed reference uses different marker names in its CSS and guide.
  // Our host provides both aliases, so the published examples work verbatim.
  parts.push("Host integration: sendPrompt(text) requests a follow-up. Both #arrow and #arrowhead markers are available. Local workspace images are rewritten by the host through its file endpoint. For Chinese labels budget approximately one font-size per character and wrap using tspan when necessary.");
  return parts.join("\n\n");
}
