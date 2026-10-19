// The transcript, after the Code tab of Claude Desktop 2.42304.0.0 (c96d752d0 / cf74bc599 /
// shared-styles) with the server switches off: turns in order with steered messages inline,
// the working line, the hover rows and the right-click menu, session chapters (table of
// contents + pinned headings), find-hit highlights, scroll pinning, older pages loading near
// the top, the empty / loading / failed states and jump-to-latest.

import type { ThreadItem } from "@protocol/v2/ThreadItem";
import { ChevronDown, Pin, RotateCcw, Split } from "lucide-react";
import {
  Fragment,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { forkThread, loadTurns, modelLabel, newChat, openThread, requestThreadId, retryFaster } from "../lib/codex";
import { timeAgo } from "../lib/format";
import { renderMarkdown } from "../lib/markdown";
import { togglePane } from "../lib/panes";
import { bucket, clockText, nextView, STEADY, steadyStep, thinkingLabel, thinkingPhase, tokenText } from "../lib/session";
import { dismissToast, getState, setSessionView, setState, toast, useStore, type Notice, type ThreadState, type TurnState } from "../lib/store";
import {
  activeChapter,
  chapterList,
  chapterTitle,
  hookFeedback,
  NO_CHAPTERS,
  pinChapter,
  quoteText,
  removeChapter,
  renameChapter,
  retryParts,
  showsToc,
  toolBlocks,
  unpinChapter,
  type Block,
  type Chapter,
  type ChapterStore,
  type UserChapter,
} from "../lib/transcript";
import { appendComposerText, setComposerDraft } from "./Composer";
import type { FindHit } from "./FindBar";
import {
  AgentMessage,
  AllowKey,
  CommandRow,
  CopyKey,
  ErrorRow,
  FileRow,
  GenericRow,
  HookLine,
  isSystemNotice,
  McpRow,
  messageText,
  NoticeRow,
  PlanRow,
  PromptBlocked,
  Reasoning,
  ReviewRow,
  SystemNotices,
  UserBubble,
  UserShell,
  ViewContext,
  WebSearchRow,
  type RowExtra,
} from "./items";
import { Button, MenuItem, MenuSep, Popover, Skeleton, Spark, Spinner } from "./ui";

type ItemOf<T extends ThreadItem["type"]> = Extract<ThreadItem, { type: T }>;

function useNow(active: boolean, every = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [active, every]);
  return now;
}

/**
 * code-reply-flash-accent on your message, 1.2s, as an overlay under its text (c96d752d0 74891,
 * shared-styles 2137); with reduced motion it is a still tint for as long.
 */
function flash(el: Element | null | undefined): void {
  if (!(el instanceof HTMLElement)) return;
  delete el.dataset.flash;
  void el.offsetWidth;
  el.dataset.flash = "accent";
  setTimeout(() => delete el.dataset.flash, 1200);
}

/** CopyAction: rich text (the Markdown as HTML) with the Markdown as plain text. */
function copyRich(markdown: string, breaks = false): Promise<void> {
  if (typeof ClipboardItem === "undefined") return navigator.clipboard.writeText(markdown);
  const blob = (text: string, type: string) => new Blob([text], { type });
  return navigator.clipboard.write([new ClipboardItem({ "text/html": blob(renderMarkdown(markdown, breaks), "text/html"), "text/plain": blob(markdown, "text/plain") })]);
}

const copyText = (text: string) => void navigator.clipboard.writeText(text).catch(() => {});

/** A turn's replies, joined (c96d752d0 h2: copy and the chapter seed take every text item). */
const replyText = (turn: TurnState) =>
  turn.items
    .flatMap((item) => (item.type === "agentMessage" && item.text ? [item.text] : []))
    .join("\n\n");

/** Rewind to here: thread/revert cannot be undone, so the rewind dialog confirms it first; the text goes back into the composer. */
function rewindHere(threadId: string, turnId: string, prompt: string): void {
  setState({ dialog: { type: "rewind", threadId, turnId, text: prompt } });
}

const FORKING = "正在创建分支会话…";

const nextFrames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/**
 * Fork from here (caec4a2d4 Wn): a reply forks through its turn; your message forks through the
 * turn before it and comes back in the new session's composer (prefillText) — before the first
 * turn that is a new session in the same folder. 400ms in, 正在创建分支会话… shows until it is
 * done; success opens the fork without a toast.
 */
async function forkFrom(threadId: string, through: string | null, prefill?: string): Promise<void> {
  const timer = setTimeout(() => toast("neutral", FORKING), 400);
  try {
    if (through === null) {
      const cwd = getState().threads[threadId]?.settings?.cwd ?? getState().threads[threadId]?.meta.cwd;
      if (cwd) setState((s) => ({ prefs: { ...s.prefs, cwd, projectId: null } }));
      newChat();
      await nextFrames();
    } else {
      await forkThread(threadId, through);
    }
    if (prefill) setComposerDraft(prefill);
  } catch {
    toast("danger", "无法为此会话创建分支。");
  } finally {
    clearTimeout(timer);
    const shown = getState().toasts.find((t) => t.title === FORKING);
    if (shown) dismissToast(shown.id);
  }
}

// ---------------------------------------------------------------------------
// Chapters: pins live in localStorage per thread (the original keeps "epitaxy-chapters-v2").

const CHAPTERS_KEY = "codex-ui:chapters";

function readChapters(): Record<string, ChapterStore> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CHAPTERS_KEY) ?? "{}");
    return value && typeof value === "object" ? (value as Record<string, ChapterStore>) : {};
  } catch {
    return {};
  }
}

let chapterBook = readChapters();
const chapterListeners = new Set<() => void>();

function subscribeChapters(listener: () => void) {
  chapterListeners.add(listener);
  return () => void chapterListeners.delete(listener);
}

function chaptersOf(threadId: string): ChapterStore {
  const store = chapterBook[threadId];
  return Array.isArray(store?.userChapters) ? store : NO_CHAPTERS;
}

function useChapters(threadId: string): ChapterStore {
  return useSyncExternalStore(subscribeChapters, () => chaptersOf(threadId));
}

function editChapters(threadId: string, edit: (store: ChapterStore) => ChapterStore): void {
  const current = chaptersOf(threadId);
  const next = edit(current);
  if (next === current) return;
  chapterBook = { ...chapterBook, [threadId]: next };
  try {
    localStorage.setItem(CHAPTERS_KEY, JSON.stringify(chapterBook));
  } catch {
    // Private mode: pins last until the window closes.
  }
  for (const listener of chapterListeners) listener();
}

/** 固定为章节 / 取消固定章节 for the reply of `turnId`; the title is its first line (empty when it has none). */
function togglePin(threadId: string, turnId: string, text: string): void {
  editChapters(threadId, (store) =>
    store.userChapters.some((chapter) => chapter.afterId === turnId)
      ? unpinChapter(store, turnId)
      : pinChapter(store, turnId, chapterTitle(text), `uch-${crypto.randomUUID()}`),
  );
}

/** Renames in place: Enter or blur commits, Esc cancels (cf74bc599 Cb, c96d752d0 yZ). */
function TitleInput({ value, label, className, onDone }: { value: string; label: string; className: string; onDone(title: string | null): void }) {
  const [draft, setDraft] = useState(value);
  const settled = useRef(false);
  const finish = (title: string | null) => {
    if (settled.current) return;
    settled.current = true;
    onDone(title && title !== value ? title : null);
  };
  return (
    <input
      className={className}
      value={draft}
      autoFocus
      aria-label={label}
      maxLength={120}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          finish(draft.trim());
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        }
      }}
      onBlur={() => finish(draft.trim())}
    />
  );
}

/** The pinned reply's heading (c96d752d0 yZ), first in the reply's items: double-click renames it. */
function ChapterHeading({ threadId, chapter }: { threadId: string; chapter: UserChapter }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <div className="chapter-heading">
        <TitleInput
          value={chapter.title}
          label="章节标题"
          className="chapter-input"
          onDone={(title) => {
            setEditing(false);
            if (title) editChapters(threadId, (store) => renameChapter(store, chapter.id, title));
          }}
        />
      </div>
    );
  }
  return (
    <h2 id={`epitaxy-ch-${chapter.id}`} className="chapter-heading" aria-hidden={!chapter.title || undefined} onDoubleClick={() => setEditing(true)}>
      {chapter.title}
    </h2>
  );
}

/** A menu at the pointer: a Popover anchored to a zero-size fixed point. */
function PointerMenu({ at, onClose, children }: { at: { x: number; y: number } | null; onClose(): void; children: ReactNode }) {
  return (
    <div className="pointer-menu">
      <Popover open={!!at} onClose={onClose} anchor={<span className="pointer-anchor" style={at ? { left: at.x, top: at.y } : undefined} />}>
        {children}
      </Popover>
    </div>
  );
}

function anchorOf(root: HTMLElement, chapter: Chapter): Element | null {
  return chapter.source === "session"
    ? root.querySelector(`[data-turn-id="${CSS.escape(chapter.anchor)}"]`)
    : root.querySelector(`#${CSS.escape(`epitaxy-ch-${chapter.id}`)}`);
}

/**
 * Session chapters (cf74bc599 xb / Sb / Cb): ticks in the left gutter, the list on hover or
 * focus. The current chapter is the last one above the viewport top + 64px, or the last one
 * within 8px of the bottom. A jump goes to the top, or 20px above the heading (scrollToChapter).
 */
function ChaptersToc({ threadId, chapters, scroller }: { threadId: string; chapters: Chapter[]; scroller: RefObject<HTMLDivElement | null> }) {
  const [active, setActive] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = root.getBoundingClientRect().top;
      const tops = chapters.map((chapter) => {
        const el = anchorOf(root, chapter);
        return el ? el.getBoundingClientRect().top - top : null;
      });
      setActive(activeChapter(tops, 64, root.scrollHeight - root.scrollTop - root.clientHeight <= 8));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [scroller, chapters]);

  const jump = (chapter: Chapter) => {
    const root = scroller.current;
    const heading = root && chapter.source === "user" ? anchorOf(root, chapter) : null;
    if (!root) return;
    const top = heading ? root.scrollTop + heading.getBoundingClientRect().top - root.getBoundingClientRect().top - 20 : 0;
    root.scrollTo({ top: Math.max(0, Math.min(top, root.scrollHeight - root.clientHeight)), behavior: "smooth" });
  };
  const close = () => {
    if (!menu && !renaming) setOpen(false);
  };

  return (
    <div className="epitaxy-toc" data-ready={active !== null || undefined}>
      <nav
        className="toc-nav"
        aria-label="会话章节"
        tabIndex={0}
        onFocus={() => setOpen(true)}
        onMouseLeave={close}
        onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && close()}
      >
        <ol className="toc-ticks" aria-hidden="true" onMouseEnter={() => setOpen(true)}>
          {chapters.map((chapter, index) => (
            <li key={chapter.id} data-current={index === active || undefined}>
              <span />
            </li>
          ))}
        </ol>
        <div className="toc-panel" data-open={open || undefined}>
          <ol className="toc-list">
            {chapters.map((chapter, index) =>
              renaming === chapter.id ? (
                <li key={chapter.id} className="toc-row" data-editing="">
                  <span className="toc-mark" />
                  <TitleInput
                    value={chapter.title}
                    label="章节标题"
                    className="toc-input"
                    onDone={(title) => {
                      setRenaming(null);
                      if (title) editChapters(threadId, (store) => renameChapter(store, chapter.id, title));
                    }}
                  />
                </li>
              ) : (
                <li key={chapter.id}>
                  <button
                    type="button"
                    className="toc-row"
                    aria-current={index === active || undefined}
                    onClick={() => jump(chapter)}
                    onDoubleClick={chapter.source === "user" ? () => setRenaming(chapter.id) : undefined}
                    onContextMenu={(event) => {
                      if (chapter.source !== "user") return;
                      event.preventDefault();
                      event.stopPropagation();
                      setMenu({ id: chapter.id, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <span className="toc-mark" />
                    <span className="toc-title">{chapter.title}</span>
                  </button>
                </li>
              ),
            )}
          </ol>
        </div>
      </nav>
      <PointerMenu at={menu} onClose={() => setMenu(null)}>
        <MenuItem
          label="重命名"
          onClick={() => {
            setRenaming(menu?.id ?? null);
            setMenu(null);
          }}
        />
        <MenuSep />
        <MenuItem
          label="删除"
          danger
          onClick={() => {
            const id = menu?.id;
            setMenu(null);
            if (id) editChapters(threadId, (store) => removeChapter(store, id));
          }}
        />
      </PointerMenu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Working line (default design, c96d752d0 w8 / T8)

const TOOL_TYPES = new Set(["commandExecution", "fileChange", "mcpToolCall", "webSearch", "dynamicToolCall", "collabAgentToolCall", "imageGeneration"]);

/** S8 + uM: the waiting label settles (session.ts steadyStep), re-rendering when a change is due. */
function useSteadyLabel(label: string | null, hold: boolean, working: boolean): string | null {
  const state = useRef(STEADY);
  const [, wake] = useReducer((n: number) => n + 1, 0);
  const step = steadyStep(state.current, label, hold, working, Date.now());
  state.current = step.state;
  const at = step.wake;
  useEffect(() => {
    if (at === null) return;
    const timer = setTimeout(wake, Math.max(0, at - Date.now()));
    return () => clearTimeout(timer);
  }, [at]);
  return step.state.shown;
}

/** zet: {n} 个任务运行中, then {n} 个任务已完成 for 1.5s after the last one ends. */
function useTasks(count: number): string | null {
  const [finished, setFinished] = useState(0);
  const last = useRef(count);
  useEffect(() => {
    const before = last.current;
    last.current = count;
    if (count > 0 || before === 0) return;
    setFinished(before);
    const timer = setTimeout(() => setFinished(0), 1500);
    return () => clearTimeout(timer);
  }, [count]);
  return count > 0 ? `${count} 个任务运行中` : finished ? `${finished} 个任务已完成` : null;
}

/**
 * The last row of the transcript: the spark (thinking only while it actually works, still
 * otherwise) and one line of footnote text — clock · tokens · tasks · label, or the stopping /
 * retrying / compacting variants. Waiting on the user hides the text (the approval card speaks
 * for it); idle, the text only counts background tasks.
 */
function WorkingLine({
  threadId,
  turn,
  timing,
  waiting,
  sending,
  connecting,
  tasks,
  tasksOpen,
}: {
  threadId: string;
  turn: TurnState | undefined;
  timing: ThreadState["timing"];
  waiting: boolean;
  /** turn/start is still in flight (h8 Sending…). */
  sending: boolean;
  /** The connection to app-server is not up (h8 Connecting…). */
  connecting: boolean;
  tasks: number;
  tasksOpen: boolean;
}) {
  const [retrying, setRetrying] = useState(false);
  const now = useNow(!!turn);
  const taskText = useTasks(tasks);
  const working = (!!turn || sending) && !waiting;
  const items = turn?.items.filter((item) => item.type !== "userMessage") ?? [];
  const last = items.at(-1);
  const seconds = turn ? Math.max(0, (now - (turn.startedAt ?? now / 1000) * 1000) / 1000) : 0;
  const clockShown = bucket(seconds) >= 2;
  // Characters / 4, like the original's estimate: replies and reasoning streamed so far.
  const chars = items.reduce(
    (sum, item) => sum + (item.type === "agentMessage" ? item.text.length : item.type === "reasoning" ? [...item.summary, ...item.content].join("").length : 0),
    0,
  );
  const tokens = clockShown && chars >= 4 ? tokenText(Math.round(chars / 4)) : null;
  const reasoning = items.findLast((item) => item.type === "reasoning");
  const span = reasoning ? timing[reasoning.id] : undefined;
  // A reasoning item that is no longer last has ended even if its completion was missed.
  const thinking = span ? thinkingPhase(now, span[0], span[1] ?? (reasoning === last ? null : span[0])) : null;
  const thought = thinking === null ? null : thinking.kind === "active" ? thinkingLabel(seconds) : `已思考 ${thinking.seconds} 秒`;
  const toolLive = !!last && TOOL_TYPES.has(last.type) && "status" in last && last.status === "inProgress";
  const wanted = !working ? null : sending && !turn ? "正在发送…" : !last ? "等待 Codex…" : toolLive ? "正在运行工具…" : null;
  const steady = useSteadyLabel(wanted && connecting ? "正在连接…" : wanted, working && !tokens && thought === null, working);
  const review = turn?.reviews?.find((r) => r.review.status === "inProgress");
  const compacting = last?.type === "contextCompaction" && !timing[last.id]?.[1];
  const clock = clockShown ? clockText(seconds) : null;

  let state = "stats";
  let parts: (ReactNode | null)[] = [];
  let label: string | null = null;
  let shimmer = true;
  if (!working && !turn?.stopping) {
    state = "idle";
  } else if (turn?.stopping) {
    state = "stopping";
    label = "正在停止…";
  } else if (turn?.retrying) {
    const retry = retryParts(turn.retrying);
    state = "retrying";
    parts = [retry.reason, retry.attempt !== null ? `正在重试（${retry.attempt}/${retry.max}）` : "正在重试", clock];
  } else if (compacting) {
    state = "compacting";
    parts = ["正在压缩会话…", clock];
  } else {
    parts = [clock, tokens];
    if (review) label = `正在自动审查：${review.summary}`;
    else if (turn?.buffering) label = "正在多想一会儿";
    else if (thought) {
      label = thought;
      shimmer = thinking?.kind === "active";
    } else label = steady;
  }
  const tasksKey = (state === "stats" || state === "stopping" || state === "idle") && taskText && (
    <button key="tasks" type="button" className="working-action" aria-pressed={tasksOpen} onClick={() => togglePane("background")}>
      {taskText}
    </button>
  );
  const labelText = label && (
    <span key={label} className="working-label" data-shimmer={shimmer || undefined}>
      {label}
    </span>
  );
  // Stats read … · tasks · label; stopping reads 正在停止… · tasks (w8).
  parts.push(...(state === "stopping" ? [labelText, tasksKey] : [tasksKey, labelText]));
  // Codex safety buffering: the TUI's "Retry with a faster model".
  if (state === "stats" && turn?.buffering?.fasterModel) {
    parts.push(
      <button
        key="faster"
        type="button"
        className="working-action"
        disabled={retrying}
        onClick={() => {
          setRetrying(true);
          retryFaster(threadId)
            .catch(() => toast("danger", "无法改用更快的模型重试"))
            .finally(() => setRetrying(false));
        }}
      >
        改用更快的模型重试
      </button>,
    );
  }
  const shownParts = parts.filter(Boolean);
  const visible = shownParts.length > 0 && (working || !!turn?.stopping || !!taskText);
  return (
    <div className="working-line" data-turn-working={working ? "true" : "false"} role="status" aria-label={(visible && (label ?? taskText)) || undefined}>
      <span className="working-spark" data-state={working || turn?.stopping ? "thinking" : undefined}>
        <Spark size={18} />
      </span>
      <span key={state} className="working-text" data-empty={!visible || undefined} aria-hidden={!visible || undefined}>
        {shownParts.map((part, index) => (
          <Fragment key={index}>
            {index > 0 && <span className="working-dot">·</span>}
            {part}
          </Fragment>
        ))}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Turns

/** Time (c96d752d0 ZF): relative, the exact time on hover. */
function Stamp({ seconds }: { seconds: number }) {
  const date = new Date(seconds * 1000);
  return (
    <time className="msg-meta msg-time" dateTime={date.toISOString()} data-tip={date.toLocaleString("zh-CN")}>
      {timeAgo(seconds)}
    </time>
  );
}

/**
 * A message action with a two-line tooltip (c96d752d0 $F: label and detail); disabled, the
 * tooltip gives the reason instead.
 */
function ActionKey({ icon, label, detail, reason, onClick }: { icon: ReactNode; label: string; detail: string; reason?: string; onClick(): void }) {
  const key = (
    <Button
      variant="ghost"
      muted
      icon={icon}
      label={label}
      tip={reason ?? label}
      data-tip-detail={reason ? undefined : detail}
      aria-description={reason ?? detail}
      disabled={!!reason}
      onClick={onClick}
    />
  );
  return reason ? (
    <span className="action-reason" data-tip={reason}>
      {key}
    </span>
  ) : (
    key
  );
}

const REWIND_DETAIL = "删除这条消息及其后的所有内容。";
const FORK_DETAIL = "从这里开始一个新会话，当前会话保持不变。";

const TurnView = memo(function TurnView({
  turn,
  threadId,
  cwd,
  timing,
  pendingItems,
  idle,
  model,
  fresh,
  notices,
  progress,
  forkBase,
}: {
  turn: TurnState;
  threadId: string;
  cwd: string;
  timing: ThreadState["timing"];
  pendingItems: Set<string>;
  /** No turn is running, so history can be rewound from here. */
  idle: boolean;
  model: string;
  /** User messages that arrived after the transcript mounted. */
  fresh: Set<string>;
  notices: Notice[];
  progress: ThreadState["progress"];
  /** The turn your message forks through: the one before (null: none; undefined: not loaded yet). */
  forkBase: string | null | undefined;
}) {
  const live = turn.status === "inProgress";
  // Items a finished turn left mid-flight (interrupt, failure) read 已停止 instead of spinning.
  const items = useMemo(
    () => (live ? turn.items : turn.items.map((item) => ("status" in item && item.status === "inProgress" ? ({ ...item, status: "stopped" } as unknown as ThreadItem) : item))),
    [live, turn.items],
  );
  const prompt = items.find((item): item is ItemOf<"userMessage"> => item.type === "userMessage");
  const promptText = prompt ? messageText(prompt.content) : "";
  const blocks = useMemo(() => toolBlocks(items.filter((item) => item !== prompt)), [items, prompt]);
  const pin = useChapters(threadId).userChapters.find((chapter) => chapter.afterId === turn.id);
  const reviews = (turn.reviews ?? []).filter((r) => r.review.status === "denied" || r.review.status === "timedOut");
  const ids = new Set(items.map((item) => item.id));
  const loose = reviews.filter((r) => !r.targetItemId || !ids.has(r.targetItemId));
  const hooks = turn.hooks ?? [];
  const blockedPrompt = hooks.find((run) => run.eventName === "userPromptSubmit" && run.status === "blocked");
  const hookLines = hooks.filter((run) => run.status === "failed" || run.status === "stopped" || (run.status === "blocked" && run.eventName !== "userPromptSubmit"));
  const notes = useMemo(
    () =>
      hookFeedback(
        turn.hooks ?? [],
        turn.items.flatMap((item) => (TOOL_TYPES.has(item.type) && timing[item.id] ? [{ id: item.id, start: timing[item.id][0], end: timing[item.id][1] }] : [])),
      ),
    [turn.hooks, turn.items, timing],
  );
  const mine = notices.filter((notice) => notice.turnId === turn.id);
  const systemNotices = mine.filter(isSystemNotice);
  const lastBlock = blocks.at(-1);
  // The todo row sits before the closing reply of a finished turn, else at the end.
  const planAt = !turn.plan ? -1 : !live && lastBlock?.kind === "item" && lastBlock.item.type === "agentMessage" ? blocks.length - 1 : blocks.length;

  const itemLive = (item: ThreadItem) => live && (timing[item.id] ? timing[item.id][1] === undefined : item === turn.items.at(-1));
  const extraOf = (blockIds: string[]): RowExtra => {
    const review = reviews.find((r) => r.targetItemId && blockIds.includes(r.targetItemId));
    const note = blockIds.flatMap((id) => notes.get(id) ?? []);
    return {
      pending: blockIds.some((id) => pendingItems.has(id)),
      note: note.length ? note : undefined,
      blocked: review ? { badge: review.review.status === "denied" && review.overridable ? <AllowKey review={review} threadId={threadId} turnId={turn.id} /> : null } : undefined,
    };
  };
  const render = (block: Block): ReactNode => {
    if (block.kind === "reads") return <CommandRow items={block.items} startedAt={timing[block.items[0].id]?.[0]} extra={extraOf(block.items.map((item) => item.id))} />;
    if (block.kind === "file") return <FileRow parts={block.parts} cwd={cwd} extra={extraOf([...new Set(block.parts.map((part) => part.item.id))])} />;
    const item = block.item;
    const running = itemLive(item);
    const extra = extraOf([item.id]);
    switch (item.type) {
      case "userMessage":
        return (
          <UserBubble
            item={item}
            entering={fresh.has(item.id)}
            receipt={live}
            actions={<CopyKey text={() => copyRich(messageText(item.content), true)} ms={2000} always />}
          />
        );
      case "agentMessage":
        return <AgentMessage item={item} streaming={running} />;
      case "reasoning":
        return <Reasoning item={item} />;
      case "commandExecution":
        return item.source === "userShell" ? <UserShell item={item} /> : <CommandRow items={[item]} startedAt={timing[item.id]?.[0]} extra={extra} />;
      case "mcpToolCall":
        return <McpRow item={item} progress={progress[item.id]} extra={extra} />;
      case "webSearch":
        return <WebSearchRow item={item} running={running} />;
      default:
        return <GenericRow item={item} live={running} extra={extra} />;
    }
  };
  const keyOf = (block: Block) => (block.kind === "item" ? block.item.id : block.kind === "reads" ? block.items[0].id : `${block.parts[0].item.id}:${block.parts[0].index}`);
  const reply = replyText(turn);

  return (
    <section className="turn" data-turn-id={turn.id} data-live={live || undefined}>
      {prompt && (
        <div className="turn-prompt">
          <UserBubble
            item={prompt}
            entering={fresh.has(prompt.id)}
            actions={
              <>
                {turn.startedAt ? <Stamp seconds={turn.startedAt} /> : null}
                {promptText && <CopyKey text={() => copyRich(promptText, true)} ms={2000} always />}
                <ActionKey
                  icon={<RotateCcw size={16} />}
                  label="回退到这里"
                  detail={REWIND_DETAIL}
                  reason={idle ? undefined : "Codex 工作时无法回退"}
                  onClick={() => rewindHere(threadId, turn.id, promptText)}
                />
                {forkBase !== undefined && (
                  <ActionKey icon={<Split size={16} />} label="从这里分支" detail={FORK_DETAIL} onClick={() => void forkFrom(threadId, forkBase, promptText)} />
                )}
              </>
            }
          />
          {blockedPrompt && <PromptBlocked run={blockedPrompt} prompt={promptText} />}
        </div>
      )}
      <div className="reply-row">
        <div className="agent-flow" data-cds="AssistantMessage" data-text-size="">
          {pin && <ChapterHeading threadId={threadId} chapter={pin} />}
          {blocks.map((block, index) => (
            <Fragment key={keyOf(block)}>
              {index === planAt && turn.plan && <PlanRow plan={turn.plan} />}
              {render(block)}
            </Fragment>
          ))}
          {planAt === blocks.length && turn.plan && <PlanRow plan={turn.plan} />}
          {loose.map((review) => (
            <ReviewRow key={review.id} review={review} threadId={threadId} turnId={turn.id} />
          ))}
          {hookLines.map((run) => (
            <HookLine key={run.id} run={run} />
          ))}
          {systemNotices.length > 0 && <SystemNotices notices={systemNotices} />}
          {mine.map((notice) => !isSystemNotice(notice) && <NoticeRow key={notice.id} notice={notice} />)}
          {turn.status === "failed" && turn.error && <ErrorRow text={turn.error.message} details={turn.error.additionalDetails} />}
        </div>
        {!live && blocks.length > 0 && (
          <div className="msg-actions" role="toolbar" aria-label="消息操作" data-find-omitted="">
            {reply && <CopyKey text={() => copyRich(reply)} ms={2000} always />}
            <ActionKey icon={<Split size={16} />} label="从这里分支" detail={FORK_DETAIL} onClick={() => void forkFrom(threadId, turn.id)} />
            <Button
              variant="ghost"
              muted
              icon={<Pin size={16} fill={pin ? "currentColor" : "none"} />}
              label={pin ? "取消固定章节" : "固定为章节"}
              aria-pressed={!!pin}
              onClick={() => togglePin(threadId, turn.id, reply)}
            />
            <span className="msg-meta">{model}</span>
            {turn.completedAt ? (
              <>
                <span className="msg-meta" aria-hidden="true">
                  ·
                </span>
                <Stamp seconds={turn.completedAt} />
              </>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
});

// ---------------------------------------------------------------------------
// Find hits (U25): the find bar announces `codex:find`; the hit scrolls into view and its
// matches light up through the CSS Custom Highlight API. Toolbars and the like are skipped
// (data-find-omitted).

const FIND_SKIP = "[data-find-omitted], .row-actions, .msg-actions, .msg-meta, .user-fold";

function rangesOf(root: Element, term: string): Range[] {
  const needle = term.toLowerCase();
  const ranges: Range[] = [];
  if (!needle) return ranges;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest(FIND_SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const haystack = node.data.toLowerCase();
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
    }
  }
  return ranges;
}

function showHit(root: HTMLElement, hit: FindHit | null): boolean {
  const highlights = "highlights" in CSS ? CSS.highlights : null;
  highlights?.delete("find-hit");
  highlights?.delete("find-hit-active");
  if (!hit) return true;
  const el = root.querySelector(`[data-entry-id="${CSS.escape(hit.itemId)}"]`) ?? root.querySelector(`[data-turn-id="${CSS.escape(hit.turnId)}"]`);
  if (!el) return false;
  el.scrollIntoView({ block: "center" });
  const ranges = rangesOf(el, hit.term);
  if (highlights && ranges.length) {
    highlights.set("find-hit-active", new Highlight(ranges[0]));
    if (ranges.length > 1) highlights.set("find-hit", new Highlight(...ranges.slice(1)));
  }
  return true;
}

// ---------------------------------------------------------------------------
// Transcript

interface ContextTarget {
  x: number;
  y: number;
  turnId: string;
  /** The user message under the pointer (the prompt, or one steered in); null over the reply. */
  entry: string | null;
  selection: string;
  /** A code block, a file path or inline code under the pointer (not on a link). */
  code: { text: string; kind: "block" | "path" | "inline" } | null;
  href: string | null;
}

/** Near the top, older pages load (c96d752d0 bTe, gTe = 1200px). */
const NEAR_TOP = 1200;

export function Transcript({ thread }: { thread: ThreadState }) {
  const requests = useStore((s) => s.requests);
  const defaultView = useStore((s) => s.defaultView);
  const connecting = useStore((s) => s.conn.status !== "ready");
  const threadId = thread.meta.id;
  const tasksOpen = useStore((s) => s.panes[threadId]?.open.includes("background") ?? false);
  const view = thread.view ?? defaultView;
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastUserScroll = useRef(0);
  const restore = useRef<{ height: number; top: number; count: number } | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [context, setContext] = useState<ContextTarget | null>(null);
  const chapterStore = useChapters(threadId);

  const pendingItems = useMemo(() => {
    const ids = new Set<string>();
    for (const request of requests) {
      const params = request.params as { itemId?: string };
      if (requestThreadId(request) === threadId && params.itemId) ids.add(params.itemId);
    }
    return ids;
  }, [requests, threadId]);
  const waiting = requests.some((request) => requestThreadId(request) === threadId);
  const liveTurn = thread.turns.findLast((turn) => turn.status === "inProgress");
  const idle = thread.loaded && !liveTurn;
  const model = modelLabel(thread.settings?.model ?? thread.meta.model);
  const lastTurnId = thread.turns.at(-1)?.id;
  const empty = thread.loaded && !thread.turns.length && !thread.sending && !liveTurn;

  // code-user-bubble-enter is only for messages that arrive after the transcript mounted
  // (Q8): everything present once the thread has loaded counts as already seen.
  const seen = useRef<{ id: string; known: Set<string>; fresh: Set<string> } | null>(null);
  if (seen.current?.id !== threadId) seen.current = null;
  if (thread.loaded) {
    const users = (turn: TurnState) => turn.items.filter((item) => item.type === "userMessage").map((item) => item.id);
    if (!seen.current) seen.current = { id: threadId, known: new Set(thread.turns.flatMap(users)), fresh: new Set() };
    const { known, fresh } = seen.current;
    for (const turn of thread.turns) {
      for (const id of users(turn)) {
        if (known.has(id)) continue;
        known.add(id);
        // Older pages loading in never animate; only the newest turn does.
        if (turn.id === lastTurnId) fresh.add(id);
      }
    }
  }
  const fresh = seen.current?.fresh ?? EMPTY;

  const chapters = useMemo(() => chapterList(thread.turns.map((turn) => turn.id), chapterStore), [thread.turns, chapterStore]);

  // Ctrl+O cycles normal -> thinking -> verbose; Ctrl+Shift+L attaches the selection (cf74bc599 Vb).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "o" && event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        const current = getState().threads[threadId]?.view ?? getState().defaultView;
        setSessionView(threadId, nextView(current));
      } else if (key === "l" && event.shiftKey && (event.ctrlKey || event.metaKey)) {
        const selection = document.getSelection();
        const text = selection?.toString().trim() ?? "";
        const root = scroller.current;
        if (!selection || text.length < 2 || !root || (document.activeElement as HTMLElement | null)?.closest("textarea, input, [contenteditable]")) return;
        for (let i = 0; i < selection.rangeCount; i++) if (!root.contains(selection.getRangeAt(i).commonAncestorContainer)) return;
        event.preventDefault();
        selection.removeAllRanges();
        appendComposerText(quoteText(text));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [threadId]);

  // Re-pin to the newest content when switching threads or when a new turn starts.
  useLayoutEffect(() => {
    pinned.current = true;
  }, [threadId, lastTurnId]);

  // Older turns paged in above: keep what was on screen in place. Otherwise follow streaming
  // output only while pinned and not within 150ms of a user scroll.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const kept = restore.current;
    if (kept) {
      if (thread.turns.length !== kept.count) el.scrollTop = kept.top + el.scrollHeight - kept.height;
      if (thread.turns.length !== kept.count || !thread.loading) restore.current = null;
      return;
    }
    if (pinned.current && performance.now() - lastUserScroll.current > 150) el.scrollTop = el.scrollHeight;
  });

  // The dock growing (an approval, a longer draft) shrinks the transcript: stay on the bottom.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A queued message sent with Send now lands with the accent flash (thread.landed).
  const landed = thread.landed;
  const flashed = useRef<string | null>(null);
  useEffect(() => {
    if (!landed || flashed.current === landed.id || Date.now() - landed.at > 10_000) return;
    const bubble = scroller.current?.querySelector(`[data-client-id="${CSS.escape(landed.id)}"] .user-bubble`);
    if (!bubble) return;
    flashed.current = landed.id;
    flash(bubble);
  }, [landed, thread.turns]);

  // Find hits: retry once after the next render when the hit's turn was only just paged in.
  useEffect(() => {
    let timer = 0;
    const onFind = (event: Event) => {
      const hit = (event as CustomEvent<FindHit | null>).detail;
      const root = scroller.current;
      clearTimeout(timer);
      if (!root) return;
      if (hit && hit.threadId !== threadId) return void showHit(root, null);
      if (hit) pinned.current = false;
      if (!showHit(root, hit)) timer = window.setTimeout(() => showHit(root, hit), 150);
    };
    window.addEventListener("codex:find", onFind);
    return () => {
      window.removeEventListener("codex:find", onFind);
      clearTimeout(timer);
      if (scroller.current) showHit(scroller.current, null);
    };
  }, [threadId]);

  const loadOlder = () => {
    const el = scroller.current;
    const current = getState().threads[threadId];
    if (!current?.olderCursor || current.loading) return;
    if (el) restore.current = { height: el.scrollHeight, top: el.scrollTop, count: current.turns.length };
    // A failure shows in the top row (无法加载更早的消息。 / 重试).
    loadTurns(threadId, true).catch(() => {});
  };

  // Too little to scroll yet: keep paging in until there is (bTe auto-drain).
  useEffect(() => {
    const el = scroller.current;
    if (!el || !thread.loaded || !thread.olderCursor || thread.loading || thread.olderError || !thread.turns.length) return;
    if (el.scrollHeight - el.clientHeight < NEAR_TOP) loadOlder();
  });

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinned.current = distance <= 40;
    setShowJump(!pinned.current && distance > 200);
    if (el.scrollTop < NEAR_TOP && !pinned.current && !thread.olderError) loadOlder();
  };
  const markUserScroll = () => {
    lastUserScroll.current = performance.now();
  };

  // GF: the transcript's own right-click menu.
  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const section = target.closest<HTMLElement>(".turn");
    const turn = thread.turns.find((t) => t.id === section?.dataset.turnId);
    if (!section || !turn || target.closest("input, textarea")) return;
    const selected = document.getSelection();
    const selection = selected && !selected.isCollapsed && section.contains(selected.anchorNode) && selected.toString().trim() ? selected.toString() : "";
    const link = target.closest("a");
    const block = target.closest(".md-code")?.querySelector("code")?.textContent;
    const path = target.closest<HTMLElement>("[data-path]")?.dataset.path;
    const inline = target.closest(":not(pre) > code")?.textContent;
    const code: ContextTarget["code"] = link
      ? null
      : block !== undefined && block !== null
        ? { text: block, kind: "block" }
        : path
          ? { text: path, kind: "path" }
          : inline
            ? { text: inline, kind: "inline" }
            : null;
    const entry = target.closest<HTMLElement>(".user-row")?.dataset.entryId ?? null;
    // A running reply with nothing to copy has nothing to offer: leave the native menu.
    if (!entry && !selection && !code && !link && turn.status === "inProgress" && !replyText(turn)) return;
    event.preventDefault();
    setContext({ x: event.clientX, y: event.clientY, turnId: turn.id, entry, selection, code, href: link?.getAttribute("href") ?? null });
  };
  const contextTurn = context ? thread.turns.find((turn) => turn.id === context.turnId) : undefined;
  const contextMenu = (() => {
    if (!context || !contextTurn) return null;
    const close = (run: () => void) => () => {
      setContext(null);
      run();
    };
    const prompt = contextTurn.items.find((item) => item.type === "userMessage");
    const promptText = prompt?.type === "userMessage" ? messageText(prompt.content) : "";
    const said = context.entry ? contextTurn.items.find((item) => item.id === context.entry) : undefined;
    const reply = replyText(contextTurn);
    const user = !!context.entry;
    // Rewind and fork work per turn, so only the turn's own prompt offers them.
    const isPrompt = user && said === prompt;
    const message = said?.type === "userMessage" ? messageText(said.content) : user ? "" : reply;
    const live = contextTurn.status === "inProgress";
    const index = thread.turns.indexOf(contextTurn);
    const forkBase = index > 0 ? thread.turns[index - 1].id : thread.olderCursor ? undefined : null;
    const pinnedHere = chapterStore.userChapters.some((chapter) => chapter.afterId === contextTurn.id);
    const ahead = !!(context.selection || context.code || context.href);
    const attach = context.selection.trim().length >= 2 ? context.selection.trim() : message;
    const canPin = !user && !live;
    const rewind = isPrompt && idle;
    const fork = user ? isPrompt && forkBase !== undefined : !live;
    return (
      <>
        {context.selection && <MenuItem label="复制" kbd="Ctrl+C" onClick={close(() => copyText(context.selection))} />}
        {context.code && (
          <MenuItem
            label={context.code.kind === "block" ? "复制代码块" : context.code.kind === "path" ? "复制路径" : "复制代码"}
            onClick={close(() => copyText(context.code?.text ?? ""))}
          />
        )}
        {context.href && (
          <>
            <MenuItem label="在默认浏览器中打开" onClick={close(() => window.open(context.href ?? "", "_blank", "noopener,noreferrer"))} />
            <MenuItem label="复制链接" onClick={close(() => copyText(context.href ?? ""))} />
          </>
        )}
        {ahead && message && <MenuSep />}
        {message && <MenuItem label="复制消息" onClick={close(() => void copyRich(message, user).catch(() => {}))} />}
        {message && <MenuItem label="将消息复制为 Markdown" onClick={close(() => copyText(message))} />}
        {(ahead || message) && (attach || canPin) && <MenuSep />}
        {attach && (
          <MenuItem
            label={attach === message ? "将消息附加为上下文" : "将所选内容附加为上下文"}
            kbd={attach === message ? undefined : "Ctrl+Shift+L"}
            onClick={close(() => {
              if (attach !== message) document.getSelection()?.removeAllRanges();
              appendComposerText(quoteText(attach));
            })}
          />
        )}
        {canPin && <MenuItem label={pinnedHere ? "取消固定章节" : "固定为章节"} onClick={close(() => togglePin(threadId, contextTurn.id, reply))} />}
        {(rewind || fork) && <MenuSep />}
        {rewind && <MenuItem label="回退到这里" hint="删除这条消息及其后的内容" onClick={close(() => rewindHere(threadId, contextTurn.id, promptText))} />}
        {fork && (
          <MenuItem
            label="从这里分支"
            hint="开始一个新会话，保留当前会话"
            onClick={close(() => void (user ? forkFrom(threadId, forkBase ?? null, promptText) : forkFrom(threadId, contextTurn.id)))}
          />
        )}
      </>
    );
  })();

  const threadHooks = thread.hooks.filter((run) => run.status === "failed" || run.status === "stopped" || run.status === "blocked");
  const looseNotices = thread.notices.filter((notice) => notice.turnId === null);
  const looseSystem = looseNotices.filter(isSystemNotice);

  return (
    <ViewContext value={view}>
      <div className="transcript-wrap">
        <div
          className="transcript"
          ref={scroller}
          role="feed"
          aria-label="聊天消息"
          aria-busy={thread.loading || !!liveTurn}
          onScroll={onScroll}
          onWheel={markUserScroll}
          onTouchMove={markUserScroll}
          onContextMenu={onContextMenu}
        >
          <div className="scroll-fade-strip-top" aria-hidden="true" />
          {thread.loadError && !thread.loaded ? (
            <div className="transcript-empty" role="alert">
              <div className="transcript-empty-text">
                <p className="transcript-empty-title">无法加载此会话</p>
                <p className="transcript-empty-body">{thread.loadError}</p>
              </div>
              <div className="transcript-empty-actions">
                <Button variant="primary" onClick={() => void openThread(threadId, true)}>
                  重试
                </Button>
              </div>
            </div>
          ) : !thread.loaded ? (
            <div className="transcript-loading" role="status">
              <span className="sr-only">正在加载会话</span>
              <Skeleton lines={2} delay="2s" />
              <Skeleton lines={4} delay="2s" />
            </div>
          ) : empty ? (
            <div className="transcript-empty">
              <div className="transcript-empty-text">
                <p className="transcript-empty-title">{thread.olderCursor ? "更早的消息尚未加载" : "还没有消息"}</p>
              </div>
            </div>
          ) : (
            <div className="transcript-list">
              {thread.olderCursor && (
                <div className="older-row" role="status" data-find-omitted="">
                  {thread.olderError ? (
                    <>
                      <span className="older-failed">无法加载更早的消息。</span>
                      <Button variant="ghost" size="xs" onClick={loadOlder}>
                        重试
                      </Button>
                    </>
                  ) : (
                    thread.loading && (
                      <>
                        <Spinner size={16} />
                        <span className="sr-only">正在加载…</span>
                      </>
                    )
                  )}
                </div>
              )}
              {threadHooks.length > 0 && (
                <div className="agent-flow thread-rows">
                  {threadHooks.map((run) => (
                    <HookLine key={run.id} run={run} />
                  ))}
                </div>
              )}
              {thread.turns.map((turn, index) => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  threadId={threadId}
                  cwd={thread.settings?.cwd ?? thread.meta.cwd}
                  timing={thread.timing}
                  pendingItems={pendingItems}
                  idle={idle}
                  model={model}
                  fresh={fresh}
                  notices={thread.notices}
                  progress={thread.progress}
                  forkBase={index > 0 ? thread.turns[index - 1].id : thread.olderCursor ? undefined : null}
                />
              ))}
              {looseNotices.length > 0 && (
                <div className="agent-flow thread-rows">
                  {looseSystem.length > 0 && <SystemNotices notices={looseSystem} />}
                  {looseNotices.map((notice) => !isSystemNotice(notice) && <NoticeRow key={notice.id} notice={notice} />)}
                </div>
              )}
              <WorkingLine
                threadId={threadId}
                turn={liveTurn}
                timing={thread.timing}
                waiting={waiting}
                sending={thread.sending}
                connecting={connecting}
                tasks={thread.background.length}
                tasksOpen={tasksOpen}
              />
            </div>
          )}
        </div>
        {empty && thread.olderCursor && (
          <div className="earlier-pill">
            {thread.loading ? (
              <span className="earlier-status" role="status">
                正在加载更早的消息…
              </span>
            ) : (
              <Button className="earlier-load" onClick={loadOlder}>
                加载更早的消息
              </Button>
            )}
          </div>
        )}
        {showsToc(chapters) && <ChaptersToc threadId={threadId} chapters={chapters} scroller={scroller} />}
        <div className="jump-host" onWheel={(event) => scroller.current?.scrollBy({ top: event.deltaY })}>
          <button
            type="button"
            className="jump-latest"
            data-shown={showJump || undefined}
            aria-label="滚动到底部"
            aria-hidden={!showJump}
            tabIndex={showJump ? 0 : -1}
            onClick={() => {
              pinned.current = true;
              scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
            }}
          >
            <ChevronDown size={12} />
          </button>
        </div>
        <PointerMenu at={context} onClose={() => setContext(null)}>
          {contextMenu}
        </PointerMenu>
      </div>
    </ViewContext>
  );
}

const EMPTY = new Set<string>();
