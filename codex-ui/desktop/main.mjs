// Electron shell: runs the same loopback server as `pnpm start` and shows it in
// a window instead of a browser tab.

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from "electron";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "../server/bridge.mjs";
import { serve } from "../server/serve.mjs";

// Electron has no context menu of its own; give back the browser's basics.
const MENU_LABELS = { cut: "剪切", copy: "复制", paste: "粘贴", selectAll: "全选" };
const THEMES = ["light", "dark", "system"];
// On Windows the page draws a 36px chrome bar (src/styles/chrome.css, [data-wco]) and the
// system caption buttons float over its right end. Elsewhere the native frame stays.
const customTitleBar = process.platform === "win32";

let win;

if (!app.requestSingleInstanceLock()) {
  app.exit();
} else {
  app.on("second-instance", () => {
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });
  app.on("window-all-closed", () => app.quit());
  start().catch((error) => {
    dialog.showErrorBox("Codex UI", error.message);
    app.exit(1);
  });
}

async function start() {
  const [server] = await Promise.all([
    serve({
      ...parseArgs([]),
      // A shortcut starts us in the install folder; new chats default to home instead.
      cwd: process.env.INIT_CWD || homedir(),
      // localStorage (theme, drafts) is per origin, so keep clear of the browser version's 7477.
      port: 7478,
    }),
    app.whenReady(),
  ]);
  app.on("quit", server.close);
  const origin = new URL(server.url).origin;

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    // The native window shows its page color until the page paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#151515" : "#fcfcfb",
    show: false,
    autoHideMenuBar: true,
    icon: path.join(import.meta.dirname, "icon.ico"),
    ...(customTitleBar && { titleBarStyle: "hidden", titleBarOverlay: titleBarOverlay() }),
    webPreferences: { preload: path.join(import.meta.dirname, "preload.cjs") },
  });
  win.once("ready-to-show", () => win.show());

  // The page reports its theme setting (preload.cjs). Following it instead of the OS keeps
  // prefers-color-scheme, native menus and the caption buttons in step with the page.
  ipcMain.on("theme", (_event, theme) => {
    if (THEMES.includes(theme)) nativeTheme.themeSource = theme;
  });
  if (customTitleBar) nativeTheme.on("updated", () => win.setTitleBarOverlay(titleBarOverlay()));

  // Links open in the system browser; anything but http(s) stays closed.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin === origin) return;
    event.preventDefault();
    openExternal(url);
  });
  win.webContents.on("context-menu", (_event, { isEditable, selectionText }) => {
    const roles = isEditable ? ["cut", "copy", "paste", "selectAll"] : selectionText ? ["copy"] : [];
    if (roles.length) Menu.buildFromTemplate(roles.map((role) => ({ role, label: MENU_LABELS[role] }))).popup();
  });

  await win.loadURL(server.url);
}

function openExternal(url) {
  if (/^https?:/i.test(url)) shell.openExternal(url);
}

// See-through over the 36px chrome bar, with Claude Desktop's caption glyph colors.
function titleBarOverlay() {
  return { color: "#00000000", symbolColor: nativeTheme.shouldUseDarkColors ? "#c2c0b6" : "#3d3d3a", height: 36 };
}
