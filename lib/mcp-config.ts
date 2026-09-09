/**
 * Pure validation for mcp.json's `mcpServers` map.
 *
 * The contract belongs to pi-mcp-extension, not to pi-web: transport is
 * "stdio" | "streamable-http" | "sse", stdio servers need `command`, and URL
 * servers need `url` + `headers`. Kept as a pure module so the API route and
 * the settings form share one implementation and it can be unit-tested
 * without booting Next.js.
 */

import { normalizeMcpTransport, type McpServerConfig } from "./api-types";

export const MCP_SERVER_NAME_RE = /^[a-zA-Z0-9_-]+$/;
export const MCP_LIFECYCLES = new Set(["eager", "lazy"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validate one server entry. Unknown fields (cwd, healthCheckIntervalMs, …) are
 * intentionally accepted so the editor never drops configuration it does not
 * understand.
 *
 * @returns an error message naming the offending field, or null when valid.
 */
export function validateMcpServer(name: string, value: unknown): string | null {
  if (!MCP_SERVER_NAME_RE.test(name)) {
    return `Invalid server name "${name}" (allowed: letters, digits, _ and -)`;
  }
  if (!isRecord(value)) return `Server "${name}" must be an object`;

  const rawTransport = value.transport;
  if (rawTransport !== undefined && rawTransport !== "http"
    && rawTransport !== "stdio" && rawTransport !== "sse" && rawTransport !== "streamable-http") {
    return `Server "${name}" transport must be one of stdio, streamable-http, sse`;
  }
  const transport = normalizeMcpTransport(rawTransport);

  if (transport === "stdio") {
    if (typeof value.command !== "string" || !value.command.trim()) {
      return `Server "${name}" requires a non-empty string command for the stdio transport`;
    }
  } else if (typeof value.url !== "string" || !value.url.trim()) {
    return `Server "${name}" requires a url for the ${transport} transport`;
  } else if (!isHttpUrl(value.url)) {
    return `Server "${name}" url must be a valid http or https URL`;
  }

  if (value.args !== undefined) {
    if (!Array.isArray(value.args) || !value.args.every((arg) => typeof arg === "string")) {
      return `Server "${name}" args must be an array of strings`;
    }
  }
  if (value.headers !== undefined && !isStringRecord(value.headers)) {
    return `Server "${name}" headers must be an object of string values`;
  }
  if (value.env !== undefined && !isStringRecord(value.env)) {
    return `Server "${name}" env must be an object of string values`;
  }
  if (value.lifecycle !== undefined && !MCP_LIFECYCLES.has(value.lifecycle as string)) {
    return `Server "${name}" lifecycle must be one of eager, lazy`;
  }
  if (value.requestTimeoutMs !== undefined) {
    const timeout = value.requestTimeoutMs;
    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) {
      return `Server "${name}" requestTimeoutMs must be a positive number`;
    }
  }
  return null;
}

/** Validate a whole `mcpServers` map, returning the first problem found. */
export function validateMcpServers(servers: Record<string, unknown>): string | null {
  for (const [name, value] of Object.entries(servers)) {
    const problem = validateMcpServer(name, value);
    if (problem) return problem;
  }
  return null;
}

/** Normalize a server map read from disk (legacy "http" → "streamable-http"). */
export function normalizeMcpServers(raw: unknown): Record<string, McpServerConfig> {
  if (!isRecord(raw)) return {};
  const servers: Record<string, McpServerConfig> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    servers[name] = { ...value, transport: normalizeMcpTransport(value.transport) } as McpServerConfig;
  }
  return servers;
}
