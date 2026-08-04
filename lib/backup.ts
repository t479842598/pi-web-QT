import AdmZip from "adm-zip";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "fs";
import { homedir, tmpdir } from "os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "path";
import { createRequire } from "module";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { normalizeFilePathSlashes } from "./file-paths";
import { writePrivateFileAtomicSync } from "./atomic-file";

/**
 * Global backup & cross-platform restore for ~/.pi/agent/.
 *
 * Export = file collection + deep path normalization (${agentDir}/${home}
 * placeholders) + zip. Import = zip parse/validation (zip-slip guard) +
 * platform expansion + MCP command adaptation + category-based restore.
 */

export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_ROOT = "pi-backup";
export const PLACEHOLDER_AGENT_DIR = "${agentDir}";
export const PLACEHOLDER_HOME = "${home}";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BackupOptions {
  includeSecrets: boolean;
  includeSessions: boolean;
}

export interface BackupManifest {
  formatVersion: number;
  createdAt: string;
  piWebVersion: string;
  piSdkVersion: string;
  sourcePlatform: string;
  includeSecrets: boolean;
  includeSessions: boolean;
  files: string[];
  mcpBinScripts: string[];
  localPackages: string[];
  absolutePaths: string[];
  warnings: string[];
}

export type McpAdaptAction =
  | "restore-script"
  | "generate-cmd"
  | "keep"
  | "keep-with-warning"
  | "manual";

export interface AdaptedServer {
  name: string;
  original: { command: string; args: string[] };
  adapted: { command: string; args: string[] } | null;
  action: McpAdaptAction;
  platform: string;
  reason?: string;
  /** Pre-built unified install prompt for manual servers (server-side only). */
  installPrompt?: string;
}

export interface BackupPreview {
  manifest: BackupManifest;
  categories: string[];
  servers: AdaptedServer[];
  warnings: string[];
  npmPackages: string[];
}

export interface RestoreSelections {
  categories: string[]; // subset of ["core","skills","packages","mcp","sessions"]
  skippedMcpServers: string[];
  reinstallNpm?: boolean; // opt-in: reinstall npm packages (default false)
}

export interface RestoreReport {
  restored: string[];
  needsRestart: string[];
  manual: Array<{ server: string; message: string }>;
  warnings: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const require = createRequire(import.meta.url);

function getVersions(): { piWebVersion: string; piSdkVersion: string } {
  try {
    const pkg = require("../package.json") as { version?: string };
    const sdk = require("@earendil-works/pi-coding-agent/package.json") as { version?: string };
    return { piWebVersion: pkg.version ?? "unknown", piSdkVersion: sdk.version ?? "unknown" };
  } catch {
    return { piWebVersion: "unknown", piSdkVersion: "unknown" };
  }
}

function readJsonFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Recursively collect directory entries (skip node_modules/.git), relative paths. */
function walkDirectory(root: string): string[] {
  const entries: string[] = [];
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop()!;
    const abs = join(root, rel);
    let items: string[];
    try {
      items = readdirSync(abs);
    } catch {
      continue;
    }
    for (const item of items) {
      if (item === "node_modules" || item === ".git") continue;
      const childRel = rel ? `${rel}/${item}` : item;
      const childAbs = join(abs, item);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(childAbs);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(childRel);
      else if (st.isFile()) entries.push(childRel);
    }
  }
  return entries;
}

/** Deep path normalization: getAgentDir()/homedir() prefixes → placeholders. */
export function normalizeBackupPaths(value: unknown): unknown {
  const agentDir = normalizeFilePathSlashes(getAgentDir());
  const home = normalizeFilePathSlashes(homedir());

  const replace = (input: string): string => {
    const s = normalizeFilePathSlashes(input);
    if (s === agentDir) return PLACEHOLDER_AGENT_DIR;
    if (s === home) return PLACEHOLDER_HOME;
    if (s.startsWith(agentDir + "/")) return PLACEHOLDER_AGENT_DIR + s.slice(agentDir.length);
    if (s.startsWith(home + "/")) return PLACEHOLDER_HOME + s.slice(home.length);
    return input;
  };

  return walkValue(value, replace);
}

/** Deep path expansion: placeholders → target-platform paths. */
export function expandBackupPaths(value: unknown): unknown {
  const agentDir = getAgentDir();
  const home = homedir();

  const expand = (input: string): string => {
    if (input === PLACEHOLDER_AGENT_DIR) return agentDir;
    if (input === PLACEHOLDER_HOME) return home;
    if (input.startsWith(PLACEHOLDER_AGENT_DIR + "/")) {
      return join(agentDir, ...input.slice(PLACEHOLDER_AGENT_DIR.length + 1).split("/"));
    }
    if (input.startsWith(PLACEHOLDER_HOME + "/")) {
      return join(home, ...input.slice(PLACEHOLDER_HOME.length + 1).split("/"));
    }
    return input;
  };

  return walkValue(value, expand);
}

function walkValue(value: unknown, transform: (s: string) => string): unknown {
  if (typeof value === "string") return transform(value);
  if (Array.isArray(value)) return value.map((item) => walkValue(item, transform));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = walkValue(item, transform);
    }
    return out;
  }
  return value;
}

/** Collect `${agentDir}/bin/<name>` references from an MCP server config value. */
export function collectBinRefs(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    const prefix = `${PLACEHOLDER_AGENT_DIR}/bin/`;
    if (value.startsWith(prefix)) {
      const rest = value.slice(prefix.length);
      const name = rest.split("/")[0];
      if (name) out.add(name);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectBinRefs(item, out);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectBinRefs(item, out);
  }
}

/** Remove apiKey fields from a models.json object (in place copy). */
function redactApiKeys(modelsJson: Record<string, unknown>): Record<string, unknown> {
  const providers = (modelsJson.providers ?? {}) as Record<string, Record<string, unknown>>;
  const next: Record<string, Record<string, unknown>> = {};
  for (const [name, provider] of Object.entries(providers)) {
    next[name] = { ...provider };
    if (typeof next[name].apiKey === "string") next[name].apiKey = "";
  }
  return { ...modelsJson, providers: next };
}

function addFileToZip(zip: AdmZip, entryName: string, content: Buffer | string): void {
  zip.addFile(`${BACKUP_ROOT}/${entryName}`, Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"));
}

// ── Export (F-01, D-01) ──────────────────────────────────────────────────────

export function createBackupZip(options: BackupOptions): Buffer {
  const agentDir = getAgentDir();
  const zip = new AdmZip();
  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    ...getVersions(),
    sourcePlatform: process.platform,
    includeSecrets: options.includeSecrets,
    includeSessions: options.includeSessions,
    files: [],
    mcpBinScripts: [],
    localPackages: [],
    absolutePaths: [],
    warnings: [],
  };

  // 1. Core config files
  const coreFiles = [
    "models.json",
    "auth.json",
    "settings.json",
    "mcp.json",
    "models-store.json",
    "AGENTS.md",
    "APPEND_SYSTEM.md",
  ];
  for (const name of coreFiles) {
    const path = join(agentDir, name);
    if (!existsSync(path)) continue;
    if (name === "auth.json" && !options.includeSecrets) continue;

    let content: unknown = readFileSync(path, "utf8");
    if (name === "models.json" && !options.includeSecrets) {
      const parsed = readJsonFile(path);
      if (parsed) content = JSON.stringify(redactApiKeys(parsed), null, 2);
    } else if (name === "settings.json" || name === "mcp.json" || name === "models.json") {
      const parsed = readJsonFile(path);
      if (parsed) content = JSON.stringify(normalizeBackupPaths(parsed), null, 2);
    }
    addFileToZip(zip, name, String(content));
    manifest.files.push(`${BACKUP_ROOT}/${name}`);
  }

  // 2. Skills directory
  const skillsDir = join(agentDir, "skills");
  if (existsSync(skillsDir)) {
    for (const rel of walkDirectory(skillsDir)) {
      zip.addFile(`${BACKUP_ROOT}/skills/${rel}`, readFileSync(join(skillsDir, rel)));
      manifest.files.push(`${BACKUP_ROOT}/skills/${rel}`);
    }
  }

  // 3. Local path packages → local-packages/<name>/
  const settings = readJsonFile(join(agentDir, "settings.json"));
  const packages = (settings?.packages ?? []) as Array<string | { source?: string }>;
  for (const entry of packages) {
    const source = typeof entry === "string" ? entry : entry?.source;
    if (!source || source.startsWith("npm:")) continue;
    const pkgDir = normalizeFilePathSlashes(source);
    if (isAbsolute(pkgDir) && existsSync(pkgDir)) {
      const name = basename(pkgDir);
      for (const rel of walkDirectory(pkgDir)) {
        zip.addFile(`${BACKUP_ROOT}/local-packages/${name}/${rel}`, readFileSync(join(pkgDir, rel)));
        manifest.files.push(`${BACKUP_ROOT}/local-packages/${name}/${rel}`);
      }
      manifest.localPackages.push(name);
    } else {
      manifest.warnings.push(`Local package skipped (not found or not absolute): ${source}`);
    }
  }

  // 4. bin scripts referenced by mcp.json
  const mcp = readJsonFile(join(agentDir, "mcp.json"));
  const binRefs = new Set<string>();
  if (mcp?.mcpServers) {
    for (const server of Object.values(mcp.mcpServers)) {
      collectBinRefs(normalizeBackupPaths(server), binRefs);
    }
  }
  for (const name of binRefs) {
    const scriptPath = join(agentDir, "bin", name);
    if (existsSync(scriptPath) && statSync(scriptPath).isFile()) {
      zip.addFile(`${BACKUP_ROOT}/bin/${name}`, readFileSync(scriptPath));
      manifest.files.push(`${BACKUP_ROOT}/bin/${name}`);
      manifest.mcpBinScripts.push(name);
    } else {
      manifest.warnings.push(`MCP bin script referenced but missing: ${name}`);
    }
  }

  // 5. Sessions (optional)
  if (options.includeSessions) {
    const sessionsDir = join(agentDir, "sessions");
    if (existsSync(sessionsDir)) {
      for (const rel of walkDirectory(sessionsDir)) {
        zip.addFile(`${BACKUP_ROOT}/sessions/${rel}`, readFileSync(join(sessionsDir, rel)));
        manifest.files.push(`${BACKUP_ROOT}/sessions/${rel}`);
      }
    }
  }

  // 6. Manifest (last)
  addFileToZip(zip, "manifest.json", JSON.stringify(manifest, null, 2));
  return zip.toBuffer();
}

// ── MCP adaptation (F-03, D-03) ──────────────────────────────────────────────

const PATH_COMMAND_WHITELIST = new Set(["npx", "uvx", "node", "uv", "npm", "git", "python3", "python", "bun", "deno"]);

/** Classify an MCP command after placeholder expansion. */
export function classifyCommand(command: string, agentDir: string): McpAdaptAction {
  if (!command) return "manual";
  const normalized = normalizeFilePathSlashes(command);
  if (normalized.startsWith(normalizeFilePathSlashes(agentDir) + "/bin/")) return "restore-script";
  if (command.includes("/") || command.includes("\\") || command.includes(":")) {
    // absolute path outside agentDir/bin
    return "keep-with-warning";
  }
  const base = command.split(/[\s]/)[0];
  if (PATH_COMMAND_WHITELIST.has(base)) return "keep";
  return "keep";
}

function readShebangLine(script: Buffer): string | null {
  const firstLine = script.toString("utf8", 0, 256).split(/\r?\n/, 1)[0] ?? "";
  return firstLine.startsWith("#!") ? firstLine : null;
}

/**
 * Adapt backup MCP servers to the current platform.
 * `binScripts` maps script name → zip entry content (from the backup).
 */
export function adaptMcpConfig(
  servers: Record<string, Record<string, unknown>>,
  binScripts: Map<string, Buffer>,
  platformOverride?: string,
): { servers: AdaptedServer[]; warnings: string[] } {
  const agentDir = getAgentDir();
  const platform = platformOverride ?? process.platform;
  const isWindows = platform === "win32";
  const warnings: string[] = [];
  const result: AdaptedServer[] = [];

  for (const [name, rawServer] of Object.entries(servers)) {
    const server = expandBackupPaths(rawServer) as Record<string, unknown>;
    const command = typeof server.command === "string" ? server.command : "";
    const args = Array.isArray(server.args) ? server.args.map(String) : [];
    const original = { command, args };
    const action = classifyCommand(command, agentDir);

    let adapted: { command: string; args: string[] } | null = null;
    let reason: string | undefined;

    if (action === "restore-script") {
      const binName = basename(normalizeFilePathSlashes(command));
      const script = binScripts.get(binName);
      if (!script) {
        adapted = null;
        reason = `bin script ${binName} missing from backup`;
        result.push({ name, original, adapted, action: "manual", platform, reason, installPrompt: buildMcpInstallPrompt({ name, original, adapted, action: "manual", platform, reason }) });
        continue;
      }
      if (!isSafeBinScriptName(binName)) {
        reason = `bin script name rejected (unsafe): ${binName}`;
        const manualServer = { name, original, adapted: null as null, action: "manual" as const, platform, reason };
        result.push({ ...manualServer, installPrompt: buildMcpInstallPrompt(manualServer) });
        warnings.push(`${name}: ${reason}`);
        continue;
      }
      if (!isSafeScriptContent(script)) {
        reason = "bin script content rejected (unrecognized shebang)";
        const manualServer = { name, original, adapted: null as null, action: "manual" as const, platform, reason };
        result.push({ ...manualServer, installPrompt: buildMcpInstallPrompt(manualServer) });
        warnings.push(`${name}: ${reason}`);
        continue;
      }
      if (!isWindows) {
        // Normalize to a plain path inside agentDir/bin (never trust the backup's raw command).
        adapted = { command: join(agentDir, "bin", binName), args };
        result.push({ name, original, adapted, action: "restore-script", platform });
      } else {
        const shebang = readShebangLine(script);
        if (shebang && shebang.includes("node")) {
          // node script → .cmd wrapper invoking node
          const cmdPath = join(agentDir, "bin", `${binName}.cmd`);
          adapted = { command: cmdPath, args };
          result.push({ name, original, adapted, action: "generate-cmd", platform, reason: join(agentDir, "bin", binName) });
        } else {
          reason = "bash/other shebang wrapper cannot run on Windows; reinstall or adjust manually";
          const manualServer = { name, original, adapted: null as null, action: "manual" as const, platform, reason };
          result.push({ ...manualServer, installPrompt: buildMcpInstallPrompt(manualServer) });
          warnings.push(`${name}: ${reason}`);
        }
      }
      continue;
    }

    if (action === "keep-with-warning") {
      adapted = { command, args };
      reason = "absolute path outside agentDir/bin — verify it exists on this machine";
      result.push({ name, original, adapted, action: "keep-with-warning", platform, reason });
      warnings.push(`${name}: ${reason}`);
      continue;
    }

    // keep (PATH command)
    adapted = { command, args };
    result.push({ name, original, adapted, action: "keep", platform });
  }

  return { servers: result, warnings };
}

// ── Parse & security (F-04, D-04) ────────────────────────────────────────────

/** Max total uncompressed bytes accepted when extracting a backup. */
export const MAX_EXTRACT_TOTAL_BYTES = 1024 * 1024 * 1024; // 1 GiB
/** Max size of a single extracted entry. */
export const MAX_EXTRACT_ENTRY_BYTES = 512 * 1024 * 1024; // 512 MiB

/** Bin script names must be plain file names (no separators, no "..", no hidden files). */
export function isSafeBinScriptName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes("..");
}

/** Accept only known interpreter shebangs for restored bin scripts. */
export function isSafeScriptContent(script: Buffer): boolean {
  const shebang = readShebangLine(script);
  if (!shebang) return false;
  const tokens = shebang.slice(2).trim().split(/\s+/);
  if (tokens.length === 0) return false;
  const interpreter = tokens[0];
  const base = interpreter.split("/").pop() ?? interpreter;
  if (["node", "bash", "sh", "python3", "python", "zsh"].includes(base)) return true;
  if (base === "env" && tokens.length > 1) {
    return ["node", "bash", "sh", "python3", "python"].includes(tokens[1].split("/").pop() ?? "");
  }
  return false;
}

export interface ParsedBackup {
  manifest: BackupManifest;
  tempDir: string;
  servers: Record<string, Record<string, unknown>>;
  binScripts: Map<string, Buffer>;
  categories: string[];
}

export function parseBackupZip(buffer: Buffer): ParsedBackup {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch (error) {
    throw new Error(`Not a valid zip archive: ${error instanceof Error ? error.message : String(error)}`);
  }

  const entries = zip.getEntries();
  const targetRoot = mkdtempSync(join(tmpdir(), "pi-backup-"));
  const extractedRoot = join(targetRoot, BACKUP_ROOT);
  mkdirSync(extractedRoot, { recursive: true });

  let declaredTotal = 0;
  let actualTotal = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const entryName = entry.entryName.replace(/\\/g, "/");
    if (!entryName.startsWith(`${BACKUP_ROOT}/`)) {
      rmSync(targetRoot, { recursive: true, force: true });
      throw new Error(`Unexpected entry outside ${BACKUP_ROOT}/: ${entryName}`);
    }
    // zip-slip guard
    const target = resolve(extractedRoot, entryName.slice(BACKUP_ROOT.length + 1));
    if (!target.startsWith(resolve(extractedRoot) + sep)) {
      rmSync(targetRoot, { recursive: true, force: true });
      throw new Error(`Path traversal blocked: ${entryName}`);
    }

    // Decompression bomb guard: declared uncompressed size per entry and in
    // total (fast fail before writing anything).
    const declaredSize = typeof entry.header.size === "number" ? entry.header.size : 0;
    declaredTotal += declaredSize;
    if (declaredSize > MAX_EXTRACT_ENTRY_BYTES || declaredTotal > MAX_EXTRACT_TOTAL_BYTES) {
      rmSync(targetRoot, { recursive: true, force: true });
      throw new Error(`Backup archive too large when extracted (entry: ${entryName})`);
    }

    mkdirSync(dirname(target), { recursive: true });
    zip.extractEntryTo(entry, dirname(target), false, true);

    // Belt and braces: verify the actual size on disk and accumulate the real
    // total (declared header sizes are attacker-controlled and can lie).
    const actualSize = statSync(target).size;
    actualTotal += actualSize;
    if (actualSize > MAX_EXTRACT_ENTRY_BYTES || actualTotal > MAX_EXTRACT_TOTAL_BYTES) {
      rmSync(targetRoot, { recursive: true, force: true });
      throw new Error(`Backup archive too large when extracted (entry: ${entryName})`);
    }
  }

  const manifestPath = join(extractedRoot, "manifest.json");
  if (!existsSync(manifestPath)) {
    rmSync(targetRoot, { recursive: true, force: true });
    throw new Error("Backup manifest.json missing — not a pi-web backup");
  }
  const manifest = readJsonFile(manifestPath) as BackupManifest | null;
  if (!manifest || manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    rmSync(targetRoot, { recursive: true, force: true });
    throw new Error(
      `Unsupported backup format version: ${manifest?.formatVersion ?? "unknown"} (expected ${BACKUP_FORMAT_VERSION})`,
    );
  }

  // Load adapted inputs
  const servers = (readJsonFile(join(extractedRoot, "mcp.json")) as Record<string, unknown> | null)
    ?.mcpServers as Record<string, Record<string, unknown>> | undefined ?? {};
  const binScripts = new Map<string, Buffer>();
  for (const name of manifest.mcpBinScripts ?? []) {
    const scriptPath = join(extractedRoot, "bin", name);
    if (existsSync(scriptPath)) binScripts.set(name, readFileSync(scriptPath));
  }

  const categories = ["core", "skills", "packages", "mcp"];
  if (manifest.includeSessions) categories.push("sessions");

  return { manifest, tempDir: targetRoot, servers, binScripts, categories };
}

export function cleanupParsedBackup(parsed: ParsedBackup): void {
  rmSync(parsed.tempDir, { recursive: true, force: true });
}

// ── Restore (F-05/F-06, D-05) ───────────────────────────────────────────────

export function restoreBackup(
  parsed: ParsedBackup,
  selections: RestoreSelections,
): { report: RestoreReport; npmPackages: string[] } {
  const agentDir = getAgentDir();
  const { manifest } = parsed;
  const report: RestoreReport = { restored: [], needsRestart: [], manual: [], warnings: [] };
  const selected = new Set(selections.categories);
  const skippedServers = new Set(selections.skippedMcpServers);

  const writeFromZip = (entryName: string): void => {
    const target = join(agentDir, entryName);
    const source = join(parsed.tempDir, BACKUP_ROOT, entryName);
    if (!existsSync(source)) return;
    mkdirSync(dirname(target), { recursive: true });
    writePrivateFileAtomicSync(target, readFileSync(source, "utf8"));
    report.restored.push(entryName);
  };

  // 1. Core config
  if (selected.has("core")) {
    const coreFiles = [
      "models.json",
      "auth.json",
      "settings.json",
      "mcp.json",
      "models-store.json",
      "AGENTS.md",
      "APPEND_SYSTEM.md",
    ];
    for (const name of coreFiles) {
      if (name === "auth.json" && !manifest.includeSecrets) continue;
      writeFromZip(name);
      report.needsRestart.push(name);
    }
  }

  // 2. Skills
  if (selected.has("skills")) {
    const sourceRoot = join(parsed.tempDir, BACKUP_ROOT, "skills");
    if (existsSync(sourceRoot)) {
      for (const rel of walkDirectory(sourceRoot)) {
        const target = join(agentDir, "skills", rel);
        mkdirSync(dirname(target), { recursive: true });
        writePrivateFileAtomicSync(target, readFileSync(join(sourceRoot, rel), "utf8"));
      }
      report.restored.push("skills/");
    }
  }

  // 3. Packages: local-packages migration + npm reinstall
  if (selected.has("packages")) {
    const settingsPath = join(agentDir, "settings.json");
    const settings = readJsonFile(settingsPath) ?? {};
    const packages = (settings.packages ?? []) as Array<string | Record<string, unknown>>;

    // 3a. local packages → agentDir/local-packages/<name>/
    const localPackages = manifest.localPackages ?? [];
    const sourceRoot = join(parsed.tempDir, BACKUP_ROOT, "local-packages");
    for (const name of localPackages) {
      if (!isSafeBinScriptName(name)) {
        report.warnings.push(`Local package ${name} not restored (unsafe name)`);
        continue;
      }
      const pkgSource = join(sourceRoot, name);
      if (!existsSync(pkgSource)) {
        report.warnings.push(`Local package ${name} missing from backup`);
        continue;
      }
      const pkgTarget = join(agentDir, "local-packages", name);
      for (const rel of walkDirectory(pkgSource)) {
        const target = join(pkgTarget, rel);
        mkdirSync(dirname(target), { recursive: true });
        writePrivateFileAtomicSync(target, readFileSync(join(pkgSource, rel), "utf8"));
      }
      report.restored.push(`local-packages/${name}`);
    }

    // 3b. rewrite settings.json packages paths for local packages
    let packagesChanged = false;
    const nextPackages = packages.map((entry) => {
      const source = typeof entry === "string" ? entry : entry?.source;
      if (typeof source !== "string" || source.startsWith("npm:")) return entry;
      const name = basename(normalizeFilePathSlashes(source));
      if (localPackages.includes(name)) {
        packagesChanged = true;
        const newPath = join(agentDir, "local-packages", name);
        if (typeof entry === "string") return newPath;
        return { ...entry, source: newPath };
      }
      return entry;
    });
    if (packagesChanged) {
      const next = { ...settings, packages: nextPackages };
      writePrivateFileAtomicSync(settingsPath, JSON.stringify(next, null, 2));
      report.restored.push("settings.json (packages paths)");
      report.needsRestart.push("settings.json (packages paths)");
    }

    // 3c. npm packages — collect for async reinstall by the caller
    const npmSpecs = packages
      .map((entry) => (typeof entry === "string" ? entry : entry?.source))
      .filter((source): source is string => typeof source === "string" && source.startsWith("npm:"));
    for (const spec of npmSpecs) {
      report.restored.push(`npm package ${spec} (queued for reinstall)`);
    }
  }

  // 4. MCP servers (adapted)
  if (selected.has("mcp")) {
    const adapted = adaptMcpConfig(parsed.servers, parsed.binScripts);
    report.warnings.push(...adapted.warnings);

    const currentMcp = (readJsonFile(join(agentDir, "mcp.json")) as Record<string, unknown> | null) ?? {};
    const nextServers: Record<string, Record<string, unknown>> = {};

    for (const server of adapted.servers) {
      if (skippedServers.has(server.name)) continue;
      if (server.action === "manual") {
        report.manual.push({
          server: server.name,
          message: server.reason ?? "cannot be adapted automatically",
        });
        continue;
      }
      const raw = parsed.servers[server.name] ?? {};
      const expanded = expandBackupPaths(raw) as Record<string, unknown>;
      nextServers[server.name] = {
        ...expanded,
        command: server.adapted?.command ?? expanded.command,
        ...(server.adapted ? { args: server.adapted.args } : {}),
      };
      if (server.action === "restore-script") {
        // restore bin script with exec bit
        const binName = basename(normalizeFilePathSlashes(String(server.adapted?.command ?? "")));
        const script = parsed.binScripts.get(binName);
        if (script && isSafeBinScriptName(binName) && isSafeScriptContent(script)) {
          const target = join(agentDir, "bin", binName);
          mkdirSync(dirname(target), { recursive: true });
          writePrivateFileAtomicSync(target, script.toString("utf8"));
          try {
            chmodSync(target, 0o755);
          } catch {
            // ignore chmod failures
          }
          report.restored.push(`bin/${binName}`);
        } else {
          report.warnings.push(`bin script ${binName} not restored (unsafe name or content)`);
        }
      }
      if (server.action === "generate-cmd") {
        const binName = basename(normalizeFilePathSlashes(String(server.adapted?.command ?? ""))).replace(/\.cmd$/, "");
        const script = parsed.binScripts.get(binName);
        if (script && isSafeBinScriptName(binName) && isSafeScriptContent(script)) {
          const scriptTarget = join(agentDir, "bin", binName);
          mkdirSync(dirname(scriptTarget), { recursive: true });
          writePrivateFileAtomicSync(scriptTarget, script.toString("utf8"));
          const cmdTarget = join(agentDir, "bin", `${binName}.cmd`);
          const relative = `%~dp0${binName}`;
          writePrivateFileAtomicSync(cmdTarget, `@node "${relative}" %*\r\n`);
          report.restored.push(`bin/${binName}`, `bin/${binName}.cmd`);
        } else {
          report.warnings.push(`bin script ${binName} not restored (unsafe name or content)`);
        }
      }
    }

    writePrivateFileAtomicSync(join(agentDir, "mcp.json"), JSON.stringify({ ...currentMcp, mcpServers: nextServers }, null, 2));
    report.restored.push("mcp.json");
    report.needsRestart.push("mcp.json");
  }

  return { report, npmPackages: npmSpecsFromSettings(parsed) };
}

/** npm: package specs recorded in the backup settings.json. */
export function npmSpecsFromSettings(parsed: ParsedBackup): string[] {
  const settings = readJsonFile(join(parsed.tempDir, BACKUP_ROOT, "settings.json"));
  const packages = (settings?.packages ?? []) as Array<string | { source?: string }>;
  return packages
    .map((entry) => (typeof entry === "string" ? entry : entry?.source))
    .filter((source): source is string => typeof source === "string" && source.startsWith("npm:"));
}

// ── AI install prompt (F-07, D-06) ───────────────────────────────────────────

export function buildMcpInstallPrompt(server: AdaptedServer): string {
  const agentDir = getAgentDir();
  const platform = process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux";
  const original = JSON.stringify(server.original, null, 2);
  return [
    `请在当前环境（${platform}）安装 MCP server「${server.name}」。`,
    "",
    "## 原始配置（来自备份）",
    "```json",
    original,
    "```",
    "",
    "## 统一安装约定",
    `- 脚本类工具统一安装到 \`${join(agentDir, "bin")}\`（Windows 上同时生成同名 \`.cmd\` 包装）。`,
    `- npm 类工具统一通过 \`npx <pkg>\` 运行，或安装到 \`${join(agentDir, "npm")}\` 后引用。`,
    "- 依赖（node/npx/uv 等）统一从 PATH 解析，不要硬编码本机绝对路径。",
    "- 安装完成后，输出可直接写入 `~/.pi/agent/mcp.json` 的完整 server 配置片段（含 command/args/transport/lifecycle）。",
    "- 不要修改 mcp.json 中其它 server 的配置。",
    "",
    "安装过程中如遇障碍，请说明原因并给出替代方案。",
  ].join("\n");
}
