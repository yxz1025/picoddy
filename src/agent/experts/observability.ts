export type ExpertEventField = string | number | boolean | null | undefined;

const SAFE_EVENT_FIELDS = new Set([
  "expertId",
  "conversationId",
  "oldExpertId",
  "newExpertId",
  "revision",
  "catalogSource",
  "promptSource",
  "durationMs",
  "result",
  "errorCode",
  "status",
]);

const MAX_EVENT_STRING_LENGTH = 256;

function boundEventValue(value: ExpertEventField): ExpertEventField {
  if (typeof value !== "string") return value;
  return value.length > MAX_EVENT_STRING_LENGTH
    ? `${value.slice(0, MAX_EVENT_STRING_LENGTH)}…`
    : value;
}

/**
 * Emit a small, structured expert-runtime event.
 *
 * Prompt bodies are deliberately removed from the payload even when a caller
 * accidentally includes a field with a prompt-like name. This keeps the
 * logger safe to use at the resolver boundary.
 */
export function logExpertEvent(
  event: string,
  fields: Record<string, ExpertEventField>,
  sink: (line: string) => void = console.info,
): void {
  const safeFields = Object.fromEntries(
    Object.entries(fields)
      .filter(([key]) => SAFE_EVENT_FIELDS.has(key))
      .map(([key, value]) => [key, boundEventValue(value)]),
  );
  sink(JSON.stringify({
    // Event names are normally internal constants, but keep this boundary
    // bounded as well so an accidental dynamic value cannot create an
    // unbounded log line.  Lifecycle consumers still receive the full name
    // for all supported events (which are far below this limit).
    event: boundEventValue(event) as string,
    timestamp: new Date().toISOString(),
    ...safeFields,
  }));
}
