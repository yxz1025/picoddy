import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { buildCliProcessEnv, type ManagedNpmRuntime } from "../../../platform/cli/runtime.ts";
import { platformPaths } from "../../../platform/paths.ts";
import { sessionContext } from "../../../infra/context.ts";
import { createArtifact } from "../../artifact/node/store.ts";
import { currentArtifactOutputDir } from "../../doc/node/paths.ts";
import {
  commandMatches,
  commandRequiresConfirmation,
  compileCommandPolicy,
  matchConnectorError,
  validateCommandArgv,
  type CompiledCommandPolicy,
} from "./command_policy.ts";
import { ConnectorError } from "./errors.ts";
import type { ConnectorErrorCode } from "./errors.ts";
import { runConnectorProcess } from "./process_runner.ts";
import type { ConnectorProcessResult, RunConnectorProcessOptions } from "./process_runner.ts";
import type { ConnectorCatalogEntry } from "./types.ts";

export interface ConnectorCommandContext {
  readonly connectorId: string;
  readonly cliVersion: string;
  readonly binPath: string;
  readonly cwd?: string;
}

export interface ConnectorCommandRequest {
  readonly connectorId: string;
  readonly argv: readonly string[];
  readonly confirmationId?: string;
}

export interface ConnectorCommandArtifact {
  readonly id: string;
  readonly filePath: string;
  readonly fileName: string;
  readonly bytes: number;
}

export type ConnectorCommandResult =
  | { readonly code: "SUCCESS"; readonly output: string; readonly artifact?: ConnectorCommandArtifact }
  | { readonly code: "CONFIRMATION_REQUIRED"; readonly confirmationId: string; readonly reason: string }
  | { readonly code: ConnectorErrorCode; readonly message: string };

export interface ConnectorCommandGateway {
  execute(request: ConnectorCommandRequest, context: ConnectorCommandContext): Promise<ConnectorCommandResult>;
}

export interface ConnectorCommandGatewayDependencies {
  readonly registry: { readonly get: (connectorId: string) => ConnectorCatalogEntry | undefined };
  readonly runtime: ManagedNpmRuntime;
  readonly runProcess?: (options: RunConnectorProcessOptions) => Promise<ConnectorProcessResult>;
  readonly saveArtifact?: (options: {
    readonly conversationId?: string;
    readonly fileName: string;
    readonly content: string;
  }) => Promise<ConnectorCommandArtifact>;
  readonly confirmationTtlMs?: number;
  readonly now?: () => number;
}

const DEFAULT_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const LARGE_OUTPUT_THRESHOLD = 32 * 1024;
const COMPACT_PREVIEW_BYTES = 4096;

async function saveArtifactToStore(options: {
  readonly conversationId?: string;
  readonly fileName: string;
  readonly content: string;
}): Promise<ConnectorCommandArtifact> {
  const filePath = platformPaths.join(currentArtifactOutputDir(), options.fileName);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, options.content, { flag: "wx" });
  const artifact = createArtifact({
    conversationId: options.conversationId,
    fileName: options.fileName,
    filePath,
    kind: "txt",
    bytes: Buffer.byteLength(options.content),
  });
  return { id: artifact.id, filePath, fileName: options.fileName, bytes: artifact.bytes };
}

export function createConnectorCommandGateway(
  dependencies: ConnectorCommandGatewayDependencies,
): ConnectorCommandGateway {
  const { registry, runtime } = dependencies;
  const runProcess = dependencies.runProcess ?? runConnectorProcess;
  const saveArtifact = dependencies.saveArtifact ?? saveArtifactToStore;
  const confirmationTtlMs = dependencies.confirmationTtlMs ?? DEFAULT_CONFIRMATION_TTL_MS;
  const now = dependencies.now ?? Date.now;
  const policyCache = new Map<string, CompiledCommandPolicy>();
  const confirmations = new Map<string, { readonly fingerprint: string; readonly expiresAt: number }>();

  const policyFor = (entry: ConnectorCatalogEntry, cliVersion: string): CompiledCommandPolicy => {
    const key = `${entry.id}:${cliVersion}:${entry.version}`;
    const cached = policyCache.get(key);
    if (cached !== undefined) return cached;
    const compiled = compileCommandPolicy(entry, cliVersion);
    policyCache.set(key, compiled);
    return compiled;
  };

  return {
    async execute(request, context) {
      if (request.connectorId !== context.connectorId) {
        throw new ConnectorError("COMMAND_NOT_ALLOWED", "Connector command is not bound to the active connector");
      }
      const entry = registry.get(context.connectorId);
      if (entry === undefined) {
        throw new ConnectorError("CONNECTOR_NOT_FOUND", `Unknown connector: ${context.connectorId}`);
      }
      validateCommandArgv(request.argv);
      const policy = policyFor(entry, context.cliVersion);
      if (!commandMatches(request.argv, policy.allowedArgv)) {
        throw new ConnectorError("COMMAND_NOT_ALLOWED", "Connector command is not in the catalog schema");
      }

      if (commandRequiresConfirmation(request.argv)) {
        const fingerprint = JSON.stringify([request.connectorId, request.argv]);
        const pending =
          request.confirmationId === undefined ? undefined : confirmations.get(request.confirmationId);
        if (pending === undefined || pending.fingerprint !== fingerprint || pending.expiresAt <= now()) {
          confirmations.delete(request.confirmationId ?? "");
          const confirmationId = randomUUID();
          confirmations.set(confirmationId, { fingerprint, expiresAt: now() + confirmationTtlMs });
          return {
            code: "CONFIRMATION_REQUIRED",
            confirmationId,
            reason: "Connector command requires user confirmation",
          };
        }
        confirmations.delete(request.confirmationId as string);
      }

      let result: ConnectorProcessResult;
      try {
        result = await runProcess({
          executable: runtime.node.executable,
          argv: [context.binPath, ...request.argv],
          cwd: context.cwd,
          env: buildCliProcessEnv({ ELECTRON_RUN_AS_NODE: "1" }),
        });
      } catch (cause) {
        if (cause instanceof ConnectorError) {
          return { code: cause.code, message: cause.message };
        }
        throw new ConnectorError("CONNECTOR_BROKEN", "Connector command execution failed", { cause });
      }

      if (result.exitCode !== 0) {
        const code =
          matchConnectorError(`${result.stdout}\n${result.stderr}`, policy) ??
          policy.defaultNonZeroExit;
        return { code, message: `Connector command failed with exit code ${result.exitCode}` };
      }

      const output = result.stdout;
      if (output.length > LARGE_OUTPUT_THRESHOLD) {
        const fileName = `connector-output-${Date.now()}-${randomBytes(4).toString("hex")}.txt`;
        const artifact = await saveArtifact({
          conversationId: sessionContext.getStore()?.sessionId,
          fileName,
          content: output,
        });
        return {
          code: "SUCCESS",
          output: `${output.slice(0, COMPACT_PREVIEW_BYTES)}\n[输出已保存到工件 ${artifact.id}]`,
          artifact,
        };
      }
      return { code: "SUCCESS", output };
    },
  };
}
