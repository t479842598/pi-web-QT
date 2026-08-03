// Ambient declarations for the Electron bridge exposed via preload.js.
// These are only present when the app runs inside the Electron shell;
// in plain browser mode the optional fields are undefined.

interface ElectronWindowControls {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
}

interface PiDesktopBridge {
  // Setup wizard (first run): save config & start server / check port / load config
  saveAndStart: (config: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  checkPort: (port: number) => Promise<{ free: boolean }>;
  onLoadConfig: (callback: (config: Record<string, unknown> | null) => void) => void;
  // Native OS directory picker — used by the workspace selector.
  selectDirectory?: () => Promise<string | null>;
  // Open PI theme folder / docs in the OS shell.
  openThemeFolder?: () => Promise<string>;
  openThemeDocs?: () => Promise<void>;
}

interface Window {
  electron?: {
    isElectron: true;
    windowControls: ElectronWindowControls;
  };
  piDesktop?: PiDesktopBridge;
}
