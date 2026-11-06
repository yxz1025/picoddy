export type SubscriptionStage = "initializing" | "callback" | "exchange" | "validation" | "storage" | "request";
const labels: Record<SubscriptionStage, string> = {
  initializing: "授权初始化", callback: "授权回调", exchange: "令牌交换",
  validation: "令牌校验", storage: "凭据保存", request: "模型调用",
};

/** Only allowlisted diagnostics leave the process. Never forward response bodies, URLs or credentials. */
export function subscriptionError(error: unknown, stage: SubscriptionStage): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current) && seen.size < 6) {
    seen.add(current);
    if (typeof current === "string") { messages.push(current); break; }
    if (typeof current !== "object") break;
    const e = current as {message?: unknown; code?: unknown; cause?: unknown};
    if (typeof e.message === "string") messages.push(e.message);
    if (typeof e.code === "string") messages.push(e.code);
    current = e.cause;
  }
  const raw = messages.join(" ");
  const http = raw.match(/(?:HTTP\s*|(?:error|failed)\s*\()(\d{3})/i)?.[1];
  const codes = ["invalid_grant", "invalid_client", "access_denied", "invalid_scope", "subscription_sharing_usage_limit_exceeded", "insufficient_quota", "rate_limit_exceeded", "model_not_found", "EADDRINUSE", "EACCES", "EPERM", "ENOSPC", "EROFS", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT"];
  const code = codes.find(c => new RegExp(`\\b${c}\\b`, "i").test(raw));
  if (/token response|grant did not include|issued client ID/i.test(raw)) stage = "validation";
  let reason = "未完成，请重试；若持续失败，请提供此错误及客户端版本";
  if (/EADDRINUSE|Port 1455 is in use/i.test(raw)) reason = "本机回调端口 1455 被占用，请取消其他客户端的待完成登录后重试";
  else if (/model.*not supported|model_not_found/i.test(raw)) reason = "当前模型不支持此订阅账号，请选择其他模型，无需重新登录";
  else if (/usage_limit|insufficient_quota|rate_limit|\b429\b/i.test(raw)) reason = "订阅额度不足或请求受限，请检查账号额度并稍后重试";
  else if (/invalid_grant/i.test(raw)) reason = "授权码或刷新凭据已失效，请重新发起登录，不要重复使用旧回调地址";
  else if (/invalid_client/i.test(raw)) reason = "授权客户端注册信息被拒绝，请重新登录";
  else if (/state mismatch|Missing OAuth state|callback URL|Missing authorization code/i.test(raw)) reason = "回调地址无效或与本次登录不匹配，请使用本次登录的完整回调地址";
  else if (/EACCES|EPERM|ENOSPC|EROFS/i.test(raw)) reason = "本机权限或磁盘异常，请检查应用数据目录权限及剩余空间";
  else if (/certificate|CERT_|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(raw)) reason = "TLS 证书校验失败，请检查系统时间、代理及企业证书配置";
  else if (/fetch failed|Connection error|ENOTFOUND|EAI_AGAIN|ECONN|ETIMEDOUT|UND_ERR|timeout|timed out/i.test(raw)) reason = "无法连接 OpenAI 或请求超时，请检查此客户端的网络和代理设置";
  else if (stage === "validation") reason = "OpenAI 返回的令牌字段或授权范围不符合要求，请重新登录";
  else if (http === "401" || http === "403" || /access_denied/i.test(raw)) reason = "OpenAI 拒绝授权，请检查账号权限或重新登录";
  else if (http && Number(http) >= 500) reason = "OpenAI 服务暂时异常，请稍后重试";
  return `${labels[stage]}失败：${reason}${http || code ? `（${[http && `HTTP ${http}`, code].filter(Boolean).join("；")}）` : ""}`;
}
