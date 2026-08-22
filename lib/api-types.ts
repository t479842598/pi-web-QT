export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
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

export interface PluginPackageInfo {
  source: string;
  scope: PluginScope;
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
 *  (env, requestTimeoutMs, cwd, ...) are passed through by the API. */
export interface McpServerConfig {
  command: string;
  args: string[];
  transport?: "stdio" | "sse" | "http";
  lifecycle?: "eager" | "lazy";
  [key: string]: unknown;
}

export interface McpConfigResponse {
  mcpServers: Record<string, McpServerConfig>;
  filePath: string;
}

/** Subagents config — whitelist of fields pi-subagents understands.
 *  All fields are optional; unknown keys are dropped on write. */
export interface SubagentsConfig {
  maxConcurrent?: number;
  defaultMaxTurns?: number;
  graceTurns?: number;
  defaultJoinMode?: "async" | "group" | "smart";
  schedulingEnabled?: boolean;
  scopeModels?: boolean;
  disableDefaultAgents?: boolean;
  toolDescriptionMode?: "full" | "compact" | "custom";
  fleetView?: boolean;
  widgetMode?: "all" | "background" | "off";
  outputTranscript?: boolean;
}

export interface SubagentsConfigResponse {
  config: SubagentsConfig;
  filePath: string;
  /** Agents discovered in <agentDir>/agents/*.md (frontmatter only). */
  agents: Array<{ name: string; displayName?: string; description?: string; model?: string }>;
}
