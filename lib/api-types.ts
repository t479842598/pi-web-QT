import type { ResourceDiagnostic } from "@earendil-works/pi-coding-agent";
import type { SubagentProfile } from "./subagents";

export interface SubagentProfilesResponse {
  profiles: SubagentProfile[];
}

export interface SubagentSettingsResponse {
  enabled: boolean;
}

export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
}

export interface ShellToolSettingsResponse {
  isWindows: boolean;
  powerShellEnabled: boolean;
}

export type SkillInstallScope = "global" | "project";

export interface SkillInstallInfo {
  package: string;
  scope: SkillInstallScope;
  source: string;
  sourceType?: string;
  skillsShUrl?: string;
  skillPath?: string;
  ref?: string;
  versionHash?: string;
  canCheckForUpdates: boolean;
}

export type SkillUpdateState =
  | "up-to-date"
  | "update-available"
  | "unsupported"
  | "error";

export interface SkillUpdateResult {
  package: string;
  scope: SkillInstallScope;
  state: SkillUpdateState;
  currentVersion?: string;
  latestVersion?: string;
  message?: string;
}

export interface ProjectTrustStatus {
  requiresTrust: boolean;
  trusted: boolean;
}

export interface SkillsResponse {
  skills: SkillInfo[];
  diagnostics: Array<{ type: "warning" | "error"; message: string; source?: string; path?: string }>;
  projectResourcesLoaded: boolean;
}

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo: {
    source?: string;
    scope?: string;
  };
  install?: SkillInstallInfo;
}

export interface ProjectTrustStatus {
  requiresTrust: boolean;
  trusted: boolean;
}

export interface AppUpdateResponse {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
}

export interface PushConfigResponse {
  publicKey: string;
}

export type PluginScope = "global" | "project";
export type PluginResourceKind = "extension" | "skill" | "prompt" | "theme";

export interface PluginResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

export interface PluginDiagnostic {
  type: "warning" | "error";
  message: string;
  source?: string;
  path?: string;
}

export interface PluginResourceInfo {
  kind: PluginResourceKind;
  name: string;
  path: string;
  relativePath: string;
}

export type PluginUpdateState =
  | "update-available"
  | "up-to-date"
  | "unsupported"
  | "error";

export interface PluginUpdateResult {
  source: string;
  scope: PluginScope;
  displayName: string;
  type: "npm" | "git";
  state: PluginUpdateState;
  message?: string;
}

export interface PluginPackageInfo {
  source: string;
  scope: PluginScope;
  canCheckForUpdates: boolean;
  filtered: boolean;
  disabled: boolean;
  installedPath?: string;
  packageName?: string;
  version?: string;
  configuredVersion?: string;
  counts: PluginResourceCounts;
  resources: PluginResourceInfo[];
  status: "loaded" | "installed" | "missing" | "disabled";
}

export interface PluginsResponse {
  packages: PluginPackageInfo[];
  totals: PluginResourceCounts;
  diagnostics: PluginDiagnostic[];
  projectResourcesLoaded: boolean;
}

/** One entry under mcp.json's `mcpServers` map. Unknown extra fields
 *  (env, requestTimeoutMs, cwd, ...) are passed through by the API.
 *
 *  `command`/`args` are stdio-only and `url` is URL-transport-only, so both are
 *  optional here; which ones are required depends on `transport`. The enum
 *  mirrors pi-mcp-extension's zod schema ("stdio" | "streamable-http" | "sse") —
 *  a legacy "http" value written by older pi-web builds is normalized on read. */
export interface McpServerConfig {
  command?: string;
  args?: string[];
  /** Remote endpoint for `streamable-http` / `sse` transports. */
  url?: string;
  /** Static HTTP headers for `streamable-http` / `sse` transports. */
  headers?: Record<string, string>;
  /** OAuth config consumed by pi-mcp-extension (URL transports only). */
  auth?: Record<string, unknown>;
  transport?: McpTransport;
  lifecycle?: "eager" | "lazy";
  env?: Record<string, string>;
  requestTimeoutMs?: number;
  [key: string]: unknown;
}

/** Transports accepted by pi-mcp-extension's mcp.json schema. */
export type McpTransport = "stdio" | "streamable-http" | "sse";

/** Legacy pi-web wrote "http" for what the extension calls "streamable-http". */
export function normalizeMcpTransport(value: unknown): McpTransport {
  if (value === "stdio" || value === "sse" || value === "streamable-http") return value;
  if (value === "http") return "streamable-http";
  return "stdio";
}

export interface McpConfigResponse {
  mcpServers: Record<string, McpServerConfig>;
  filePath: string;
}

