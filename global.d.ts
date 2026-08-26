/** Optional host integration used by browser wrappers for directory/theme actions. */
interface Window {
  piDesktop?: {
    selectDirectory: () => Promise<string | null>;
    openThemeFolder: () => Promise<string>;
    openThemeDocs: () => Promise<void>;
  };
  /** Tauri desktop shell (withGlobalTauri=true) — present only inside the
   *  Pi Web desktop app webview. See hooks/useTheme.ts syncNativeTheme. */
  __TAURI__?: {
    core?: {
      invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
  };
}
