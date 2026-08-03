/** Optional host integration used by browser wrappers for directory/theme actions. */
interface Window {
  piDesktop?: {
    selectDirectory: () => Promise<string | null>;
    openThemeFolder: () => Promise<string>;
    openThemeDocs: () => Promise<void>;
  };
}
