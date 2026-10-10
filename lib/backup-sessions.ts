import {
  existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const SIDECARS = [".queue.json", ".goal.json"] as const;

type RestoreResult = { restored: string[]; warnings: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Never follow links inside either the extracted archive or the destination. */
function collectFiles(root: string, warnings: string[]): Set<string> {
  const files = new Set<string>();
  const pending = [""];
  while (pending.length) {
    const rel = pending.pop()!;
    const full = join(root, rel);
    const info = lstatSync(full);
    if (info.isSymbolicLink()) {
      warnings.push(`Skipped symbolic link in sessions: ${rel || "sessions/"}`);
    } else if (info.isDirectory()) {
      for (const name of readdirSync(full)) pending.push(rel ? `${rel}/${name}` : name);
    } else if (info.isFile()) {
      files.add(rel);
    } else {
      warnings.push(`Skipped unsupported session entry: ${rel}`);
    }
  }
  return files;
}

function ensureDirectory(root: string, rel: string): string {
  let directory = root;
  for (const part of rel.split("/").filter(Boolean)) {
    if (part === "." || part === ".." || /[\\:\0]/.test(part)) throw new Error("Invalid session path");
    directory = join(directory, part);
    try {
      mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const info = lstatSync(directory);
    if (info.isSymbolicLink()) throw new Error("Symbolic link in session destination");
    if (!info.isDirectory()) throw new Error("Session destination is not a directory");
    const contained = relative(root, realpathSync(directory));
    if (contained === ".." || contained.startsWith(`..${sep}`) || resolve(root, contained) !== realpathSync(directory)) {
      throw new Error("Session destination is outside the agent directory");
    }
  }
  return directory;
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path); // Includes dangling symlinks; existsSync does not.
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function sidecarContents(path: string, suffix: typeof SIDECARS[number]): { data: Buffer; paused: boolean } {
  const data = readFileSync(path);
  let parsed: unknown;
  try { parsed = JSON.parse(data.toString("utf8")); } catch { throw new Error(`Invalid ${suffix} file`); }
  if (!isRecord(parsed) || parsed.version !== 1) throw new Error(`Invalid ${suffix} file`);
  if (suffix === ".queue.json") {
    if (!Array.isArray(parsed.entries) || !parsed.entries.every((entry) => isRecord(entry)
      && (entry.kind === "steer" || entry.kind === "followUp") && typeof entry.text === "string")) {
      throw new Error("Invalid queue file");
    }
    return { data, paused: false };
  }
  if (!isRecord(parsed.state)) throw new Error("Invalid goal file");
  if (parsed.state.status !== "running") return { data, paused: false };
  const paused = { ...parsed, state: { ...parsed.state, status: "paused", updatedAt: Date.now() } };
  return { data: Buffer.from(`${JSON.stringify(paused)}\n`), paused: true };
}

/** Restore missing history only. No AgentSession is created and no work is resumed. */
export function restoreSessionFiles(sourceRoot: string, agentDir: string): RestoreResult {
  const result: RestoreResult = { restored: [], warnings: [] };
  if (!pathExists(sourceRoot)) {
    result.warnings.push("No session files in this backup");
    return result;
  }
  const files = collectFiles(sourceRoot, result.warnings);
  const sessions = [...files].filter((file) => file.endsWith(".jsonl")).sort();
  const consumed = new Set<string>();
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const targetRoot = realpathSync(agentDir);
  for (const rel of sessions) {
    const group = [rel, ...SIDECARS.map((suffix) => rel + suffix).filter((name) => files.has(name))];
    for (const name of group) consumed.add(name);
    let staging: string | undefined;
    const published: Array<{ destination: string; source: string }> = [];
    try {
      const relativeDirectory = dirname(`sessions/${rel}`).split(sep).join("/");
      const targetDirectory = ensureDirectory(targetRoot, relativeDirectory);
      const target = join(targetRoot, "sessions", rel);
      // A sidecar left from another history also makes the entire group a conflict.
      if ([target, ...SIDECARS.map((suffix) => target + suffix)].some(pathExists)) {
        result.warnings.push(`Skipped existing session or sidecar: ${rel}`);
        continue;
      }
      const data = readFileSync(join(sourceRoot, rel));
      const firstNewline = data.indexOf(10);
      let header: unknown;
      try { header = JSON.parse(data.subarray(0, firstNewline < 0 ? data.length : firstNewline).toString("utf8")); }
      catch { throw new Error("Invalid session header"); }
      if (!isRecord(header) || header.type !== "session" || typeof header.id !== "string" || !header.id
        || typeof header.cwd !== "string") throw new Error("Invalid session header");
      let paused = false;
      const payloads = group.slice(1).map((name) => {
        const suffix = name.endsWith(".goal.json") ? ".goal.json" : ".queue.json";
        const content = sidecarContents(join(sourceRoot, name), suffix);
        paused ||= content.paused;
        return { name, data: content.data };
      });
      // Publish the transcript last, so a reader never sees history before its sidecars.
      payloads.push({ name: rel, data });
      staging = mkdtempSync(join(targetDirectory, ".restore-"));
      for (const [index, payload] of payloads.entries()) {
        writeFileSync(join(staging, String(index)), payload.data, { flag: "wx", mode: 0o600, flush: true });
      }
      for (const [index, payload] of payloads.entries()) {
        const destination = join(targetRoot, "sessions", payload.name);
        // Unlike rename, hard-link publication fails if any destination already exists.
        const source = join(staging, String(index));
        linkSync(source, destination);
        published.push({ destination, source });
      }
      result.restored.push(...payloads.map(({ name }) => `sessions/${name}`));
      if (paused) result.warnings.push(`Restored goal paused; resume manually: ${rel}`);
      if (typeof header.cwd === "string" && !existsSync(header.cwd)) {
        result.warnings.push(`Original workspace path was retained; select a valid workspace before continuing: ${rel}`);
      }
      if (header.parentSession) result.warnings.push(`Parent session path was retained; verify the restored relationship: ${rel}`);
    } catch (error) {
      for (const { destination, source } of published.reverse()) {
        try {
          // Staging keeps the original inode alive. Another process may have
          // replaced this path after publication; never unlink its replacement.
          const original = lstatSync(source, { bigint: true });
          const current = lstatSync(destination, { bigint: true });
          if (current.dev === original.dev && current.ino === original.ino) unlinkSync(destination);
          else result.warnings.push(`Rollback kept a replaced session file: ${relative(targetRoot, destination)}`);
        } catch (cleanupError) {
          if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
            result.warnings.push(`Session rollback needs manual cleanup: ${relative(targetRoot, destination)}`);
          }
        }
      }
      // Only our own validation text is useful; avoid exposing serialized private data.
      const detail = error instanceof Error && /^(Invalid |Symbolic link |Session destination )/.test(error.message)
        ? error.message : "File operation failed";
      result.warnings.push(`Skipped session ${rel}: ${detail}`);
    } finally {
      if (staging) {
        try {
          rmSync(staging, { recursive: true, force: true });
        } catch {
          result.warnings.push(`Session staging needs manual cleanup: ${relative(targetRoot, staging)}`);
        }
      }
    }
  }
  for (const file of files) {
    if (!consumed.has(file)) result.warnings.push(`Skipped orphan or unsupported session file: ${file}`);
  }
  return result;
}
