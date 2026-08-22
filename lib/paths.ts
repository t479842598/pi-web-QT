import { normalize } from "path";

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

export function isWindowsAbsolutePath(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("//");
}

/** 在 Linux（WSL）上把 Windows 绝对路径转成 /mnt/<drive>/... 挂载路径。 */
export function convertWindowsPathToWsl(p: string): string {
  const trimmed = p.trim();
  const driveMatch = trimmed.match(/^([a-zA-Z]):(?:[\\/](.*))?$/);
  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase();
    const rest = (driveMatch[2] ?? "").replace(/\\/g, "/");
    return rest ? `/mnt/${drive}/${rest}` : `/mnt/${drive}`;
  }
  return p;
}

/** Convert git's slash-separated Windows paths to native path separators. */
export function toNativePath(filePath: string): string {
  if (!filePath || process.platform !== "win32") return filePath;
  return normalize(filePath);
}

/** Normalize separators for internal path keys. */
export function toSlashPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/** Compare filesystem paths, including Windows separator and case rules. */
export function samePath(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b || process.platform !== "win32") return false;
  return toNativePath(a).toLowerCase() === toNativePath(b).toLowerCase();
}
