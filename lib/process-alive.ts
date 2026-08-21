/** True when a process with `pid` exists and we may signal it. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user — alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
