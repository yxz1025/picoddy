import { fail } from './errors.ts';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function object(value: unknown, label = "body"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(400, "INVALID_REQUEST", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function string(
  value: unknown,
  label: string,
  minimum = 1,
  maximum = 10_000,
): string {
  if (typeof value !== "string") fail(400, "INVALID_REQUEST", `${label} must be a string`);
  const result = value.trim();
  if (result.length < minimum || result.length > maximum) {
    fail(400, "INVALID_REQUEST", `${label} must contain ${minimum}-${maximum} characters`);
  }
  return result;
}

export function optionalUuid(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !UUID.test(value)) {
    fail(400, "INVALID_REQUEST", `${label} must be a UUID`);
  }
  return value;
}

export function uuidArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) {
    fail(400, "INVALID_REQUEST", `${label} must be an array of at most 64 UUIDs`);
  }
  const result = value.map((item) => {
    if (typeof item !== "string" || !UUID.test(item)) {
      fail(400, "INVALID_REQUEST", `${label} must contain only UUIDs`);
    }
    return item;
  });
  if (new Set(result).size !== result.length) {
    fail(400, "INVALID_REQUEST", `${label} must not contain duplicates`);
  }
  return result;
}
