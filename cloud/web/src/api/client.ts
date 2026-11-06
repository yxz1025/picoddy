export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

export async function unwrapResponse<T>(response: Response): Promise<T> {
  if (response.ok && response.status === 204) return undefined as T;
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? ((await response.json()) as { data?: T } & ErrorEnvelope) : undefined;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? "REQUEST_FAILED",
      body?.error?.message ?? `请求失败（${response.status}）`,
    );
  }

  if (!body || !("data" in body)) {
    throw new ApiError(response.status, "INVALID_RESPONSE", "服务返回了无法识别的数据");
  }
  return body.data as T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  headers.set("accept", "application/json");

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  return unwrapResponse<T>(response);
}

export const api = {
  get<T>(path: string, signal?: AbortSignal) {
    return request<T>(path, { method: "GET", signal });
  },
  post<T>(path: string, body?: unknown, signal?: AbortSignal) {
    return request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  },
  patch<T>(path: string, body: unknown, signal?: AbortSignal) {
    return request<T>(path, { method: "PATCH", body: JSON.stringify(body), signal });
  },
  delete<T>(path: string, signal?: AbortSignal) {
    return request<T>(path, { method: "DELETE", signal });
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "发生了未知错误，请稍后重试";
}
