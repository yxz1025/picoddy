import { cloudWidgetImageUrl } from "./widgetImageSource";
import { WIDGET_CDN_HOSTS } from "./widgetDocument";

/** Resolve workspace images in the host so sandbox captures and saved files remain standalone. */
export async function inlineWidgetImages(code: string): Promise<string> {
  const template = document.createElement("template");
  template.innerHTML = code;
  const requests = new Map<string, Promise<string>>();
  await Promise.all(Array.from(template.content.querySelectorAll("img,image")).map(async image => {
    const attr = image.localName === "img" ? "src" : image.hasAttribute("href") ? "href" : "xlink:href";
    const source = image.getAttribute(attr) || image.getAttribute("srcset")?.split(",")[0]?.trim().split(/\s+/)[0];
    if (!source || source.startsWith("data:") || source.startsWith("#")) return;
    let url: string;
    const cloudUrl = cloudWidgetImageUrl(source, location.origin);
    if (cloudUrl) {
      url = cloudUrl;
    } else {
      try { const parsed = new URL(source); if (parsed.protocol !== "https:" || !(WIDGET_CDN_HOSTS as readonly string[]).includes(parsed.hostname)) return; url = parsed.href; }
      catch { return; }
    }
    if (!requests.has(url)) requests.set(url, (async () => {
      const response = await fetch(url, {signal: AbortSignal.timeout(8000)});
      if (!response.ok) throw new Error(`无法读取可视化图片：${source}`);
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error(`可视化图片类型无效：${source}`);
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error(`无法解码可视化图片：${source}`));
        reader.readAsDataURL(blob);
      });
    })());
    try {
      image.setAttribute(attr, await requests.get(url)!);
      image.removeAttribute("srcset");
      image.removeAttribute("sizes");
      if (image.parentElement?.localName === "picture") {
        image.parentElement.querySelectorAll("source").forEach(source => source.remove());
      }
    } catch {
      // Match 参考设计's per-image fallback: one unavailable asset must not hide the widget.
    }
  }));
  return template.innerHTML;
}
