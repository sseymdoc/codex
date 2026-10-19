// Claude Desktop's @font-face rules (server/claude-fonts.mjs), linked here so Vite leaves the
// runtime-only URL alone.
try {
  const fonts = document.createElement("link");
  fonts.rel = "stylesheet";
  fonts.href = "/claude-fonts.css";
  fonts.setAttribute("blocking", "render");
  document.head.append(fonts);
} catch {}

// Apply the saved appearance before first paint so nothing flashes: theme, reduced motion, the
// new-session background animation, the chat text size, the transcript width and the interface
// font (Settings → 常规 and Codex → 外观 write the same keys and attributes afterwards).
try {
  const root = document.documentElement;
  // Interface font (shared-52 cm()): System and OpenDyslexic set data-font="system" and their own
  // marker; Anthropic Sans (the default) is left unmarked.
  const font = localStorage.getItem("codex-ui:interface-font");
  if (font === "system" || font === "dyslexic") {
    root.dataset.font = "system";
    root.setAttribute(font === "system" ? "data-system-font" : "data-dyslexic-font", "");
  }
  const theme = localStorage.getItem("codex-ui:theme") || "system";
  // The desktop shell (desktop/preload.cjs) themes its title bar to match.
  window.codexDesktop?.setTheme(theme);
  root.classList.toggle("dark", theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches));
  if (localStorage.getItem("codex-ui:motion") === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches) root.dataset.reduceMotion = "true";
  // "system" (the default) is left unmarked.
  const background = localStorage.getItem("codex-ui:bg-anim");
  if (background === "enabled" || background === "disabled") root.dataset.bgAnim = background;
  const size = localStorage.getItem("codex-ui:chat-text-size");
  root.dataset.chatTextSize = size === "s" || size === "l" ? size : "m";
  // s 768 (the default) · m 960 · l 1280.
  const width = localStorage.getItem("codex-ui:transcript-width");
  root.dataset.transcriptWidth = width === "m" || width === "l" ? width : "s";
} catch {}

// Windows desktop shell: with the window-controls overlay on, the page draws the 36px chrome bar.
// Only the Electron shell qualifies (shared-22 VN(): data-wco needs isClaudeApp); a browser that
// happens to report an overlay keeps the sidebar's own title row.
try {
  const overlay = window.codexDesktop ? navigator.windowControlsOverlay : undefined;
  const sync = () => {
    if (overlay?.visible) document.documentElement.dataset.wco = "";
    else delete document.documentElement.dataset.wco;
  };
  sync();
  overlay?.addEventListener("geometrychange", sync);
} catch {}
