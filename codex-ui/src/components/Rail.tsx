// Session rail ("Session details": cf74bc599 fO / rD as Claude Desktop 2.42304.0.0 shows it with
// the session-presets flag on; the rest of codex-ui stays the flag-off Code tab). Cards beside the
// chat: 环境, 目标, 上下文, 连接器 and 后台任务, in the bundle's order (c227f4d5e xZ, the cards Codex
// has data for). The rail docks where the session column has room (shared-18 My) and is a
// floating panel the toggle raises where it does not (jH). Cards fold per session and hide from
// a header's context menu (VZ); 环境 always shows. Codex has no presets, pull requests, preview
// servers or outputs, so those cards are left out, and the order is fixed (no drag to reorder).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { compactThread, errorMessage, loginMcpServer, setRemoteControl, supports, terminateBackground } from "../lib/codex";
import { basename, formatDuration, formatTokens, parentDir } from "../lib/format";
import { openPane } from "../lib/panes";
import { setState, toast, useStore, writePref, type McpRuntime, type ThreadState } from "../lib/store";
import { setComposerDraft, useContextUsage } from "./Composer";
import { GOAL_LABELS, useNow } from "./Panes";
import { openSettings } from "./Settings";
import { PointerMenu, menuPoint } from "./Sidebar";
import { openTerminalTab } from "./Terminal";
import { Button, Icon, MenuItem, MenuSection, MenuSep, Popover, Spinner, Toggle } from "./ui";

const fail = (title: string) => (error: unknown) => toast("danger", title, errorMessage(error));

type CardId = "environment" | "goal" | "context" | "connectors" | "backgroundTasks";

const CARD_NAMES: Record<CardId, string> = { environment: "环境", goal: "目标", context: "上下文", connectors: "连接器", backgroundTasks: "后台任务" };
const CARDS = Object.keys(CARD_NAMES) as CardId[];
/** Cards that start folded (kZ); the others start open. */
const FOLDED: readonly CardId[] = ["context", "connectors", "backgroundTasks"];

interface Folds {
  collapsed: CardId[];
  expanded: CardId[];
}

interface Sections {
  folds: Record<string, Folds>;
  hidden: CardId[];
}

const SECTIONS_KEY = "codex-ui:rail-sections";
/** Folds are kept for the last 100 sessions (PZ). */
const KEPT_FOLDS = 100;

function readSections(): Sections {
  try {
    const saved = JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? "null") as Partial<Sections> | null;
    return { folds: saved?.folds ?? {}, hidden: Array.isArray(saved?.hidden) ? saved.hidden : [] };
  } catch {
    return { folds: {}, hidden: [] };
  }
}

function isOpen(sections: Sections, session: string, card: CardId): boolean {
  const folds = sections.folds[session];
  return FOLDED.includes(card) ? !!folds?.expanded.includes(card) : !folds?.collapsed.includes(card);
}

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
  const id = thread.meta.id;
  const [sections, setSections] = useState(readSections);
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

  const save = (next: Sections) => {
    setSections(next);
    writePref(SECTIONS_KEY, JSON.stringify(next));
  };
  const setFolds = (folds: Folds) =>
    save({ ...sections, folds: Object.fromEntries([...Object.entries(sections.folds).filter(([key]) => key !== id), [id, folds]].slice(-KEPT_FOLDS)) });
  const fold = (card: CardId): Fold => ({
    open: isOpen(sections, id, card),
    onOpen: (open, all) => {
      // Alt+click opens or folds every card (c73f45bc3 Xv setAllOpen).
      if (all) return setFolds(open ? { collapsed: [], expanded: [...FOLDED] } : { collapsed: CARDS.filter((c) => !FOLDED.includes(c)), expanded: [] });
      const folds = sections.folds[id] ?? { collapsed: [], expanded: [] };
      if (FOLDED.includes(card)) setFolds({ ...folds, expanded: open ? [...without(folds.expanded, card), card] : without(folds.expanded, card) });
      else setFolds({ ...folds, collapsed: open ? without(folds.collapsed, card) : [...without(folds.collapsed, card), card] });
    },
    onMenu: (event) => {
      event.preventDefault();
      setMenu(menuPoint(event));
    },
  });
  const shown = (card: CardId) => !sections.hidden.includes(card);

  return (
    <aside ref={panel} className="rail" data-overlay={floating || undefined} aria-label="会话详情" tabIndex={-1}>
      <div className="rail-scroll scroll-fade-y">
        <EnvironmentCard thread={thread} fold={fold("environment")} />
        {shown("goal") && <GoalCard thread={thread} fold={fold("goal")} />}
        {shown("context") && <ContextCard thread={thread} fold={fold("context")} />}
        {shown("connectors") && <ConnectorsCard thread={thread} fold={fold("connectors")} />}
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
              onClick={() => save({ ...sections, hidden: shown(card) ? [...sections.hidden, card] : without(sections.hidden, card) })}
            />
          ))}
          <MenuSep />
          <MenuItem
            label="重置为默认值"
            disabled={sections.hidden.length === 0}
            onClick={() => {
              setMenu(null);
              save({ ...sections, hidden: [] });
            }}
          />
        </PointerMenu>
      )}
    </aside>
  );
}

/**
 * A card (c73f45bc3 Xv): the heading toggles it, the caret turns and the summary hides while it
 * is open; a right click on the heading opens the rail's menu.
 */
function Card({ id, summary, fold, children }: { id: CardId; summary?: ReactNode; fold: Fold; children: ReactNode }) {
  return (
    <section className="rail-card" data-rail-card={id}>
      <h3 className="rail-card-top" onContextMenu={fold.onMenu}>
        <button type="button" className="rail-card-head" aria-expanded={fold.open} onClick={(event) => fold.onOpen(!fold.open, event.altKey)}>
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
          {all ? "显示更少" : "显示更多"}
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
        <span className="rail-label">这台电脑</span>
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
                  label="复制分支名"
                  onClick={() => {
                    close();
                    copy(branch, "分支名已复制到剪贴板。");
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
                .catch(fail("Remote Control 切换失败"))
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
          {more ? "显示更少" : "显示更多"}
        </button>
      )}
    </Card>
  );
}

/**
 * 上下文 (c73f45bc3 ay → c2d611398 ke, layout "rail"): Codex reports no breakdown, so it is the
 * headline (已使用 n% · used / max), the 4px bar and, from 50%, the compact row. Folded, the
 * summary is the percentage with a small meter (Qv rollup).
 */
function ContextCard({ thread, fold }: { thread: ThreadState; fold: Fold }) {
  const context = useContextUsage(thread);
  const { pct } = context;
  const summary = context.noData ? undefined : pct === null ? context.summary : (
    <span className="rail-rollup">
      <span>{pct}%</span>
      <span className="rail-meter" aria-hidden="true">
        <span data-level={context.level} style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
    </span>
  );
  return (
    <Card id="context" summary={summary} fold={fold}>
      {context.noData ? (
        <p className="rail-note">发送消息后即可查看上下文用量。</p>
      ) : (
        <div className="rail-context">
          <div className="rail-context-head">
            {pct !== null && <span>已使用 {pct}%</span>}
            <span className="rail-context-value">{context.summary}</span>
          </div>
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
        </div>
      )}
      {context.canCompact && (
        <div className="rail-compact">
          <span className="rail-compact-hint">{context.compactHint}</span>
          <Button
            size="xs"
            disabled={context.running}
            tip={context.running ? "Codex 完成本轮后可用" : undefined}
            onClick={() => compactThread(thread.meta.id).catch(fail("压缩失败"))}
          >
            压缩会话
          </Button>
        </div>
      )}
    </Card>
  );
}

type ServerState = "auth" | "failed" | "unavailable" | undefined;

/** A server that needs a sign-in again or failed asks to be reconnected; a cancelled one is unavailable. */
function serverState({ status, failureReason }: McpRuntime): ServerState {
  if (status === "failed") return failureReason === "reauthenticationRequired" ? "auth" : "failed";
  return status === "cancelled" ? "unavailable" : undefined;
}

/**
 * 连接器 (cf74bc599 lD): this session's MCP servers, three before 显示更多; the summary counts the
 * connected ones, or those to reconnect. A server that needs a sign-in starts it; the others open
 * 设置 › 连接器. Hidden while the session has none.
 */
function ConnectorsCard({ thread, fold }: { thread: ThreadState; fold: Fold }) {
  const servers = Object.entries(thread.mcp).map(([name, runtime]) => ({ name, state: serverState(runtime) }));
  if (servers.length === 0) return null;
  const reconnect = servers.filter((server) => server.state === "auth" || server.state === "failed").length;
  const unavailable = servers.filter((server) => server.state === "unavailable").length;
  return (
    <Card id="connectors" summary={reconnect > 0 ? `${reconnect} 个需重新连接` : `已连接 ${servers.length - unavailable} 个`} fold={fold}>
      <Limited items={servers} limit={3}>
        {({ name, state }) => (
          <button
            key={name}
            type="button"
            className="rail-row"
            onClick={() => (state === "auth" ? loginMcpServer(name, thread.meta.id).catch(fail("登录失败")) : openSettings("connectors", "setting-connectors-mcp"))}
          >
            <span className="rail-icon">
              <Icon name="Connectors" size="sm" />
            </span>
            {/* codex_apps carries the ChatGPT apps of 设置 › 连接器 › 应用. */}
            <span className="rail-label">{name === "codex_apps" ? "应用" : name}</span>
            {state === "unavailable" ? (
              <span className="rail-meta">不可用</span>
            ) : (
              state && (
                <span className="rail-meta" data-warning="">
                  {state === "auth" ? "登录" : "重新连接"}
                </span>
              )
            )}
          </button>
        )}
      </Limited>
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
      .catch(fail("停止失败"))
      .finally(() => setStopping((list) => without(list, processId)));
  };
  return (
    <Card id="backgroundTasks" summary={`${tasks.length} 个运行中`} fold={fold}>
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
