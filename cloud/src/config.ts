import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type StorageDriver = "local" | "s3" | "oss";

export interface Config {
  databaseUrl: string;
  host: string;
  port: number;
  publicOrigin: string;
  secureCookies: boolean;
  encryptionKey: string;
  casLoginUrl: string;
  casExchangeUrl: string;
  skillHubBaseUrl: string;
  skillHubSecret: string;
  skillHubSecretFile: string;
  skillHubDownloadHosts: string[];
  sandboxDomain: string;
  sandboxApiKey: string;
  sandboxImage: string;
  sandboxTimeoutSeconds: number;
  storageDriver: StorageDriver;
  storageLocalRoot: string;
  storageEndpoint: string;
  storageRegion: string;
  storageBucket: string;
  storageAccessKey: string;
  storageSecretKey: string;
  oss?: { region: string; bucket: string; endpoint?: string; accessKeyId: string; accessKeySecret: string };
  maxUploadBytes: number;
  workerConcurrency: number;
  modelAllowedHosts: string[];
}

type Environment = Record<string, string | undefined>;

const CLOUD_DIRECTORY = fileURLToPath(new URL("../", import.meta.url));
const DEFAULT_LOCAL_STORAGE_ROOT = resolve(CLOUD_DIRECTORY, "data/files");

const DEFAULT_MODEL_HOSTS = [
  "api.anthropic.com",
  "api.deepseek.com",
  "api.mistral.ai",
  "api.moonshot.cn",
  "api.openai.com",
  "api.x.ai",
  "dashscope.aliyuncs.com",
  "generativelanguage.googleapis.com",
  "openrouter.ai",
];

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(
  env: Environment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function boolean(env: Environment, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new Error(`${name} must be true or false`);
}

function url(value: string, name: string, protocols: readonly string[]): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use ${protocols.join(" or ")}`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function validateEncryptionKey(value: string): void {
  const isHex = /^[a-f\d]{64}$/i.test(value);
  const isUtf8 = Buffer.byteLength(value, "utf8") === 32;
  let isBase64 = false;
  try {
    isBase64 = Buffer.from(value, "base64").byteLength === 32;
  } catch {
    isBase64 = false;
  }
  if (!isHex && !isUtf8 && !isBase64) {
    throw new Error("ENCRYPTION_KEY must encode exactly 32 bytes");
  }
}

function authEndpoint(value: string, name: string): string {
  const parsed = new URL(url(value, name, ['https:']));
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must be a trusted HTTPS endpoint without credentials, query or fragment`);
  }
  return parsed.toString();
}

function skillHubEndpoint(env: Environment): string {
  const value=env.SKILLHUB_BASE_URL?.trim() || '';
  if (!value) return '';
  const parsed=new URL(url(value,'SKILLHUB_BASE_URL',['http:','https:']));
  if(parsed.username||parsed.password||parsed.search||parsed.hash) {
    throw new Error('SKILLHUB_BASE_URL must be a server-managed endpoint without credentials, query or fragment');
  }
  return parsed.toString().replace(/\/+$/,'');
}

function modelHosts(env: Environment): string[] {
  const raw = env.MODEL_ALLOWED_HOSTS;
  const values = raw ? raw.split(",") : DEFAULT_MODEL_HOSTS;
  const hosts = values
    .map((entry) => entry.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
  if (hosts.length === 0) throw new Error("MODEL_ALLOWED_HOSTS must not be empty");
  for (const host of hosts) {
    if (host.includes("://") || host.includes("/") || /\s/.test(host)) {
      throw new Error("MODEL_ALLOWED_HOSTS entries must be hostnames, not URLs");
    }
  }
  return [...new Set(hosts)];
}

function storageDriver(env: Environment): StorageDriver {
  const value = env.STORAGE_DRIVER?.trim().toLowerCase() || "local";
  if (value !== "local" && value !== "s3" && value !== "oss") {
    throw new Error("STORAGE_DRIVER must be local, s3 or oss");
  }
  return value;
}

function localStorageRoot(env: Environment): string {
  const value = env.STORAGE_LOCAL_ROOT?.trim();
  if (value?.includes("\0")) throw new Error("STORAGE_LOCAL_ROOT must not contain NUL bytes");
  return value ? resolve(CLOUD_DIRECTORY, value) : DEFAULT_LOCAL_STORAGE_ROOT;
}

export function loadConfig(env: Environment = process.env): Config {
  const databaseUrl = url(required(env, "DATABASE_URL"), "DATABASE_URL", [
    "postgres:",
    "postgresql:",
  ]);
  const publicOrigin = url(required(env, "PUBLIC_ORIGIN"), "PUBLIC_ORIGIN", [
    "http:",
    "https:",
  ]);
  if (publicOrigin !== new URL(publicOrigin).origin) {
    throw new Error("PUBLIC_ORIGIN must not include a path, query, or fragment");
  }
  const origin = new URL(publicOrigin);
  const allowInsecureHttp = boolean(env, 'ALLOW_INSECURE_HTTP', false);
  const octets = origin.hostname.split('.').map(Number);
  const privateIp = octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    && (octets[0] === 10 || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
      || (octets[0] === 192 && octets[1] === 168));
  const privateHttp = origin.protocol === 'http:' && allowInsecureHttp && privateIp;
  if (origin.protocol !== 'https:' && !privateHttp && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
    throw new Error('PUBLIC_ORIGIN must use HTTPS except for loopback development');
  }
  const secureCookies = boolean(env, 'SECURE_COOKIES', origin.protocol === 'https:');
  if (origin.protocol === 'https:' && !secureCookies) throw new Error('SECURE_COOKIES cannot be disabled for HTTPS');
  if (privateHttp && secureCookies) throw new Error('SECURE_COOKIES must be false for private HTTP');
  const encryptionKey = required(env, "ENCRYPTION_KEY");
  validateEncryptionKey(encryptionKey);
  const selectedStorageDriver = storageDriver(env);
  let oss: Config['oss'];
  if (selectedStorageDriver === 'oss') {
    const region = required(env, 'OSS_REGION');
    if (!/^oss-[a-z0-9]+(?:-[a-z0-9]+)+$/.test(region)) throw new Error('OSS_REGION must be an OSS region, such as oss-cn-hangzhou');
    const bucket = required(env, 'OSS_BUCKET');
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('OSS_BUCKET is invalid');
    if (env.OSS_STS_TOKEN?.trim()) throw new Error('Fixed OSS STS tokens are not supported without credential refresh; use dedicated server-side RAM credentials');
    const endpoint = env.OSS_ENDPOINT?.trim() ? url(env.OSS_ENDPOINT.trim(), 'OSS_ENDPOINT', ['https:']) : undefined;
    if (endpoint) {
      const parsed = new URL(endpoint);
      if (parsed.username || parsed.password || endpoint !== parsed.origin) throw new Error('OSS_ENDPOINT must be an HTTPS origin without credentials or path');
    }
    oss = { region, bucket, endpoint, accessKeyId: required(env, 'OSS_ACCESS_KEY_ID'), accessKeySecret: required(env, 'OSS_ACCESS_KEY_SECRET') };
  }
  const storageEndpoint = selectedStorageDriver === "s3"
    ? url(required(env, "STORAGE_ENDPOINT"), "STORAGE_ENDPOINT", ["http:", "https:"])
    : "";

  return {
    databaseUrl,
    host: env.HOST?.trim() || "0.0.0.0",
    port: integer(env, "PORT", 8080, 0, 65_535),
    publicOrigin,
    secureCookies,
    encryptionKey,
    casLoginUrl: env.CAS_LOGIN_URL?.trim() ? authEndpoint(env.CAS_LOGIN_URL.trim(), 'CAS_LOGIN_URL') : '',
    casExchangeUrl: env.CAS_EXCHANGE_URL?.trim() ? authEndpoint(env.CAS_EXCHANGE_URL.trim(), 'CAS_EXCHANGE_URL') : '',
    skillHubBaseUrl: skillHubEndpoint(env),
    skillHubSecret: env.SKILLHUB_AUTH_ACCESS_TOKEN_SECRET?.trim() || env.SKILLHUB_ACCESS_TOKEN_SECRET_API_KEY?.trim() || '',
    skillHubSecretFile: resolve(CLOUD_DIRECTORY,env.SKILLHUB_SECRET_FILE?.trim() || 'data/skillhub-secret.enc'),
    skillHubDownloadHosts: env.SKILLHUB_DOWNLOAD_HOSTS?.trim() ? modelHosts({MODEL_ALLOWED_HOSTS:env.SKILLHUB_DOWNLOAD_HOSTS}) : [],
    sandboxDomain: url(
      required(env, "SANDBOX_DOMAIN"),
      "SANDBOX_DOMAIN",
      ["http:", "https:"],
    ),
    sandboxApiKey: required(env, "SANDBOX_API_KEY"),
    sandboxImage: env.SANDBOX_IMAGE?.trim() || "picoddy-cloud-sandbox:latest",
    sandboxTimeoutSeconds: integer(env, "SANDBOX_TIMEOUT_SECONDS", 900, 30, 86_400),
    storageDriver: selectedStorageDriver,
    ...(oss ? { oss } : {}),
    storageLocalRoot: localStorageRoot(env),
    storageEndpoint,
    storageRegion: env.STORAGE_REGION?.trim() || "us-east-1",
    storageBucket: env.STORAGE_BUCKET?.trim() || "picoddy-cloud",
    storageAccessKey: selectedStorageDriver === "s3"
      ? required(env, "STORAGE_ACCESS_KEY")
      : "",
    storageSecretKey: selectedStorageDriver === "s3"
      ? required(env, "STORAGE_SECRET_KEY")
      : "",
    maxUploadBytes: integer(env, "MAX_UPLOAD_BYTES", 25 * 1024 * 1024, 1, 1024 ** 3),
    workerConcurrency: integer(env, "WORKER_CONCURRENCY", 2, 1, 128),
    modelAllowedHosts: modelHosts(env),
  };
}
