import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyTheme } from "./components/Settings";
import { connect } from "./lib/codex";
import { setState } from "./lib/store";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/chrome.css";
import "./styles/thread.css";

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme());
// The sidebar is a drawer on narrow screens: closed there, open on desktop.
const narrow = matchMedia("(max-width: 860px)");
const syncSidebar = () => setState({ sidebarOpen: !narrow.matches });
syncSidebar();
narrow.addEventListener("change", syncSidebar);

connect();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
