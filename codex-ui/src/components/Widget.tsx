// show_widget in the conversation (Claude 4.4212 c96d752d0 qX, mcp__visualize__show_widget): its
// loading messages while the call runs, then its code in a /widget-frame frame
// (server/widget-frame.mjs), drawn again from the call's arguments on every load. The frame is
// sandboxed to an origin of its own; this page takes only its height from it, and a prompt or a
// link the user clicked for, each checked here again.

import { useEffect, useRef, useState } from "react";
import { activeTurn, errorMessage, sendMessage } from "../lib/codex";
import { getState, toast } from "../lib/store";
import { useDarkTheme } from "./ConnectorIcon";
import { Spinner } from "./ui";

/** The names read_me gives widgets, from this page's own tokens (so a widget matches the app). */
const VARS: Record<string, string> = {
  "--surface-0": "--cds-surface-0", "--surface-1": "--cds-surface-1", "--surface-2": "--cds-surface-2", "--surface-3": "--cds-surface-3",
  "--text-primary": "--cds-text-primary", "--text-secondary": "--cds-text-secondary", "--text-muted": "--cds-text-muted",
  "--text-accent": "--cds-text-accent", "--text-danger": "--cds-text-danger", "--text-success": "--cds-text-success", "--text-warning": "--cds-text-warning",
  "--bg-accent": "--cds-bg-accent", "--bg-danger": "--cds-bg-danger", "--bg-warning": "--cds-bg-warning",
  "--border": "--cds-border", "--border-strong": "--cds-border-strong", "--border-stronger": "--cds-border-stronger",
  "--font-sans": "--font-sans", "--font-mono": "--font-mono",
};
const MIN_HEIGHT = 40;
const MAX_HEIGHT = 1600;
const PROMPT_GAP_MS = 1000;
/** A frame that navigates itself away is drawn again this often, then given up. */
const REMOUNTS = 2;

function theme(dark: boolean) {
  const style = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const [name, token] of Object.entries(VARS)) {
    const value = style.getPropertyValue(token).trim();
    if (value) vars[name] = value;
  }
  return { mode: dark ? "dark" : "light", vars };
}

export interface WidgetArgs {
  title: string;
  code: string;
  loading: string[];
}

/** The call's arguments as a widget, or null when they are not one. */
export function widgetArgs(value: unknown): WidgetArgs | null {
  const args = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (!args || typeof args.widget_code !== "string" || !args.widget_code.trim() || typeof args.title !== "string") return null;
  const loading = Array.isArray(args.loading_messages) ? args.loading_messages.filter((line): line is string => typeof line === "string" && !!line.trim()).slice(0, 4) : [];
  return { title: args.title, code: args.widget_code, loading };
}

/** While the call runs: its loading messages in turn. */
export function WidgetLoading({ lines }: { lines: string[] }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (lines.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % lines.length), 2400);
    return () => clearInterval(timer);
  }, [lines.length]);
  return (
    <div className="widget-loading" role="status">
      <Spinner size={12} />
      <span>{lines[index] ?? "正在绘制…"}</span>
    </div>
  );
}

export function Widget({ widget, threadId }: { widget: WidgetArgs; threadId: string | null }) {
  const dark = useDarkTheme();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);
  const [mount, setMount] = useState(0);
  const [broken, setBroken] = useState(false);
  const loads = useRef(0);
  const lastPrompt = useRef(0);
  const post = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(message, "*");

  useEffect(() => post({ type: "theme", ...theme(dark) }), [dark]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = frame.current && event.source === frame.current.contentWindow ? (event.data as Record<string, unknown> | null) : null;
      if (!data || typeof data !== "object" || data.codexUiWidget !== true) return;
      if (data.type === "size" && typeof data.height === "number" && Number.isFinite(data.height)) setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(data.height))));
      // A prompt or a link only from the user's own click in this frame, a prompt at most once a second.
      const clicked = data.active === true && document.activeElement === frame.current;
      if (data.type === "sendPrompt" && clicked && typeof data.text === "string" && threadId) {
        const text = data.text.trim().slice(0, 4000);
        if (!text || Date.now() - lastPrompt.current < PROMPT_GAP_MS) return;
        lastPrompt.current = Date.now();
        const running = !!activeTurn(getState().threads[threadId]);
        sendMessage(threadId, [{ type: "text", text, text_elements: [] }], { queue: running }).catch((error) => toast("warning", "无法发送小组件的消息", errorMessage(error)));
      }
      if (data.type === "openLink" && clicked && typeof data.url === "string" && /^https?:\/\//i.test(data.url)) window.open(data.url, "_blank", "noopener,noreferrer");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [threadId]);

  if (broken) return <div className="widget-note">此可视化无法显示。</div>;
  return (
    <iframe
      key={mount}
      ref={frame}
      className="widget-frame"
      src="/widget-frame"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      title={widget.title.replaceAll("_", " ")}
      style={{ height }}
      onLoad={() => {
        // A second load is the code navigating its frame elsewhere: start over in a fresh one.
        if (++loads.current > 1) {
          loads.current = 0;
          if (mount < REMOUNTS) setMount(mount + 1);
          else setBroken(true);
          return;
        }
        post({ type: "render", code: widget.code, ...theme(dark) });
      }}
    />
  );
}
