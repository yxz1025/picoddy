export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

interface ErrorBody {
  error?: string | { code?: unknown; message?: unknown };
  code?: unknown;
  message?: unknown;
}

async function responseError(response: Response): Promise<ApiError> {
  let message = `请求失败 (${response.status})`;
  let code: string | undefined;
  try {
    const body = await response.json() as ErrorBody;
    if (typeof body.error === "string" && body.error.trim()) message = body.error;
    if (body.error && typeof body.error === "object") {
      if (typeof body.error.message === "string" && body.error.message.trim()) {
        message = body.error.message;
      }
      if (typeof body.error.code === "string") code = body.error.code;
    }
    if (typeof body.message === "string" && body.message.trim()) message = body.message;
    if (typeof body.code === "string") code = body.code;
  } catch {
    // Non-JSON error responses retain the status-based message.
  }
  return new ApiError(response.status, message, code);
}

export function unsupported(message: string, code = "CLOUD_UNSUPPORTED"): never {
  throw new ApiError(501, message, code);
}

export async function requestCloudJson<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = {
    method,
    credentials: "same-origin",
    headers,
    signal,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (!response.ok) throw await responseError(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  const value = JSON.parse(text) as unknown;
  if (
    value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === 1 && Object.prototype.hasOwnProperty.call(value, "data")
  ) {
    return (value as { data: T }).data;
  }
  return value as T;
}
