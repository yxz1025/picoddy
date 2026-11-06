import { createHash } from "node:crypto";

import { ConnectorError } from "./errors.ts";
import type { ConnectorErrorCode } from "./errors.ts";
import type { ConnectorCatalogEntry } from "./types.ts";

export interface CompiledCommandPolicy {
  readonly connectorId: string;
  readonly cliVersion: string;
  readonly digest: string;
  readonly allowedArgv: readonly string[];
  readonly errorMatchers: ReadonlyArray<{ readonly code: ConnectorErrorCode; readonly pattern: RegExp }>;
  readonly defaultNonZeroExit: ConnectorErrorCode;
}

const ERROR_EVALUATION_BUDGET = 64 * 1024;
const SHELL_METACHARACTERS = /[;&|<>`$\n\r]/u;
const PATH_SEPARATOR = /[\\/]/u;
const DANGEROUS_VERBS =
  /^(?:delete|remove|rm|drop|update|write|send|clear|reset|revoke|destroy|migrate|purge|transfer)$/iu;

function notAllowed(message: string): never {
  throw new ConnectorError("COMMAND_NOT_ALLOWED", message);
}

// All policy data comes from the catalog, so the digest keys the compiled
// cache by connector id, CLI version, and every policy-relevant field.
export function compileCommandPolicy(
  entry: ConnectorCatalogEntry,
  cliVersion: string,
): CompiledCommandPolicy {
  const digest = createHash("sha256")
    .update(JSON.stringify({ schema: entry.commandPolicy.schema.argv, errors: entry.errors }))
    .digest("hex");
  const errorMatchers = (
    ["AUTH_REQUIRED", "AUTH_FAILED", "CONNECTOR_TIMEOUT", "NETWORK_ERROR"] as const
  ).flatMap((code) =>
    entry.errors[code].map((source) => ({ code, pattern: new RegExp(source, "iu") })),
  );
  return Object.freeze({
    connectorId: entry.id,
    cliVersion,
    digest,
    allowedArgv: Object.freeze([...entry.commandPolicy.schema.argv]),
    errorMatchers: Object.freeze(errorMatchers),
    defaultNonZeroExit: entry.errors.defaultNonZeroExit,
  });
}

// Rejects tokens that could smuggle a second command, a path, or an
// executable override into what must remain one schema-bound invocation.
export function validateCommandArgv(argv: readonly string[]): void {
  for (const token of argv) {
    if (typeof token !== "string" || token.length === 0 || token.length > 512) {
      notAllowed("Connector command contains an invalid argument");
    }
    if (token.includes("\0") || SHELL_METACHARACTERS.test(token)) {
      notAllowed("Connector command arguments must not contain shell metacharacters");
    }
    if (/\s/u.test(token)) {
      notAllowed("Connector command arguments must be single tokens");
    }
    if (PATH_SEPARATOR.test(token) || token === "..") {
      notAllowed("Connector command must not override the executable or escape the schema");
    }
  }
}

export function commandMatches(argv: readonly string[], allowed: readonly string[]): boolean {
  return argv.length === allowed.length && argv.every((token, index) => token === allowed[index]);
}

export function commandRequiresConfirmation(argv: readonly string[]): boolean {
  return argv.some((token) => DANGEROUS_VERBS.test(token));
}

// Evaluates catalog error patterns against a bounded slice of combined
// output; catalog patterns are trusted, so the budget bounds worst-case cost.
export function matchConnectorError(
  output: string,
  policy: CompiledCommandPolicy,
): ConnectorErrorCode | undefined {
  const bounded = output.slice(0, ERROR_EVALUATION_BUDGET);
  for (const { code, pattern } of policy.errorMatchers) {
    if (pattern.test(bounded)) return code;
  }
  return undefined;
}
