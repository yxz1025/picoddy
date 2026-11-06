import DOMPurify from "dompurify";
import { WIDGET_REFERENCE_CSS, WIDGET_REFERENCE_THEME } from "./widgetReferenceStyles";

export const WIDGET_CDN_HOSTS = ["cdnjs.cloudflare.com", "esm.sh", "cdn.jsdelivr.net", "unpkg.com"] as const;
export const MAX_WIDGET_HEIGHT = 2000;
const cdns = WIDGET_CDN_HOSTS.map(h => `https://${h}`).join(" ");
export const WIDGET_CSP = `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: ${cdns}; style-src 'unsafe-inline'; img-src data: blob: ${cdns}; font-src ${cdns}; connect-src ${cdns}; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`;

export function isSvgWidget(code: string): boolean {
  return /^<svg\b/i.test(code.replace(/^\uFEFF/, "").trimStart().replace(/^(?:<\?xml[^?]*\?>\s*|<!--[\s\S]*?-->\s*)*/i, ""));
}

/** Same SVG profile as 参考设计, retaining marker, pattern and mask geometry. */
export function sanitizeWidgetSvg(code: string): string {
  const doc = new DOMParser().parseFromString(code, "image/svg+xml");
  if (doc.querySelector("parsererror") || doc.documentElement.localName !== "svg") return "";
  for (const element of doc.querySelectorAll("[onclick]")) {
    const prompt = element.getAttribute("onclick")?.match(/^\s*sendPrompt\(\s*(['"])([\s\S]*?)\1\s*\)\s*;?\s*$/)?.[2];
    if (prompt && !/[\\]/.test(prompt)) element.setAttribute("data-widget-prompt", prompt);
  }
  return DOMPurify.sanitize(new XMLSerializer().serializeToString(doc.documentElement), {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject"],
    FORBID_ATTR: ["srcdoc", "formaction"],
  });
}

const aliases: Record<string, string> = {
  "--color-background-primary": "--bg", "--color-background-secondary": "--bg-subtle",
  "--color-background-tertiary": "--bg-hover", "--color-text-primary": "--text",
  "--color-text-secondary": "--text-2", "--color-text-tertiary": "--text-3",
  "--color-border-tertiary": "--border", "--font-sans": "--font",
  "--color-text-info": "--accent", "--color-background-info": "--accent-soft",
  "--color-text-success": "--green", "--color-text-warning": "--amber", "--color-text-danger": "--red",
};

export function widgetThemeCss(getProperty: (name: string) => string, dark: boolean, extraNames: string[] = []): string {
  const names = new Set([...Object.values(aliases), ...extraNames]);
  const declarations = [...names].map(name => {
    const value = getProperty(name).trim();
    return value && /^--[\w-]+$/.test(name) ? `${name}:${value.replace(/[<>]/g, "")};` : "";
  });
  for (const [name, original] of Object.entries(aliases)) {
    const value = getProperty(name).trim() || getProperty(original).trim();
    if (value) declarations.push(`${name}:${value.replace(/[<>]/g, "")};`);
  }
  // Semantic colors are available even when the host has no matching background token.
  for (const [kind, color] of [["info", "--accent"], ["success", "--green"], ["warning", "--amber"], ["danger", "--red"]]) {
    declarations.push(`--color-background-${kind}:color-mix(in srgb, var(${color}, currentColor) 12%, transparent);--color-border-${kind}:var(${color}, currentColor);`);
  }
  return `${WIDGET_REFERENCE_THEME}\n:root{color-scheme:${dark ? "dark" : "light"};${declarations.join("")}}`;
}

export function widgetBaseCss(dark: boolean): string {
  // Explicit host theme wins over the OS preference, including in downloaded images.
  const css = WIDGET_REFERENCE_CSS.replace(/@media \(prefers-color-scheme: dark\)\s*\{[\s\S]*?\n\}/, "");
  const lightPalette = css.slice(css.indexOf(".c-purple {"), css.indexOf("/* 暗色模式"));
  return `${css}\n${dark ? "" : lightPalette}\n${WIDGET_UI_CSS}`;
}

const WIDGET_UI_CSS = `
*{box-sizing:border-box}html,body{margin:0;padding:0}body{background:transparent;color:var(--color-text-primary);font:13px/1.6 var(--font-sans)}
h1,h2,h3,p{margin:0 0 12px}h1{font-size:15px;font-weight:500}h2{font-size:14px;font-weight:500}h3{font-size:13px;font-weight:500}
button,input,select,textarea{font:inherit;color:inherit;border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-md);background:transparent;padding:8px 12px}
button{cursor:pointer}button:hover{background:var(--color-background-secondary)}input[type=range]{padding:0;accent-color:var(--color-text-info)}
:focus-visible{outline:2px solid var(--color-text-info);outline-offset:2px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
#widget-root{display:flow-root;min-width:0}#widget-root>svg{display:block;width:100%;height:auto}
`;

export function addWidgetSvgDefaults(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  for (const id of ["arrow", "arrowhead"]) {
    if (Array.from(root.querySelectorAll("[id]")).some(e => e.id === id)) continue;
    const defs = doc.createElementNS(root.namespaceURI, "defs");
    const marker = doc.createElementNS(root.namespaceURI, "marker");
    for (const [key,value] of Object.entries({id,viewBox:"0 0 10 10",refX:"8",refY:"5",markerWidth:"6",markerHeight:"6",orient:"auto-start-reverse"})) marker.setAttribute(key,value);
    const path = doc.createElementNS(root.namespaceURI, "path");
    for (const [key,value] of Object.entries({d:"M2 1L8 5L2 9",fill:"none",stroke:"context-stroke","stroke-width":"1.5","stroke-linecap":"round","stroke-linejoin":"round"})) path.setAttribute(key,value);
    marker.append(path); defs.append(marker); root.prepend(defs);
  }
  return new XMLSerializer().serializeToString(root);
}

export function buildWidgetDocument(code: string, themeCss: string, dark: boolean, bridge = "", imageOrigin = ""): string {
  const svg = isSvgWidget(code);
  let content = svg ? addWidgetSvgDefaults(sanitizeWidgetSvg(code)) : code;
  if (!svg) {
    const template = document.createElement("template"); template.innerHTML = content;
    template.content.querySelectorAll("iframe,object,embed,meta,link,base,form").forEach(e => e.remove());
    content = template.innerHTML;
  }
  // Local images use the existing file endpoint; no filesystem access from the iframe.
  if (imageOrigin) {
    const template = document.createElement("template");
    template.innerHTML = content;
    for (const image of template.content.querySelectorAll("img,image")) {
      for (const attr of ["src", "href", "xlink:href"]) {
        const path = image.getAttribute(attr);
        if (path && (/^\/(?!\/)/.test(path) || /^[a-z]:[\\/]/i.test(path))) {
          image.setAttribute(attr, `${imageOrigin}/api/file?path=${encodeURIComponent(path)}`);
        }
      }
    }
    content = template.innerHTML;
  }
  const csp = WIDGET_CSP.replace("img-src data: blob:", `img-src data: blob: ${imageOrigin}`);
  const standaloneBridge = `<script>window.sendPrompt=function(){};window.openLink=function(url){try{var target=new URL(url);if(['https:','http:'].includes(target.protocol))window.open(target.href,'_blank','noopener,noreferrer');}catch(error){}};</script>`;
  return `<!DOCTYPE html><html class="${dark ? "dark" : "light"}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style id="widget-theme">${themeCss}</style><style id="widget-base">${widgetBaseCss(dark)}</style>${bridge || standaloneBridge}</head><body><div id="widget-root">${content}</div></body></html>`;
}

/** Standalone SVG carries exactly the styles used by the sandbox. */
export function styleWidgetSvg(svg: string, themeCss: string, dark: boolean): string {
  const prepared = addWidgetSvgDefaults(sanitizeWidgetSvg(svg));
  const doc = new DOMParser().parseFromString(prepared, "image/svg+xml");
  const root = doc.documentElement;
  root.classList.add(dark ? "dark" : "light");
  const style = doc.createElementNS(root.namespaceURI,"style");
  style.textContent = `${themeCss}\n${widgetBaseCss(dark)}`;
  root.prepend(style);
  return new XMLSerializer().serializeToString(root);
}
