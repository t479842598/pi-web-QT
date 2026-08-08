import { normalize } from "path";

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

export function isWindowsAbsolutePath(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("//");
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
