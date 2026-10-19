// Session rail ("Session details": cf74bc599 fO / rD as Claude Desktop 2.42304.0.0 shows it with
// the session-presets flag on; the rest of codex-ui stays the flag-off Code tab). Cards beside the
// chat: 环境, 目标, 上下文, 连接器, 输出, 更改 and 后台任务, in the bundle's order (c227f4d5e xZ, the
// cards Codex has data for). The rail docks where the session column has room (shared-18 My) and is a
// floating panel the toggle raises where it does not (jH). Cards and the lists in them stay as they
// were last left, in every session, and cards hide from a header's context menu (VZ); 环境 always
// shows. 设置 and 用量 never show beside the flag-on picker row (cf74bc599 fO `c`), 进度 is always
// hidden (wZ) and Codex has no preview servers, so those cards are left out, and the order is fixed
// (no drag to reorder).

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode, type RefObject, type WheelEvent } from "react";
import { activeTurn, attachBranchPr, compactThread, errorMessage, readPr, refreshMcp, removePullRequest, sendMessage, setRemoteControl, supports, terminateBackground } from "../lib/codex";
import { contextBreakdown, mcpToolTokens, readContextParts, type Breakdown, type ContextParts, type LegendRow, type Row } from "../lib/context";
import { filesStats, outputFiles, turnFiles } from "../lib/diff";
import { basename, formatDuration, formatTokens, parentDir } from "../lib/format";
import { relativeTime } from "../lib/landing";
import { openChanges, openPane } from "../lib/panes";
import { composePrUrl, createPrAsk, githubRemote, parsePr, prIdentity, promptLabel, type Ci, type PrLook, type PrStatus } from "../lib/pr";
import { pullRequests, readPref, setState, toast, useStore, writePref, type AttachedPullRequest, type ThreadState } from "../lib/store";
import { setComposerDraft, useContextUsage } from "./Composer";
import { openFile } from "./content";
import { GOAL_LABELS, loadRemoteDiff, useNow, useRemoteDiff } from "./Panes";
import { openSettings } from "./Settings";
import { PointerMenu, menuPoint } from "./Sidebar";
import { openTerminalTab } from "./Terminal";
import { Button, Icon, MenuItem, MenuSection, MenuSep, Popover, Spinner, StatusDot, Toggle, fileGlyph, type IconName } from "./ui";

const fail = (title: string) => (error: unknown) => toast("danger", title, errorMessage(error));

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
/** Cards that start folded (kZ); the others start open. */
const FOLDED: readonly CardId[] = ["context", "connectors", "backgroundTasks"];

interface Sections {
  /**
   * How each card (by id) and each list in one (`card/list`) was last left, for every session: the
   * user asked for the last state everywhere, where Claude keeps folds per session (PZ). A key not
   * in it is at its default.
   */
  open: Record<string, boolean>;
  hidden: CardId[];
}

const SECTIONS_KEY = "codex-ui:rail-sections";

function readSections(): Sections {
  try {
    const saved = JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? "null") as Partial<Sections> | null;
    return { open: saved?.open && typeof saved.open === "object" ? saved.open : {}, hidden: Array.isArray(saved?.hidden) ? saved.hidden : [] };
  } catch {
    return { open: {}, hidden: [] };
  }
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
}

/**
 * cc43287c9 yH: a wheel over the rail scrolls the transcript under it, unless what it is over in
 * the rail scrolls itself (vH / _H).
 */
function scrollTranscript(event: WheelEvent<HTMLElement>) {
  const rail = event.currentTarget;
  const target = event.target instanceof Element && rail.contains(event.target) ? event.target : null;
  if (!target || event.ctrlKey || event.deltaY === 0) return;
  for (let el: Element | null = target; el && el !== rail; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight && /^(auto|scroll)$/.test(getComputedStyle(el).overflowY)) return;
  }
  rail.closest(".session-row")?.querySelector(".transcript")?.scrollBy({ top: event.deltaY });
}

/**
 * Docked (shared-18 ky): 280 wide beside the chat, the cards 10 apart with their rings. Floating
 * (By / Vy): the same column in one bordered panel, the cards flat with a rule between them; it
 * takes focus when the keyboard raised it.
 */
export function SessionRail({
  thread,
  overlay,
  toggleRef,
  onDismiss,
}: {
  thread: ThreadState;
  overlay?: "pointer" | "keyboard";
  toggleRef?: RefObject<HTMLElement | null>;
  onDismiss?(refocus: boolean): void;
}) {
  const sections = useSections();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const floating = !!overlay;

  useEffect(() => {
    if (overlay === "keyboard") panel.current?.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // cc43287c9 AH: Esc (unless a menu is open over it) or a press outside the panel and the toggle.
  useEffect(() => {
    if (!floating || !onDismiss) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector(".popover")) return;
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
  }, [floating, onDismiss, toggleRef]);

  const fold = (card: CardId): Fold => ({
    open: sections.open[card] ?? !FOLDED.includes(card),
    // Alt+click opens or folds every card (c73f45bc3 Xv setAllOpen).
    onOpen: (open, all) => keepOpen(Object.fromEntries((all ? CARDS : [card]).map((c) => [c, open]))),
    onMenu: (event) => {
      event.preventDefault();
      setMenu(menuPoint(event));
    },
  });
  const shown = (card: CardId) => !sections.hidden.includes(card);

  return (
    <aside ref={panel} className="rail" data-overlay={floating || undefined} aria-label="会话详情" tabIndex={-1} onWheel={scrollTranscript}>
      <div className="rail-scroll scroll-fade-y">
        <EnvironmentCard thread={thread} fold={fold("environment")} />
        {shown("goal") && <GoalCard thread={thread} fold={fold("goal")} />}
        {shown("context") && <ContextCard thread={thread} fold={fold("context")} />}
        {shown("connectors") && <ConnectorsCard thread={thread} fold={fold("connectors")} />}
        {shown("outputs") && <OutputsCard thread={thread} fold={fold("outputs")} />}
        {shown("pullRequests") && <ChangesCard thread={thread} fold={fold("pullRequests")} />}
        {shown("backgroundTasks") && <BackgroundCard thread={thread} fold={fold("backgroundTasks")} />}
      </div>
      {menu && (
        // c73f45bc3 ey / ty / ny: 显示 lists the cards that can hide; 重置为默认值 brings them back.
        <PointerMenu at={menu} onClose={() => setMenu(null)}>
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
            disabled={sections.hidden.length === 0}
            onClick={() => {
              setMenu(null);
              saveSections({ ...sections, hidden: [] });
            }}
          />
        </PointerMenu>
      )}
    </aside>
  );
}

/**
 * A card (c73f45bc3 Xv): the heading toggles it, the caret turns and the summary hides while it
 * is open; a right click on the heading opens the rail's menu. The pointer coming to the card or
 * focus to its heading is an intent (onIntent).
 */
function Card({ id, summary, fold, onIntent, children }: { id: CardId; summary?: ReactNode; fold: Fold; onIntent?(): void; children: ReactNode }) {
  return (
    <section className="rail-card" data-rail-card={id} onPointerEnter={onIntent}>
      <h3 className="rail-card-top" onContextMenu={fold.onMenu}>
        <button type="button" className="rail-card-head" aria-expanded={fold.open} onFocus={onIntent} onClick={(event) => fold.onOpen(!fold.open, event.altKey)}>
          <span>{CARD_NAMES[id]}</span>
          <Icon name="CaretRight" size="xs" className="rail-card-caret" />
          {summary !== undefined && summary !== null && (
            <span className="rail-card-summary" aria-hidden={fold.open || undefined}>
              {summary}
            </span>
          )}
        </button>
      </h3>
      {fold.open && <div className="rail-card-body">{children}</div>}
    </section>
  );
}

/** A list cut at `limit` rows with 显示更多 / 显示更少 under it (c227f4d5e QL). */
function Limited<T>({ items, limit, children }: { items: T[]; limit: number; children(item: T): ReactNode }) {
  const [all, setAll] = useState(false);
  return (
    <>
      {(all ? items : items.slice(0, limit)).map(children)}
      {items.length > limit && (
        <button type="button" className="rail-more" aria-expanded={all} onClick={() => setAll(!all)}>
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

function copy(text: string, done: string) {
  navigator.clipboard.writeText(text).then(() => toast("neutral", done), fail("复制失败"));
}

// ---------------------------------------------------------------------------
// Cards

/**
 * 环境 (cf74bc599 rD environment): this computer, the working folder with its parent, the branch
 * and, with the flag on, Remote Control. Codex's Remote Control is the app's, not the session's.
 * The summary is the folder's name (vD).
 */
function EnvironmentCard({ thread, fold }: { thread: ThreadState; fold: Fold }) {
  const remote = useStore((s) => s.remoteControl);
  const allowed = useStore((s) => s.requirements?.allowRemoteControl !== false);
  const [busy, setBusy] = useState(false);
  const id = thread.meta.id;
  const cwd = thread.settings?.cwd ?? thread.meta.cwd;
  const branch = thread.meta.gitInfo?.branch ?? null;
  const terminal = supports("process/spawn");
  const on = !!remote && remote.status !== "disabled";
  return (
    <Card id="environment" summary={basename(cwd) || branch} fold={fold}>
      <div className="rail-row" data-tip="本地会话">
        <span className="rail-icon">
          <Icon name="Computer" size="sm" />
        </span>
        <span className="rail-label">本电脑</span>
      </div>
      <div className="rail-row">
        <span className="rail-icon">
          <Icon name="Folder" size="sm" />
        </span>
        <NameMenu name={basename(cwd)} tip={`工作文件夹\n${cwd}`}>
          {(close) => (
            <>
              <MenuItem
                label="复制路径"
                onClick={() => {
                  close();
                  copy(cwd, "路径已复制到剪贴板。");
                }}
              />
              {terminal && (
                <MenuItem
                  label="在终端中打开"
                  onClick={() => {
                    close();
                    openTerminalTab(id, cwd);
                  }}
                />
              )}
            </>
          )}
        </NameMenu>
        <span className="rail-dot" aria-hidden="true">
          ·
        </span>
        <span className="rail-path">{parentDir(cwd)}</span>
      </div>
      {branch && (
        <div className="rail-row">
          <span className="rail-icon">
            <Icon name="GitBranch" size="sm" />
          </span>
          <NameMenu name={branch} tip={`分支\n${branch}`}>
            {(close) => (
              <>
                <MenuItem
                  label="复制分支名称"
                  onClick={() => {
                    close();
                    copy(branch, "分支名称已复制到剪贴板。");
                  }}
                />
                {terminal && (
                  <>
                    <MenuSep />
                    <MenuItem
                      label="在终端中打开"
                      onClick={() => {
                        close();
                        openTerminalTab(id, cwd);
                      }}
                    />
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
            disabled={busy}
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
 * 目标 (cf74bc599 CD): Codex's goal, two lines until 显示更多, with its state and spend under it;
 * the pencil puts `/goal …` in the composer. Pausing and clearing stay in the Plan pane.
 */
function GoalCard({ thread, fold }: { thread: ThreadState; fold: Fold }) {
  const { goal } = thread;
  const [more, setMore] = useState(false);
  const [clamped, setClamped] = useState(false);
  const text = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = text.current;
    if (el && !more) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [goal?.objective, more, fold.open]);
  if (!goal) return null;
  const meta = [
    GOAL_LABELS[goal.status],
    `${formatTokens(goal.tokensUsed)}${goal.tokenBudget ? ` / ${formatTokens(goal.tokenBudget)}` : ""} tokens`,
    goal.timeUsedSeconds ? formatDuration(goal.timeUsedSeconds * 1000) : null,
  ].filter(Boolean);
  return (
    <Card id="goal" summary={GOAL_LABELS[goal.status]} fold={fold}>
      <div className="rail-goal">
        <div className="rail-goal-text" dir="auto">
          <bdi ref={text} className="rail-goal-objective" data-clamped={!more || undefined}>
            {goal.objective}
          </bdi>
          <bdi className="rail-goal-meta">{meta.join(" · ")}</bdi>
        </div>
        <Button variant="ghost" size="xs" className="rail-goal-edit" icon={<Icon name="Edit" size={16} />} label="编辑目标" onClick={() => setComposerDraft(`/goal ${goal.objective}`)} />
      </div>
      {(clamped || more) && (
        <button type="button" className="rail-more" aria-expanded={more} onClick={() => setMore(!more)}>
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
  for (let t = turns.length - 1; t >= 0; t--) {
    for (let i = turns[t].items.length - 1; i >= 0; i--) {
      const item = turns[t].items[i];
      if (item.type === "contextCompaction") return item.id;
    }
  }
  return null;
}

/**
 * The thread's context parts, read when Claude asks a local session's get_context_usage (c5da7eb42
 * TF, c227f4d5e hZ): when the card shows with none, folded too (Claude keeps its panel mounted);
 * when it opens, unless a read settled in the last 5 s (Og); when the pointer or focus comes to it
 * (c73f45bc3 Xv onIntent) with none, stale or older than a compaction, even while a turn runs.
 * Otherwise a turn holds reads back: opening the card, parts read during the turn and a compaction
 * in it read when it ends. Parts a read renewed then stay until one of those; stale ones, or none,
 * read again when a turn ends, every 30 s while the window shows and when it shows again.
 */
function useContextParts(thread: ThreadState, open: boolean, running: boolean, ready: boolean) {
  useSyncExternalStore(subscribeContext, () => contextVersion);
  const id = thread.meta.id;
  const rollout = ready ? thread.meta.path : null;
  const compaction = lastCompaction(thread.turns);
  const kept = contextReads.get(id);
  const reading = contextReading.has(id);
  const idle = !!rollout && !running;
  const outdated = !kept?.parts || kept.stale;
  const settledLately = () => !!kept && Date.now() - kept.settled < 5_000;
  const read = useEffectEvent(() => {
    if (rollout) readContext(id, rollout, running, compaction);
  });

  useEffect(() => {
    if (idle && kept?.compaction !== compaction) read();
  }, [idle, kept, compaction]);

  const was = useRef({ id, running });
  useEffect(() => {
    const before = was.current;
    was.current = { id, running };
    if (before.id === id && before.running && !running && kept && outdated && document.visibilityState === "visible") read();
  }, [id, running, kept, outdated]);

  useEffect(() => {
    if (!idle || !outdated) return;
    const poll = () => document.visibilityState === "visible" && read();
    const timer = window.setInterval(poll, 30_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
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
    if ((kept?.midTurn && !kept.stale) || (first && !settledLately())) read();
  }, [open, idle, reading, kept]);

  const intent = () => {
    if (rollout && !settledLately() && (outdated || kept?.compaction !== compaction)) readContext(id, rollout, running, compaction);
  };
  return { kept, reading: reading && !kept, intent };
}

const legendPercent = new Intl.NumberFormat("zh-CN", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const meterShare = new Intl.NumberFormat("zh-CN", { style: "percent", maximumSignificantDigits: 2 });
const meterOffset = (share: number) => Number((share * 100).toFixed(3));

/**
 * Claude's stacked meter at size sm (c91b6e9db M): 4px over the free-space tint, the parts side
 * by side with a 1px seam, read out as an image whose tooltip lists them.
 */
function ContextMeter({ breakdown }: { breakdown: Breakdown }) {
  const { meter, total } = breakdown;
  const entries = meter.map((segment) => `${segment.name}: ${formatTokens(segment.tokens)}, ${meterShare.format(segment.tokens / total)}`);
  let start = 0;
  return (
    <div className="rail-stack" role="img" tabIndex={0} aria-label={`上下文窗口: ${entries.join("; ")}`} data-tip={entries.join("\n")}>
      {meter.map((segment, index) => {
        const from = start;
        start += segment.tokens / total;
        const seam = index === 0 ? 0 : 1;
        return (
          <span
            key={segment.id}
            style={{ insetInlineStart: `calc(${meterOffset(from)}% + ${seam}px)`, width: `calc(${meterOffset(segment.tokens / total)}% - ${seam}px)`, background: segment.color }}
          />
        );
      })}
    </div>
  );
}

/** A legend row (c2d611398 ue): swatch, name, tokens and share of the window; a part outside it reads —. */
function LegendItem({ row, window }: { row: LegendRow; window: number }) {
  return (
    <div className="rail-legend-row" data-deferred={row.deferred || undefined}>
      <span className="rail-legend-lead">
        <span className="rail-swatch" style={{ background: row.color }} />
      </span>
      <span className="rail-legend-name">{row.name}</span>
      <span className="rail-legend-tokens">{formatTokens(row.tokens)}</span>
      <span className="rail-legend-pct">{row.deferred ? "—" : legendPercent.format(row.tokens / window)}</span>
    </div>
  );
}

/**
 * A folded list under the legend (c2d611398 q, rail): its count, then a row per item; past 12 it
 * scrolls. It stays as it was last left, like the cards.
 */
function LegendList({ id, label, rows }: { id: string; label: string; rows: Row[] }) {
  const key = `context/${id}`;
  const open = useSections().open[key] ?? false;
  return (
    <div className="rail-legend-list">
      <button type="button" className="rail-legend-toggle" aria-expanded={open} onClick={() => keepOpen({ [key]: !open })}>
        <span className="rail-legend-lead">
          <Icon name="CaretRight" size="xs" className="rail-legend-caret" />
        </span>
        <span className="rail-legend-name">{label}</span>
        <span className="rail-legend-pct">{rows.length.toLocaleString("zh-CN")}</span>
      </button>
      {open && (
        <div className="rail-legend-rows" data-scroll={rows.length > 12 || undefined}>
          {rows.map((row, index) => (
            <div key={`${row.name}-${index}`} className="rail-legend-row">
              <span className="rail-legend-lead" />
              <span className="rail-legend-name">{row.name}</span>
              <span className="rail-legend-tokens">{formatTokens(row.tokens)}</span>
              <span className="rail-legend-pct" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * When the parts were read (c2d611398 ke): while a turn runs they renew when it ends, otherwise a
 * message renews them. The time moves on Claude's minute clock (shared-2 RelativeTime, WY).
 */
function ContextNote({ at, running }: { at: number; running: boolean }) {
  const now = useNow(true, 60_000);
  return (
    <p className="rail-note rail-context-note">
      上次更新于 {relativeTime(at / 1000, now)}。{running ? "本轮回复结束后将刷新。" : "发送消息即可刷新。"}
    </p>
  );
}

/**
 * 上下文 (c73f45bc3 ay → c227f4d5e gZ → c2d611398 ke / H, layout "rail"): the headline (已使用 n%
 * · used / max) over the stacked meter, then the legend (the parts in the window, the auto-compact
 * buffer and free space, then what waits outside it), the MCP 工具 and 记忆文件 lists, the
 * compact row from 50% and, for parts read during the turn still running or that a read could not
 * renew, when they were read. The headline follows the live count; the meter and legend are the
 * last read's (useContextParts). Until there is one, or for a thread without a rollout, the meter
 * is the plain bar. Folded, the summary is the percentage with a small meter (Qv rollup).
 */
function ContextCard({ thread, fold }: { thread: ThreadState; fold: Fold }) {
  const context = useContextUsage(thread);
  const { pct, running } = context;
  const { kept, reading, intent } = useContextParts(thread, fold.open, running, !context.noData);
  const parts = kept?.parts ?? null;
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
            tool ? [{ name: `${server.name === "codex_apps" ? "应用" : server.name} · ${tool.title || tool.name}`, tokens: mcpToolTokens(server.name, tool) }] : [],
          ),
        ),
    [inventory, thread.mcp],
  );
  const window = context.max ?? parts?.windowTokens ?? null;
  const breakdown = parts && window ? contextBreakdown(parts, window, context.compactAt, mcpTools) : null;
  // hZ staleSince.
  const since = kept?.parts && (kept.stale || (kept.midTurn && running)) ? kept.at : null;
  const summary = context.noData ? undefined : pct === null ? context.summary : (
    <span className="rail-rollup">
      <span>{pct}%</span>
      <span className="rail-meter" aria-hidden="true">
        <span data-level={context.level} style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
    </span>
  );
  return (
    <Card id="context" summary={summary} fold={fold} onIntent={intent}>
      {context.noData ? (
        <p className="rail-note">发送消息即可查看上下文用量。</p>
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
                <LegendItem key={row.id} row={row} window={window} />
              ))}
          </div>
          {breakdown.legend.some((row) => row.deferred) && (
            <div className="rail-legend-group">
              {breakdown.legend
                .filter((row) => row.deferred)
                .map((row) => (
                  <LegendItem key={row.id} row={row} window={window} />
                ))}
            </div>
          )}
          {breakdown.lists.length > 0 && (
            <div className="rail-legend-group">
              {breakdown.lists.map((list) => (
                <LegendList key={list.key} id={list.key} label={list.label} rows={list.rows} />
              ))}
            </div>
          )}
        </div>
      )}
      {context.canCompact && (
        <div className="rail-compact">
          <span className="rail-compact-hint">{context.compactHint}</span>
          <Button
            size="xs"
            disabled={context.running}
            tip={context.running ? "Codex 完成本轮回复后可用" : undefined}
            onClick={() => compactThread(thread.meta.id).catch(fail("压缩失败"))}
          >
            压缩会话
          </Button>
        </div>
      )}
      {since !== null && <ContextNote at={since} running={running} />}
      {reading && !breakdown && (
        <p className="rail-note rail-context-note rail-loading">
          <Spinner size={12} />
          <span>正在加载上下文明细…</span>
        </p>
      )}
    </Card>
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

/**
 * 连接器 (cf74bc599 lD): the MCP servers this session started (startup status ready), three before
 * 显示更多, their count as the summary; one that failed, was cancelled or is still starting stays
 * out (a sign-in again is the transcript's 重新登录 line). A row opens 设置 › 连接器. Hidden while
 * none is up.
 */
function ConnectorsCard({ thread, fold }: { thread: ThreadState; fold: Fold }) {
  const inventory = useStore((s) => s.mcp);
  const names = Object.entries(thread.mcp).flatMap(([name, runtime]) => (runtime.status === "ready" ? [name] : []));
  const hasServers = names.length > 0;
  useEffect(() => {
    if (fold.open && hasServers && inventory === null) void refreshMcp();
  }, [fold.open, hasServers, inventory]);
  if (!hasServers) return null;
  const servers = names.map((name) => ({ name, icon: serverIcon(inventory?.find((server) => server.name === name)?.serverInfo?.icons) }));
  return (
    <Card id="connectors" summary={`已连接 ${servers.length} 个`} fold={fold}>
      <Limited items={servers} limit={3}>
        {({ name, icon }) => (
          <button key={name} type="button" className="rail-row" onClick={() => openSettings("connectors", "setting-connectors-mcp")}>
            <span className="rail-icon">
              <ServerIcon key={icon} src={icon} />
            </span>
            {/* codex_apps carries the ChatGPT apps of 设置 › 连接器 › 应用. */}
            <span className="rail-label">{name === "codex_apps" ? "应用" : name}</span>
          </button>
        )}
      </Limited>
    </Card>
  );
}

/**
 * 输出 (cf74bc599 xE / _E / gE): the files the session made (lib/diff.ts outputFiles), five
 * before 显示更多, the count as the summary; a row shows the file's glyph and name, its path in
 * the tooltip, and opens it in the 文件 pane. Hidden while there is none.
 */
function OutputsCard({ thread, fold }: { thread: ThreadState; fold: Fold }) {
  const cwd = thread.settings?.cwd ?? thread.meta.cwd;
  const checkout = !!thread.meta.gitInfo;
  const files = useMemo(() => outputFiles(thread.turns, cwd, checkout), [thread.turns, cwd, checkout]);
  if (files.length === 0) return null;
  return (
    <Card id="outputs" summary={files.length.toLocaleString("zh-CN")} fold={fold}>
      <Limited items={files} limit={5}>
        {(path) => (
          <button key={path} type="button" className="rail-row" data-tip={basename(path)} data-tip-detail={path} onClick={() => openFile(path)}>
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
 * gh's reads of the session PRs by attachment key, and the branch lookups that have answered
 * (Claude's prAnswered), shared by every 更改 card: the last answer stays up while the next read
 * is under way, and a read in flight is not asked again.
 */
const prReads = new Map<string, PrStatus>();
const lookedUp = new Set<string>();
const prReading = new Set<string>();
const prListeners = new Set<() => void>();
let prVersion = 0;

function subscribePrs(listener: () => void) {
  prListeners.add(listener);
  return () => void prListeners.delete(listener);
}

function readOnce(key: string, read: () => Promise<void>): void {
  if (prReading.has(key)) return;
  prReading.add(key);
  void read()
    .catch(() => undefined)
    .finally(() => {
      prReading.delete(key);
      prVersion += 1;
      for (const listener of prListeners) listener();
    });
}

/** Each state's glyph and name (c96d752d0 xLe, shared-18 Xw); its git tint is the CSS's. */
const PR_LOOKS: Record<PrLook, { icon: IconName; label: string }> = {
  open: { icon: "GitPullRequest", label: "打开" },
  draft: { icon: "GitPullRequestDraft", label: "草稿" },
  merged: { icon: "GitMergedSimple", label: "已合并" },
  closed: { icon: "GitPullRequestClosed", label: "已关闭" },
  approved: { icon: "CheckCircle", label: "已批准" },
  changesRequested: { icon: "XCircle", label: "已请求更改" },
  conflicting: { icon: "GitMergeConflict", label: "合并冲突" },
};

/** CI as it is read out (c96d752d0 pB / nB). */
function ciLabel({ status, total, failed }: Ci): string {
  if (status === "failed") return `CI：${failed} 项检查失败`;
  if (status === "skipped") return `CI：已跳过 ${total} 项检查`;
  return { passed: "CI：所有检查均已通过", pending: "CI：检查进行中", unavailable: "CI：状态不可用" }[status];
}

/**
 * The branch's PR's CI (c96d752d0 FLe in the rail): a ghost xs button with 6px dot (tB), the
 * failing count in danger instead, or done/total while checks run (HLe). Claude's opens its
 * checks popover with auto-fix (its GitHub App's); this one opens the checks on GitHub, the
 * popover's own link.
 */
function CiButton({ url, ci }: { url: string; ci: Ci }) {
  const label = ciLabel(ci);
  return (
    <a className="btn btn-ghost btn-xs rail-ci" data-status={ci.status} href={`${url}/checks`} target="_blank" rel="noopener" aria-label={label} data-tip="CI 监控" data-tip-detail={label}>
      {ci.status === "pending" ? <StatusDot kind="running" /> : ci.status !== "failed" && <span className="rail-ci-dot" />}
      {ci.status === "failed" ? `${ci.failed} 项失败` : ci.status === "pending" ? `${ci.total - ci.pending}/${ci.total}` : null}
    </a>
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
 * A pull request (c96d752d0 OLe with a link, rail layout): its state's glyph, then its title as
 * the link with the row's ⋮ on one line and #N under it, the branch's own PR with the changes and
 * its CI after. Codex keeps a PR's link and branch only, so the state, title and CI are gh's
 * (Claude's main process asks GitHub with gh's token): until gh answers, or without gh, the glyph
 * is the plain one and the branch stands in for the title as Claude's does until the title loads.
 * The own PR's open state splits by its review and conflicts as Claude's does; the others show
 * their state alone, with no CI. Merge queues (gh does not say), the draft / merge controls and
 * auto-fix (Claude's GitHub App) stay out. The menu opens it on GitHub, copies the link and
 * removes it from the session (Dismiss: thread/attachment/remove).
 */
function PrRow({ thread, pr, own, changes, onChanges }: { thread: ThreadState; pr: AttachedPullRequest; own: boolean; changes?: { added: number; removed: number }; onChanges(): void }) {
  const link = parsePr(pr.url);
  const read = prReads.get(pr.key);
  const look = read && (own ? read.look : read.state);
  const ci = own && (read?.state === "open" || read?.state === "draft") ? read.ci : undefined;
  const title = read?.title || (pr.branch ?? (link ? `${link.owner}/${link.repo}` : pr.url.replace(/^https:\/\//, "")));
  const host = new URL(pr.url).hostname;
  const menu = useRowMenu(title, (close) => (
    <>
      <MenuItem
        label={`在 ${host === "github.com" ? "GitHub" : host} 上打开`}
        onClick={() => {
          close();
          window.open(pr.url, "_blank", "noopener");
        }}
      />
      <MenuItem
        label="复制链接"
        onClick={() => {
          close();
          copy(pr.url, "链接已复制到剪贴板。");
        }}
      />
      {changes && (
        <MenuItem
          label="查看更改"
          onClick={() => {
            close();
            onChanges();
          }}
        />
      )}
      <MenuSep />
      <MenuItem
        label="移除"
        onClick={() => {
          close();
          removePullRequest(thread.meta.id, pr.key).catch(fail("移除失败"));
        }}
      />
    </>
  ));
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
          {menu.dots}
        </div>
        {(link || changes || ci) && (
          <div className="rail-pr-meta">
            {link && <span>#{link.number}</span>}
            {changes && <ChangesButton {...changes} onClick={onChanges} />}
            {ci && (
              <>
                <span className="spacer" />
                <CiButton url={pr.url} ci={ci} />
              </>
            )}
          </div>
        )}
      </div>
      {menu.pointer}
    </div>
  );
}

/**
 * 更改 (cf74bc599 rD pullRequests, titled "Changes"; c96d752d0 OLe in the rail's "row" layout):
 * the working folder's changes on one row, ChangesPlusMinus then the lines added and removed as a
 * button to the 更改 pane. In a checkout they are the pane's 所有更改 (gitDiffToRemote: the
 * working tree with untracked files against the closest commit on a remote, as Claude counts the
 * working tree against its base), read on show, around each turn and when the window regains
 * focus; where that read fails (no remote) or there is no checkout, they are the session's latest
 * changes (本轮更改), as Claude falls back to the session's own edits.
 *
 * The row ends with Claude's action (yze): a checkout without a GitHub remote has 提交更改, which
 * asks Codex to commit (so does a detached HEAD, with no branch to open a PR from); a GitHub one
 * has 创建 PR, the way its menu last picked: 创建 PR and 创建草稿 PR send the session Claude's
 * create-pr ask (cx → lx: a local session gets a message, not a gh call from the app), shown as
 * /create-pr, and stay busy while that turn runs; 手动创建 PR opens GitHub's compare page. While
 * another turn runs the action waits, and so it does while gh first looks for the branch's PR
 * (正在检查是否已有拉取请求, Claude's prLookup); without gh that answers at once. Claude's other
 * reasons to hold it are its cloud sessions' (no GitHub remote, on the base branch, not pushed).
 * The row's menu (⋮ while it has focus, or a right click) holds 查看更改 and the ways to create
 * the PR; picking one closes it.
 *
 * The session's pull requests (thread attachments; Claude's bound PRs) follow, one row each, and
 * count in the folded summary; the branch's own PR takes the changes row's place and carries its
 * changes. gh reads them, and looks up the branch's PR until one is bound, on show, around each
 * turn, on focus and every 30 s while the window shows, as Claude polls; an open one it finds is
 * bound, a merged or closed one only shows once bound. Hidden while there is nothing to show.
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
  const bound = prs.map((pr) => `${pr.key} ${pr.url}`).join("\n");
  useSyncExternalStore(subscribePrs, () => prVersion);
  useEffect(() => {
    const read = () => {
      // ponytail: every bound PR still open is read each round, where Claude polls the branch's
      // own; read the others once if a session ever binds many.
      for (const pr of prs) {
        const state = prReads.get(pr.key)?.state;
        if (state === "merged" || state === "closed") continue;
        readOnce(pr.key, async () => {
          const status = await readPr(cwd, pr.url);
          if (status) prReads.set(pr.key, status);
        });
      }
      if (lookup && repo && branch)
        readOnce(lookup, async () => {
          try {
            const status = await readPr(cwd, branch, repo);
            const link = status && parsePr(status.url);
            if (!status || !link) return;
            prReads.set(prIdentity(link), status);
            await attachBranchPr(id, status, branch);
          } finally {
            lookedUp.add(lookup);
          }
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
  }, [id, cwd, lookup, bound, running]);
  const verb = !git ? null : github && branch ? mode : "commit";
  const busy = verb !== "commit" && makingPr(thread);
  const checking = lookable && (lookup === null || !lookedUp.has(lookup));
  const pick = (next: CreateMode, close: () => void) => {
    close();
    setMode(next);
    writePref(CREATE_KEY, next);
  };
  const viewChanges = () => openChanges(checkout ? "all" : "turn");
  const menu = useRowMenu(branch ?? basename(cwd), (close) => (
    <>
      <MenuItem
        label="查看更改"
        onClick={() => {
          close();
          viewChanges();
        }}
      />
      {verb && verb !== "commit" && (
        <>
          <MenuItem label={CREATE_LABELS.create} checked={mode === "create"} onClick={() => pick("create", close)} />
          <MenuItem label={CREATE_LABELS.draft} checked={mode === "draft"} onClick={() => pick("draft", close)} />
          <MenuSep />
          <MenuItem label={CREATE_LABELS.compose} checked={mode === "compose"} onClick={() => pick("compose", close)} />
        </>
      )}
    </>
  ));
  // The first read decides between the checkout's changes and the session's.
  if (git && remote === null) return null;
  if (!changes && prs.length === 0) return null;
  const act = () => {
    if (verb === "commit") return void ask(id, COMMIT_ASK);
    if (!github || !branch) return;
    if (verb === "compose") window.open(composePrUrl(github, branch), "_blank", "noopener");
    else void ask(id, createPrAsk({ repo: github.repo, branch, cwd, draft: verb === "draft" }));
  };
  return (
    <Card id="pullRequests" summary={prs.length > 0 ? `${prs.length.toLocaleString("zh-CN")} 个拉取请求` : undefined} fold={fold}>
      {own ? (
        <PrRow thread={thread} pr={own} own changes={changes} onChanges={viewChanges} />
      ) : (
        changes && (
          <div className="rail-row" data-rail-changes-row="" onContextMenu={menu.onContextMenu}>
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
                onClick={act}
              >
                {busy ? "正在创建 PR…" : CREATE_LABELS[verb]}
              </Button>
            )}
            <span className="rail-dots">{menu.dots}</span>
            {menu.pointer}
          </div>
        )
      )}
      {prs
        .filter((pr) => pr !== own)
        .map((pr) => (
          <PrRow key={pr.key} thread={thread} pr={pr} own={false} onChanges={viewChanges} />
        ))}
    </Card>
  );
}

/**
 * 后台任务 (cf74bc599 LD / ID): the agent's background terminals, four before 显示更多, each with
 * its running time and a stop button; a row opens the 后台任务 pane. Hidden while none runs.
 */
function BackgroundCard({ thread, fold }: { thread: ThreadState; fold: Fold }) {
  const id = thread.meta.id;
  const tasks = thread.background;
  const [stopping, setStopping] = useState<string[]>([]);
  const now = useNow(tasks.length > 0 && fold.open);
  if (tasks.length === 0) return null;
  const stop = (processId: string) => {
    setStopping((list) => [...list, processId]);
    terminateBackground(id, processId)
      .catch(fail("无法停止任务"))
      .finally(() => setStopping((list) => without(list, processId)));
  };
  return (
    <Card id="backgroundTasks" summary={`${tasks.length} 个正在运行`} fold={fold}>
      <Limited items={tasks} limit={4}>
        {(task) => {
          const busy = stopping.includes(task.processId);
          const started = thread.timing[task.itemId]?.[0];
          return (
            <div key={task.processId} className="rail-task">
              <button type="button" className="rail-row" aria-label={`在后台任务中打开 ${task.command}`} onClick={() => openPane("background", id)}>
                <span className="rail-icon">
                  <Icon name="CommandLine" size="sm" />
                </span>
                <span className="rail-label">{task.command}</span>
                {(busy || started) && <span className="rail-meta">{busy ? "正在停止…" : formatDuration(now - (started ?? now))}</span>}
              </button>
              <Button
                variant="ghost"
                size="xs"
                icon={busy ? <Spinner size={12} /> : <Icon name="Stop" size={14} />}
                label={busy ? "正在停止…" : "停止此任务"}
                disabled={busy}
                onClick={() => stop(task.processId)}
              />
            </div>
          );
        }}
      </Limited>
    </Card>
  );
}
