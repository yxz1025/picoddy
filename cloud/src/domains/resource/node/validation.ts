import { fail } from "../../../shared/errors.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(400, "INVALID_REQUEST", "body must be an object");
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, field: string, maximum = 10_000): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    fail(
      400,
      "INVALID_REQUEST",
      `${field} must be a non-empty string of at most ${maximum} characters`,
    );
  }
  return value.trim();
}

export function optionalText(
  value: unknown,
  field: string,
  maximum = 10_000,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maximum) {
    fail(400, "INVALID_REQUEST", `${field} must be a string of at most ${maximum} characters`);
  }
  return value;
}

export function uuid(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !UUID.test(value)) {
    fail(400, "INVALID_REQUEST", `${field} must be a UUID`);
  }
  return value;
}

export function uuidList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 64) {
    fail(400, "INVALID_REQUEST", `${field} must be an array of at most 64 UUIDs`);
  }
  const result = value.map((entry) => {
    if (typeof entry !== "string" || !UUID.test(entry)) {
      fail(400, "INVALID_REQUEST", `${field} must contain UUIDs`);
    }
    return entry;
  });
  if (new Set(result).size !== result.length) {
    fail(400, "INVALID_REQUEST", `${field} must not contain duplicates`);
  }
  return result;
}

export function stringRecord(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(400, "INVALID_REQUEST", `${field} must be an object of string values`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100) fail(400, "INVALID_REQUEST", `${field} has too many entries`);
  const result: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!key || key.length > 200 || typeof item !== "string" || item.length > 20_000) {
      fail(400, "INVALID_REQUEST", `${field} contains an invalid entry`);
    }
    result[key] = item;
  }
  return result;
}
