// Electron shell: runs the same loopback server as `pnpm start` and shows it in
// a window instead of a browser tab.

import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "../server/bridge.mjs";
import { serve } from "../server/serve.mjs";

// Electron has no context menu of its own; give back the browser's basics.
const MENU_LABELS = { cut: "剪切", copy: "复制", paste: "粘贴", selectAll: "全选" };

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
    width: 1280,
    height: 860,
    minWidth: 400,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    icon: path.join(import.meta.dirname, "icon.ico"),
  });
  win.once("ready-to-show", () => win.show());

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
