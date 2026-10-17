// Apply the saved theme before first paint so dark mode does not flash.
try {
  const theme = localStorage.getItem("codex-ui:theme") || "system";
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
} catch {}
