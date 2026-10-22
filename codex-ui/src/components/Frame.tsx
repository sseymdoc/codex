// The dframe frame in Claude's own markup (Claude Desktop 3.1623.4 ion-dist shared-22 RL / ML,
// shared-20 Zf, shared-1 lG): div.dframe-root with the Windows chrome bar, the sidebar, the
// collapsed sidebar's edge and main.dframe-content. The class names and data attributes are
// Claude's, so are their rules (scripts/claude-css.mjs → styles/claude.generated.css). The
// sidebar keeps the root's state attributes (Sidebar.tsx syncFrame).

import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { canStepRoute, stepRoute, useStore } from "../lib/store";
import { newChat, openThread } from "../lib/codex";
import { registerTitleSlot } from "./Main";
import { SidebarToggle } from "./Sidebar";
import { Button, Icon } from "./ui";

const DESKTOP = typeof window !== "undefined" && !!window.codexDesktop;

// theme-init.js keeps :root[data-wco] in step with the window-controls overlay.
const wcoNow = () => document.documentElement.hasAttribute("data-wco");
function onWco(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-wco"] });
  return () => observer.disconnect();
}
/** Whether the Windows chrome bar is drawn (the window-controls overlay is on). */
export const useWco = () => useSyncExternalStore(onWco, wcoNow);

/**
 * RL: [data-web] off the desktop app, [data-wco] with the chrome bar (only then drawn), the web
 * variant everywhere; the sidebar's width and density on the root. The Code route's content runs to the sidebar's edge (shared-21 bM: contentGutterZero
 * for /code). The page goes in the inner column; the collapsed sidebar's edge (Sidebar.tsx
 * SidebarEdge) sits between the sidebar and main, as RM does.
 */
export function Frame({ chrome, sidebar, children }: { chrome?: ReactNode; sidebar?: ReactNode; children: ReactNode }) {
  const wco = useWco();
  return (
    <div
      className="dframe-root draggable-none"
      data-wco={wco ? "" : undefined}
      data-web={DESKTOP ? undefined : ""}
      data-variant="web"
      data-sidebar-density="compact"
      style={{ "--df-sidebar-width": "288px", "--df-traffic-light-spacer": "max(0px, calc(0px - 1000 * max(0px, var(--app-top-offset, 0px) - 48px)))" } as CSSProperties}
    >
      {wco && chrome}
      {sidebar}
      <main className="dframe-content">
        <div className="dframe-content-inner" style={{ "--df-content-gutter": "0px" } as CSSProperties}>
          <div className="dframe-content-banner" />
          {children}
        </div>
        <div className="dframe-peek-nodrag" aria-hidden="true" />
      </main>
    </div>
  );
}

/** 返回 (-1) / 前进 (1) through openThread / newChat, which then record nothing. */
export function navigate(direction: -1 | 1) {
  const route = stepRoute(direction);
  if (route === null) newChat();
  else if (route !== undefined) void openThread(route);
}

/** shared-20 Zf: ghost arrows 2px apart; with nowhere to go they stay, dimmed and inert. */
function NavArrows() {
  const back = useStore((s) => canStepRoute(s, -1));
  const forward = useStore((s) => canStepRoute(s, 1));
  return (
    <div className="flex items-center gap-0.5 draggable-none">
      <Button variant="ghost" size="sm" icon={<Icon name="ArrowLeft" size={16} />} label="返回" kbd="Alt+←" tipSide="bottom" className="aria-disabled:pointer-events-none aria-disabled:*:opacity-50" aria-disabled={!back || undefined} onClick={back ? () => navigate(-1) : undefined} />
      <Button variant="ghost" size="sm" icon={<Icon name="ArrowRight" size={16} />} label="前进" kbd="Alt+→" tipSide="bottom" className="aria-disabled:pointer-events-none aria-disabled:*:opacity-50" aria-disabled={!forward || undefined} onClick={forward ? () => navigate(1) : undefined} />
    </div>
  );
}

/**
 * The Windows / Linux chrome bar ([data-wco], shared-22 ML): 菜单 (shared-1 lG: no tooltip, the
 * app menu at the pointer), with a sidebar its switch, 返回 / 前进 and the switcher slot; then the
 * title slot the session's titlebar lifts into, a 12px spacer and the peek's band. The end clears
 * the system caption buttons where the overlay puts them (env(titlebar-area-*)), the shell's
 * reserve standing in until it reports them.
 */
export function ChromeBar({ toggle = false }: { toggle?: boolean }) {
  return (
    <div
      className="dframe-chrome-bar draggable absolute top-0 inset-x-0 h-[36px] flex items-center gap-1 z-20"
      style={
        {
          paddingLeft: "calc(12px + 0px)",
          paddingRight: "calc(var(--df-chrome-bar-end-gutter, 12px) + max(0px, 100% - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100% - var(--df-chrome-bar-caption-reserve)))))",
          "--df-chrome-bar-pad-start": "calc(12px + 0px)",
        } as CSSProperties
      }
    >
      <div className="dframe-chrome-lead flex shrink-0 items-center gap-1" data-size="lg">
        <Button
          variant="ghost"
          size="sm"
          icon={<Icon name="Menu" size="sm" />}
          label="菜单"
          tip=""
          className="draggable-none"
          data-testid="topbar-windows-menu"
          data-app-menu-trigger=""
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => window.codexDesktop?.popupMenu()}
        />
        {toggle && <SidebarToggle place="chrome" />}
        {toggle && (
          <div className="flex items-center">
            <NavArrows />
          </div>
        )}
        <div role="group" aria-label="侧边栏" data-chrome-switcher="" className="draggable-none ms-auto me-1 flex shrink-0 items-center empty:hidden" />
      </div>
      <div ref={registerTitleSlot} className="dframe-chrome-title-slot flex min-w-0 flex-1 items-center self-stretch" />
      <div aria-hidden="true" className="w-3 shrink-0 self-stretch" />
      {toggle && <div aria-hidden="true" className="dframe-chrome-peek-band" data-peek-owner="" />}
    </div>
  );
}
