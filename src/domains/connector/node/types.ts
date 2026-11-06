export type ConnectorLifecycleState =
  | "not_installed"
  | "installing"
  | "installed_unauthorized"
  | "authorizing"
  | "ready"
  | "auth_expired"
  | "install_failed"
  | "version_invalid"
  | "auth_failed"
  | "runtime_broken"
  | "connector_broken";

export interface ConnectorLockedPackage {
  readonly resolved: string;
  readonly integrity: string;
}

export interface ConnectorCatalogErrorMapping {
  readonly AUTH_REQUIRED: readonly string[];
  readonly AUTH_FAILED: readonly string[];
  readonly CONNECTOR_TIMEOUT: readonly string[];
  readonly NETWORK_ERROR: readonly string[];
  readonly defaultNonZeroExit: "CONNECTOR_BROKEN";
}

export interface ConnectorCatalogEntry {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly presentation: { readonly icon: string };
  readonly delegate: { readonly toolName: string; readonly description: string };
  readonly runtime: { readonly type: "managed-node-npm"; readonly profile: "default" };
  readonly install: {
    readonly package: string;
    readonly version: string;
    readonly registry: "https://registry.npmjs.org";
    readonly tarball: string;
    readonly integrity: string;
    readonly postInstall?: { readonly path: string; readonly argv: readonly string[] };
  };
  readonly skill: { readonly source: "package-archive"; readonly archive: string; readonly entry: string };
  readonly executable: Partial<Readonly<Record<"darwin" | "linux" | "win32", string>>>;
  readonly versionCheck: { readonly argv: readonly string[]; readonly outputPattern: string };
  readonly auth: { readonly argv: readonly string[]; readonly allowedDomains: readonly string[]; readonly waitForExit: true };
  readonly status: { readonly argv: readonly string[]; readonly format: "json"; readonly jsonMatch: Readonly<Record<string, unknown>> };
  readonly logout: { readonly argv: readonly string[] };
  readonly commandPolicy: { readonly schema: { readonly argv: readonly string[] } };
  readonly errors: ConnectorCatalogErrorMapping;
  readonly packages: Readonly<Record<string, ConnectorLockedPackage>>;
}

export interface ConnectorCatalog {
  readonly schemaVersion: 1;
  readonly connectors: readonly ConnectorCatalogEntry[];
}

export interface ConnectorRuntimeLock {
  readonly schemaVersion: 2;
  readonly host: {
    readonly source: "electron";
    readonly package: "electron";
    readonly version: string;
    readonly integrity: string;
    readonly nodeVersion: string;
  };
  readonly npm: { readonly package: "npm"; readonly version: string; readonly integrity: string };
}
