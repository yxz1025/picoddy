import {
  MAX_ATTACHMENT_BYTES,
  type PublicAttachment,
} from "../components/composerMenuModel.ts";
import { requestCloudJson } from "./cloudHttp";

interface CloudFile { id: string; name: string; size: number; mimeType: string }

function extension(name: string): string {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index + 1).toLowerCase();
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function publicAttachment(file: CloudFile): PublicAttachment {
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    mimeType: file.mimeType,
    extension: extension(file.name),
  };
}

export async function uploadAttachments(files: File[]): Promise<PublicAttachment[]> {
  const oversized = files.find((file) => file.size > MAX_ATTACHMENT_BYTES);
  if (oversized) {
    throw new Error(`附件“${oversized.name}”超过 25 MiB 限制`);
  }
  const uploaded: CloudFile[] = [];
  try {
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      uploaded.push(await requestCloudJson<CloudFile>("POST", "/api/files", {
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64: base64(bytes),
      }));
    }
    return uploaded.map(publicAttachment);
  } catch (error) {
    await Promise.allSettled(
      uploaded.map((file) => requestCloudJson("DELETE", `/api/files/${encodeURIComponent(file.id)}`)),
    );
    throw error;
  }
}

export async function deletePendingAttachment(id: string): Promise<void> {
  await requestCloudJson("DELETE", `/api/files/${encodeURIComponent(id)}`);
}
