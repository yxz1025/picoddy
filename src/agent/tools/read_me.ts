import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { DESIGN_GUIDES, normalizeWidgetModules, formatDesignGuides } from "./design_guides.ts";
const schema = Type.Object({
  modules: Type.Union([Type.Array(Type.String()), Type.String()], {
    description: 'Modules to load: diagram, mockup, interactive, chart, art. Accepts an array, JSON-encoded array or comma-separated list.',
  }),
});
export const widgetGuidelinesTool: AgentTool<typeof schema, any> = {
  name: "widget_guidelines",
  label: "读取可视化设计指引",
  description: "Returns required context for show_widget (CSS variables, colors, typography, layout rules, examples). Call before your first show_widget call. Call again later if you need a different module. Do NOT mention or narrate this call to the user — it is an internal setup step.",
  parameters: schema,
  execute: async (_id, p) => {
    const guides = normalizeWidgetModules(p.modules).map(m => DESIGN_GUIDES[m]);
    return { content: [{ type: "text", text: formatDesignGuides(guides) }], details: { guides } };
  },
};
// Existing sessions may still call read_me.
export const readMeTool: AgentTool<typeof schema, any> = { ...widgetGuidelinesTool, name: "read_me" };
