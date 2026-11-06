// Pi 1.0.4 exposes these maintained implementations only through internal paths.
// Keep the pinned imports in one place; do not copy OAuth or reconnect logic.
export { McpServerConnection, createDefaultTransport } from "../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/runtime.js";
export { McpOAuthCredentialStore, signInMcpServer } from "../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/oauth.js";
export { FileAuthStorageBackend } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js";
export { validateMcpServerConfig, getMcpToolExposure } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/mcp-servers.js";
export type { McpOAuthConfig, McpExposure, McpServerConfig as NativeMcpServerConfig } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/mcp-servers.js";

export { createMcpResultSchema, convertMcpResult } from "../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/tools.js";
