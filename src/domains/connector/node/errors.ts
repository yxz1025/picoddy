export type ConnectorErrorCode =
  | "CONNECTOR_NOT_FOUND"
  | "CONNECTOR_CATALOG_INVALID"
  | "CONNECTOR_RUNTIME_UNAVAILABLE"
  | "PACKAGE_INTEGRITY_INVALID"
  | "SKILL_ARCHIVE_INVALID"
  | "CLI_NOT_INSTALLED"
  | "CLI_VERSION_INVALID"
  | "AUTH_REQUIRED"
  | "AUTH_FAILED"
  | "COMMAND_NOT_ALLOWED"
  | "CONFIRMATION_REQUIRED"
  | "PERMISSION_DENIED"
  | "NETWORK_ERROR"
  | "OUTPUT_TOO_LARGE"
  | "CONNECTOR_TIMEOUT"
  | "CONNECTOR_BROKEN"
  | "CONNECTOR_BUSY"
  | "CONNECTOR_CANCELLED";

export const CONNECTOR_ERROR_HTTP_STATUS: Readonly<Record<ConnectorErrorCode, number>> = Object.freeze({
  CONNECTOR_NOT_FOUND: 404,
  CONNECTOR_CATALOG_INVALID: 500,
  CONNECTOR_RUNTIME_UNAVAILABLE: 500,
  PACKAGE_INTEGRITY_INVALID: 500,
  SKILL_ARCHIVE_INVALID: 422,
  CLI_NOT_INSTALLED: 409,
  CLI_VERSION_INVALID: 409,
  AUTH_REQUIRED: 401,
  AUTH_FAILED: 401,
  COMMAND_NOT_ALLOWED: 403,
  CONFIRMATION_REQUIRED: 409,
  PERMISSION_DENIED: 403,
  NETWORK_ERROR: 502,
  OUTPUT_TOO_LARGE: 413,
  CONNECTOR_TIMEOUT: 504,
  CONNECTOR_BROKEN: 502,
  CONNECTOR_BUSY: 409,
  CONNECTOR_CANCELLED: 409,
});

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly status: number;

  constructor(code: ConnectorErrorCode, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "ConnectorError";
    this.code = code;
    this.status = options.status ?? CONNECTOR_ERROR_HTTP_STATUS[code];
  }
}
