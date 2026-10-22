import type { ThreadItem } from "@protocol/v2/ThreadItem";
import { useEffect, useSyncExternalStore } from "react";
import { openPane, viewKey } from "./panes.ts";
import { getState } from "./store.ts";

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  error: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  viewport: { width: number; height: number } | null;
  inspecting: boolean;
  busy: boolean;
}
export interface BrowserServer {
  name: string;
  port: number;
  status: string;
  command: string;
  logs: string[];
}
export interface BrowserSnapshot {
  view: string;
  engine: "electron-cdp";
  toolsEnabled: boolean;
  approvals: { id: string; title: string; detail: string; origin?: string; remember?: boolean }[];
  settings: { enabled: boolean; storage: "none" | "shared" | "session"; openLinks: boolean; autoOpenFiles: boolean; allowedOrigins: string[] };
  tabs: BrowserTab[];
  active: string | null;
  servers: BrowserServer[];
}
export interface BrowserEvent extends Partial<BrowserSnapshot> {
  view: string;
  reveal?: boolean;
  shortcut?: string;
  shift?: boolean;
  notice?: string;
  selection?: { element: unknown; image: string; url: string };
}
export interface BrowserRequest {
  view: string;
  cwd: string;
  action: string;
  [key: string]: unknown;
}
export interface BrowserServerConfig {
  name: string;
  runtimeExecutable: string;
  runtimeArgs: string[];
  port: number;
}
const snapshots = new Map<string, BrowserSnapshot>();
const listeners = new Set<() => void>();
let listening = false;
function listen() {
  if (listening || !window.codexDesktop) return;
  listening = true;
  window.codexDesktop.onBrowserState((event) => {
    if (event.tabs) {
      snapshots.set(event.view, event as BrowserSnapshot);
      for (const listener of listeners) listener();
    }
    if (event.reveal) openPane("browser", event.view);
    window.dispatchEvent(new CustomEvent("codex-browser", { detail: event }));
  });
}
export async function browserRequest<T = BrowserSnapshot>(
  view: string,
  cwd: string,
  action: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!window.codexDesktop) throw new Error("浏览器仅在桌面版可用。");
  listen();
  const result = await window.codexDesktop.browserRequest({ ...args, view, cwd, action });
  if (result && typeof result === "object" && "tabs" in result) {
    snapshots.set(view, result as BrowserSnapshot);
    for (const listener of listeners) listener();
  }
  return result as T;
}
export function useBrowser(view: string, cwd: string) {
  const state = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshots.get(view),
  );
  useEffect(() => {
    if (!view) return;
    listen();
    void browserRequest(view, cwd, "state").catch((error) =>
      window.dispatchEvent(new CustomEvent("codex-browser", { detail: { view, notice: error.message } })),
    );
  }, [view, cwd]);
  return state;
}
/**
 * What a write opens (Claude 3.1623 main-process agent-edit hook pE: HTML, SVG, images, PDFs,
 * videos). ponytail: no PDF yet; whether Chromium's PDF viewer renders in a pane tab, past its
 * request filter (desktop/browser.mjs browserSession), is unchecked; add .pdf here and there once it does.
 */
export const AUTO_OPEN = /\.(html?|svg|png|jpe?g|gif|webp|avif|mp4|webm|m4v|mov|ogv)$/i;

/** The files a completed patch wrote that the browser pane shows: added or updated ones, at their new path. */
export function writtenFiles(item: ThreadItem): string[] {
  if (item.type !== "fileChange" || item.status !== "completed") return [];
  return item.changes.flatMap((change) => (change.kind.type === "delete" ? [] : [(change.kind.type === "update" && change.kind.move_path) || change.path])).filter((path) => AUTO_OPEN.test(path));
}

/**
 * 自动打开 Codex 写入的文件 (pE → GT, the launchAutoOpenFiles setting): a file Codex wrote opens in
 * the session's browser pane while the session is on screen (GT's "watched"); the desktop skips it
 * when the setting is off or a dev server is up for HTML. ponytail: Claude also tells the model the
 * file is showing, which needs the backend.
 */
export function openWritten(threadId: string, item: ThreadItem) {
  const files = writtenFiles(item);
  const thread = getState().threads[threadId];
  const cwd = thread?.settings?.cwd ?? thread?.meta.cwd;
  if (!files.length || !cwd || !window.codexDesktop || viewKey() !== threadId || document.hidden) return;
  void (async () => {
    for (const path of files) await browserRequest(threadId, cwd, "openWritten", { path }).catch(() => {});
  })();
}

export function attachBrowserContext(view: string, text: string, image: string) {
  window.dispatchEvent(new CustomEvent("composer-browser-context", { detail: { view, text, image } }));
}
export function browserUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("请输入 URL。");
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http${/^(localhost(?=[:/]|$)|[^/:]+\.localhost(?=[:/]|$)|127\.|\[::1\])/.test(raw) ? "" : "s"}://${raw}`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("请输入有效的 HTTP(S) URL。");
  return url.href;
}

if (typeof window !== "undefined" && window.codexDesktop) listen();
