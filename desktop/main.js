/**
 * WorkPulse for Windows.
 *
 * The same decision the mobile app made (A65): this is a native window around the *deployed* site,
 * not a copy of it. The app has 76 API routes, middleware, Auth.js sessions and a realtime
 * transport, so there is nothing to bundle offline - and loading the live URL means every Vercel
 * deploy updates every installed desktop app at once, with no new installer to hand out.
 *
 * Because the window loads https://app.broaddcast.com directly, the session cookie is first-party
 * exactly as it is in a browser: login, roles and the realtime transport all work unchanged.
 */
const { app, BrowserWindow, Menu, shell, session, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

const APP_URL = process.env.WORKPULSE_URL || "https://app.broaddcast.com";
const APP_ORIGIN = new URL(APP_URL).origin;

// Windows shows this as the sender of any notification the page raises, and groups the taskbar icon.
app.setAppUserModelId("com.broaddcast.workpulse");

/** Remember where the window was, so it opens where it was left. */
const stateFile = () => path.join(app.getPath("userData"), "window-state.json");
function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    if (typeof s.width === "number" && typeof s.height === "number") return s;
  } catch { /* first run, or a corrupt file: fall back to the defaults */ }
  return { width: 1440, height: 900, maximized: false };
}
function saveState(win) {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch { /* not being able to remember the size is not worth an error dialog */ }
}

let mainWindow = null;

function createWindow() {
  const state = readState();
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 380,
    minHeight: 560,
    show: false,
    backgroundColor: "#f4f0e8",
    autoHideMenuBar: true,
    title: "WorkPulse",
    icon: path.join(__dirname, "build/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (state.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());

  win.loadURL(APP_URL);

  // The server is unreachable (no network, or the host is down): say so, with a way back.
  win.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 is an aborted navigation, which is normal
    win.loadFile(path.join(__dirname, "offline.html"), { query: { url: APP_URL, reason: desc || String(code) } });
  });

  // Anything outside the app opens in the real browser rather than trapping the person in the shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file://")) return;
    if (new URL(url).origin !== APP_ORIGIN) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  for (const ev of ["resize", "move", "close"]) win.on(ev, () => saveState(win));
  win.on("closed", () => { mainWindow = null; });
  return win;
}

/** One window only: a second launch focuses the one already open. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    // The page may ask to raise notifications; nothing else is granted.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
      cb(permission === "notifications"));

    Menu.setApplicationMenu(buildMenu());
    mainWindow = createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}

/**
 * A small menu, hidden behind Alt. Edit is here because cut/copy/paste shortcuts are bound through
 * menu roles; Go gives back/forward, which a window with no browser chrome otherwise loses.
 */
function buildMenu() {
  const focused = () => BrowserWindow.getFocusedWindow()?.webContents;
  return Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => focused()?.reload() },
        { type: "separator" },
        { role: "quit", label: "Exit" },
      ],
    },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    {
      label: "Go",
      submenu: [
        { label: "Back", accelerator: "Alt+Left", click: () => { const w = focused(); if (w?.navigationHistory.canGoBack()) w.navigationHistory.goBack(); } },
        { label: "Forward", accelerator: "Alt+Right", click: () => { const w = focused(); if (w?.navigationHistory.canGoForward()) w.navigationHistory.goForward(); } },
        { type: "separator" },
        { label: "Home", accelerator: "Alt+Home", click: () => focused()?.loadURL(APP_URL) },
      ],
    },
    { label: "View", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }, { role: "toggleDevTools" }] },
    {
      label: "Help",
      submenu: [
        { label: "Open in browser", click: () => void shell.openExternal(APP_URL) },
        {
          label: "About WorkPulse",
          click: () => dialog.showMessageBox({
            type: "info",
            title: "About WorkPulse",
            message: `WorkPulse ${app.getVersion()}`,
            detail: `Connected to ${APP_URL}\nElectron ${process.versions.electron} - Chromium ${process.versions.chrome}`,
            buttons: ["OK"],
          }),
        },
      ],
    },
  ]);
}
