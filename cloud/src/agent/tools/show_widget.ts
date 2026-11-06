import { Type } from "typebox";
import { SaxesParser } from "saxes";
import type { AgentTool } from "@earendil-works/pi-agent-core";
const schema = Type.Object({
  title: Type.String({ description: "Short, specific identifier in the user's language. Spaces and hyphens are converted to underscores. Also used as the download filename." }),
  widget_code: Type.String({ description: "Raw SVG or HTML fragment. No DOCTYPE, html, head or body. SVG viewBox must start with 0 0 680. HTML may load scripts from the widget CDN allowlist." }),
  loading_messages: Type.Union([Type.String(), Type.Array(Type.String())], { description: '1–4 short loading messages in the user language, as JSON-encoded string array or array.' }),
  module: Type.Optional(Type.Union([Type.Literal("diagram"), Type.Literal("chart"), Type.Literal("art"), Type.Literal("mockup"), Type.Literal("interactive")], {description:"Optional display category; SVG/HTML render mode is detected from code."})),
});
function fail(message: string): never { throw new Error(`[show_widget] ${message}`); }
function loadingMessages(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed.map(String).map(s => s.trim()).filter(Boolean); } catch { /* comma-separated fallback matches 参考设计 */ }
  return value.split(",").map(s => s.trim()).filter(Boolean);
}
export const showWidgetTool: AgentTool<typeof schema, any> = {
  name: "show_widget",
  label: "展示可视化 widget",
  description: 'Show visual content — SVG graphics, diagrams, charts, or interactive HTML widgets — inline alongside your text response. Call widget_guidelines (modules: diagram|mockup|interactive|chart|art) before your first show_widget call. widget_code MUST be a raw SVG/HTML fragment; for SVG use viewBox="0 0 680 H".',
  parameters: schema,
  execute: async (_id, p) => {
    if (!p.title?.trim()) fail("title is required.");
    if (!p.widget_code?.trim()) fail("widget_code is required.");
    const code = p.widget_code.trim();
    const messages = loadingMessages(p.loading_messages);
    if (!messages.length || messages.length > 4) fail("loading_messages must contain one to four messages.");
    if (/<(!DOCTYPE|html|head|body)\b/i.test(code)) fail("Use a raw SVG or HTML fragment without document wrapper tags.");
    if (/\b(localStorage|sessionStorage)\b/.test(code)) fail("Storage is unavailable in the widget sandbox.");
    if (/position\s*:\s*fixed/i.test(code)) fail("position: fixed is incompatible with auto-sized widget height.");
    if (/<form[\s>]/i.test(code)) fail("Use normal controls and event handlers instead of form tags.");
    const mode = code.startsWith("<svg") ? "svg" : "html";
    if (mode === "svg") {
      // Providers may return a tool call with truncated, partially recovered JSON.
      // Reject invalid XML before emitting a successful widget for the renderer.
      try {
        const parser = new SaxesParser();
        parser.on("doctype", () => { throw new Error("DOCTYPE is not allowed"); });
        parser.write(code).close();
      } catch {
        fail("SVG XML 无法解析或内容不完整。请重新生成完整、精简的 SVG，闭合所有标签和属性，并转义文本中的 & 和 <。");
      }
      if ((code.match(/<svg[\s>]/gi) || []).length !== 1) fail("SVG widget_code must contain exactly one SVG element.");
      if (!/viewBox\s*=\s*["']0\s+0\s+680\s+\d+["']/i.test(code)) fail("SVG widget_code must use a 680px-wide viewBox.");
    }
    const title = p.title.replace(/[\s-]+/g,"_").replace(/[^\p{L}\p{N}_]/gu, "").replace(/^_+|_+$/g, "").replace(/_{2,}/g, "_") || "widget";
    const payload = {type:"visualizer_show_widget_result",success:true,title,widget_code:code,loading_messages:messages,render_mode:mode,message:"Widget payload prepared for inline rendering."};
    return {content:[{type:"text",text:JSON.stringify(payload)}],details:{widget:{...payload,module:p.module ?? (mode === "svg" ? "diagram" : "interactive")}}};
  },
};
