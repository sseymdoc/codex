// Session rail ("Session details": cf74bc599 fO / rD as Claude Desktop 2.42304.0.0 shows it with
// the session-presets flag on; the rest of codex-ui stays the flag-off Code tab). Cards beside the
// chat: 环境, 目标, 上下文, 连接器, 输出, 更改 and 后台任务, in the bundle's order (c227f4d5e xZ, the
// cards Codex has data for). The rail docks where the session column has room (shared-18 My) and is a
// floating panel the toggle raises where it does not (jH). Cards and the lists in them stay as they
// were last left, in every session, and cards hide from a header's context menu (VZ); 环境 always
// shows. 设置 and 用量 never show beside the flag-on picker row (cf74bc599 fO `c`), 进度 is always
// hidden (wZ) and Codex has no preview servers, so those cards are left out. A card's header drags
// it to another place (cf74bc599 FA / MA), the order kept for every session.

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type WheelEvent,
} from "react";
import { flushSync } from "react-dom";
import { activeTurn, archiveThread, attachBranchPr, changeThreadFolder, compactThread, errorMessage, fail, folderGitInfo, inWorktreeRoot, loginMcpServer, projectFor, readPr, refreshMcp, removePullRequest, sendMessage, setRemoteControl, runGh, sshStatus, stopBackgroundTask, supports, threadCwd, type SshStatus } from "../lib/codex";
import type { BackgroundTask } from "../lib/background";
import { openBackgroundTask, openFinishedBackground, showAgent, useBackgroundTasks, useStopping } from "../lib/background-view";
import { contextBreakdown, mcpToolTokens, readContextParts, type Breakdown, type ContextParts, type LegendRow, type Row } from "../lib/context";
import { filesStats, outputFiles, turnFiles } from "../lib/diff";
import { environmentOf, sshStateLabel } from "../lib/environments";
import { goneFiles, revealFile } from "../lib/files";
import { basename, formatDuration, formatTokens, parentDir, samePath, taskClock, timeAgo } from "../lib/format";
import { openChanges } from "../lib/panes";
import {
  autoMergeCommand,
  canMerge,
  composePrUrl,
  createPrAsk,
  ghProblemText,
  githubRemote,
  mergeBlock,
  mergeCommand,
  mergeMethod,
  mergeMethodCommand,
  parsePr,
  parsePrList,
  prHistoryCommand,
  prIdentity,
  promptLabel,
  prRank,
  readyCommand,
  type Ci,
  type GhProblem,
  type PrLook,
  type PrStatus,
} from "../lib/pr";
import { moveItem, railOrder, sameOrder } from "../lib/rail";
import { useSshConnections, type SshConnection } from "../lib/ssh";
import { pullRequests, readJson, readPref, setState, toast, useStore, writePref, type AttachedPullRequest, type McpRuntime, type ThreadState } from "../lib/store";
import { prefillEmptyComposer, useContextUsage } from "./Composer";
import { openFile, openFileFrom } from "./content";
import { copied, openFileMenu } from "./FileMenu";
import { BackgroundTitle, GOAL_LABELS, loadRemoteDiff, remoteDiffOf, useRemoteDiff } from "./Panes";
import { openSettings } from "./Settings";
import { openConnector } from "./SettingsConnectors";
import { PointerMenu, menuPoint } from "./Sidebar";
import { openTerminalTab } from "./Terminal";
import { Button, Icon, MenuItem, MenuSection, MenuSep, Popover, Spinner, StatusDot, Submenu, Toggle, fileGlyph, useNow, type IconName } from "./ui";

/** A menu item's onClick: the menu closes, then the action runs. */
const closing = (close: () => void, action: () => void) => () => {
  close();
  action();
};

type CardId = "environment" | "goal" | "context" | "connectors" | "outputs" | "pullRequests" | "backgroundTasks";

const CARD_NAMES: Record<CardId, string> = {
  environment: "环境",
  goal: "目标",
  context: "上下文",
  connectors: "连接器",
  outputs: "输出内容",
  pullRequests: "更改",
  backgroundTasks: "后台任务",
};
const CARDS = Object.keys(CARD_NAMES) as CardId[];
/** Cards that start folded (cdae9a994 T); the others start open. */
const FOLDED: readonly CardId[] = ["context", "connectors"];
const opensByDefault = (card: CardId) => !FOLDED.includes(card);

interface Sections {
  /**
   * How each card (by id) and each list in one (`card/list`) was last left, for every session: the
   * user asked for the last state everywhere, where Claude keeps folds per session (PZ). A key not
   * in it is at its default.
   */
  open: Record<string, boolean>;
  hidden: CardId[];
  /** The order the cards were dragged into (cdae9a994 order); railOrder fills in the rest. */
  order: string[];
}

const SECTIONS_KEY = "codex-ui:rail-sections";

function readSections(): Sections {
  const saved = readJson(SECTIONS_KEY) as Partial<Sections> | null;
  return {
    open: saved?.open && typeof saved.open === "object" ? saved.open : {},
    hidden: Array.isArray(saved?.hidden) ? saved.hidden : [],
    order: Array.isArray(saved?.order) ? saved.order.filter((id) => typeof id === "string") : [],
  };
}

/** Shared by the docked rail, the floating one and the lists in their cards. */
let railSections = readSections();
const sectionListeners = new Set<() => void>();

function saveSections(next: Sections) {
  railSections = next;
  writePref(SECTIONS_KEY, JSON.stringify(next));
  for (const listener of sectionListeners) listener();
}

function subscribeSections(listener: () => void) {
  sectionListeners.add(listener);
  return () => void sectionListeners.delete(listener);
}

const useSections = () => useSyncExternalStore(subscribeSections, () => railSections);
const keepOpen = (open: Record<string, boolean>) => saveSections({ ...railSections, open: { ...railSections.open, ...open } });

const without = <T,>(list: T[], item: T) => list.filter((other) => other !== item);

// ---------------------------------------------------------------------------
// Toggle and placement

/** Docks where the session column is this wide (shared-18 My: 320 + 280 + 13 - 2, or 760 + 13 - 2 beside a pane). */
const fits = (width: number, besidePane: boolean) => width >= (besidePane ? 771 : 611);

function showRail(shown: boolean) {
  setState({ railShown: shown });
  writePref("codex-ui:rail", shown ? "shown" : "hidden");
}

export type RailState = ReturnType<typeof useRail>;

/**
 * Where the rail is for this session (cc43287c9 vn2): the toggle hides a docked rail for good
 * (persisted.epitaxy.sessionRailShown); where it does not fit, the toggle raises the floating
 * panel instead, which an outside click or Esc puts away.
 */
export function useRail(threadId: string) {
  const col = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const shown = useStore((s) => s.railShown);
  const besidePane = useStore((s) => (s.panes[threadId]?.open.length ?? 0) > 0);
  const [width, setWidth] = useState(0);
  const [raised, setRaised] = useState<false | "pointer" | "keyboard">(false);
  useLayoutEffect(() => {
    const el = col.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const room = fits(width, besidePane);
  const docked = shown && room;
  if (raised && docked) setRaised(false);
  const overlay = docked ? false : raised;
  const onScreen = docked || !!overlay;
  const dismiss = useCallback((refocus: boolean) => {
    setRaised(false);
    if (refocus) toggleRef.current?.focus({ preventScroll: true });
  }, []);
  const toggle = (keyboard: boolean) => {
    if (onScreen) {
      setRaised(false);
      if (docked) showRail(false);
      return;
    }
    showRail(true);
    if (!room) setRaised(keyboard ? "keyboard" : "pointer");
  };
  return { col, toggleRef, docked, overlay, onScreen, raises: !!overlay || (!onScreen && !room), toggle, dismiss };
}

// ---------------------------------------------------------------------------
// The rail

interface Fold {
  open: boolean;
  onOpen(open: boolean, all: boolean): void;
  onMenu(event: MouseEvent<HTMLElement>): void;
  /** The rail's menu was opened from this card's header (data-rail-menu-open). */
  menuOpen: boolean;
  /** A press on the header's grab end, which drags the card once it moves (cdbb20c70 H). */
  onGrab(event: ReactPointerEvent<HTMLElement>): void;
  /** Keys on the grip: Space / Enter pick the card up (cdbb20c70 Me). */
  onGripKey(event: ReactKeyboardEvent<HTMLElement>): void;
  onGripBlur(): void;
  /** Picked up with the keyboard. */
  lifted: boolean;
  /** The grip's instructions (dnd-kit's describedby text). */
  hintId: string;
}

/** The card being dragged and where the others were when it was picked up. */
interface Lift {
  id: CardId;
  keyboard: boolean;
  cards: HTMLElement[];
  ids: CardId[];
  boxes: { top: number; height: number }[];
  from: number;
  over: number;
  gap: number;
}

const GRIP_HINT = "要拾取某个部分，请按空格键或回车键。拾取后，请按上下方向键移动它，按空格键或回车键放下它，或按 Esc 键取消。";
/** dnd-kit sortable's default transition for the cards making room. */
const SHIFT = "transform 250ms ease";
const reducedMotion = () => document.documentElement.dataset.reduceMotion === "true";

/**
 * Dragging a card to another place (cf74bc599 FA / MA over dnd-kit's sortable list): a press on
 * the header's grab end lifts it once the pointer moves 6px, Space / Enter on the grip lift it for
 * the arrow keys. Only cards on show take part; the lifted one moves up and down only and the others
 * make room, the place nearest its centre being where it lands; Space, Enter or Tab (or letting go)
 * drops it, Esc puts it back. Dropped, it slides 200ms from where it was let go into its slot
 * (MA dropFromTop), and each step is read out (FA announcements).
 */
function useCardDrag(list: RefObject<HTMLDivElement | null>, order: CardId[], commit: (next: CardId[]) => void) {
  const lift = useRef<Lift | null>(null);
  const [lifted, setLifted] = useState<CardId | null>(null);
  const [said, setSaid] = useState("");
  const landing = useRef<{ id: CardId; top: number; keyboard: boolean } | null>(null);

  useLayoutEffect(() => {
    const landed = landing.current;
    const card = landed && list.current?.querySelector<HTMLElement>(`:scope > [data-rail-card="${landed.id}"]`);
    landing.current = null;
    if (!landed || !card) return;
    if (landed.keyboard) card.querySelector<HTMLElement>("[data-rail-grip]")?.focus({ preventScroll: true });
    const offset = landed.top - card.getBoundingClientRect().top;
    if (Math.abs(offset) < 1 || reducedMotion()) return;
    card.animate([{ transform: `translate3d(0, ${offset}px, 0)`, zIndex: 1 }, { transform: "translate3d(0, 0, 0)", zIndex: 1 }], { duration: 200, easing: "ease" });
  });

  const name = (state: Lift) => CARD_NAMES[state.id];
  const restyle = (state: Lift, settle: boolean) => {
    for (const card of state.cards) {
      card.style.transform = "";
      if (settle) continue;
      card.style.transition = "";
      card.style.position = "";
      card.style.zIndex = "";
      delete card.dataset.lifted;
    }
  };
  const finish = () => {
    delete list.current?.dataset.dragging;
    lift.current = null;
    setLifted(null);
  };
  const start = (id: CardId, keyboard: boolean): Lift | null => {
    const root = list.current;
    const cards = root ? [...root.querySelectorAll<HTMLElement>(":scope > .rail-card")] : [];
    const from = cards.findIndex((card) => card.dataset.railCard === id);
    if (!root || from < 0) return null;
    const shift = reducedMotion() ? "none" : SHIFT;
    cards.forEach((card, index) => (card.style.transition = index === from && !keyboard ? "none" : shift));
    cards[from].style.position = "relative";
    cards[from].style.zIndex = "1";
    cards[from].dataset.lifted = "";
    root.dataset.dragging = "";
    const state: Lift = {
      id,
      keyboard,
      cards,
      ids: cards.map((card) => card.dataset.railCard as CardId),
      boxes: cards.map((card) => {
        const box = card.getBoundingClientRect();
        return { top: box.top, height: box.height };
      }),
      from,
      over: from,
      gap: parseFloat(getComputedStyle(root).rowGap) || 0,
    };
    lift.current = state;
    if (keyboard) setLifted(id);
    setSaid(`已拾取 ${CARD_NAMES[id]}。它是第 ${from + 1} 个部分，共 ${cards.length} 个。`);
    return state;
  };
  /** The lifted card at `dy`, the ones between its place and `over` moved by its height. */
  const place = (state: Lift, over: number, dy: number) => {
    const { cards, boxes, from, gap } = state;
    cards[from].style.transform = `translate3d(0, ${dy}px, 0)`;
    if (over === state.over) return;
    state.over = over;
    const room = boxes[from].height + gap;
    cards.forEach((card, index) => {
      if (index === from) return;
      const y = from < over && index > from && index <= over ? -room : over < from && index >= over && index < from ? room : 0;
      card.style.transform = y ? `translate3d(0, ${y}px, 0)` : "";
    });
    setSaid(`${name(state)} 现在是第 ${over + 1} 节，共 ${cards.length} 节。`);
  };
  const drop = (state: Lift) => {
    const target = state.ids[state.over];
    landing.current = { id: state.id, top: state.cards[state.from].getBoundingClientRect().top, keyboard: state.keyboard };
    restyle(state, false);
    setSaid(`${name(state)} 已放置到第 ${state.over + 1} 个区块，共 ${state.cards.length} 个。`);
    flushSync(() => {
      if (target !== state.id) commit(moveItem(order, order.indexOf(state.id), order.indexOf(target)));
      finish();
    });
  };
  const cancel = (state: Lift) => {
    // The cards slide back with their transitions on, which then come off.
    restyle(state, true);
    window.setTimeout(() => restyle(state, false), reducedMotion() ? 0 : 250);
    setSaid(`移动 ${name(state)} 的操作已取消。`);
    finish();
    if (state.keyboard) state.cards[state.from].querySelector<HTMLElement>("[data-rail-grip]")?.focus({ preventScroll: true });
  };

  const onGrab = (id: CardId) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || lift.current || !(event.target as Element).closest("[data-rail-grab]")) return;
    const x0 = event.clientX;
    const y0 = event.clientY;
    let state: Lift | null = null;
    const move = (moved: PointerEvent) => {
      if (!state) {
        if (Math.hypot(moved.clientX - x0, moved.clientY - y0) < 6) return;
        state = start(id, false);
        if (!state) return stop();
        getSelection()?.removeAllRanges();
      }
      const dy = moved.clientY - y0;
      const { boxes, from } = state;
      const centre = boxes[from].top + boxes[from].height / 2 + dy;
      let over = from;
      boxes.forEach((box, index) => {
        if (Math.abs(box.top + box.height / 2 - centre) < Math.abs(boxes[over].top + boxes[over].height / 2 - centre)) over = index;
      });
      place(state, over, dy);
    };
    // A drag's pointerup must not also toggle the card.
    const swallow = (click: Event) => {
      click.preventDefault();
      click.stopPropagation();
    };
    const up = () => {
      stop();
      if (!state) return;
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      drop(state);
    };
    const away = () => {
      stop();
      if (state) cancel(state);
    };
    const key = (pressed: KeyboardEvent) => {
      if (pressed.key !== "Escape" || !state) return;
      pressed.preventDefault();
      pressed.stopPropagation();
      away();
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", away);
      window.removeEventListener("keydown", key, true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", away);
    window.addEventListener("keydown", key, true);
  };

  const onGripKey = (id: CardId) => (event: ReactKeyboardEvent<HTMLElement>) => {
    const state = lift.current;
    const pick = event.key === " " || event.key === "Enter";
    if (!state) {
      if (!pick || event.repeat) return;
      event.preventDefault();
      start(id, true);
      return;
    }
    if (!state.keyboard) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const { boxes, from } = state;
      const over = Math.min(boxes.length - 1, Math.max(0, state.over + (event.key === "ArrowDown" ? 1 : -1)));
      const dy = over > from ? boxes[over].top + boxes[over].height - (boxes[from].top + boxes[from].height) : boxes[over].top - boxes[from].top;
      place(state, over, dy);
    } else if ((pick && !event.repeat) || event.key === "Tab") {
      event.preventDefault();
      drop(state);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel(state);
    }
  };
  const onGripBlur = () => {
    const state = lift.current;
    if (state?.keyboard && landing.current === null) cancel(state);
  };

  const lifting = useCallback(() => lift.current !== null, []);
  return { lifted, said, lifting, onGrab, onGripKey, onGripBlur };
}

/**
 * cc43287c9 yH: a wheel over the rail scrolls the transcript under it, unless what it is over in
 * the rail scrolls itself (vH / _H).
 */
function scrollTranscript(event: WheelEvent<HTMLElement>, scrollRef: RefObject<HTMLDivElement | null>) {
  const rail = event.currentTarget;
  const target = event.target as Element | null;
  if (event.ctrlKey || event.deltaY === 0 || target?.nodeType !== 1 || !rail.contains(target)) return;
  for (let el: Element | null = target; el && el !== rail; el = el.parentElement) {
    if (el.scrollHeight <= el.clientHeight) continue;
    const overflow = el.ownerDocument.defaultView?.getComputedStyle(el).overflowY;
    if (overflow === "auto" || overflow === "scroll") return;
  }
  scrollRef.current?.scrollBy({ top: event.deltaY });
}

/**
 * Docked (shared-18 ky): 280 wide beside the chat, the cards 10 apart with their rings. Floating
 * (By / Vy): the same column in one bordered panel, the cards flat with a rule between them; it
 * takes focus when the keyboard raised it.
 */
export function SessionRail({
  thread,
  scrollRef,
  overlay,
  toggleRef,
  onDismiss,
}: {
  thread: ThreadState;
  scrollRef: RefObject<HTMLDivElement | null>;
  overlay?: "pointer" | "keyboard";
  toggleRef?: RefObject<HTMLElement | null>;
  onDismiss?(refocus: boolean): void;
}) {
  const sections = useSections();
  const [menu, setMenu] = useState<{ x: number; y: number; card: CardId } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const floating = !!overlay;
  const order = railOrder(CARDS, sections.order);
  const drag = useCardDrag(list, order, (next) => saveSections({ ...railSections, order: next }));

  useEffect(() => {
    if (overlay === "keyboard") panel.current?.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // cc43287c9 AH: Esc (unless a menu is open over it or a card is being dragged) or a press outside
  // the panel and the toggle.
  useEffect(() => {
    if (!floating || !onDismiss) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || drag.lifting() || document.querySelector(".popover")) return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss(!!panel.current?.contains(document.activeElement));
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element;
      if (panel.current?.contains(target) || toggleRef?.current?.contains(target) || target.closest?.(".popover")) return;
      onDismiss(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [floating, onDismiss, toggleRef, drag.lifting]);

  const fold = (card: CardId): Fold => ({
    open: sections.open[card] ?? opensByDefault(card),
    // Alt+click opens or folds every card (c73f45bc3 Xv setAllOpen).
    onOpen: (open, all) => keepOpen(Object.fromEntries((all ? CARDS : [card]).map((c) => [c, open]))),
    onMenu: (event) => {
      event.preventDefault();
      setMenu({ ...menuPoint(event), card });
    },
    menuOpen: menu?.card === card,
    onGrab: drag.onGrab(card),
    onGripKey: drag.onGripKey(card),
    onGripBlur: drag.onGripBlur,
    lifted: drag.lifted === card,
    hintId,
  });
  const shown = (card: CardId) => !sections.hidden.includes(card);
  const rendered: Record<CardId, ReactNode> = {
    environment: <EnvironmentCard key="environment" thread={thread} fold={fold("environment")} />,
    goal: shown("goal") && <GoalCard key="goal" thread={thread} fold={fold("goal")} />,
    context: shown("context") && <ContextCard key="context" thread={thread} fold={fold("context")} />,
    connectors: shown("connectors") && <ConnectorsCard key="connectors" thread={thread} fold={fold("connectors")} />,
    outputs: shown("outputs") && <OutputsCard key="outputs" thread={thread} fold={fold("outputs")} />,
    pullRequests: shown("pullRequests") && <ChangesCard key="pullRequests" thread={thread} fold={fold("pullRequests")} />,
    backgroundTasks: shown("backgroundTasks") && <BackgroundCard key={`backgroundTasks:${thread.meta.id}`} thread={thread} fold={fold("backgroundTasks")} />,
  };
  const cards = (
    <div ref={list} className="rail-scroll scroll-fade-y">
      {order.map((card) => rendered[card])}
    </div>
  );
  // cdae9a994 Y: anything off its default (a hidden card, the order, a card's fold) can be reset.
  const changed =
    sections.hidden.length > 0 || !sameOrder(order, CARDS) || CARDS.some((card) => card in sections.open && sections.open[card] !== opensByDefault(card));
  const closeMenu = () => {
    setMenu(null);
    // The header it was opened from may have gone with its card: focus goes to the rail.
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body) panel.current?.focus({ preventScroll: true });
    });
  };

  return (
    <aside ref={panel} className="rail" data-overlay={floating || undefined} aria-label="会话详情" tabIndex={-1} onWheel={(event) => scrollTranscript(event, scrollRef)}>
      {floating ? <div className="rail-surface">{cards}</div> : cards}
      <div id={hintId} hidden>
        {GRIP_HINT}
      </div>
      <div className="sr-only" role="status" aria-live="assertive" aria-atomic="true">
        {drag.said}
      </div>
      {menu && (
        // cdbb20c70 Pe / Le: 显示 lists the cards that can hide; 恢复默认设置 brings back the
        // hidden cards, the order and the folds.
        <PointerMenu at={menu} onClose={closeMenu}>
          <MenuSection title="显示" />
          {CARDS.filter((card) => card !== "environment").map((card) => (
            <MenuItem
              key={card}
              label={CARD_NAMES[card]}
              toggle
              checked={shown(card)}
              onClick={() => saveSections({ ...sections, hidden: shown(card) ? [...sections.hidden, card] : without(sections.hidden, card) })}
            />
          ))}
          <MenuSep />
          <MenuItem
            label="恢复默认设置"
            disabled={!changed}
            onClick={() => {
              closeMenu();
              const open = Object.fromEntries(Object.entries(sections.open).filter(([key]) => !(CARDS as string[]).includes(key)));
              saveSections({ open, hidden: [], order: [] });
            }}
          />
        </PointerMenu>
      )}
    </aside>
  );
}

const GRIP_DOTS = Array.from({ length: 6 }, (_, index) => <i key={index} />);

/**
 * A card (cdbb20c70 L): the heading toggles it, the caret turns and the summary hides while it is
 * open; a right click on the heading opens the rail's menu, the heading tinted while it is open.
 * Hovering the heading shows the grip at its end in place of the summary: the last 80px of the
 * heading drag the card (Me / data-rail-grab), the grip itself lifts it from the keyboard. The
 * pointer coming to the card or focus to its heading is an intent (onIntent). A card `leaving`
 * goes inert and fades out over 200ms before onLeft drops it (c5220dfc1 xp), at once when motion
 * is reduced; focus in it moves to the rail first.
 */
function Card({ id, summary, fold, onIntent, leaving = false, onLeft, children }: { id: CardId; summary?: ReactNode; fold: Fold; onIntent?(): void; leaving?: boolean; onLeft?(): void; children: ReactNode }) {
  const section = useRef<HTMLElement>(null);
  const headId = useId();
  useEffect(() => {
    const node = section.current;
    if (!leaving || !node) return;
    if (node.contains(document.activeElement)) node.parentElement?.closest<HTMLElement>('[tabindex="-1"]')?.focus({ preventScroll: true });
    if (reducedMotion()) return void onLeft?.();
    node.inert = true;
    const fade = node.animate([{ opacity: 0 }], { duration: 200, easing: "ease-out", fill: "forwards" });
    fade.finished.then(() => onLeft?.(), () => {});
    return () => {
      fade.cancel();
      node.inert = false;
    };
  }, [leaving, onLeft]);
  const name = CARD_NAMES[id];
  return (
    <section ref={section} className="rail-card" data-rail-card={id} aria-labelledby={headId} onPointerEnter={onIntent}>
      <h3 className="rail-card-top" data-rail-menu-open={fold.menuOpen || undefined} onContextMenu={fold.onMenu}>
        <button
          id={headId}
          type="button"
          className="rail-card-head"
          aria-expanded={fold.open}
          onFocus={onIntent}
          onPointerDown={fold.onGrab}
          onClick={(event) => fold.onOpen(!fold.open, event.altKey)}
        >
          <span>{name}</span>
          <Icon name="CaretRight" size="xs" className="rail-card-caret" />
          {summary !== undefined && summary !== null && (
            <span className="rail-card-summary" aria-hidden={fold.open || undefined}>
              {summary}
            </span>
          )}
          <span className="rail-grab" data-rail-grab="" aria-hidden="true" />
        </button>
        <div
          className="rail-grip"
          data-rail-grip=""
          role="button"
          tabIndex={0}
          aria-roledescription="可拖动区块"
          aria-describedby={fold.hintId}
          aria-label={`调整 ${name} 的顺序`}
          aria-pressed={fold.lifted || undefined}
          onKeyDown={fold.onGripKey}
          onBlur={fold.onGripBlur}
        >
          <span className="rail-grip-box">
            <span className="rail-grip-dots">{GRIP_DOTS}</span>
          </span>
        </div>
      </h3>
      {fold.open && <div className="rail-card-body">{children}</div>}
    </section>
  );
}

/** Enter held down does not toggle again and again (c4ec2d81d V). */
function swallowRepeat(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== "Enter" || !event.repeat) return;
  event.preventDefault();
  event.stopPropagation();
}

const FOCUSABLE = 'button, a[href], [role=button], [tabindex="0"]';

/**
 * A list cut at `limit` rows with 显示更多 / 收起 under it (c4ec2d81d se / H); it folds back once
 * it fits. Showing more moves focus to the first row it brought in (the page kept still when that
 * was a click).
 */
function Limited<T>({ items, limit, children }: { items: T[]; limit: number; children(item: T): ReactNode }) {
  const [all, setAll] = useState(false);
  const rows = useRef<HTMLDivElement>(null);
  const before = useRef<{ shown: Set<Element>; pointer: boolean } | null>(null);
  if (all && items.length <= limit) setAll(false);
  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    if (!was || !rows.current) return;
    for (const row of rows.current.children) {
      if (was.shown.has(row)) continue;
      const target = row.matches(FOCUSABLE) ? row : row.querySelector(FOCUSABLE);
      if (!(target instanceof HTMLElement)) continue;
      target.focus({ preventScroll: was.pointer });
      return;
    }
  }, [all]);
  return (
    <>
      <div ref={rows} className="rail-rows" role="presentation" onKeyDownCapture={swallowRepeat}>
        {(all ? items : items.slice(0, limit)).map(children)}
      </div>
      {items.length > limit && (
        <button
          type="button"
          className="rail-more"
          aria-expanded={all}
          onKeyDown={swallowRepeat}
          onClick={(event) => {
            if (!all && rows.current) before.current = { shown: new Set(rows.current.children), pointer: event.detail > 0 };
            setAll(!all);
          }}
        >
          {all ? "收起" : "显示更多"}
        </button>
      )}
    </>
  );
}

/** A name that opens a menu (c227f4d5e Jo / n_), on a click or a right click. */
function NameMenu({ name, tip, children }: { name: string; tip: string; children(close: () => void): ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <Popover
      open={open}
      onClose={close}
      anchor={
        <button
          type="button"
          className="rail-name"
          data-tip={tip}
          onClick={() => setOpen(!open)}
          onContextMenu={(event) => {
            event.preventDefault();
            setOpen(true);
          }}
        >
          {name}
        </button>
      }
    >
      {children(close)}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Cards

/**
 * The session's SSH host as environment/status reads it: on show, around each turn, on focus and
 * every 30 s while the window shows, as the 更改 card polls. Null outside an SSH session.
 */
function useSshStatus(connection: SshConnection | undefined, running: boolean): SshStatus | null {
  const [status, setStatus] = useState<SshStatus | null>(null);
  const key = connection?.id;
  useEffect(() => {
    if (!connection) return;
    let live = true;
    const read = () =>
      void sshStatus(connection).then(
        (next) => live && setStatus(next),
        (error) => live && setStatus({ status: "unknown", error: errorMessage(error) }),
      );
    read();
    const poll = () => document.visibilityState === "visible" && read();
    window.addEventListener("focus", read);
    const timer = window.setInterval(poll, 30_000);
    return () => {
      live = false;
      window.removeEventListener("focus", read);
      window.clearInterval(timer);
    };
  }, [key, running]); // eslint-disable-line react-hooks/exhaustive-deps
  return connection ? status : null;
}

type FolderGit = ThreadState["meta"]["gitInfo"];

/**
 * The card's other local folders' branch and origin (cf74bc599 _M: each folder's own repo links).
 * ponytail: read when the folders change; read again on focus if they switch branch mid-session.
 */
function useFolderGit(paths: string[]): Record<string, FolderGit> {
  const [known, setKnown] = useState<Record<string, FolderGit>>({});
  const key = paths.join("\n");
  useEffect(() => {
    let live = true;
    for (const path of key ? key.split("\n") : [])
      folderGitInfo(path).then((info) => live && setKnown((map) => ({ ...map, [path]: info })), () => {});
    return () => {
      live = false;
    };
  }, [key]);
  return known;
}

/**
 * 环境 (cf74bc599 RA environment, live 10-27; vM builds its rows): where the session runs, its
 * folders, the branch and Remote Control. The first row names the session's environment, else
 * 本电脑 (shared-20 Bq), its tooltip the session type with the plain place under it (c60746e70
 * Aa), an SSH host's state at its end (lj); a session in no environment ends it with 保存 (oS,
 * the picker row's place for 另存为环境), one in a local environment with 编辑环境 (c73f45bc3
 * nS, only for local ones: pu). Every folder's menu is c6314ba87 he's groups over that folder's
 * own git, with 更改文件夹… only on the working one (_M has none); Codex cannot add a folder to
 * a running session, so 添加文件夹… stays out. Codex's Remote Control is the app's, not the
 * session's, with no link for gj's menu. Project identity comes from this session
 * (its projectId, else the environment holding its folder, which also gave it its variables),
 * never the next-chat selection.
 */
function EnvironmentCard({ thread, fold }: { thread: ThreadState; fold: Fold }) {
  const remote = useStore((s) => s.remoteControl);
  const allowed = useStore((s) => s.requirements?.allowRemoteControl !== false);
  // Remote Control needs a ChatGPT login to turn on; turning it off stays open (setRemoteControl).
  const chatgpt = useStore((s) => s.account?.account?.type === "chatgpt");
  const [busy, setBusy] = useState(false);
  const id = thread.meta.id;
  const cwd = threadCwd(thread);
  const project = useStore((s) => thread.meta.projectId ? s.projects.find((project) => project.id === thread.meta.projectId) : projectFor(cwd));
  // An SSH environment's session works in its host's folders; the local cwd is not where it runs.
  const ssh = environmentOf(project).kind === "ssh" ? environmentOf(project).ssh : undefined;
  const connection = useSshConnections().find((c) => c.id === ssh?.connectionId);
  const running = !!activeTurn(thread);
  const hostStatus = useSshStatus(ssh ? connection : undefined, running);
  const state = ssh && sshStateLabel(connection ? hostStatus?.status : "unknown", running);
  const folders = ssh ? ssh.folders : [cwd, ...(project?.roots.map((root) => root.path) ?? [])]
    .filter((path, index, paths) => path && paths.findIndex((other) => samePath(other, path)) === index);
  // A session's own worktree is no folder to keep (Claude saves its origin, which Codex does not say).
  const savable = !project && !thread.meta.projectId && !!cwd && supports("project/create") && !inWorktreeRoot(cwd);
  const branch = thread.meta.gitInfo?.branch ?? null;
  const extraGit = useFolderGit(ssh ? [] : folders.filter((path) => !samePath(path, cwd)));
  const terminal = supports("process/spawn");
  const on = !!remote && remote.status !== "disabled";
  const details = [
    ...(project ? [ssh ? (connection?.host ?? "") : "本电脑"] : []),
    ...(connection?.port ? [`主机 · ${connection.host}:${connection.port}`] : []),
    ...(state ? [`状态 · ${hostStatus?.error ?? state.label}`] : []),
  ].filter(Boolean);
  const changeFolder = async () => {
    const pick = window.codexDesktop?.pickFolder;
    if (!pick) return setState({ dialog: { type: "folder", threadId: id } });
    try {
      const path = await pick(cwd);
      if (path) await changeThreadFolder(id, path);
    } catch (error) {
      toast("warning", "无法打开文件夹选择器", errorMessage(error));
    }
  };
  // he: [在资源管理器中显示, repository link] / [copy, 更改文件夹…] / [在终端中打开], each over its folder's git.
  const folderMenu = (path: string, own: boolean) => (close: () => void) => {
    const run = (action: () => void) => closing(close, action);
    const git = own ? thread.meta.gitInfo : extraGit[path];
    const github = githubRemote(git?.originUrl);
    const folderBranch = git?.branch;
    const copyPath = run(() => copied(path, "路径已复制到剪贴板。"));
    return (
      <>
        {!ssh && (
          <MenuItem
            label="在资源管理器中显示"
            onClick={run(() => void revealFile(path).then((ok) => ok || toast("warning", "无法在资源管理器中显示此项。该项可能已删除或已移动。")))}
          />
        )}
        {github && (
          <MenuItem
            label={github.host === "github.com" ? "在 GitHub 上打开仓库" : `在 ${github.host} 上打开仓库`}
            onClick={run(() => window.open(`https://${github.host}/${github.repo}`, "_blank", "noopener"))}
          />
        )}
        {(!ssh || github) && <MenuSep />}
        {folderBranch ? (
          <Submenu label="复制">
            <MenuItem label="路径" onClick={copyPath} />
            <MenuItem label="分支名称" onClick={run(() => copied(folderBranch, "分支名称已复制到剪贴板。"))} />
          </Submenu>
        ) : (
          <MenuItem label="复制路径" onClick={copyPath} />
        )}
        {own && !ssh && <MenuItem label="更改文件夹…" onClick={run(() => void changeFolder())} />}
        {terminal && !ssh && (
          <>
            <MenuSep />
            <MenuItem label="在终端中打开" onClick={run(() => openTerminalTab(id, path))} />
          </>
        )}
      </>
    );
  };
  return (
    <Card id="environment" summary={basename(folders[0] ?? cwd) || branch} fold={fold}>
      <div className="rail-row" data-tip-group="" data-tip={ssh ? "SSH 会话" : "本地会话"} data-tip-detail={details.join("\n") || undefined}>
        <span className="rail-icon">
          <Icon name={ssh ? "CommandLine" : "Laptop"} size="sm" />
        </span>
        <span className="rail-label">{project?.name || "本电脑"}</span>
        {state && (
          <span className="rail-meta" data-danger={state.danger}>
            {state.label}
          </span>
        )}
        {savable && (
          <button type="button" className="link-btn rail-save" aria-label="另存为环境" onClick={() => setState({ dialog: { type: "createProject", cwd, threadId: id } })}>
            保存
          </button>
        )}
        {project && !ssh && supports("project/update") && (
          <Button variant="ghost" size="xs" icon={<Icon name="Settings" size="xs" />} label="编辑环境" onClick={() => setState({ dialog: { type: "editProject", projectId: project.id } })} />
        )}
      </div>
      {folders.map((path) => <div key={path} className="rail-row" data-tip-group="">
        <span className="rail-icon">
          <Icon name="Folder" size="sm" />
        </span>
        <NameMenu name={basename(path)} tip={`${ssh ? (path === ssh.folders[0] ? "主机上的工作文件夹" : "主机上的文件夹") : samePath(path, cwd) ? "工作文件夹" : "附加文件夹"}\n${path}`}>
          {folderMenu(path, ssh ? path === ssh.folders[0] : samePath(path, cwd))}
        </NameMenu>
        {!ssh && samePath(path, cwd) && <><span className="rail-dot" aria-hidden="true">
          ·
        </span>
        <span className="rail-path">{parentDir(path)}</span></>}
      </div>)}
      {branch && (
        <div className="rail-row" data-tip-group="">
          <span className="rail-icon">
            <Icon name="GitBranch" size="sm" />
          </span>
          <NameMenu name={branch} tip={`分支\n${branch}`}>
            {(close) => (
              <>
                <MenuItem label="复制分支名称" onClick={closing(close, () => copied(branch, "分支名称已复制到剪贴板。"))} />
                {terminal && (
                  <>
                    <MenuSep />
                    <MenuItem label="在终端中打开" onClick={closing(close, () => openTerminalTab(id, cwd))} />
                  </>
                )}
              </>
            )}
          </NameMenu>
        </div>
      )}
      {remote && allowed && (
        <label className="rail-row">
          <span className="rail-icon">
            <Icon name="Cursor" size="sm" />
          </span>
          <span className="rail-label">Remote Control</span>
          {remote.status === "connecting" && <Spinner size={12} label="正在连接" />}
          <Toggle
            checked={on}
            label="Remote Control"
            disabled={busy || (!chatgpt && !on)}
            onChange={(next) => {
              setBusy(true);
              setRemoteControl(next)
                .catch(fail("无法切换 Remote Control。请重试。"))
                .finally(() => setBusy(false));
            }}
          />
        </label>
      )}
    </Card>
  );
}

/**
 * The turns a goal has run, "尚未检查" until one ends (cf74bc599 fj). Claude counts the times its
 * goal's condition was checked, once per turn end; Codex keeps no count, so the turns that ended
 * after the goal was set stand in for it.
 */
function goalTurns(thread: ThreadState, since: number): string {
  const turns = thread.turns.filter((turn) => turn.status !== "inProgress" && turn.startedAt !== null && turn.startedAt >= since).length;
  return turns === 0 ? "尚未检查" : `${turns.toLocaleString("zh-CN")} 轮`;
}

/** Whether a goal's text was cut when last shown (cf74bc599 BA cutWhenLastShown), by thread and goal. */
const goalCuts = new Map<string, boolean>();

/**
 * 目标 (cf74bc599 pj / fj / cA): Codex's goal and a footnote, two lines each until 显示更多,
 * which shows while either is cut (and at once when the goal was cut last time). The summary and
 * the footnote's head are the turns it has run; Codex's state, spend and time follow in the
 * footnote. A goal that is cleared or complete (Claude's met) fades out. The pencil (on hover or
 * focus) puts `/goal …` in the composer only when it is empty, its text on one line and cut at
 * 4000 characters; pausing and clearing stay in the Plan pane.
 */
function GoalCard({ thread, fold }: { thread: ThreadState; fold: Fold }) {
  const live = thread.goal && thread.goal.status !== "complete" ? thread.goal : null;
  const [goal, setGoal] = useState(live);
  if (live && live !== goal) setGoal(live);
  const drop = useCallback(() => setGoal(null), []);
  const key = goal ? `${thread.meta.id}:${goal.createdAt}` : "";
  const [more, setMore] = useState(false);
  const [cut, setCut] = useState(() => goalCuts.get(key) ?? false);
  const objective = useRef<HTMLElement>(null);
  const footnote = useRef<HTMLElement>(null);
  const turns = goal ? goalTurns(thread, goal.createdAt) : "";
  const meta = goal
    ? [
        turns,
        GOAL_LABELS[goal.status],
        `${formatTokens(goal.tokensUsed)}${goal.tokenBudget ? ` / ${formatTokens(goal.tokenBudget)}` : ""} tokens`,
        goal.timeUsedSeconds ? formatDuration(goal.timeUsedSeconds * 1000) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  useLayoutEffect(() => {
    if (more || !objective.current || !footnote.current) return;
    const over = (el: HTMLElement) => el.scrollHeight > el.clientHeight + 1;
    const now = over(objective.current) || over(footnote.current);
    goalCuts.set(key, now);
    setCut(now);
  }, [key, goal?.objective, meta, more, fold.open]);
  if (!goal) return null;
  const editText = goal.objective.replace(/\s+/g, " ").trim().slice(0, 4000);
  const edit = () => {
    const outcome = prefillEmptyComposer(`/goal ${editText}`);
    if (outcome === "has_draft") toast("warning", "消息框中有草稿时无法编辑目标。您可以先发送或清空草稿。");
    else if (outcome === "unavailable") toast("warning", "消息框准备就绪前无法编辑目标。请稍后重试。");
  };
  return (
    <Card id="goal" summary={turns} fold={fold} leaving={!live} onLeft={drop}>
      <div className="rail-goal">
        <div className="rail-goal-text" dir="auto">
          <bdi ref={objective} className="rail-goal-objective" data-clamped={!more || undefined}>
            {goal.objective}
          </bdi>
          <bdi ref={footnote} className="rail-goal-meta" data-clamped={!more || undefined}>
            {meta}
          </bdi>
        </div>
        {editText && <Button variant="ghost" size="xs" className="rail-goal-edit" icon={<Icon name="Edit" size={16} />} label="编辑目标" onClick={edit} />}
      </div>
      {(cut || more) && (
        <button type="button" className="rail-more" aria-expanded={more} onKeyDown={swallowRepeat} onClick={() => setMore(!more)}>
          {more ? "收起" : "显示更多"}
        </button>
      )}
    </Card>
  );
}

/**
 * The last read of each thread's context parts (lib/context.ts), kept when the card folds or the
 * session changes, as Claude keeps its get_context_usage answers (c5da7eb42 TF). A read that finds
 * none keeps the parts it had, stale; `midTurn` parts were read while a turn ran, and a compaction
 * newer than `compaction` outdates them. A read in flight is not asked again.
 */
interface ContextRead {
  parts: ContextParts | null;
  /** When the parts were read. */
  at: number;
  /** When the last read settled, with parts or without. */
  settled: number;
  stale: boolean;
  midTurn: boolean;
  compaction: string | null;
}

const contextReads = new Map<string, ContextRead>();
const contextReading = new Set<string>();
const contextListeners = new Set<() => void>();
let contextVersion = 0;

function subscribeContext(listener: () => void) {
  contextListeners.add(listener);
  return () => void contextListeners.delete(listener);
}

function contextChanged() {
  contextVersion += 1;
  for (const listener of contextListeners) listener();
}

function readContext(id: string, rollout: string, running: boolean, compaction: string | null): void {
  if (contextReading.has(id)) return;
  contextReading.add(id);
  contextChanged();
  void readContextParts(rollout)
    .catch(() => null)
    .then((parts) => {
      const kept = contextReads.get(id);
      const now = Date.now();
      contextReads.set(id, parts || !kept?.parts ? { parts, at: now, settled: now, stale: false, midTurn: running, compaction } : { ...kept, settled: now, stale: true, compaction });
      contextReading.delete(id);
      contextChanged();
    });
}

function lastCompaction(turns: ThreadState["turns"]): string | null {
  const compaction = (item: { type: string }) => item.type === "contextCompaction";
  return turns.findLast((turn) => turn.items.some(compaction))?.items.findLast(compaction)?.id ?? null;
}

/** c82492f2c fr: how long after a turn ends parts read during it still say they refresh then. */
const SETTLE_MS = 20_000;

/**
 * The thread's context parts, read when Claude asks a local session's get_context_usage (c82492f2c
 * Cr / ht, c5da7eb42 TF): when the card shows with none (folded too: Claude keeps it mounted), as a
 * compaction outdates them or a turn they were read in ends; when it opens, unless a read settled
 * in the last 5 s; when the pointer or focus comes to it with none, stale or older than a
 * compaction, even while a turn runs. Nothing else reads during a turn, and when the window shows
 * again or the app-server is back, only when there are none or they are stale (no polling). `settling` holds for 20 s after the turn
 * a read happened in ends, until a newer read lands (c82492f2c pr).
 */
function useContextParts(thread: ThreadState, open: boolean, running: boolean) {
  useSyncExternalStore(subscribeContext, () => contextVersion);
  const connected = useStore((s) => s.conn.status === "ready");
  const id = thread.meta.id;
  const rollout = thread.meta.path ?? null;
  const compaction = lastCompaction(thread.turns);
  const kept = contextReads.get(id);
  const reading = contextReading.has(id);
  const idle = !!rollout && !running && connected;
  const outdated = !kept?.parts || kept.stale;
  const settledLately = () => !!kept && Date.now() - kept.settled < 5_000;
  const read = useEffectEvent(() => {
    if (rollout) readContext(id, rollout, running, compaction);
  });

  // A turn's end: when it ended, so parts read before then can be told apart.
  const [ended, setEnded] = useState<{ id: string; at: number } | null>(null);
  const [wasRunning, setWasRunning] = useState(running);
  if (wasRunning !== running) {
    setWasRunning(running);
    if (!running) setEnded({ id, at: Date.now() });
  }
  const endedAt = ended?.id === id ? ended.at : 0;
  const [settleOver, setSettleOver] = useState(0);
  const settling = !running && !!kept?.parts && kept.midTurn && kept.at < endedAt && settleOver < endedAt;
  useEffect(() => {
    if (!settling || reading) return;
    const timer = window.setTimeout(() => setSettleOver(endedAt), SETTLE_MS - (Date.now() - endedAt));
    return () => window.clearTimeout(timer);
  }, [settling, reading, endedAt]);

  useEffect(() => {
    // Once after a turn its parts were read in: a read that settled since ends it, parts or not.
    if (idle && (kept?.compaction !== compaction || (kept?.midTurn && kept.settled < endedAt))) read();
  }, [idle, kept, compaction, endedAt]);

  useEffect(() => {
    if (!idle || !outdated) return;
    read();
    const shown = () => document.visibilityState === "visible" && read();
    document.addEventListener("visibilitychange", shown);
    return () => document.removeEventListener("visibilitychange", shown);
  }, [idle, outdated]);

  const unopened = useRef(true);
  useEffect(() => {
    if (!open) {
      unopened.current = true;
      return;
    }
    if (!idle || reading) return;
    const first = unopened.current;
    unopened.current = false;
    if (first && !settledLately()) read();
  }, [open, idle, reading]);

  // Even while a turn runs: such parts say when they were read until a read after the turn.
  const intent = () => {
    if (rollout && connected && !settledLately() && (outdated || kept?.compaction !== compaction)) read();
  };
  return { kept, reading: reading && !kept, intent, settling, compaction };
}

const legendPercent = new Intl.NumberFormat("zh-CN", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const meterShare = new Intl.NumberFormat("zh-CN", { style: "percent", maximumSignificantDigits: 2 });
const meterOffset = (share: number) => Number((share * 100).toFixed(3));

/**
 * Claude's stacked meter at size sm (c91b6e9db L): 4px over the free-space tint, the parts side by
 * side with a 1px seam, each with its own tooltip, the whole read out as an image whose tooltip
 * lists them.
 */
function ContextMeter({ breakdown }: { breakdown: Breakdown }) {
  const { meter, total } = breakdown;
  const entries = meter.map((segment) => `${segment.name}: ${formatTokens(segment.tokens)}, ${meterShare.format(segment.tokens / total)}`);
  let start = 0;
  return (
    <div className="rail-stack" data-tip-group="" role="img" tabIndex={0} aria-label={`上下文窗口: ${entries.join("; ")}`} data-tip={entries.join("\n")}>
      {meter.map((segment, index) => {
        const from = start;
        start += segment.tokens / total;
        const seam = index === 0 ? 0 : 1;
        return (
          <span
            key={segment.id}
            data-tip={entries[index]}
            style={{ insetInlineStart: `calc(${meterOffset(from)}% + ${seam}px)`, width: `calc(${meterOffset(segment.tokens / total)}% - ${seam}px)`, background: segment.color }}
          />
        );
      })}
    </div>
  );
}

type Press = { hint: string; onPress(): void };

/**
 * A row that does something (c2d611398 J, c227f4d5e dB): the row as a button with its hint read out
 * after it; a legend row also shows it as the tooltip, a list row does not (ve).
 */
function PressRow({ press, tip = false, children }: { press: Press; tip?: boolean; children: ReactNode }) {
  return (
    <button type="button" className="rail-legend-row rail-legend-press" data-tip={tip ? press.hint : undefined} onClick={press.onPress}>
      {children}
      <span className="sr-only">{press.hint}</span>
    </button>
  );
}

/** 管理连接器 (c73f45bc3 sS): Codex keeps every MCP server under 设置 › 连接器 › MCP. */
const CONNECTORS: Press = { hint: "管理连接器", onPress: () => openSettings("connectors", "setting-connectors-mcp") };

/**
 * What a legend row does (c73f45bc3 sS): MCP tools and MCP server instructions open 设置 › 连接器,
 * Skills the Skills page, Memory files 设置 › 记忆 when Codex's memories are among them and
 * otherwise unfold their list. Codex has no custom agents.
 */
function legendPress(row: LegendRow, memories: boolean, reveal: () => void): Press | null {
  if (row.deferred) return null;
  if (row.name === "MCP tools" || row.name === "MCP server instructions") return CONNECTORS;
  if (row.name === "Skills") return { hint: "管理 Skills", onPress: () => openSettings("skills") };
  if (row.name === "Memory files") return memories ? { hint: "编辑记忆文件", onPress: () => openSettings("memory", "setting-memory-files") } : { hint: "查看记忆文件", onPress: reveal };
  return null;
}

/**
 * What a list row does (c73f45bc3 sS mcpToolActionOf, ce96f5751 Q): an MCP tool opens its own
 * server in 设置 › 连接器 (the ChatGPT apps open the page), a memory file opens in the 文件 pane and
 * Codex's memories open 设置 › 记忆.
 */
function listPress(row: Row): Press | null {
  if (row.server === "codex_apps") return CONNECTORS;
  if (row.server) return { hint: "管理连接器", onPress: () => openConnector(row.server!) };
  if (row.path) return { hint: "打开文件", onPress: () => openFile(row.path!) };
  if (row.memories) return { hint: "编辑记忆文件", onPress: () => openSettings("memory", "setting-memory-files") };
  return null;
}

/** A legend row (c2d611398 ce): swatch, name, tokens and share of the window; a part outside it reads —. */
function LegendItem({ row, window, press }: { row: LegendRow; window: number; press: Press | null }) {
  const cells = (
    <>
      <span className="rail-legend-lead">
        <span className="rail-swatch" style={{ background: row.color }} />
      </span>
      <span className="rail-legend-name">{row.name}</span>
      <span className="rail-legend-tokens">{formatTokens(row.tokens)}</span>
      <span className="rail-legend-pct">{row.deferred ? "—" : legendPercent.format(row.tokens / window)}</span>
    </>
  );
  return press ? (
    <PressRow press={press} tip>
      {cells}
    </PressRow>
  ) : (
    <div className="rail-legend-row" data-deferred={row.deferred || undefined}>
      {cells}
    </div>
  );
}

/** A list row's name, its full text as the tooltip once it is cut (ce96f5751 ae). */
function ListName({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setCut(el.scrollWidth > el.clientWidth);
  }, [name]);
  return (
    <span ref={ref} className="rail-legend-name" data-tip={cut ? name : undefined}>
      {name}
    </span>
  );
}

/**
 * A folded list under the legend (ce96f5751 se, rail): its count, then a row per item, each one a
 * button when it leads somewhere (listPress); past 12 it scrolls. It stays as it was last left,
 * like the cards (the user's choice; Claude's starts folded each time).
 */
function LegendList({ id, label, rows, ref }: { id: string; label: string; rows: Row[]; ref?: RefObject<HTMLButtonElement | null> }) {
  const key = `context/${id}`;
  const open = useSections().open[key] ?? false;
  const presses = rows.map(listPress);
  return (
    <div className="rail-legend-list">
      <button ref={ref} type="button" className="rail-legend-toggle" aria-expanded={open} onClick={() => keepOpen({ [key]: !open })}>
        <span className="rail-legend-lead">
          <Icon name="CaretRight" size="xs" className="rail-legend-caret" />
        </span>
        <span className="rail-legend-name">{label}</span>
        <span className="rail-legend-pct">{rows.length.toLocaleString("zh-CN")}</span>
      </button>
      {open && (
        <div className="rail-legend-rows" data-scroll={rows.length > 12 || undefined} data-press={presses.some(Boolean) ? "" : undefined}>
          {rows.map((row, index) => {
            const cells = (
              <>
                <span className="rail-legend-lead" />
                <ListName name={row.name} />
                <span className="rail-legend-tokens">{formatTokens(row.tokens)}</span>
                <span className="rail-legend-pct" />
              </>
            );
            const press = presses[index];
            return press ? (
              <PressRow key={`${row.name}-${index}`} press={press}>
                {cells}
              </PressRow>
            ) : (
              <div key={`${row.name}-${index}`} className="rail-legend-row">
                {cells}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 上下文 (c73f45bc3 lS / uS → c82492f2c Cr → c2d611398 I, layout "rail"): the headline (已使用 n%
 * · used / max) over the stacked meter, then the legend (the parts in the window, 自上次更新以来,
 * the auto-compact buffer and free space, then what waits outside it), the MCP 工具 and 记忆文件
 * lists, the compact row from 50%. The headline follows the live count; the meter and legend are
 * the last read's (useContextParts), what the count has grown since being 自上次更新以来. A session
 * Codex has not reported on since it was opened shows the last read's count instead. When the
 * read is stale, or was taken during a turn that is still running (or ended under 20 s ago), a
 * note says when it was taken. Until there is a read, or for a thread without a rollout, the meter
 * is the plain bar, and once no read is due outside a turn, 发送一条消息以查看明细。 says why.
 * Rows that lead somewhere are buttons. Folded, the summary is the percentage with a small meter
 * (cdbb20c70 je rollup).
 */
function ContextCard({ thread, fold }: { thread: ThreadState; fold: Fold }) {
  const running = !!activeTurn(thread);
  const { kept, reading, intent, settling, compaction } = useContextParts(thread, fold.open, running);
  const parts = kept?.parts ?? null;
  const context = useContextUsage(thread, parts && { used: parts.usedTokens, max: parts.windowTokens });
  const { pct } = context;
  const connected = useStore((s) => s.conn.status === "ready");
  // Deferred MCP tools are sized from their definitions: the inventory (2-3 MB) loads on first need.
  const inventory = useStore((s) => s.mcp);
  const needsTools = fold.open && !!parts && Object.keys(thread.mcp).length > 0;
  useEffect(() => {
    if (needsTools && inventory === null) void refreshMcp();
  }, [needsTools, inventory]);
  const mcpTools = useMemo(
    () =>
      (inventory ?? [])
        .filter((server) => thread.mcp[server.name])
        .flatMap((server) =>
          Object.values(server.tools).flatMap((tool) =>
            tool ? [{ name: `${server.name === "codex_apps" ? "应用" : server.name} · ${tool.title || tool.name}`, tokens: mcpToolTokens(server.name, tool), server: server.name }] : [],
          ),
        ),
    [inventory, thread.mcp],
  );
  const window = context.max ?? parts?.windowTokens ?? null;
  // c2d611398 Le: the live count goes in once it has a share of the window.
  const breakdown = parts && window ? contextBreakdown(parts, window, context.compactAt, mcpTools, pct === null || context.outdated ? null : context.used) : null;
  // A thread with a rollout and no read yet is due one (Le reportDue).
  const due = !kept && !!thread.meta.path;
  // c82492f2c je: when the breakdown is from, while it is stale or from a turn not over yet.
  const staleSince = parts && (kept!.stale || (kept!.midTurn && (running || settling))) ? kept!.at : null;
  // ce96f5751 reveal: unfold the list, bring it into view and focus its toggle.
  const memoryToggle = useRef<HTMLButtonElement>(null);
  const revealMemory = () => {
    flushSync(() => keepOpen({ "context/memory": true }));
    memoryToggle.current?.parentElement?.scrollIntoView({ block: "nearest" });
    memoryToggle.current?.focus({ preventScroll: true });
  };
  // c82492f2c Z6 / c1958b152: a read no older than the last compaction, none under way.
  const compacting = !!activeTurn(thread)?.items.some((item) => item.type === "contextCompaction");
  const compactable = context.canCompact && !compacting && !(context.outdated && kept?.compaction !== compaction);
  const blocked = !connected ? "重新连接后可用" : running ? "Codex 完成本轮回复后可用" : undefined;
  const hintId = useId();
  const compactButton = useRef<HTMLButtonElement>(null);
  // c2d611398 B: a compact button that turns disabled under focus hands it to the rail.
  useEffect(() => {
    const button = compactButton.current;
    if (blocked && button && document.activeElement === button) button.closest<HTMLElement>('[tabindex="-1"]')?.focus({ preventScroll: true });
  }, [blocked]);
  const summary = context.noData ? undefined : pct === null ? context.summary : (
    <span className="rail-rollup">
      <span>{pct}%</span>
      <span className="rail-meter" aria-hidden="true">
        <span data-level={context.level} style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
    </span>
  );
  const at = staleSince === null ? null : new Date(staleSince);
  return (
    <Card id="context" summary={summary} fold={fold} onIntent={intent}>
      {context.noData ? (
        <p className={`rail-note${reading ? " rail-loading" : ""}`}>{reading ? <ContextLoading /> : "发送消息即可查看上下文用量。"}</p>
      ) : (
        <div className="rail-context">
          <div className="rail-context-head">
            {pct !== null && <span>已使用 {pct}%</span>}
            <span className="rail-context-value">{context.summary}</span>
          </div>
          {breakdown ? (
            <ContextMeter breakdown={breakdown} />
          ) : (
            <div
              className="usage-bar"
              role="progressbar"
              aria-label="上下文窗口"
              aria-valuenow={pct ?? undefined}
              aria-valuetext={pct === null ? context.summary : undefined}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              {pct !== null && <span data-level={context.level} style={{ width: `${Math.min(100, pct)}%` }} />}
            </div>
          )}
        </div>
      )}
      {breakdown && window && (
        <div className="rail-legend">
          <div className="rail-legend-group">
            {breakdown.legend
              .filter((row) => !row.deferred)
              .map((row) => (
                <LegendItem key={row.id} row={row} window={window} press={legendPress(row, !!parts?.memory, revealMemory)} />
              ))}
          </div>
          {breakdown.legend.some((row) => row.deferred) && (
            <div className="rail-legend-group">
              {breakdown.legend
                .filter((row) => row.deferred)
                .map((row) => (
                  <LegendItem key={row.id} row={row} window={window} press={null} />
                ))}
            </div>
          )}
          {breakdown.lists.length > 0 && (
            <div className="rail-legend-group">
              {breakdown.lists.map((list) => (
                <LegendList key={list.key} id={list.key} label={list.label} rows={list.rows} ref={list.key === "memory" ? memoryToggle : undefined} />
              ))}
            </div>
          )}
        </div>
      )}
      {compactable && (
        <div className="rail-compact">
          {context.compactHint && (
            <span id={hintId} className="rail-compact-hint">
              {context.compactHint}
            </span>
          )}
          <Button
            ref={compactButton}
            size="xs"
            disabled={!!blocked}
            tip={blocked}
            aria-describedby={context.compactHint ? hintId : undefined}
            onClick={() => compactThread(thread.meta.id).catch(fail("压缩失败"))}
          >
            压缩会话
          </Button>
        </div>
      )}
      {at && (
        <p className="rail-note rail-context-note">
          {running || settling ? "上次更新于 " : "上次更新："}
          <time dateTime={at.toISOString()} data-tip={at.toLocaleString("zh-CN")}>
            {timeAgo(staleSince! / 1000)}
          </time>
          {running || settling ? "。本轮回复结束后将刷新。" : "。发送消息即可刷新。"}
        </p>
      )}
      {reading && !breakdown && !context.noData && (
        <p className="rail-note rail-context-note rail-loading">
          <ContextLoading />
        </p>
      )}
      {!context.noData && !parts && !reading && !due && !running && <p className="rail-note rail-context-note rail-loading">发送一条消息以查看明细。</p>}
    </Card>
  );
}

/** c2d611398 L: the loading line, its spinner after a beat. */
function ContextLoading() {
  return (
    <>
      <Spinner size={12} />
      <span>正在加载上下文明细…</span>
    </>
  );
}

/**
 * The icon an MCP server advertises (serverInfo.icons: { src, theme? }), the one for the current
 * theme first. Only data: images: the page's CSP (server/serve.mjs img-src) keeps remote ones out.
 */
function serverIcon(icons: unknown[] | null | undefined): string | undefined {
  const dark = document.documentElement.classList.contains("dark") ? "dark" : "light";
  type McpIcon = { src: string; theme?: unknown };
  const usable = (icons ?? []).filter((icon): icon is McpIcon => String((icon as McpIcon | null)?.src).startsWith("data:image/"));
  return (usable.find((icon) => icon.theme === dark) ?? usable.find((icon) => !icon.theme) ?? usable[0])?.src;
}

/** uD: the server's own icon, or the connectors glyph when it has none or it fails to load. */
function ServerIcon({ src }: { src: string | undefined }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <Icon name="Connectors" size="sm" />;
  return <img className="rail-server-icon" src={src} alt="" onError={() => setBroken(true)} />;
}

/** What a connector row says after its name (cf74bc599 QA / ZA). */
type ConnectorState = "auth" | "failed" | "unavailable" | undefined;

const connectorState = (runtime: McpRuntime): ConnectorState =>
  runtime.status === "failed" ? (runtime.failureReason === "reauthenticationRequired" ? "auth" : "failed") : runtime.status === "cancelled" ? "unavailable" : undefined;

/**
 * 连接器 (cf74bc599 QA, c9081d688 v, c60746e70 ga): every MCP server this session started, the
 * ones to reconnect first, then by name (the server's own title, codex_apps as 应用), three before
 * 显示更多. A server that failed reads 重新连接 and one that needs signing in again 验证身份, both
 * in the warning tone; a cancelled one reads 不可用. The summary is how many to reconnect while any
 * are, else how many are connected (those still starting count). 验证身份 signs in from the row;
 * the other rows open the server in 设置 › 连接器 (the ChatGPT apps open the page). Hidden while
 * the session has none.
 */
function ConnectorsCard({ thread, fold }: { thread: ThreadState; fold: Fold }) {
  const inventory = useStore((s) => s.mcp);
  const entries = Object.entries(thread.mcp);
  const count = entries.length;
  useEffect(() => {
    if (fold.open && count > 0 && inventory === null) void refreshMcp();
  }, [fold.open, count, inventory]);
  if (count === 0) return null;
  const servers = entries
    .map(([name, runtime]) => {
      const info = inventory?.find((server) => server.name === name)?.serverInfo;
      return { name, state: connectorState(runtime), label: name === "codex_apps" ? "应用" : info?.title || name, icon: serverIcon(info?.icons) };
    })
    .sort((a, b) => Number(b.state === "auth" || b.state === "failed") - Number(a.state === "auth" || a.state === "failed") || a.label.localeCompare(b.label, "zh-CN"));
  const reconnect = servers.filter((server) => server.state === "auth" || server.state === "failed").length;
  const unavailable = servers.filter((server) => server.state === "unavailable").length;
  const open = (server: (typeof servers)[number]) => {
    if (server.state === "auth") void loginMcpServer(server.name, thread.meta.id).catch(fail("登录失败"));
    else if (server.name === "codex_apps") openSettings("connectors");
    else openConnector(server.name);
  };
  return (
    <Card id="connectors" summary={reconnect > 0 ? `${reconnect} 项待重新连接` : `已连接 ${count - unavailable} 个`} fold={fold}>
      <Limited items={servers} limit={3}>
        {(server) => (
          <button key={server.name} type="button" className="rail-row" onClick={() => open(server)}>
            <span className="rail-icon">
              <ServerIcon key={server.icon} src={server.icon} />
            </span>
            <span className="rail-label">{server.label}</span>
            {server.state && (
              <span className="rail-meta" data-warning={server.state !== "unavailable" || undefined}>
                {server.state === "auth" ? "验证身份" : server.state === "failed" ? "重新连接" : "不可用"}
              </span>
            )}
          </button>
        )}
      </Limited>
    </Card>
  );
}

/**
 * 输出 (cf74bc599 yA / SA / vA): the files the session made (lib/diff.ts outputFiles) less the
 * ones that are gone, asked again as each turn ends (c73f45bc3 Gx), five before 显示更多, the
 * count as the summary. A row shows the file's glyph and name, its path in the tooltip; it opens
 * the file in the 文件 pane, with Ctrl in its default app (c856385e2 ir), and a right click opens
 * the file menu. The card fades out once the list is empty.
 */
function OutputsCard({ thread, fold }: { thread: ThreadState; fold: Fold }) {
  const cwd = thread.settings?.cwd ?? thread.meta.cwd;
  const checkout = !!thread.meta.gitInfo;
  const made = useMemo(() => outputFiles(thread.turns, cwd, checkout), [thread.turns, cwd, checkout]);
  const ended = thread.turns.filter((turn) => turn.status !== "inProgress").length;
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const asked = made.join("\n");
  useEffect(() => {
    let live = true;
    void goneFiles(made).then((found) => live && setGone(found));
    return () => {
      live = false;
    };
  }, [asked, ended]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = useMemo(() => (gone.size ? made.filter((path) => !gone.has(path)) : made), [made, gone]);
  const [files, setFiles] = useState(current);
  if (current.length > 0 && current !== files) setFiles(current);
  const drop = useCallback(() => setFiles([]), []);
  if (files.length === 0) return null;
  return (
    <Card id="outputs" summary={files.length.toLocaleString("zh-CN")} fold={fold} leaving={current.length === 0} onLeft={drop}>
      <Limited items={files} limit={5}>
        {(path) => (
          <button
            key={path}
            type="button"
            className="rail-row"
            data-tip={basename(path)}
            data-tip-detail={path}
            onClick={(event) => openFileFrom(event, path)}
            onContextMenu={(event) => {
              event.preventDefault();
              openFileMenu({ path, surface: "transcript" }, menuPoint(event));
            }}
          >
            <span className="rail-icon">
              <Icon name={fileGlyph(path)} size="sm" />
            </span>
            <span className="rail-label">{basename(path)}</span>
          </button>
        )}
      </Limited>
    </Card>
  );
}

/** What Claude's 提交更改 asks the session (c96d752d0 nze, pr_bar_commit). */
const COMMIT_ASK = "Commit the working tree changes with a sensible message.";

type CreateMode = "create" | "draft" | "compose";
/** The way 创建 PR goes, picked in the row's menu and kept across sessions (c227f4d5e _L). */
const CREATE_KEY = "codex-ui:pr-create-mode";
const CREATE_LABELS: Record<CreateMode | "commit", string> = { create: "创建 PR", draft: "创建草稿 PR", compose: "手动创建 PR", commit: "提交更改" };

const ask = (threadId: string, text: string) => sendMessage(threadId, [{ type: "text", text, text_elements: [] }]).catch(fail("发送失败"));

/** The running turn answers a create-pr ask: Claude holds 创建 PR busy until that turn ends (c96d752d0 uLe). */
const makingPr = (thread: ThreadState) =>
  !!activeTurn(thread)?.items.some((item) => item.type === "userMessage" && item.content.some((part) => part.type === "text" && promptLabel(part.text) !== part.text));

/**
 * gh's reads of the session PRs by attachment key, what went wrong the last time one failed, the
 * branch's other PRs (history) and the branch lookups that have answered (Claude's prAnswered),
 * shared by every 更改 card: the last answer stays up while the next read is under way, and a read
 * in flight is not asked again.
 */
const prReads = new Map<string, PrStatus>();
const prProblems = new Map<string, GhProblem>();
const prHistory = new Map<string, PrStatus[]>();
const lookedUp = new Set<string>();
const prReading = new Set<string>();
const prListeners = new Set<() => void>();
let prVersion = 0;

function subscribePrs(listener: () => void) {
  prListeners.add(listener);
  return () => void prListeners.delete(listener);
}

function prChanged() {
  prVersion += 1;
  for (const listener of prListeners) listener();
}

function readOnce(key: string, read: () => Promise<void>): void {
  if (prReading.has(key)) return;
  prReading.add(key);
  void read()
    .catch(() => undefined)
    .finally(() => {
      prReading.delete(key);
      prChanged();
    });
}

/** gh's sign-in and SSO problems also toast, once in six hours (ca6174065 Qo). */
const GH_WARNED_KEY = "codex-ui:gh-warned";

function noteProblem(key: string, problem: GhProblem | null) {
  if (!problem) return void prProblems.delete(key);
  prProblems.set(key, problem);
  if (problem.kind !== "auth" && problem.kind !== "sso") return;
  const warned = (readJson(GH_WARNED_KEY) ?? {}) as Record<string, number>;
  if (Date.now() - (warned[problem.kind] ?? 0) < 6 * 3_600_000) return;
  writePref(GH_WARNED_KEY, JSON.stringify({ ...warned, [problem.kind]: Date.now() }));
  toast("warning", ghProblemText(problem));
}

/** Reads one PR again and keeps what it found (or what went wrong). */
const readPrInto = (cwd: string, key: string, url: string) =>
  readOnce(key, async () => {
    const { status, problem } = await readPr(cwd, url);
    if (status) prReads.set(key, status);
    noteProblem(key, problem);
  });

/** 移除 on the changes row (cb1afaa4b Xn): that folder and branch's row stays hidden, across restarts. */
const DISMISSED_ROWS_KEY = "codex-ui:changes-dismissed";
const dismissedRows = () => new Set((readJson(DISMISSED_ROWS_KEY) as string[] | null) ?? []);

function dismissRow(key: string) {
  // ponytail: one key per dismissed folder and branch, never pruned; trim if it ever grows.
  writePref(DISMISSED_ROWS_KEY, JSON.stringify([...dismissedRows(), key]));
  prChanged();
}

/** 合并或关闭时自动归档 (ca6174065 Ji): by session; the session is archived once its PR is merged or closed. */
const AUTO_ARCHIVE_KEY = "codex-ui:pr-auto-archive";
const autoArchives = () => (readJson(AUTO_ARCHIVE_KEY) ?? {}) as Record<string, boolean>;
const archivedFor = new Set<string>();

function setAutoArchive(threadId: string, on: boolean) {
  const all = autoArchives();
  if (on) all[threadId] = true;
  else delete all[threadId];
  writePref(AUTO_ARCHIVE_KEY, JSON.stringify(all));
  prChanged();
}

/** Each state's glyph and name (c96d752d0 xLe, shared-18 Xw); its git tint is the CSS's. Codex's font has no merge-queue glyph: a queued PR takes the merge one, in the queue's tint. */
const PR_LOOKS: Record<PrLook, { icon: IconName; label: string }> = {
  open: { icon: "GitPullRequest", label: "打开" },
  draft: { icon: "GitPullRequestDraft", label: "草稿" },
  merged: { icon: "GitMergedSimple", label: "已合并" },
  closed: { icon: "GitPullRequestClosed", label: "已关闭" },
  approved: { icon: "CheckCircle", label: "已批准" },
  changesRequested: { icon: "XCircle", label: "已请求更改" },
  conflicting: { icon: "GitMergeConflict", label: "合并冲突" },
  queued: { icon: "GitMergedSimple", label: "排队中" },
};

/** CI as it is read out (c96d752d0 pB / nB). */
function ciLabel({ status, total, failed }: Ci): string {
  if (status === "failed") return `CI：${failed} 项检查失败`;
  if (status === "skipped") return `CI：已跳过 ${total} 项检查`;
  return { passed: "CI：所有检查均已通过", pending: "CI：检查进行中", unavailable: "CI：状态不可用" }[status];
}

/** The popover's counts (ca6174065 $r / ei): each kind with checks, its glyph, name and count. */
const CI_ROWS: { key: "failed" | "pending" | "passed" | "skipped"; icon: IconName; label: string }[] = [
  { key: "failed", icon: "XCircle", label: "失败" },
  { key: "pending", icon: "DotsCircle", label: "进行中" },
  { key: "passed", icon: "CheckCircle", label: "已通过" },
  { key: "skipped", icon: "StopCircle", label: "已跳过" },
];

/**
 * The branch's PR's CI (ca6174065 ni in the rail): a ghost xs button with 6px dot (tB), the
 * failing count in danger instead, or done/total while checks run. It opens Claude's checks
 * popover (Zr / $r), the rail's without toggles: 「CI 监控」 and the way to the checks on GitHub,
 * then the checks by kind, or none reported, cancelled.
 */
function CiButton({ url, ci }: { url: string; ci: Ci }) {
  const [open, setOpen] = useState(false);
  const label = ciLabel(ci);
  const state = ci.total === 0 ? "empty" : ci.passed + ci.failed + ci.pending + ci.skipped === 0 ? "cancelled" : "counts";
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="top-end"
      className="rail-ci-pop"
      anchor={
        <button type="button" className="btn btn-ghost btn-xs rail-ci" data-status={ci.status} aria-label={label} data-tip="CI 监控" data-tip-detail={label} onClick={() => setOpen(!open)}>
          {ci.status === "pending" ? <StatusDot kind="running" /> : ci.status !== "failed" && <span className="rail-ci-dot" />}
          {ci.status === "failed" ? `${ci.failed} 项失败` : ci.status === "pending" ? `${ci.total - ci.pending}/${ci.total}` : null}
        </button>
      }
    >
      <div className="rail-ci-head">
        <span>CI 监控</span>
        <Button variant="ghost" size="xs" icon={<Icon name="ArrowOutSquare" size="sm" />} label="在 GitHub 上打开检查" onClick={() => window.open(`${url}/checks`, "_blank", "noopener")} />
      </div>
      {state === "counts" ? (
        CI_ROWS.filter((row) => ci[row.key] > 0).map((row) => (
          <div key={row.key} className="rail-ci-count" data-kind={row.key}>
            <span>
              <Icon name={row.icon} size="sm" />
              {row.label}
            </span>
            <span className="rail-ci-number">{ci[row.key]}</span>
          </div>
        ))
      ) : (
        <p className="rail-ci-note">{state === "empty" ? "尚未报告任何检查。" : "检查已取消。"}</p>
      )}
    </Popover>
  );
}

/** A row's menu (c96d752d0 kLe): from its ⋮ (DotsVertical, bottom end) or a right click on the row (Qg). */
function useRowMenu(title: string, items: (close: () => void) => ReactNode) {
  const [dots, setDots] = useState(false);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const close = () => {
    setDots(false);
    setAt(null);
  };
  return {
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      setAt(menuPoint(event));
    },
    dots: (
      <Popover
        open={dots}
        onClose={close}
        placement="bottom-end"
        anchor={<Button variant="ghost" size="xs" icon={<Icon name="DotsVertical" size="sm" />} label={`${title} 的更多选项`} onClick={() => setDots(!dots)} />}
      >
        {items(close)}
      </Popover>
    ),
    pointer: at && (
      <PointerMenu at={at} onClose={close}>
        {items(close)}
      </PointerMenu>
    ),
  };
}

/** Lines added and removed as a button to the 更改 pane (dS in a ghost xxs button, "Open changes"). */
function ChangesButton({ added, removed, onClick }: { added: number; removed: number; onClick(): void }) {
  return (
    <button
      type="button"
      className="rail-name rail-changes"
      data-tip="打开更改"
      data-tip-kbd="Ctrl + Shift + D"
      aria-label={`打开更改，新增 ${added} 行，删除 ${removed} 行`}
      onClick={onClick}
    >
      <span className="plus">+{added.toLocaleString("zh-CN")}</span>
      <span className="minus">−{removed.toLocaleString("zh-CN")}</span>
    </button>
  );
}

/**
 * 合并 on the branch's PR (ca6174065 ia): where it is open, approved, passing, mergeable, not set to
 * merge on its own and not queued. A press reads the PR again (正在检查拉取请求…) and stops on
 * what changed (mergeBlock); otherwise it asks 合并拉取请求 #N？ with 取消 / 确认合并, which merges
 * only the head it checked, the repository's allowed way.
 */
function MergeAction({ cwd, prKey, url, number, repo, shown }: { cwd: string; prKey: string; url: string; number: number; repo: string | null; shown: PrStatus }) {
  const [phase, setPhase] = useState<"idle" | "checking" | "confirm" | "merging">("idle");
  const checked = useRef<PrStatus | null>(null);
  const check = async () => {
    setPhase("checking");
    const { status } = await readPr(cwd, url);
    if (!status) {
      setPhase("idle");
      return void toast("warning", "无法加载拉取请求，因此未执行合并。");
    }
    prReads.set(prKey, status);
    prChanged();
    const block = mergeBlock(status, shown.headSha);
    if (block) {
      setPhase("idle");
      return void toast("warning", block);
    }
    checked.current = status;
    setPhase("confirm");
  };
  const merge = async () => {
    const sha = checked.current?.headSha;
    if (!sha) return;
    setPhase("merging");
    const allowed = repo ? await runGh(cwd, mergeMethodCommand(repo)) : null;
    const done = await runGh(cwd, mergeCommand(url, allowed?.ok ? mergeMethod(allowed.stdout) : "--squash", sha), true);
    setPhase("idle");
    if (!done.ok) toast("warning", "无法合并拉取请求。", done.problem ? ghProblemText(done.problem) : undefined);
    readPrInto(cwd, prKey, url);
  };
  if (phase === "confirm" || phase === "merging")
    return (
      <div className="rail-pr-confirm" role="group" aria-label={`合并拉取请求 #${number}？`}>
        <span>合并拉取请求 #{number}？</span>
        <span className="spacer" />
        <Button size="xs" variant="ghost" disabled={phase === "merging"} onClick={() => setPhase("idle")}>
          取消
        </Button>
        <Button size="xs" variant="primary" disabled={phase === "merging"} icon={phase === "merging" ? <Spinner size={12} /> : undefined} onClick={() => void merge()}>
          确认合并
        </Button>
      </div>
    );
  return (
    <Button size="xs" disabled={phase === "checking"} icon={phase === "checking" ? <Spinner size={12} /> : undefined} onClick={() => void check()}>
      {phase === "checking" ? "正在检查拉取请求…" : "合并"}
    </Button>
  );
}

/** 标记为就绪 on a draft (ca6174065 Qi): gh pr ready, then a fresh read. */
function ReadyAction({ cwd, prKey, url }: { cwd: string; prKey: string; url: string }) {
  const [busy, setBusy] = useState(false);
  const ready = async () => {
    setBusy(true);
    const done = await runGh(cwd, readyCommand(url, false), true);
    setBusy(false);
    if (!done.ok) toast("warning", "无法将该拉取请求标记为可供审核。请重试或使用 GitHub。");
    readPrInto(cwd, prKey, url);
  };
  return (
    <Button size="xs" disabled={busy} icon={busy ? <Spinner size={12} /> : undefined} onClick={() => void ready()}>
      标记为就绪
    </Button>
  );
}

/**
 * A pull request (cb1afaa4b Xn over ca6174065 Lo, rail layout): its state's glyph, then its title
 * as the link with the row's ⋮ on one line and #N under it, then its open review threads, its CI
 * and its action (合并 / 标记为就绪); the branch's own PR also carries the changes. A merged or
 * queued PR shows none of those. Until gh answers, or without gh, the glyph is the plain one and the
 * branch stands in for the title; when gh failed, a warning says why. The menu opens it on GitHub,
 * copies the link, opens the changes and the review comments, turns an open PR back to a draft,
 * holds the settings (就绪时自动合并, and the session's 合并或关闭时自动归档) and
 * removes it from the session (Dismiss: thread/attachment/remove). Claude's auto-fix (its GitHub
 * App) stays out.
 */
function PrRow({ thread, pr, repo, changes, onChanges }: { thread: ThreadState; pr: AttachedPullRequest; repo: string | null; changes?: { added: number; removed: number }; onChanges(): void }) {
  const id = thread.meta.id;
  const cwd = thread.settings?.cwd ?? thread.meta.cwd;
  const link = parsePr(pr.url);
  const read = prReads.get(pr.key);
  const problem = prProblems.get(pr.key);
  const look = read?.look;
  const settled = read?.state === "merged" || read?.look === "queued";
  const live = read?.state === "open" || read?.state === "draft";
  const ci = live && !settled ? read.ci : undefined;
  const threads = live && !settled ? (read.openThreads ?? 0) : 0;
  const title = read?.title || (pr.branch ?? (link ? `${link.owner}/${link.repo}` : pr.url.replace(/^https:\/\//, "")));
  const host = new URL(pr.url).hostname;
  const comments = () => window.open(`${pr.url}/files`, "_blank", "noopener");
  const archiveOn = !!autoArchives()[id];
  const [autoMergeBusy, setAutoMergeBusy] = useState(false);
  const toggleAutoMerge = async (on: boolean) => {
    setAutoMergeBusy(true);
    const allowed = repo ? await runGh(cwd, mergeMethodCommand(repo)) : null;
    const done = await runGh(cwd, autoMergeCommand(pr.url, on, allowed?.ok ? mergeMethod(allowed.stdout) : "--squash"), true);
    setAutoMergeBusy(false);
    if (!done.ok) toast("warning", done.problem ? `无法更改自动合并：${ghProblemText(done.problem)}` : "无法在此处更改自动合并设置。");
    readPrInto(cwd, pr.key, pr.url);
  };
  const toDraft = async () => {
    const done = await runGh(cwd, readyCommand(pr.url, true), true);
    if (!done.ok) toast("warning", "无法将拉取请求转换为草稿。请重试或使用 GitHub。");
    readPrInto(cwd, pr.key, pr.url);
  };
  const menu = useRowMenu(title, (close) => (
    <>
      <MenuItem label={`在 ${host === "github.com" ? "GitHub" : host} 上打开`} onClick={closing(close, () => window.open(pr.url, "_blank", "noopener"))} />
      <MenuItem label="复制链接" onClick={closing(close, () => copied(pr.url, "链接已复制到剪贴板。"))} />
      {changes && !settled && <MenuItem label="查看更改" onClick={closing(close, onChanges)} />}
      {threads > 0 && <MenuItem label="打开审阅评论" onClick={closing(close, comments)} />}
      {read?.state === "open" && !settled && <MenuItem label="转为草稿" onClick={closing(close, () => void toDraft())} />}
      {live && !settled && (
        <>
          <MenuSep />
          <MenuItem
            label="就绪时自动合并"
            toggle
            checked={!!read?.autoMerge}
            disabled={autoMergeBusy || read?.state === "draft"}
            title={read?.state === "draft" ? "草稿 PR 无法使用自动合并。" : undefined}
            onClick={closing(close, () => void toggleAutoMerge(!read?.autoMerge))}
          />
          <MenuItem label="合并或关闭时自动归档" toggle checked={archiveOn} onClick={closing(close, () => setAutoArchive(id, !archiveOn))} />
        </>
      )}
      <MenuSep />
      <MenuItem label="移除" onClick={closing(close, () => removePullRequest(id, pr.key).catch(fail("移除失败")))} />
    </>
  ));
  const action =
    read && link && live && !settled ? (
      read.state === "draft" ? (
        <ReadyAction cwd={cwd} prKey={pr.key} url={pr.url} />
      ) : canMerge(read) ? (
        <MergeAction cwd={cwd} prKey={pr.key} url={pr.url} number={link.number} repo={repo} shown={read} />
      ) : null
    ) : null;
  return (
    <div className="rail-pr" onContextMenu={menu.onContextMenu}>
      <span className="rail-icon" role="img" aria-label={look ? PR_LOOKS[look].label : "拉取请求"} data-look={look}>
        <Icon name={look ? PR_LOOKS[look].icon : "GitPullRequest"} size="sm" bold />
      </span>
      <div className="rail-pr-body">
        <div className="rail-pr-title">
          <span>
            <a href={pr.url} target="_blank" rel="noopener">
              {title}
            </a>
          </span>
          {problem && (
            <span className="rail-pr-warn" role="img" aria-label={ghProblemText(problem)} data-tip={ghProblemText(problem)}>
              <Icon name="Warning" size="sm" />
            </span>
          )}
          {menu.dots}
        </div>
        {(link || changes || ci || action) && (
          <div className="rail-pr-meta" data-tip-group="">
            {link && <span>#{link.number}</span>}
            {changes && !settled && <ChangesButton {...changes} onClick={onChanges} />}
            {threads > 0 && (
              <button type="button" className="rail-name rail-pr-threads" aria-label={`打开审阅评论，${threads} 个未解决的讨论串`} data-tip="打开审阅评论" onClick={comments}>
                <Icon name="ChatSimple" size="xs" />
                {threads}
              </button>
            )}
            {(ci || action) && <span className="spacer" />}
            {ci && <CiButton url={pr.url} ci={ci} />}
            {action}
          </div>
        )}
      </div>
      {menu.pointer}
    </div>
  );
}

/** One of the branch's earlier PRs (ca6174065 Wi rows): its state's glyph, title and #N. */
function HistoryRow({ pr }: { pr: PrStatus }) {
  const link = parsePr(pr.url);
  return (
    <div className="rail-pr">
      <span className="rail-icon" role="img" aria-label={PR_LOOKS[pr.state].label} data-look={pr.state}>
        <Icon name={PR_LOOKS[pr.state].icon} size="sm" bold />
      </span>
      <div className="rail-pr-body">
        <div className="rail-pr-title">
          <span>
            <a href={pr.url} target="_blank" rel="noopener">
              {pr.title || pr.url}
            </a>
          </span>
        </div>
        {link && <div className="rail-pr-meta">#{link.number}</div>}
      </div>
    </div>
  );
}

/**
 * 更改 (cf74bc599 rD pullRequests, titled "Changes"; c73f45bc3 xb → cb1afaa4b Mr / Xn over the PR
 * bar ca6174065 in the rail's "row" layout): the working folder's changes on one row,
 * ChangesPlusMinus then the lines added and removed as a button to the 更改 pane. In a checkout
 * they are the pane's 所有更改 (gitDiffToRemote: the working tree with untracked files against
 * the closest commit on a remote), read on show, around each turn and when the window regains
 * focus; where that read fails (no remote) or there is no checkout, they are the session's latest
 * changes (本轮更改), as Claude falls back to the session's own edits.
 *
 * The row ends with Claude's action (yze): a checkout without a GitHub remote has 提交更改, which
 * asks Codex to commit (so does a detached HEAD); a GitHub one has 创建 PR, the way its menu last
 * picked: 创建 PR and 创建草稿 PR send the session Claude's create-pr ask, shown as /create-pr, and
 * stay busy while that turn runs; 手动创建 PR opens GitHub's compare page. While another turn runs
 * the action waits, and so it does while gh first looks for the branch's PR. The row's menu holds
 * 查看更改, the ways to create the PR (picking 创建 PR or 创建草稿 PR creates it at once, 手动创建
 * PR only becomes the way) and 移除, which hides the row for this folder and branch.
 *
 * The session's pull requests (thread attachments; Claude's bound PRs) follow, by what needs the
 * user most (prRank: the branch's open PR first), five before 再显示 N 个; the branch's own PR
 * takes the changes row's place and carries its changes. The branch's other PRs on GitHub fold
 * under N 个较早的拉取请求 · 已合并 N 项. gh reads the PRs, and looks up the branch's PR until one is
 * bound, on show, around each turn, on focus and every 30 s while the window shows, as Claude
 * polls; an open one it finds is bound. A session set to archive with its PR is archived once that
 * PR is seen going from open to merged or closed. Hidden while there is nothing to show.
 */
function ChangesCard({ thread, fold }: { thread: ThreadState; fold: Fold }) {
  const id = thread.meta.id;
  const cwd = thread.settings?.cwd ?? thread.meta.cwd;
  const git = !!thread.meta.gitInfo;
  const branch = thread.meta.gitInfo?.branch ?? null;
  const running = !!activeTurn(thread);
  const remote = useRemoteDiff(cwd);
  const latest = useMemo(() => thread.turns.map((turn) => turnFiles(turn, cwd)).findLast((files) => files.length > 0) ?? [], [thread.turns, cwd]);
  const [mode, setMode] = useState(() => readPref<CreateMode>(CREATE_KEY, ["create", "draft", "compose"], "create"));
  const [showAll, setShowAll] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    if (!git) return;
    const read = () => loadRemoteDiff(cwd);
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [cwd, git, running]);
  const checkout = git && remote?.status === "ready" ? remote : null;
  const files = checkout ? checkout.files : latest;
  const changes = files.length > 0 ? filesStats(files) : undefined;
  const github = githubRemote(thread.meta.gitInfo?.originUrl);
  // Read live (the store tells its readers a frame late), so the render a lookup's answer sets off
  // already holds the PR it bound.
  const attachments = useStore((s) => s.threads[id]?.attachments ?? null);
  const prs = pullRequests({ ...thread, attachments });
  const own = prs.find((pr) => branch !== null && pr.branch === branch);
  // The branch's PR lookup (Claude's prLookup) runs once the session's PRs are known, until one is
  // bound to the branch; gh would read a digits-only branch as a PR number.
  const repo = github && `${github.host}/${github.repo}`;
  const lookable = !!repo && !!branch && !own && !/^#?\d+$/.test(branch);
  const lookup = lookable && attachments !== null ? `${cwd}\0${repo}\0${branch}` : null;
  const historyKey = repo && branch && !/^#?\d+$/.test(branch) ? `history\0${repo}\0${branch}` : null;
  const bound = prs.map((pr) => `${pr.key} ${pr.url}`).join("\n");
  useSyncExternalStore(subscribePrs, () => prVersion);
  useEffect(() => {
    const read = () => {
      // ponytail: every bound PR still open is read each round, where Claude polls the branch's
      // own; read the others once if a session ever binds many.
      for (const pr of prs) {
        const state = prReads.get(pr.key)?.state;
        if (state === "merged" || state === "closed") continue;
        readPrInto(cwd, pr.key, pr.url);
      }
      if (lookup && repo && branch)
        readOnce(lookup, async () => {
          try {
            const { status, problem } = await readPr(cwd, branch, repo);
            noteProblem(lookup, problem);
            const link = status && parsePr(status.url);
            if (!status || !link) return;
            prReads.set(prIdentity(link), status);
            await attachBranchPr(id, status, branch);
          } finally {
            lookedUp.add(lookup);
          }
        });
      // The branch's other PRs, until they have been read once.
      if (historyKey && repo && branch && !prHistory.has(historyKey))
        readOnce(historyKey, async () => {
          const answer = await runGh(cwd, prHistoryCommand(repo, branch));
          if (answer.ok) prHistory.set(historyKey, parsePrList(answer.stdout));
        });
    };
    read();
    // Claude polls every 30 s while the window shows (EA, no background refetch) and on focus.
    const poll = () => document.visibilityState === "visible" && read();
    window.addEventListener("focus", read);
    const timer = window.setInterval(poll, 30_000);
    return () => {
      window.removeEventListener("focus", read);
      window.clearInterval(timer);
    };
  }, [id, cwd, lookup, historyKey, bound, running]);
  // 合并或关闭时自动归档: once, when the branch's PR is seen going from open to merged or closed.
  const ownState = own ? prReads.get(own.key)?.state : undefined;
  const lastState = useRef(ownState);
  useEffect(() => {
    const was = lastState.current;
    lastState.current = ownState;
    if ((was !== "open" && was !== "draft") || (ownState !== "merged" && ownState !== "closed") || !autoArchives()[id] || archivedFor.has(id)) return;
    archivedFor.add(id);
    void archiveThread(id).catch(fail("归档失败"));
  }, [ownState, id]);
  const verb = !git ? null : github && branch ? mode : "commit";
  const busy = verb !== "commit" && makingPr(thread);
  const checking = lookable && (lookup === null || !lookedUp.has(lookup));
  const act = (how: CreateMode | "commit" | null = verb) => {
    if (how === "commit") return void ask(id, COMMIT_ASK);
    if (!github || !branch) return;
    if (how === "compose") window.open(composePrUrl(github, branch), "_blank", "noopener");
    else void ask(id, createPrAsk({ repo: github.repo, branch, cwd, draft: how === "draft" }));
  };
  // cb1afaa4b tr: 创建 PR / 创建草稿 PR become the way and create it; 手动创建 PR only becomes the way.
  const pick = (next: CreateMode, close: () => void) => {
    close();
    setMode(next);
    writePref(CREATE_KEY, next);
    if (next !== "compose" && !running && !checking && !busy) act(next);
  };
  const viewChanges = () => openChanges(checkout ? "all" : "turn");
  const rowKey = `${cwd}\0${branch ?? ""}`;
  const menu = useRowMenu(branch ?? basename(cwd), (close) => (
    <>
      <MenuItem label="查看更改" onClick={closing(close, viewChanges)} />
      {verb && verb !== "commit" && (
        <>
          <MenuItem label={CREATE_LABELS.create} checked={mode === "create"} onClick={() => pick("create", close)} />
          <MenuItem label={CREATE_LABELS.draft} checked={mode === "draft"} onClick={() => pick("draft", close)} />
          <MenuSep />
          <MenuItem label={CREATE_LABELS.compose} checked={mode === "compose"} disabled={!github} onClick={() => pick("compose", close)} />
        </>
      )}
      <MenuSep />
      <MenuItem label="移除" onClick={closing(close, () => dismissRow(rowKey))} />
    </>
  ));
  // The first read decides between the checkout's changes and the session's.
  if (git && remote === null) return null;
  const rowShown = !!changes && !own && !dismissedRows().has(rowKey);
  const sorted = [...prs].sort((a, b) => prRank(prReads.get(a.key), a === own) - prRank(prReads.get(b.key), b === own));
  const listed = showAll ? sorted : sorted.slice(0, 5);
  const boundUrls = new Set(prs.map((pr) => pr.url));
  const history = (historyKey ? (prHistory.get(historyKey) ?? []) : []).filter((pr) => !boundUrls.has(pr.url)).sort((a, b) => prRank(a, false) - prRank(b, false));
  const historyMerged = history.filter((pr) => pr.state === "merged").length;
  if (!rowShown && prs.length === 0 && history.length === 0) return null;
  return (
    <Card id="pullRequests" summary={prs.length > 0 ? `${prs.length.toLocaleString("zh-CN")} 个拉取请求` : undefined} fold={fold}>
      {rowShown && (
        <div className="rail-row" data-rail-changes-row="" data-tip-group="" onContextMenu={menu.onContextMenu}>
          <span className="rail-icon">
            <Icon name="ChangesPlusMinus" size="sm" />
          </span>
          <ChangesButton {...changes} onClick={viewChanges} />
          <span className="spacer" />
          {verb && (
            <Button
              size="xs"
              disabled={running || checking}
              tip={busy ? undefined : checking ? "正在检查是否已有拉取请求" : running ? "Codex 正在处理中，请等待本轮完成" : undefined}
              icon={busy ? <Spinner size={12} /> : undefined}
              onClick={() => act()}
            >
              {busy ? "正在创建 PR…" : CREATE_LABELS[verb]}
            </Button>
          )}
          <span className="rail-dots">{menu.dots}</span>
          {menu.pointer}
        </div>
      )}
      {listed.map((pr) => (
        <PrRow key={pr.key} thread={thread} pr={pr} repo={repo || null} changes={pr === own ? changes : undefined} onChanges={viewChanges} />
      ))}
      {sorted.length > 5 && (
        <button type="button" className="rail-more" aria-expanded={showAll} onKeyDown={swallowRepeat} onClick={() => setShowAll(!showAll)}>
          {showAll ? "收起" : `再显示 ${sorted.length - 5} 个`}
        </button>
      )}
      {history.length > 0 && (
        <div className="rail-pr-history">
          <button type="button" className="rail-legend-toggle rail-pr-history-toggle" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}>
            <span className="rail-legend-lead">
              <Icon name="CaretRight" size="xs" className="rail-legend-caret" />
            </span>
            <span className="rail-legend-name">{history.length} 个较早的拉取请求</span>
            {historyMerged > 0 && <span className="rail-legend-tokens">已合并 {historyMerged} 项</span>}
          </button>
          {historyOpen && history.map((pr) => <HistoryRow key={pr.url} pr={pr} />)}
        </div>
      )}
    </Card>
  );
}

/**
 * 后台任务 (cf74bc599 kj / Ej / Tj, live 10-27): running agents and shells, four before 显示更多,
 * each with its clock and a stop button; N 个已结束 opens the finished ones in the task pane. The
 * card keeps its last rows while it fades out (c5220dfc1 bp), and a stop asked for here is read
 * out once the task has stopped (任务已停止). Stops in flight are shared with the pane.
 */
function BackgroundCard({ thread, fold }: { thread: ThreadState; fold: Fold }) {
  const id = thread.meta.id;
  const { tasks, groups } = useBackgroundTasks(thread);
  const running = useMemo(() => tasks.filter((task) => task.status === "running"), [tasks]);
  const stopping = useStopping();
  const now = useNow(running.length > 0 && fold.open);
  const [rows, setRows] = useState(running);
  if (running.length > 0 && rows !== running) setRows(running);
  const drop = useCallback(() => setRows([]), []);
  const list = useRef<HTMLDivElement>(null);
  const asked = useRef(new Set<string>());
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    for (const key of asked.current) {
      // The outcome is known once the stop settles: a killed shell's item can end (failed) or
      // drop out of the list before app-server's answer marks it stopped.
      const task = tasks.find((item) => item.key === key);
      if (stopping.has(key) || !task || task.status === "running") continue;
      asked.current.delete(key);
      if (task.status === "stopped") setAnnouncement("任务已停止");
    }
  }, [tasks, stopping]);
  // Ej: focus in the list stays in it while the stopped row goes.
  const stop = (task: BackgroundTask) => {
    if (list.current?.contains(document.activeElement)) list.current.focus({ preventScroll: true });
    asked.current.add(task.key);
    void stopBackgroundTask(task);
  };
  return (
    <>
      {rows.length > 0 && (
        <Card id="backgroundTasks" summary={`${rows.length} 个正在运行`} fold={fold} leaving={running.length === 0} onLeft={drop}>
          <div ref={list} className="rail-tasks" tabIndex={-1}>
            <Limited items={rows} limit={4}>
              {(task) => {
                const busy = stopping.has(task.key);
                return (
                  <div key={task.key} className="rail-task">
                    <button type="button" className="rail-row" aria-label={`在后台任务中打开 ${task.title}`} onClick={() => (task.kind === "agent" ? showAgent(id, task.threadId) : openBackgroundTask(id, task, tasks))}>
                      <span className="rail-icon">
                        <Icon name={task.kind === "shell" ? "CommandLine" : "AgentsSimple"} size="sm" />
                      </span>
                      <BackgroundTitle title={task.title} rail />
                      {(busy || task.startedAt !== undefined) && <span className="rail-meta">{busy ? "正在停止…" : taskClock(Math.max(1, now - (task.startedAt ?? now)))}</span>}
                    </button>
                    {/* A double click stops once (Tj: detail <= 1). */}
                    <Button variant="ghost" size="xs" icon={busy ? <Spinner size={12} /> : <Icon name="Stop" />} label={busy ? "正在停止…" : "停止此任务"} tipSide="left" disabled={busy} onClick={(event) => event.detail <= 1 && stop(task)} />
                  </div>
                );
              }}
            </Limited>
            {groups.finished.length > 0 && (
              <button type="button" className="rail-row" onClick={() => openFinishedBackground(id)}>
                <span className="rail-icon"><Icon name="AgentsSimple" size="sm" /></span>
                <span className="rail-label">{groups.finished.length} 个已结束</span>
              </button>
            )}
          </div>
        </Card>
      )}
      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
    </>
  );
}

export type NextAction = "commit" | "create_pr" | "archive";

/**
 * The app actions wrap_up's next-step box may draw (Claude cd4f82e77's commit, create_pr and
 * archive rules, as the changes card reads a session): commit or create a PR where its changes row
 * offers that action and the branch has no pull request, archive once that pull request is open
 * or merged. The turn calling wrap_up is still running, so its own edits count and running does
 * not hold an action back; the box draws them after the turn.
 */
export function nextActions(thread: ThreadState): NextAction[] {
  const cwd = thread.settings?.cwd ?? thread.meta.cwd;
  const branch = thread.meta.gitInfo?.branch ?? null;
  const remote = remoteDiffOf(cwd);
  const changed = (remote?.status === "ready" && remote.files.length > 0) || thread.turns.some((turn) => turnFiles(turn, cwd).length > 0);
  const github = githubRemote(thread.meta.gitInfo?.originUrl);
  const own = pullRequests(thread).find((pr) => branch !== null && pr.branch === branch);
  const actions: NextAction[] = [];
  if (thread.meta.gitInfo && changed && !own) {
    if (!github || !branch) actions.push("commit");
    else if (!makingPr(thread) && (/^#?\d+$/.test(branch) || lookedUp.has(`${cwd}\0${github.host}/${github.repo}\0${branch}`))) actions.push("create_pr");
  }
  const state = own && prReads.get(own.key)?.state;
  if (state === "open" || state === "merged") actions.push("archive");
  return actions;
}

/** Commit / create a PR from the next-step box, as the changes row runs them (its menu's way of creating the PR). */
export function runNextAction(thread: ThreadState, action: "commit" | "create_pr"): void {
  const id = thread.meta.id;
  if (action === "commit") return void ask(id, COMMIT_ASK);
  const branch = thread.meta.gitInfo?.branch;
  const github = githubRemote(thread.meta.gitInfo?.originUrl);
  if (!github || !branch) return;
  const mode = readPref<CreateMode>(CREATE_KEY, ["create", "draft", "compose"], "create");
  if (mode === "compose") window.open(composePrUrl(github, branch), "_blank", "noopener");
  else void ask(id, createPrAsk({ repo: github.repo, branch, cwd: thread.settings?.cwd ?? thread.meta.cwd, draft: mode === "draft" }));
}
