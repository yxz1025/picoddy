#!/usr/bin/env node

import { readFile, stat, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  auth,
  selectClientAuthMethod,
} from "@modelcontextprotocol/sdk/client/auth.js";

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_STRING = 20_000;
const REQUEST_PATH = /^\/workspace\/\.oauth-request-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/i;

function fail(message) {
  throw new Error(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function optionalString(value, label, maximum = MAX_STRING) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value || value.length > maximum || value.includes("\0")) {
    fail(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function loopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function safeUrl(value, label, allowInsecureLoopback) {
  let parsed;
  try {
    parsed = new URL(optionalString(value, label, 8_000));
  } catch {
    fail(`${label} is invalid`);
  }
  if (parsed.username || parsed.password || !["http:", "https:"].includes(parsed.protocol)) {
    fail(`${label} must use HTTP(S) without credentials`);
  }
  if (parsed.protocol !== "https:" && !(allowInsecureLoopback && loopback(parsed.hostname))) {
    fail(`${label} must use HTTPS`);
  }
  return parsed;
}

function cloneRecord(value, label) {
  if (value === undefined) return {};
  const input = object(value, label);
  return structuredClone(input);
}

export function parseOAuthRequest(value) {
  const input = object(value, "request");
  if (!["begin", "exchange", "refresh", "revoke"].includes(input.operation)) {
    fail("operation is invalid");
  }
  if (typeof input.allowInsecureLoopback !== "boolean") fail("allowInsecureLoopback must be a boolean");
  const serverUrl = safeUrl(input.serverUrl, "serverUrl", input.allowInsecureLoopback);
  const redirectUrl = safeUrl(input.redirectUrl, "redirectUrl", input.allowInsecureLoopback);
  if (redirectUrl.pathname !== "/api/mcp/oauth/callback" || redirectUrl.search || redirectUrl.hash) {
    fail("redirectUrl must use the fixed callback path");
  }
  const parsed = {
    operation: input.operation,
    serverUrl,
    redirectUrl,
    allowInsecureLoopback: input.allowInsecureLoopback,
    scope: optionalString(input.scope, "scope", 2_000),
    state: optionalString(input.state, "state", 1_024),
    authorizationCode: optionalString(input.authorizationCode, "authorizationCode"),
    clientId: optionalString(input.clientId, "clientId", 2_000),
    clientSecret: optionalString(input.clientSecret, "clientSecret"),
    providerState: cloneRecord(input.providerState, "providerState"),
  };
  if ((parsed.operation === "begin" || parsed.operation === "exchange") && !parsed.state) {
    fail("interactive OAuth operation requires state");
  }
  if (parsed.operation === "exchange" && !parsed.authorizationCode) {
    fail("OAuth exchange requires an authorization code");
  }
  if (parsed.operation === "refresh") {
    const tokens = object(parsed.providerState.tokens, "providerState.tokens");
    optionalString(tokens.refresh_token, "refresh_token");
  }
  return parsed;
}

export function createOAuthProvider(request) {
  const state = structuredClone(request.providerState);
  let authorizationUrl;
  const configuredClient = request.clientId
    ? {
        client_id: request.clientId,
        ...(request.clientSecret ? { client_secret: request.clientSecret } : {}),
      }
    : undefined;

  return {
    get redirectUrl() { return request.redirectUrl; },
    get clientMetadata() {
      return {
        client_name: "PiCoddy Cloud",
        redirect_uris: [request.redirectUrl.toString()],
        response_types: ["code"],
        grant_types: ["authorization_code", "refresh_token"],
        token_endpoint_auth_method: request.clientSecret ? "client_secret_basic" : "none",
        ...(request.scope ? { scope: request.scope } : {}),
      };
    },
    state() { return request.state; },
    clientInformation() {
      return configuredClient ?? state.clientInformation;
    },
    saveClientInformation(value) { state.clientInformation = structuredClone(value); },
    tokens() {
      return request.operation === "begin" ? undefined : state.tokens;
    },
    saveTokens(value) {
      state.tokens = structuredClone(value);
      const seconds = Number(value.expires_in);
      state.tokenExpiresAt = Number.isFinite(seconds) && seconds > 0
        ? Date.now() + Math.floor(seconds * 1000)
        : undefined;
    },
    redirectToAuthorization(value) { authorizationUrl = value.toString(); },
    saveCodeVerifier(value) { state.codeVerifier = value; },
    codeVerifier() {
      if (typeof state.codeVerifier !== "string" || !state.codeVerifier) fail("OAuth code verifier is unavailable");
      return state.codeVerifier;
    },
    saveDiscoveryState(value) { state.discovery = structuredClone(value); },
    discoveryState() { return state.discovery; },
    invalidateCredentials(scope) {
      if (scope === "all" || scope === "client") delete state.clientInformation;
      if (scope === "all" || scope === "tokens") {
        delete state.tokens;
        delete state.tokenExpiresAt;
      }
      if (scope === "all" || scope === "verifier") delete state.codeVerifier;
      if (scope === "all" || scope === "discovery") delete state.discovery;
    },
    result() {
      return {
        ...(authorizationUrl ? { authorizationUrl } : {}),
        state: structuredClone(state),
      };
    },
  };
}

function revocationEndpoint(request) {
  const discovery = request.providerState.discovery;
  const metadata = discovery && typeof discovery === "object" ? discovery.authorizationServerMetadata : undefined;
  const value = metadata && typeof metadata === "object" ? metadata.revocation_endpoint : undefined;
  if (typeof value !== "string") return undefined;
  return safeUrl(value, "revocation endpoint", request.allowInsecureLoopback);
}

async function revokeToken(request, token, endpoint, clientInformation, metadata) {
  if (typeof token !== "string" || !token) return;
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
  const params = new URLSearchParams({ token });
  const supported = Array.isArray(metadata?.token_endpoint_auth_methods_supported)
    ? metadata.token_endpoint_auth_methods_supported.filter((item) => typeof item === "string")
    : [];
  const method = selectClientAuthMethod(clientInformation, supported);
  if (method === "client_secret_basic") {
    if (!clientInformation.client_secret) fail("OAuth client secret is unavailable");
    headers.set("Authorization", `Basic ${Buffer.from(`${clientInformation.client_id}:${clientInformation.client_secret}`).toString("base64")}`);
  } else {
    params.set("client_id", clientInformation.client_id);
    if (method === "client_secret_post" && clientInformation.client_secret) {
      params.set("client_secret", clientInformation.client_secret);
    }
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: params,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  await response.body?.cancel();
  if (!response.ok) fail("OAuth token revocation failed");
}

export async function executeOAuthRequest(request) {
  const provider = createOAuthProvider(request);
  if (request.operation === "revoke") {
    const endpoint = revocationEndpoint(request);
    if (!endpoint) return { revoked: false };
    const tokens = object(request.providerState.tokens, "providerState.tokens");
    const clientInformation = provider.clientInformation();
    if (!clientInformation?.client_id) fail("OAuth client information is unavailable");
    const metadata = request.providerState.discovery?.authorizationServerMetadata;
    await revokeToken(request, tokens.refresh_token, endpoint, clientInformation, metadata);
    await revokeToken(request, tokens.access_token, endpoint, clientInformation, metadata);
    return { revoked: true };
  }

  const result = await auth(provider, {
    serverUrl: request.serverUrl,
    ...(request.operation === "exchange" ? { authorizationCode: request.authorizationCode } : {}),
    ...(request.scope ? { scope: request.scope } : {}),
  });
  const output = provider.result();
  if (request.operation === "begin") {
    if (result !== "REDIRECT" || !output.authorizationUrl) fail("OAuth server did not return an authorization redirect");
    const url = safeUrl(output.authorizationUrl, "authorizationUrl", request.allowInsecureLoopback);
    if (url.searchParams.get("state") !== request.state) fail("OAuth authorization state mismatch");
  } else if (result !== "AUTHORIZED" || !output.state.tokens?.access_token) {
    fail("OAuth authorization is required");
  }
  return output;
}

async function loadRequest(path) {
  if (!REQUEST_PATH.test(path)) fail("request path is invalid");
  const info = await stat(path);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_REQUEST_BYTES) fail("request file is invalid or too large");
  const bytes = await readFile(path);
  await unlink(path);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("request file is not valid JSON");
  }
  return parseOAuthRequest(value);
}

async function main() {
  if (process.argv.length !== 3) fail("usage: oauth-runner.mjs <request-json-path>");
  const requestPath = process.argv[2];
  try {
    const request = await loadRequest(requestPath);
    const result = await executeOAuthRequest(request);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    if (REQUEST_PATH.test(requestPath)) {
      await unlink(requestPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
  }
}

const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) {
  main().catch(() => {
    process.stderr.write("OAuth runner failed\n");
    process.exitCode = 1;
  });
}
