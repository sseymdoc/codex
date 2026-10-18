// Apply the saved theme and density before first paint so neither flashes.
try {
  const theme = localStorage.getItem("codex-ui:theme") || "system";
  // The desktop shell (desktop/preload.cjs) themes its title bar to match.
  window.codexDesktop?.setTheme(theme);
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  // comfortable is the default density; only the workbench choice is marked.
  if (localStorage.getItem("codex-ui:density") === "compact") document.documentElement.dataset.density = "compact";
} catch {}

// Windows desktop shell: with the window-controls overlay on, the page draws the 36px chrome bar.
try {
  const overlay = navigator.windowControlsOverlay;
  const sync = () => {
    if (overlay?.visible) document.documentElement.dataset.wco = "";
    else delete document.documentElement.dataset.wco;
  };
  sync();
  overlay?.addEventListener("geometrychange", sync);
} catch {}
