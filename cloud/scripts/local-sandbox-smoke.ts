import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { SandboxApiException } from "@alibaba-group/opensandbox";

import type { Config } from "../src/config.ts";
import {
  createSandbox,
  reconcileRunSandboxes,
  type CloudSandbox,
} from "../src/platform/sandbox.ts";

const SERVER_ORIGIN = "http://127.0.0.1:8090";
const SERVER_PORT = 8090;
const SANDBOX_IMAGE = "picoddy-cloud-sandbox:0.1.0";
const CLOUD_ROOT = fileURLToPath(new URL("../", import.meta.url));
const COMPOSE_FILE = fileURLToPath(
  new URL("../deploy/opensandbox.local.yaml", import.meta.url),
);
const PROCESS_OUTPUT_LIMIT = 64 * 1024;

type SmokeStage =
  | "preflight"
  | "compose_up"
  | "health"
  | "sandbox_create"
  | "sandbox_write"
  | "sandbox_read"
  | "sandbox_exec"
  | "sandbox_destroy"
  | "sandbox_reconcile"
  | "compose_down";

interface SmokeFailure {
  stage: SmokeStage;
  status: string;
  diagnostic?: {
    method: "GET" | "POST";
    path: string;
    httpStatus: number;
    sdkCode?: string;
  };
}

class PortOccupiedError extends Error {
  constructor() {
    super("LOCAL_SANDBOX_PORT_OCCUPIED");
    this.name = "PortOccupiedError";
  }
}

class HealthTimeoutError extends Error {
  constructor() {
    super("LOCAL_SANDBOX_HEALTH_TIMEOUT");
    this.name = "HealthTimeoutError";
  }
}

class ProcessFailure extends Error {
  constructor(
    readonly output: string,
    readonly exitCode: number | null,
    readonly timedOut: boolean,
    readonly aborted: boolean,
  ) {
    super("LOCAL_SANDBOX_PROCESS_FAILED");
    this.name = "ProcessFailure";
  }
}

class StagedFailure extends Error {
  constructor(
    readonly stage: SmokeStage,
    readonly underlying: unknown,
  ) {
    super("LOCAL_SANDBOX_STAGE_FAILED");
    this.name = "StagedFailure";
  }
}

function status(stage: SmokeStage, value: "running" | "passed"): void {
  process.stdout.write(`LOCAL_SANDBOX_SMOKE stage=${stage} status=${value}\n`);
}

function appendBounded(current: string, chunk: Buffer): string {
  const combined = current + chunk.toString("utf8");
  return combined.length <= PROCESS_OUTPUT_LIMIT
    ? combined
    : combined.slice(combined.length - PROCESS_OUTPUT_LIMIT);
}

function dockerEnvironment(apiKey: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    SANDBOX_API_KEY: apiKey,
    NO_COLOR: "1",
  };
  const inherited = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "DOCKER_CONFIG",
    "DOCKER_CONTEXT",
    "DOCKER_HOST",
    "DOCKER_CERT_PATH",
    "DOCKER_TLS_VERIFY",
    "XDG_CONFIG_HOME",
  ] as const;
  for (const name of inherited) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return environment;
}

async function runProcess(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  return new Promise<string>((resolve, reject) => {
    const child = spawn("docker", [...args], {
      cwd: CLOUD_ROOT,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    let aborted = false;
    let spawnError: NodeJS.ErrnoException | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const terminate = () => {
      child.kill("SIGTERM");
      forceKillTimer ??= setTimeout(() => child.kill("SIGKILL"), 5_000);
    };
    const onAbort = () => {
      aborted = true;
      terminate();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      output = appendBounded(output, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output = appendBounded(output, chunk);
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      spawnError = error;
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", onAbort);
      if (spawnError) {
        reject(spawnError);
      } else if (exitCode === 0 && !timedOut && !aborted) {
        resolve(output);
      } else {
        reject(new ProcessFailure(output, exitCode, timedOut, aborted));
      }
    });
  });
}

async function assertPortAvailable(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    const onAbort = () => server.close(() => reject(signal?.reason));
    signal?.addEventListener("abort", onAbort, { once: true });
    server.once("error", (error: NodeJS.ErrnoException) => {
      signal?.removeEventListener("abort", onAbort);
      reject(error.code === "EADDRINUSE" ? new PortOccupiedError() : error);
    });
    server.listen({ host: "127.0.0.1", port: SERVER_PORT, exclusive: true }, () => {
      server.close((error) => {
        signal?.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve();
      });
    });
  });
}

async function waitForHealth(signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(2_000)])
      : AbortSignal.timeout(2_000);
    try {
      const response = await fetch(`${SERVER_ORIGIN}/health`, { signal: requestSignal });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
    }
    await delay(1_000, undefined, signal ? { signal } : undefined);
  }
  throw new HealthTimeoutError();
}

function smokeConfig(apiKey: string): Config {
  return {
    databaseUrl: "postgresql://unused.invalid/picoddy_local_sandbox_smoke",
    host: "127.0.0.1",
    port: 0,
    publicOrigin: SERVER_ORIGIN,
    casLoginUrl: 'https://sso.example.test/cas/login',
    casExchangeUrl: 'https://sso.example.test/cas/exchange',
    skillHubBaseUrl: 'https://market.example.test',
    skillHubSecret: '',
    skillHubSecretFile: join(tmpdir(), 'picoddy-local-sandbox-smoke-unused', 'skillhub-secret.enc'),
    skillHubDownloadHosts: ['market-assets.example.test'],
    secureCookies: false,
    encryptionKey: "0".repeat(64),
    sandboxDomain: SERVER_ORIGIN,
    sandboxApiKey: apiKey,
    sandboxImage: SANDBOX_IMAGE,
    sandboxTimeoutSeconds: 180,
    storageDriver: "local",
    storageLocalRoot: join(tmpdir(), "picoddy-local-sandbox-smoke-unused"),
    storageEndpoint: "",
    storageRegion: "us-east-1",
    storageBucket: "unused",
    storageAccessKey: "",
    storageSecretKey: "",
    maxUploadBytes: 1024 * 1024,
    workerConcurrency: 1,
    modelAllowedHosts: ["localhost"],
  };
}

function composeArgs(projectName: string, action: "up" | "down"): string[] {
  const common = [
    "compose",
    "--ansi",
    "never",
    "--project-name",
    projectName,
    "--file",
    COMPOSE_FILE,
  ];
  return action === "up"
    ? [...common, "up", "--detach"]
    : [...common, "down", "--remove-orphans", "--timeout", "10"];
}

function classifyFailure(stage: SmokeStage, error: unknown): SmokeFailure {
  if (error instanceof StagedFailure) {
    return classifyFailure(error.stage, error.underlying);
  }
  if (error instanceof PortOccupiedError) return { stage, status: "PORT_8090_OCCUPIED" };
  if (error instanceof HealthTimeoutError) return { stage, status: "HEALTH_TIMEOUT" };
  if (error instanceof SandboxApiException) {
    const safeCodes = new Set([
      "UNEXPECTED_RESPONSE",
      "NOT_FOUND",
      "ROUTE_NOT_FOUND",
      "PATH_NOT_FOUND",
      "FILE_NOT_FOUND",
    ]);
    const sdkCode = safeCodes.has(error.error.code) ? error.error.code : undefined;
    const httpStatus = error.statusCode;
    const diagnostic = typeof httpStatus === "number" && stage === "sandbox_write"
      ? {
          method: "POST" as const,
          path: "/v1/filesystem/10001/10001/files/upload",
          httpStatus,
          ...(sdkCode ? { sdkCode } : {}),
        }
      : typeof httpStatus === "number" && stage === "sandbox_read"
        ? {
            method: "GET" as const,
            path: "/v1/filesystem/10001/10001/files/download",
            httpStatus,
            ...(sdkCode ? { sdkCode } : {}),
          }
        : undefined;
    if (error.statusCode === 401 || error.statusCode === 403) {
      return { stage, status: "SDK_AUTH_REJECTED", diagnostic };
    }
    if (error.statusCode === 404) {
      return { stage, status: "SDK_API_NOT_FOUND", diagnostic };
    }
    return { stage, status: `SDK_HTTP_${error.statusCode}`, diagnostic };
  }
  if (error instanceof ProcessFailure) {
    if (error.aborted) return { stage, status: "CANCELLED" };
    if (error.timedOut) return { stage, status: "PROCESS_TIMEOUT" };
    const output = error.output.toLowerCase();
    if (output.includes("port is already allocated") || output.includes("address already in use")) {
      return { stage, status: "PORT_8090_OCCUPIED" };
    }
    if (output.includes("permission denied") && output.includes("docker.sock")) {
      return { stage, status: "DOCKER_SOCKET_PERMISSION_DENIED" };
    }
    if (output.includes("cannot connect to the docker daemon")) {
      return { stage, status: "DOCKER_UNAVAILABLE" };
    }
    if (output.includes("manifest unknown") || output.includes("pull access denied")) {
      return { stage, status: "IMAGE_UNAVAILABLE" };
    }
    return {
      stage,
      status: error.exitCode === null ? "PROCESS_TERMINATED" : `PROCESS_EXIT_${error.exitCode}`,
    };
  }
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    return { stage, status: "DOCKER_CLI_NOT_FOUND" };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return { stage, status: "CANCELLED" };
  }
  const fallback: Record<SmokeStage, string> = {
    preflight: "PREFLIGHT_FAILED",
    compose_up: "COMPOSE_UP_FAILED",
    health: "HEALTH_FAILED",
    sandbox_create: "SDK_CREATE_FAILED",
    sandbox_write: "SDK_WRITE_FAILED",
    sandbox_read: "SDK_READ_FAILED",
    sandbox_exec: "SDK_EXEC_FAILED",
    sandbox_destroy: "SDK_DESTROY_FAILED",
    sandbox_reconcile: "SDK_RECONCILE_FAILED",
    compose_down: "COMPOSE_DOWN_FAILED",
  };
  return { stage, status: fallback[stage] };
}

async function verificationStep(
  stage: "sandbox_write" | "sandbox_read" | "sandbox_exec",
  operation: () => Promise<void>,
): Promise<void> {
  status(stage, "running");
  try {
    await operation();
  } catch (error) {
    throw new StagedFailure(stage, error);
  }
  status(stage, "passed");
}

async function verifySandbox(sandbox: CloudSandbox, runId: string, signal: AbortSignal): Promise<void> {
  const payload = randomBytes(256);
  // Exercise both identity-scoped directory creation and file upload.
  const path = `/workspace/work/local-smoke-${runId}.bin`;

  await verificationStep("sandbox_write", async () => {
    await sandbox.write(path, payload);
  });

  await verificationStep("sandbox_read", async () => {
    const restored = await sandbox.read(path, payload.byteLength, signal);
    if (!Buffer.from(restored).equals(payload)) throw new Error("SMOKE_READ_MISMATCH");
  });

  await verificationStep("sandbox_exec", async () => {
    const execution = await sandbox.exec(
      [
        "set -eu",
        'test "$(id -u)" = "10001"',
        'test "$(id -g)" = "10001"',
        'test "$PWD" = "/workspace"',
        `test "$(stat -c %u ${path})" = "10001"`,
        `test "$(stat -c %a ${path})" = "600"`,
        'test "$(stat -c %a /workspace/work)" = "700"',
        "command -v node >/dev/null",
        "command -v python3 >/dev/null",
        "node -e 'if (process.getuid() !== 10001 || process.cwd() !== \"/workspace\") process.exit(1)'",
        "python3 -c 'import os,sys; sys.exit(0 if os.getuid() == 10001 and os.getcwd() == \"/workspace\" else 1)'",
        "printf 'LOCAL_SANDBOX_EXEC_OK\\n'",
      ].join("\n"),
      signal,
    );
    if (execution.exitCode !== 0 || !execution.stdout.includes("LOCAL_SANDBOX_EXEC_OK")) {
      throw new Error("SMOKE_EXEC_VERIFICATION_FAILED");
    }
  });
}

async function main(): Promise<void> {
  // Temporary-service traffic only. Never record query strings, headers, bodies
  // or exception messages; the server API key must stay out of diagnostics.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request?.url ?? String(input));
    const response = await originalFetch(input, init);
    if (url.origin === SERVER_ORIGIN && response.status >= 400) {
      process.stdout.write(`LOCAL_SANDBOX_HTTP method=${init?.method ?? request?.method ?? 'GET'} path=${url.pathname} status=${response.status}\n`);
    }
    return response;
  };
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(new DOMException("Cancelled", "AbortError"));
  };
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);

  const apiKey = randomBytes(32).toString("hex");
  const projectName = `picoddy-opensandbox-smoke-${randomBytes(8).toString("hex")}`;
  const runId = randomUUID();
  const environment = dockerEnvironment(apiKey);
  const config = smokeConfig(apiKey);
  let stage: SmokeStage = "preflight";
  let composeAttempted = false;
  let createAttempted = false;
  let sandbox: CloudSandbox | undefined;
  let failure: SmokeFailure | undefined;
  const cleanupFailures: SmokeStage[] = [];
  let cleanupComplete = true;

  try {
    status(stage, "running");
    await assertPortAvailable(controller.signal);
    status(stage, "passed");

    stage = "compose_up";
    status(stage, "running");
    composeAttempted = true;
    await runProcess(composeArgs(projectName, "up"), environment, 300_000, controller.signal);
    status(stage, "passed");

    stage = "health";
    status(stage, "running");
    await waitForHealth(controller.signal);
    status(stage, "passed");

    stage = "sandbox_create";
    status(stage, "running");
    createAttempted = true;
    sandbox = await createSandbox(config, runId, controller.signal);
    status(stage, "passed");

    await verifySandbox(sandbox, runId, controller.signal);
  } catch (error) {
    failure = classifyFailure(stage, error);
  } finally {
    if (sandbox) {
      stage = "sandbox_destroy";
      status(stage, "running");
      try {
        await sandbox.destroy();
        status(stage, "passed");
      } catch (error) {
        const cleanupFailure = classifyFailure(stage, error);
        if (!failure) failure = cleanupFailure;
        else cleanupFailures.push(stage);
      }
    }

    if (createAttempted) {
      stage = "sandbox_reconcile";
      status(stage, "running");
      try {
        await reconcileRunSandboxes(config, runId);
        status(stage, "passed");
      } catch (error) {
        cleanupComplete = false;
        const cleanupFailure = classifyFailure(stage, error);
        if (!failure) failure = cleanupFailure;
        else cleanupFailures.push(stage);
      }
    }

    if (composeAttempted) {
      stage = "compose_down";
      status(stage, "running");
      try {
        await runProcess(composeArgs(projectName, "down"), environment, 60_000);
        status(stage, "passed");
      } catch (error) {
        cleanupComplete = false;
        const cleanupFailure = classifyFailure(stage, error);
        if (!failure) failure = cleanupFailure;
        else cleanupFailures.push(stage);
      }
    }

    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
    globalThis.fetch = originalFetch;
  }

  if (failure) {
    const cleanup = cleanupComplete ? "complete" : "incomplete";
    const cleanupSuffix = cleanupFailures.length > 0
      ? ` cleanupStages=${[...new Set(cleanupFailures)].join(",")}`
      : "";
    const diagnosticSuffix = failure.diagnostic
      ? ` method=${failure.diagnostic.method} path=${failure.diagnostic.path}`
        + ` httpStatus=${failure.diagnostic.httpStatus}`
        + (failure.diagnostic.sdkCode ? ` sdkCode=${failure.diagnostic.sdkCode}` : "")
      : "";
    process.stderr.write(
      `LOCAL_SANDBOX_SMOKE_FAIL stage=${failure.stage} status=${failure.status}`
        + ` cleanup=${cleanup}${diagnosticSuffix}${cleanupSuffix}\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    "LOCAL_SANDBOX_SMOKE_PASS uid=10001 node=ok python=ok workspace=/workspace cleanup=complete\n",
  );
}

try {
  await main();
} catch {
  process.stderr.write(
    "LOCAL_SANDBOX_SMOKE_FAIL stage=preflight status=UNEXPECTED cleanup=unknown\n",
  );
  process.exitCode = 1;
}
