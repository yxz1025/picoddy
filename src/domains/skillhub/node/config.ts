export const SKILLHUB_BASE_URL = "";

export function resolveSkillHubBaseUrl(): string {
  const value = (process.env["SKILLHUB_BASE_URL"] ?? process.env["SKILLHUB_REGISTRY"])?.trim();
  if (!value) throw new Error("未配置自定义专家市场地址；技能请使用公开 ClawHub");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("技能市场部署地址无效"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("技能市场部署地址无效");
  }
  return url.toString().replace(/\/+$/, "");
}
