import { useEffect, useState } from "react";
import { cloudFileUrl } from "../../utils/cloudFile";

export default function CloudFilePreview({ path, name }: { path: string; name: string }) {
  const url = cloudFileUrl(path);
  const [content, setContent] = useState<{ blob?: string; text?: string; error?: string }>({});
  const extension = (path.split("/").pop() || name).split(".").pop()?.toLowerCase() ?? "";
  const image = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(extension);
  const text = ["txt", "md", "json", "yaml", "yml", "csv", "tsv", "html", "svg", "js", "ts", "py", "log"].includes(extension);
  useEffect(() => {
    setContent({});
    if (!url || (!image && !text)) return;
    const controller = new AbortController();
    let blobUrl: string | undefined;
    void (async () => {
      try {
        const response = await fetch(url, { credentials: "same-origin", signal: controller.signal });
        if (!response.ok) throw new Error(`文件读取失败（${response.status}）`);
        const limit = 10 * 1024 * 1024;
        const declared = response.headers.get("Content-Length");
        if (declared !== null && Number(declared) > limit) throw new Error("预览上限 10MB，请下载查看");
        if (!response.body) throw new Error("文件响应为空");
        const reader = response.body.getReader();
        const chunks: ArrayBuffer[] = [];
        let size = 0;
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > limit) throw new Error("预览上限 10MB，请下载查看");
            chunks.push(new Uint8Array(value).buffer);
          }
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
        // SVG is rendered only as an image resource, never injected into the page DOM.
        const blob = new Blob(chunks, { type: extension === "svg" ? "image/svg+xml" : response.headers.get("Content-Type") || "application/octet-stream" });
        if (controller.signal.aborted) return;
        if (image) { blobUrl = URL.createObjectURL(blob); setContent({ blob: blobUrl }); }
        else { const value = await blob.text(); if (!controller.signal.aborted) setContent({ text: value }); }
      } catch (error) {
        if (!controller.signal.aborted) setContent({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => { controller.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [url, image, text, extension]);
  if (!url) return <div className="preview-empty-state">此文件尚未发布，请让 Agent 发布交付物后下载。</div>;
  return <div className="preview-panel" style={{ padding: 16, overflow: "auto" }}>
    <a className="settings-btn" href={url} download>下载 {name}</a>
    {content.error && <p role="alert">{content.error}</p>}
    {content.blob && <img src={content.blob} alt={name} style={{ maxWidth: "100%" }} />}
    {content.text !== undefined && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{content.text}</pre>}
    {!image && !text && <p>此格式的云端预览尚未接入，请下载查看。</p>}
  </div>;
}
