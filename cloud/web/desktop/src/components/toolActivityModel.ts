export type ToolActivityStatus = "running" | "success" | "error";

export interface ToolActivityMessage {
  id: string;
  content?: string;
  isError?: boolean;
  status?: ToolActivityStatus;
  toolArgs?: string;
  toolName?: string;
}

export function getToolActivityStatus(
  message: ToolActivityMessage,
): ToolActivityStatus {
  return message.status || (message.isError ? "error" : "success");
}

function isToolParameterValidationFailure(
  message: ToolActivityMessage,
): boolean {
  return getToolActivityStatus(message) === "error" &&
    /\bValidation failed for tool\b/i.test(message.content ?? "");
}

function parseToolPath(message: ToolActivityMessage): string | undefined {
  if (!message.toolArgs) return undefined;
  try {
    const input = JSON.parse(message.toolArgs) as { path?: unknown } | null;
    return typeof input?.path === "string" && input.path.trim().length > 0
      ? input.path.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizePathForComparison(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

function isRecoveredXlsxRead(
  current: ToolActivityMessage,
  next: ToolActivityMessage,
): boolean {
  if (
    current.toolName !== "read_xlsx" ||
    next.toolName !== "read_doc" ||
    getToolActivityStatus(current) !== "error" ||
    getToolActivityStatus(next) !== "success" ||
    !/^\s*Tool\s+["']?read_xlsx["']?\s+not found\s*$/i.test(
      current.content ?? "",
    )
  ) {
    return false;
  }

  const currentPath = parseToolPath(current);
  const nextPath = parseToolPath(next);
  return Boolean(
    currentPath &&
      nextPath &&
      normalizePathForComparison(currentPath) ===
        normalizePathForComparison(nextPath),
  );
}

/**
 * A failure is recovered only by the immediately following, explicitly
 * compatible successful call. The original error remains available for
 * expansion and audit; this set only controls its presentation status.
 */
export function autoCorrectedToolCallIds(
  messages: readonly ToolActivityMessage[],
): ReadonlySet<string> {
  const corrected = new Set<string>();
  for (let index = 0; index < messages.length - 1; index++) {
    const current = messages[index];
    const next = messages[index + 1];
    if (
      current.toolName &&
      ((current.toolName === next.toolName &&
        isToolParameterValidationFailure(current) &&
        getToolActivityStatus(next) === "success") ||
        isRecoveredXlsxRead(current, next))
    ) {
      corrected.add(current.id);
    }
  }
  return corrected;
}
