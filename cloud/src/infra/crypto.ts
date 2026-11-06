import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function encryptionKey(value: string): Buffer {
  if (/^[a-f\d]{64}$/i.test(value)) return Buffer.from(value, "hex");
  if (Buffer.byteLength(value, "utf8") === 32) return Buffer.from(value, "utf8");
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength === 32) return decoded;
  throw new Error("Encryption key must encode exactly 32 bytes");
}

export function seal(value: unknown, key: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(key), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((part) => typeof part === "string" ? part : part.toString("base64url"))
    .join(".");
}

export function unseal(ciphertext: string, key: string): unknown {
  try {
    const [version, encodedIv, encodedTag, encodedBody, ...extra] = ciphertext.split(".");
    if (
      version !== VERSION ||
      !encodedIv ||
      !encodedTag ||
      !encodedBody ||
      extra.length > 0
    ) {
      throw new Error("Malformed ciphertext");
    }
    const iv = Buffer.from(encodedIv, "base64url");
    const tag = Buffer.from(encodedTag, "base64url");
    if (iv.byteLength !== IV_BYTES || tag.byteLength !== 16) {
      throw new Error("Malformed ciphertext");
    }
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(key), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encodedBody, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error("Unable to decrypt secret", { cause: error });
  }
}
