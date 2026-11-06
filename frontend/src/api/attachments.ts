import type { PublicAttachment } from "../components/composerMenuModel.ts";

interface AttachmentResponse {
  attachments?: unknown;
  error?: string;
}

async function readAttachmentResponse(
  response: Response,
): Promise<AttachmentResponse> {
  try {
    return await response.json() as AttachmentResponse;
  } catch {
    return {};
  }
}

function isPublicAttachment(value: unknown): value is PublicAttachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Record<string, unknown>;
  return typeof attachment.id === "string" &&
    attachment.id.length > 0 &&
    typeof attachment.name === "string" &&
    attachment.name.length > 0 &&
    typeof attachment.size === "number" &&
    Number.isFinite(attachment.size) &&
    attachment.size >= 0 &&
    typeof attachment.mimeType === "string" &&
    typeof attachment.extension === "string" &&
    (attachment.extension === "" || /^[a-z0-9]+$/.test(attachment.extension));
}

export async function uploadAttachments(
  files: File[],
): Promise<PublicAttachment[]> {
  console.log("[upload] uploadAttachments called, files:", files.map(f => ({name: f.name, size: f.size, type: f.type})));
  const ipc = (window as any).electronAPI;
  if (ipc?.attachments?.upload) {
    console.log("[upload] using IPC path");
    const results = await Promise.all(
      files.map(async (f) => {
        console.log("[upload] IPC uploading:", f.name, "size:", f.size);
        const result = await ipc.attachments.upload(f);
        console.log("[upload] IPC result:", JSON.stringify(result));
        return result;
      }),
    );
    const filtered = results.flat().filter(isPublicAttachment);
    console.log("[upload] IPC filtered results:", filtered.length, "of", results.flat().length);
    if (filtered.length !== files.length) {
      throw new Error("附件上传响应无效");
    }
    return filtered;
  }
  // 非 Electron 环境：HTTP FormData 上传
  console.log("[upload] using HTTP fallback path");
  const form = new FormData();
  files.forEach((file) => form.append("files", file));
  const response = await fetch("/api/attachments", { method: "POST", body: form });
  console.log("[upload] HTTP response status:", response.status);
  const data = await readAttachmentResponse(response);
  console.log("[upload] HTTP response data:", JSON.stringify(data));
  if (!response.ok) throw new Error(data.error || "附件上传失败");
  if (!Array.isArray(data.attachments) || data.attachments.length !== files.length || !data.attachments.every(isPublicAttachment)) {
    throw new Error("附件上传响应无效");
  }
  return data.attachments.map(({ id, name, size, mimeType, extension }) => ({ id, name, size, mimeType, extension }));
}

export async function deletePendingAttachment(id: string): Promise<void> {
  const ipc = (window as any).electronAPI;
  if (ipc?.attachments?.delete) {
    await ipc.attachments.delete({ id });
    return;
  }
  const response = await fetch(
    `/api/attachments/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  if (response.ok) return;

  const data = await readAttachmentResponse(response);
  throw new Error(data.error || "附件删除失败");
}
