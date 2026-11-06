export interface ApiResponseError extends Error {
  status: number;
  code?: string;
}

/** Decode fetch-style API responses without throwing plain objects across IPC. */
export async function decodeApiResponse(result: Response): Promise<unknown> {
  let payload: unknown;
  try {
    payload = await result.json();
  } catch {
    payload = undefined;
  }
  if (result.ok) return payload;

  const record = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : undefined;
  const message = typeof record?.error === "string" && record.error.trim()
    ? record.error
    : typeof record?.message === "string" && record.message.trim()
    ? record.message
    : `请求失败 (${result.status})`;
  const code = typeof record?.code === "string" ? record.code : undefined;
  const error = new Error(message) as ApiResponseError;
  error.name = "ApiError";
  error.status = result.status;
  if (code) error.code = code;
  throw error;
}
