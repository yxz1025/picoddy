import { cloudFileUrl } from "./cloudFile";
/** Download published files through the authenticated cloud endpoint. */
export function showItemInFolder(filePath: string): void {
  const url = cloudFileUrl(filePath);
  if (!url) return;
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  link.click();
}
