import { inlineWidgetImages } from "./widgetImages";
import { captureWidgetPng } from "./widgetCapture";
import { buildWidgetDocument, styleWidgetSvg, widgetThemeCss } from "./widgetDocument";

const PNG_SCALE = 3;
const PNG_MAX_EDGE = 4096;

export function stripWidgetPreamble(code: string): string {
  return code
    .replace(/^\uFEFF/, "")
    .replace(/^\s*(?:<\?xml\b[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*/i, "")
    .trim();
}

/** 抽出可独立保存的 SVG；允许 XML 声明、注释、style，或整段里只有一个 svg。 */
export function extractSvgDocument(code: string): string | null {
  const stripped = stripWidgetPreamble(code);
  if (/^<svg\b/i.test(stripped) && /<\/svg>\s*$/i.test(stripped)) {
    const match = stripped.match(/^<svg\b[\s\S]*<\/svg>/i);
    if (match) return match[0];
  }
  const svgs = stripped.match(/<svg\b[\s\S]*?<\/svg>/gi);
  return svgs?.length === 1 ? svgs[0] : null;
}

export function isSvgWidgetCode(code: string, _module?: string): boolean {
  // Like 参考设计, detect the fragment itself; a chart's SVG icon is not its render mode.
  return /^<svg\b/i.test(stripWidgetPreamble(code)) && extractSvgDocument(code) !== null;
}

export function widgetFileStem(title?: string): string {
  return (title || "widget")
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "widget";
}

export function resolveThemeVarsInCode(
  code: string,
  getProperty: (variableName: string) => string,
): string {
  return code.replace(
    /var\((--[\w-]+)(?:,\s*([^)]+))?\)/g,
    (original, variableName: string, fallback?: string) => {
      const resolved = getProperty(variableName).trim();
      if (resolved) return resolved;
      const fallbackValue = fallback?.trim();
      return fallbackValue || original;
    },
  );
}

export function ensureSvgXmlns(svg: string): string {
  if (/\sxmlns\s*=/i.test(svg)) return svg;
  return svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}

export function svgExportSize(svg: string): { width: number; height: number } {
  const viewBox = svg.match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1];
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    const width = parts[2];
    const height = parts[3];
    if (width > 0 && height > 0) return { width, height };
  }
  const width = Number(svg.match(/\bwidth\s*=\s*["']([\d.]+)/i)?.[1]);
  const height = Number(svg.match(/\bheight\s*=\s*["']([\d.]+)/i)?.[1]);
  if (width > 0 && height > 0) return { width, height };
  return { width: 680, height: 400 };
}

export function pngRasterSize(
  width: number,
  height: number,
  scale = PNG_SCALE,
): { width: number; height: number } {
  const longEdge = Math.max(width, height) * scale;
  const factor = longEdge > PNG_MAX_EDGE ? PNG_MAX_EDGE / Math.max(width, height) : scale;
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

/** 把栅格宽高写进 SVG，让浏览器按目标像素解码，避免先画小图再放大。 */
export function prepareSvgForPng(svg: string, pixelWidth: number, pixelHeight: number): string {
  return svg.replace(/<svg\b[^>]*>/i, (root) => {
    const withoutSize = root.replace(/\s(?:width|height)\s*=\s*["'][^"']*["']/gi, "");
    return withoutSize.replace(/<svg\b/i, `<svg width="${pixelWidth}" height="${pixelHeight}"`);
  });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function downloadWidgetSource(
  code: string,
  title: string | undefined,
  getProperty: (variableName: string) => string,
  module?: string,
): Promise<void> {
  code = await inlineWidgetImages(code);
  const stem = widgetFileStem(title);
  const svgMarkup = isSvgWidgetCode(code, module) ? extractSvgDocument(code) : null;
  const dark = document.documentElement.dataset.theme === "dark" || document.documentElement.classList.contains("dark");
  const names = [...code.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]);
  const themeCss = widgetThemeCss(getProperty, dark, names);
  if (svgMarkup) {
    triggerDownload(
      new Blob([ensureSvgXmlns(styleWidgetSvg(svgMarkup, themeCss, dark))], { type: "image/svg+xml;charset=utf-8" }),
      `${stem}.svg`,
    );
    return;
  }
  triggerDownload(
    new Blob(
      [buildWidgetDocument(code, themeCss, dark, "", location.origin)],
      { type: "text/html;charset=utf-8" },
    ),
    `${stem}.html`,
  );
}

export async function downloadWidgetPng(
  code: string,
  title: string | undefined,
  getProperty: (variableName: string) => string,
  module?: string,
  frame?: HTMLIFrameElement | null,
): Promise<void> {
  const svgMarkup = isSvgWidgetCode(code, module) ? extractSvgDocument(code) : null;
  if (!svgMarkup) {
    if (!frame) throw new Error("可视化尚未就绪，无法导出图片");
    triggerDownload(await captureWidgetPng(frame), `${widgetFileStem(title)}.png`);
    return;
  }
  const dark = document.documentElement.dataset.theme === "dark" || document.documentElement.classList.contains("dark");
  const names = [...svgMarkup.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]);
  const themed = ensureSvgXmlns(styleWidgetSvg(await inlineWidgetImages(svgMarkup), widgetThemeCss(getProperty, dark, names), dark));
  const logical = svgExportSize(themed);
  const raster = pngRasterSize(logical.width, logical.height);
  const svg = prepareSvgForPng(themed, raster.width, raster.height);
  const background = getProperty("--bg").trim() || "#ffffff";
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = raster.width;
    canvas.height = raster.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建画布");
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await canvasToPng(canvas);
    triggerDownload(png, `${widgetFileStem(title)}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("SVG 无法绘制为图片"));
    image.src = url;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG 导出失败"));
    }, "image/png");
  });
}
