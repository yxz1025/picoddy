#!/usr/bin/env node

import { readFile, stat, unlink } from "node:fs/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_LIST_PAGES = 100;
const REQUEST_PATH = /^\/workspace\/\.mcp-request-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/i;

function fail(message) {
  throw new Error(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function optionalStringRecord(value, label) {
  if (value === undefined) return undefined;
  const record = object(value, label);
  const output = {};
  for (const [key, item] of Object.entries(record)) {
    if (!key || typeof item !== "string" || key.includes("\0") || item.includes("\0")) {
      fail(`${label} must contain only non-empty string keys and string values`);
    }
    output[key] = item;
  }
  return output;
}

function parseRequest(value) {
  const request = object(value, "request");
  const connector = object(request.connector, "connector");
  if (request.operation !== "list" && request.operation !== "call") {
    fail("operation must be list or call");
  }

  let parsedConnector;
  if (connector.transport === "stdio") {
    if (typeof connector.command !== "string" || !connector.command || connector.command.includes("\0")) {
      fail("stdio connector command must be a non-empty string");
    }
    if (connector.args !== undefined &&
        (!Array.isArray(connector.args) || connector.args.some((arg) => typeof arg !== "string" || arg.includes("\0")))) {
      fail("stdio connector args must be strings");
    }
    parsedConnector = {
      transport: "stdio",
      command: connector.command,
      args: connector.args ?? [],
      env: optionalStringRecord(connector.env, "stdio connector env"),
    };
  } else if (connector.transport === "http" || connector.transport === "sse") {
    if (typeof connector.url !== "string") fail("http connector url must be a string");
    let url;
    try {
      url = new URL(connector.url);
    } catch {
      fail("http connector url is invalid");
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      fail("http connector url must use http(s) without embedded credentials");
    }
    parsedConnector = {
      transport: connector.transport,
      url,
      headers: optionalStringRecord(connector.headers, "http connector headers"),
    };
  } else {
    fail("connector transport must be stdio, http or sse");
  }

  if (request.operation === "call") {
    if (typeof request.name !== "string" || !request.name) fail("call operation requires a tool name");
    if (request.arguments !== undefined) object(request.arguments, "arguments");
  }
  return {
    connector: parsedConnector,
    operation: request.operation,
    name: request.name,
    arguments: request.arguments,
  };
}

async function loadRequest(path) {
  if (!REQUEST_PATH.test(path)) fail("request path must be /workspace/.mcp-request-<uuid>.json");
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_REQUEST_BYTES) fail("request file is invalid or too large");
  const bytes = await readFile(path);
  await unlink(path);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("request file is not valid JSON");
  }
  return parseRequest(value);
}

function createTransport(connector) {
  if (connector.transport === "stdio") {
    const transport = new StdioClientTransport({
      command: connector.command,
      args: connector.args,
      cwd: "/workspace",
      env: { ...getDefaultEnvironment(), ...connector.env },
      stderr: "pipe",
      maxBufferSize: 10 * 1024 * 1024,
    });
    transport.stderr?.on('data', () => {});
    return transport;
  }
  if (connector.transport === 'sse') return new SSEClientTransport(connector.url, {
    requestInit: connector.headers ? { headers: connector.headers } : undefined,
    eventSourceInit: { fetch: (url, init) => {
      const headers = new Headers(init?.headers);
      for (const [key, value] of Object.entries(connector.headers ?? {})) headers.set(key, value);
      return fetch(url, { ...init, headers });
    } },
  });
  return new StreamableHTTPClientTransport(connector.url, {
    requestInit: connector.headers ? { headers: connector.headers } : undefined,
  });
}

async function listTools(client) {
  const tools = [];
  const names = new Set();
  let cursor;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const result = await client.listTools(cursor ? { cursor } : undefined);
    for (const tool of result.tools) {
      if (names.has(tool.name)) fail(`MCP server returned duplicate tool ${JSON.stringify(tool.name)}`);
      names.add(tool.name);
      tools.push({
        name: tool.name,
        description: tool.description ?? "",
        inputSchema: tool.inputSchema,
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      });
    }
    if (!result.nextCursor) return { tools };
    cursor = result.nextCursor;
  }
  fail(`MCP tool listing exceeded ${MAX_LIST_PAGES} pages`);
}

async function main() {
  if (process.argv.length !== 3) fail("usage: mcp-runner.mjs <request-json-path>");
  const requestPath = process.argv[2];
  let transport;
  let client;
  try {
    const request = await loadRequest(requestPath);
    transport = createTransport(request.connector);
    client = new Client({ name: "picoddy-sandbox", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    const result = request.operation === "list"
      ? await listTools(client)
      : await client.callTool({ name: request.name, arguments: request.arguments ?? {} });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    if (REQUEST_PATH.test(requestPath)) {
      await unlink(requestPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
    let closeError;
    try {
      await client?.close();
    } catch (error) {
      closeError = error;
    }
    try {
      await transport?.close();
    } catch (error) {
      if (closeError) throw new AggregateError([closeError, error], "MCP client cleanup failed");
      throw error;
    }
    if (closeError) throw closeError;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`MCP runner error: ${message}\n`);
  process.exitCode = 1;
});
