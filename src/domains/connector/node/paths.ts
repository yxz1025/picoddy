import { join } from "node:path";

export interface ConnectorPaths {
  root: string;
  packageRoot: string;
  versions: string;
  staging: string;
  current: string;
  cache: string;
  logs: string;
  lock: string;
}

const CONNECTOR_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const EXACT_SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const DOS_DEVICE_BASENAME = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/iu;

export function validateConnectorId(connectorId: string): void {
  if (typeof connectorId !== "string"
    || !CONNECTOR_ID.test(connectorId)
    || DOS_DEVICE_BASENAME.test(connectorId)) {
    throw new Error(`invalid connector id: ${connectorId}`);
  }
}

export function connectorPaths(
  appDataDir: string,
  connectorId: string,
  cliVersion: string,
): ConnectorPaths {
  validateConnectorId(connectorId);
  if (!EXACT_SEMVER.test(cliVersion)) {
    throw new Error(`invalid connector cli version: ${cliVersion}`);
  }
  const root = join(appDataDir, "connectors");
  const packageRoot = join(root, "packages", connectorId);
  const versions = join(packageRoot, "versions");
  return Object.freeze({
    root,
    packageRoot,
    versions,
    staging: join(versions, `.staging-${cliVersion}`),
    current: join(packageRoot, "current"),
    cache: join(root, "cache", connectorId),
    logs: join(root, "logs", connectorId),
    lock: join(root, "locks", `${connectorId}.lock`),
  });
}
