declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

/**
 * True when running inside the Tauri desktop shell (the packaged app, or a
 * dev `cargo run` build that loads a server window). The shell injects
 * `window.__TAURI_INTERNALS__` whenever `withGlobalTauri` is enabled, which
 * covers every server-window URL — including direct remote connections.
 */
export function isTauriDesktop(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}
