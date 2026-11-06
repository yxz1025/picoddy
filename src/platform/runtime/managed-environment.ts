import { posix, win32 } from "node:path";

const BLOCKED_KEYS = new Set([
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_DEBUG",
  "NODE_EXTRA_CA_CERTS",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "PYTHONHOME",
  "PYTHONPATH",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
]);
const BLOCKED_PREFIXES = ["ELECTRON_", "CODEBUDDY_", "VITE_", "ACC_PRODUCT_CONFIG_"];
const PROXY_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"] as const;

function shouldDrop(key: string): boolean {
  const upper = key.toUpperCase();
  return BLOCKED_KEYS.has(upper)
    || BLOCKED_PREFIXES.some((prefix) => upper.startsWith(prefix))
    || /(?:TOKEN|API_KEY|PASSWORD|SECRET)$/u.test(upper);
}

export interface ManagedEnvironmentInput {
  platform: "darwin" | "win32";
  pythonRoot?: string;
  wrapperDir: string;
  hostEnv?: NodeJS.ProcessEnv;
}

function copySafeHostEnv(hostEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(hostEnv)) {
    if (value !== undefined && !shouldDrop(key)) result[key] = value;
  }
  return result;
}

function replacePath(env: NodeJS.ProcessEnv, paths: string[], platform: "darwin" | "win32"): void {
  const existingKey = platform === "win32"
    ? Object.keys(env).find((key) => key.toUpperCase() === "PATH")
    : "PATH";
  const previous = existingKey ? env[existingKey] : undefined;
  if (existingKey && existingKey !== "PATH") delete env[existingKey];
  const pathDelimiter = platform === "win32" ? ";" : ":";
  env.PATH = [...paths, ...(previous ? [previous] : [])].join(pathDelimiter);
}

export function buildManagedShellEnv(input: ManagedEnvironmentInput): NodeJS.ProcessEnv {
  const env = copySafeHostEnv(input.hostEnv ?? process.env);
  const pathJoin = input.platform === "win32" ? win32.join : posix.join;
  const pythonBin = !input.pythonRoot ? undefined : input.platform === "win32" ? input.pythonRoot : pathJoin(input.pythonRoot, "bin");
  const pythonScripts = input.pythonRoot && input.platform === "win32" ? pathJoin(input.pythonRoot, "Scripts") : undefined;
  replacePath(env, [...(pythonBin ? [pythonBin] : []), ...(pythonScripts ? [pythonScripts] : []), input.wrapperDir], input.platform);
  delete env.ELECTRON_RUN_AS_NODE;
  env.PYTHONUTF8 = "1";
  env.PYTHONNOUSERSITE = "1";
  env.PYTHONDONTWRITEBYTECODE = "1";
  return env;
}

export function buildManagedNodeEnv(hostEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = copySafeHostEnv(hostEnv);
  env.ELECTRON_RUN_AS_NODE = "1";
  return env;
}

export function buildManagedPythonEnv(hostEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = copySafeHostEnv(hostEnv);
  // pip and uv must be able to use an explicitly configured enterprise proxy.
  // Proxy variables are stripped from the general managed environment above so
  // they do not leak to arbitrary tools; restore them only for Python package
  // operations, normalizing lowercase variants used on macOS and Linux.
  for (const proxyKey of PROXY_KEYS) {
    const entry = Object.entries(hostEnv).find(([key, value]) => key.toUpperCase() === proxyKey && value !== undefined);
    if (entry) env[proxyKey] = entry[1];
  }
  delete env.ELECTRON_RUN_AS_NODE;
  env.PYTHONUTF8 = "1";
  env.PYTHONNOUSERSITE = "1";
  env.PYTHONDONTWRITEBYTECODE = "1";
  return env;
}
