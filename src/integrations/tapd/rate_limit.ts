export class TapdRateLimitError extends Error {
  readonly code = 'TAPD_RATE_LIMITED';
  readonly status = 429;
  constructor(readonly retryAfterSeconds: number) {
    super(`TAPD 请求过于频繁，已触发限流，请至少等待 ${retryAfterSeconds} 秒后重试`);
    this.name = 'TapdRateLimitError';
  }
}

/** Do not parse or retry a rate-limited response (including non-JSON gateways). */
export function assertTapdRateLimit(response: Response, endpoint: string, now = Date.now()) {
  if (response.status !== 429) return;
  const value = response.headers.get('retry-after')?.trim() || '';
  const delay = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - now) / 1000);
  const seconds = Number.isFinite(delay) && delay > 0 ? delay : 60;
  console.warn('tapd-api rate limited', { endpoint, httpStatus: 429, retryAfterSeconds: seconds });
  throw new TapdRateLimitError(seconds);
}
