const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");

// Config path: ~/.pi/agent/pi-web-desktop.json
const piDir = path.join(require("os").homedir(), ".pi", "agent");
const configPath = path.join(piDir, "pi-web-desktop.json");

function ensurePiDir() {
  if (!fs.existsSync(piDir)) fs.mkdirSync(piDir, { recursive: true });
}

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
  } catch { /* ignore */ }
  return null;
}

function saveConfig(config) {
  ensurePiDir();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

let mainWindow = null;
let setupWindow = null;
let nextProcess = null;
let serverPort = 30141;
let serverHostname = "0.0.0.0";

function startNextServer(config) {
  return new Promise(async (resolve, reject) => {
    serverPort = config.port || 30141;
    serverHostname = config.hostname || "0.0.0.0";

    const env = {
      ...process.env,
      PI_WEB_PASSWORD: config.password || "",
      PI_WEB_ALLOWED_HOSTS: config.allowedHosts || "",
      NODE_ENV: "production",
      PORT: String(serverPort),
    };

    // Prefer the built-in bin/pi-web.js, fallback to next start
    const pkgDir = path.join(__dirname, "..");
    const nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");

    const args = ["start", "-p", String(serverPort), "-H", serverHostname];
    const child = spawn(process.execPath, [nextBin, ...args], {
      cwd: pkgDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let started = false;
    child.stdout.on("data", (data) => {
      const text = data.toString();
      if (!started && text.includes("Ready")) {
        started = true;
        resolve();
      }
    });

    child.stderr.on("data", (data) => {
      process.stderr.write(data);
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (!started) reject(new Error(`Next.js exited with code ${code}`));
      nextProcess = null;
    });

    nextProcess = child;

    // Timeout after 30s
    setTimeout(() => {
      if (!started) reject(new Error("Next.js server failed to start within 30s"));
    }, 30000);
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: "Pi Web",
    backgroundColor: "#282828",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: "hiddenInset",
    show: false,
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => { mainWindow = null; });
}

function createSetupWindow(existingConfig) {
  setupWindow = new BrowserWindow({
    width: 480,
    height: 520,
    resizable: false,
    title: "Pi Web - Setup",
    backgroundColor: "#282828",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    titleBarStyle: "hiddenInset",
  });

  setupWindow.loadFile(path.join(__dirname, "setup.html"));

  // Send existing config to renderer
  setupWindow.webContents.on("did-finish-load", () => {
    setupWindow.webContents.send("load-config", existingConfig);
  });

  setupWindow.on("closed", () => { setupWindow = null; });
}

ipcMain.handle("save-and-start", async (_event, config) => {
  saveConfig(config);

  try {
    await startNextServer(config);
    if (setupWindow) setupWindow.close();
    createMainWindow();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("check-port", async (_event, port) => {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(port, "127.0.0.1", () => {
      srv.close(() => resolve({ free: true }));
    });
    srv.on("error", () => resolve({ free: false }));
  });
});

app.whenReady().then(async () => {
  const existingConfig = loadConfig();

  if (existingConfig && existingConfig.password) {
    // Has config → start server directly
    try {
      await startNextServer(existingConfig);
      createMainWindow();
      return;
    } catch {
      // Server failed → fall through to setup
    }
  }

  // No config → show setup window
  createSetupWindow(existingConfig);
});

function killNextProcess() {
  if (!nextProcess) return;
  try {
    if (process.platform === "win32") {
      process.kill(nextProcess.pid, "SIGKILL");
    } else {
      nextProcess.kill("SIGTERM");
    }
  } catch { /* already dead */ }
  nextProcess = null;
}

app.on("window-all-closed", () => {
  // macOS: keep app alive in dock (standard macOS behavior)
  if (process.platform === "darwin") return;
  killNextProcess();
  app.quit();
});

app.on("before-quit", () => {
  killNextProcess();
});

app.on("activate", () => {
  // macOS: re-create window when dock icon clicked
  if (mainWindow === null && nextProcess) {
    createMainWindow();
  }
});
