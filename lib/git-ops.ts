import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 60_000;

/** Run a git command in cwd. Throws with the stderr message on failure. */
export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });
  const out = `${stdout ?? ""}${stderr ? `\n${stderr}` : ""}`.trim();
  return out;
}

export interface PushResult {
  ok: boolean;
  output: string;
  branch: string | null;
}

/** Push the current branch to its upstream (origin). */
export async function gitPush(cwd: string): Promise<PushResult> {
  try {
    const branch = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "");
    const output = await git(cwd, ["push"]);
    return { ok: true, output, branch: branch || null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: message, branch: null };
  }
}

export interface StashEntry {
  index: string;
  ref: string;
  message: string;
}

/** `git stash list` parsed into entries. */
export async function listStashes(cwd: string): Promise<StashEntry[]> {
  const out = await git(cwd, ["stash", "list", "--format=%gd|%H|%gs"]).catch(() => "");
  if (!out) return [];
  return out.split("\n").filter(Boolean).map((line) => {
    const [index, ref, ...msg] = line.split("|");
    return { index: index ?? "", ref: ref ?? "", message: msg.join("|") ?? "" };
  });
}

/** `git stash push` with an optional message. */
export async function stashPush(cwd: string, message?: string): Promise<string> {
  const args = ["stash", "push"];
  if (message?.trim()) args.push("-m", message.trim());
  return git(cwd, args);
}

/** `git stash drop <ref>`. */
export async function stashDrop(cwd: string, ref: string): Promise<string> {
  return git(cwd, ["stash", "drop", ref]);
}

/** `git stash pop <ref>`. */
export async function stashPop(cwd: string, ref: string): Promise<string> {
  return git(cwd, ["stash", "pop", ref]);
}
