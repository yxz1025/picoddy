export function encodeJsonForXml(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
}

export function renderJsonBlock(tag: string, value: unknown): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(tag)) {
    throw new TypeError("JSON block tag is invalid");
  }
  return `<${tag} encoding="json">${encodeJsonForXml(value)}</${tag}>`;
}
