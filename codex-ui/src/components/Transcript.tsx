// The transcript, after the Code tab of Claude Desktop 2.42304.0.0 (c96d752d0 / cf74bc599 /
// shared-styles): turns in order with steered messages inline, the working line, message
// actions and the right-click menu, session chapters (table of contents + pinned headings),
// the sticky prompt, find-hit highlights, scroll pinning and jump-to-latest.

import type { ThreadItem } from "@protocol/v2/ThreadItem";
import { ArrowDown, Check, Copy, Ellipsis, GitFork, Pin, ThumbsDown, ThumbsUp } from "lucide-react";
import {
  Fragment,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { errorMessage, forkThread, loadTurns, modelLabel, requestThreadId, rewindAndSend, sendMessage, setOverride, summariesOff } from "../lib/codex";
import { threadTitle, timeAgo } from "../lib/format";
import { renderMarkdown } from "../lib/markdown";
import { bucket, clockText, nextView, thinkingLabel, thinkingPhase, tokenText } from "../lib/session";
import { getState, setState, toast, updateThread, useStore, type Notice, type ThreadState, type TurnState } from "../lib/store";
import {
  activeChapter,
  chapterList,
  chapterTitle,
  hookVisible,
  NO_CHAPTERS,
  pinChapter,
  quoteText,
  removeChapter,
  renameChapter,
  retryParts,
  showsToc,
  unpinChapter,
  type Chapter,
  type ChapterStore,
  type UserChapter,
} from "../lib/transcript";
import { appendComposerText } from "./Composer";
import type { FindHit } from "./FindBar";
import {
  AgentMessage,
  CommandGroup,
  CommandRow,
  ExplorationGroup,
  FileChangeCard,
  GenericRow,
  HookRow,
  isExploration,
  McpCallRow,
  messageText,
  NoticeLine,
  NoticeRow,
  PlanRow,
  Reasoning,
  ReviewRow,
  UserBubble,
  ViewContext,
  WebSearchRow,
} from "./items";
import { Button, MenuItem, MenuSep, Popover, Skeleton, Spark } from "./ui";

type ItemOf<T extends ThreadItem["type"]> = Extract<ThreadItem, { type: T }>;

const fail = (title: string) => (error: unknown) => toast("error", title, errorMessage(error));

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

/** Replays code-reply-flash (or the accent one) on `el`, 1.2s. */
function flash(el: Element | null | undefined, accent = false): void {
  if (!(el instanceof HTMLElement)) return;
  delete el.dataset.flash;
  void el.offsetWidth;
  el.dataset.flash = accent ? "accent" : "";
  const done = (event: AnimationEvent) => {
    if (!event.animationName.startsWith("code-reply-flash")) return;
    delete el.dataset.flash;
    el.removeEventListener("animationend", done);
  };
  el.addEventListener("animationend", done);
}

/** CopyAction: the reply as rich text (HTML + the Markdown as plain text). */
function copyReply(markdown: string): Promise<void> {
  if (typeof ClipboardItem === "undefined") return navigator.clipboard.writeText(markdown);
  const blob = (text: string, type: string) => new Blob([text], { type });
  return navigator.clipboard.write([new ClipboardItem({ "text/html": blob(renderMarkdown(markdown), "text/html"), "text/plain": blob(markdown, "text/plain") })]);
}

const copyText = (text: string) => void navigator.clipboard.writeText(text).catch(fail("复制失败"));

/** Rewind to here: thread/revert cannot be undone, so the rewind dialog confirms it first. */
function rewindHere(threadId: string, turnId: string, prompt: string | undefined): void {
  setState({ dialog: { type: "rewind", threadId, turnId, text: prompt ?? "" } });
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

/** 固定为章节 / 取消固定章节 for the reply of `turnId`; the title is the reply's first line. */
function togglePin(threadId: string, turnId: string, text: string): void {
  editChapters(threadId, (store) =>
    store.userChapters.some((chapter) => chapter.afterId === turnId)
      ? unpinChapter(store, turnId)
      : pinChapter(store, turnId, chapterTitle(text) || "章节", `uch-${crypto.randomUUID()}`),
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

/** The pinned reply's heading (c96d752d0 yZ): double-click renames it. */
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
    <h2 id={`epitaxy-ch-${chapter.id}`} className="chapter-heading" onDoubleClick={() => setEditing(true)}>
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
 * within 8px of the bottom.
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
    if (!root) return;
    if (chapter.source === "session") {
      root.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const heading = anchorOf(root, chapter);
    heading?.scrollIntoView({ block: "start", behavior: "smooth" });
    flash(heading?.closest(".turn")?.querySelector(".agent-flow"));
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
                    title={chapter.title}
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
// Sticky prompt (cf74bc599 Uv): once the newest user message above the viewport top + 24px
// has scrolled fully past it, its last line peeks from the top edge; click to go back.

function StickyPrompt({ scroller, turns }: { scroller: RefObject<HTMLDivElement | null>; turns: TurnState[] }) {
  const [stuck, setStuck] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (root.scrollHeight - root.scrollTop - root.clientHeight <= 8) return setStuck(null);
      const line = root.getBoundingClientRect().top + 24;
      let found: HTMLElement | null = null;
      let visible = false;
      for (const bubble of root.querySelectorAll<HTMLElement>(".user-row[data-entry-id]")) {
        const rect = bubble.getBoundingClientRect();
        if (rect.top > line) break;
        found = bubble;
        visible = rect.bottom > line;
      }
      setStuck(found && !visible ? (found.dataset.entryId ?? null) : null);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [scroller]);

  const text = useMemo(() => {
    for (const turn of turns) {
      const item = turn.items.find((entry) => entry.id === stuck);
      if (item?.type === "userMessage") return messageText(item.content).trim().slice(-800) || null;
    }
    return null;
  }, [turns, stuck]);

  // Code blocks keep their copy key below the prompt (--epitaxy-sticky-prompt-end).
  useLayoutEffect(() => {
    const el = box.current;
    const wrap = el?.closest<HTMLElement>(".transcript-wrap");
    if (!el || !wrap) return;
    const update = () => wrap.style.setProperty("--epitaxy-sticky-prompt-end", `${el.getBoundingClientRect().bottom - wrap.getBoundingClientRect().top}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      wrap.style.removeProperty("--epitaxy-sticky-prompt-end");
    };
  }, [text]);

  if (!text) return null;
  const back = () => {
    const bubble = scroller.current?.querySelector(`[data-entry-id="${CSS.escape(stuck ?? "")}"]`);
    bubble?.scrollIntoView({ block: "start", behavior: "smooth" });
    flash(bubble?.querySelector(".user-bubble"), true);
  };
  return (
    <div className="sticky-prompt" ref={box} onWheel={(event) => scroller.current?.scrollBy({ top: event.deltaY })}>
      <div className="sticky-prompt-column">
        <button type="button" className="sticky-prompt-clip" aria-label="滚动到你的消息" onClick={back}>
          <span className="sticky-prompt-bubble" data-text-size="">
            {text}
          </span>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Working line (default design, c96d752d0 w8)

const TOOL_TYPES = new Set(["commandExecution", "fileChange", "mcpToolCall", "webSearch", "dynamicToolCall", "collabAgentToolCall", "imageGeneration"]);

/** h8: a waiting label shows 150ms after it is first wanted and then stays at least 650ms. */
function useSteadyLabel(label: string | null): string | null {
  const [shown, setShown] = useState<string | null>(null);
  const since = useRef(0);
  useEffect(() => {
    if (label === shown) return;
    const timer = setTimeout(
      () => {
        since.current = Date.now();
        setShown(label);
      },
      Math.max(150, since.current + 650 - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [label, shown]);
  return shown;
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
 * The spark (thinking only while it actually works) and one line of footnote text: clock ·
 * tokens · tasks · label, or the retry / compaction / stopping variants. Waiting on the
 * user hides the text (the approval card speaks for it). Idle, it only counts background tasks.
 */
function WorkingLine({
  turn,
  timing,
  waiting,
  sending,
  tasks,
}: {
  turn: TurnState | undefined;
  timing: ThreadState["timing"];
  waiting: boolean;
  /** turn/start is still in flight (h8 Sending…). */
  sending: boolean;
  tasks: number;
}) {
  const now = useNow(!!turn);
  const taskText = useTasks(tasks);
  const items = turn?.items.filter((item) => item.type !== "userMessage") ?? [];
  const last = items.at(-1);
  const toolLive = !!last && TOOL_TYPES.has(last.type) && "status" in last && last.status === "inProgress";
  const steady = useSteadyLabel(sending && !last ? "正在发送…" : !turn ? null : !last ? "等待 Codex…" : toolLive ? "正在运行工具…" : null);
  if (!turn && !sending && !taskText) return null;

  const seconds = turn ? Math.max(0, (now - (turn.startedAt ?? now / 1000) * 1000) / 1000) : 0;
  const shown = bucket(seconds) >= 2;
  const clock = shown ? clockText(seconds) : null;
  // Characters / 4, like the original's estimate: replies and reasoning streamed so far.
  const chars = items.reduce(
    (sum, item) =>
      sum + (item.type === "agentMessage" ? item.text.length : item.type === "reasoning" ? [...item.summary, ...item.content].join("").length : 0),
    0,
  );
  const tokens = shown && chars >= 4 ? tokenText(Math.round(chars / 4)) : null;
  const reasoning = items.findLast((item) => item.type === "reasoning");
  const span = reasoning ? timing[reasoning.id] : undefined;
  // A reasoning item that is no longer last has ended even if its completion was missed.
  const thinking = span ? thinkingPhase(now, span[0], span[1] ?? (reasoning === last ? null : span[0])) : null;
  const review = turn?.reviews?.find((r) => r.review.status === "inProgress");
  const compacting = last?.type === "contextCompaction" && !timing[last.id]?.[1];

  let state = "stats";
  let parts: (ReactNode | null)[] = [];
  let label: string | null = null;
  let shimmer = true;
  if (!turn) {
    state = sending ? "stats" : "tasks";
    if (sending) label = steady;
  } else if (waiting) {
    state = "waiting";
  } else if (turn.stopping) {
    state = "stopping";
    label = "正在停止…";
  } else if (turn.retrying) {
    const retry = retryParts(turn.retrying);
    state = "retrying";
    parts = [retry.reason, retry.attempt !== null ? `正在重试（${retry.attempt}/${retry.max}）` : "正在重试", clock];
  } else if (compacting) {
    state = "compacting";
    parts = ["正在压缩会话…", clock];
  } else {
    parts = [clock, tokens];
    if (review) label = `正在自动审查：${review.summary}`;
    else if (turn.buffering) label = "正在多想一会儿";
    else if (thinking?.kind === "active") label = thinkingLabel(seconds);
    else if (thinking?.kind === "done") {
      label = `已思考 ${thinking.seconds} 秒`;
      shimmer = false;
    } else label = steady;
  }
  if (state !== "retrying" && state !== "compacting" && state !== "waiting" && taskText) {
    parts.push(
      <button key="tasks" type="button" className="working-tasks" onClick={() => setState({ panel: "details" })}>
        {taskText}
      </button>,
    );
  }
  if (label) {
    parts.push(
      <span key={label} className="working-label" data-shimmer={shimmer || undefined}>
        {label}
      </span>,
    );
  }
  const shownParts = parts.filter(Boolean);
  return (
    <div className="working-line" data-turn-working={turn || sending ? "true" : undefined} role="status" aria-label={label ?? taskText ?? "工作中"}>
      <span className="working-spark" data-state={(turn || sending) && !waiting && !turn?.stopping ? "thinking" : undefined}>
        <Spark size={18} />
      </span>
      <span key={state} className="working-text" data-empty={shownParts.length === 0 || undefined}>
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

type Block =
  | { kind: "item"; item: ThreadItem }
  | { kind: "explore"; items: ItemOf<"commandExecution">[] }
  | { kind: "commands"; items: ItemOf<"commandExecution">[] };

/** Commands that may fold into 已运行 N 条命令: not the user's own, not failed, declined or awaiting approval. */
const groupable = (item: ThreadItem, pending: Set<string>): item is ItemOf<"commandExecution"> =>
  item.type === "commandExecution" && item.source !== "userShell" && item.status !== "failed" && item.status !== "declined" && !pending.has(item.id);

/**
 * The prompt renders on its own; runs of read / list / search commands fold into one
 * exploration row and runs of two or more other commands into one command group.
 */
function toBlocks(items: ThreadItem[], prompt: ThreadItem | undefined, pending: Set<string>): Block[] {
  const blocks: Block[] = [];
  for (const item of items) {
    if (item === prompt) continue;
    const last = blocks.at(-1);
    if (isExploration(item)) {
      if (last?.kind === "explore") last.items.push(item);
      else blocks.push({ kind: "explore", items: [item] });
    } else if (groupable(item, pending) && last?.kind === "commands") {
      last.items.push(item);
    } else if (groupable(item, pending) && last?.kind === "item" && groupable(last.item, pending)) {
      blocks[blocks.length - 1] = { kind: "commands", items: [last.item, item] };
    } else {
      blocks.push({ kind: "item", item });
    }
  }
  return blocks;
}

const blockIds = (block: Block) => (block.kind === "item" ? [block.item.id] : block.items.map((item) => item.id));

/** lI: 复制 · 分支 · 固定为章节 · 评价 · ⋯ · model · time. */
function MessageActions({
  threadId,
  turn,
  text,
  prompt,
  model,
  idle,
  pinned,
}: {
  threadId: string;
  turn: TurnState;
  text: string | undefined;
  prompt: string | undefined;
  model: string;
  idle: boolean;
  pinned: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const rate = (good: boolean) => setState({ dialog: { type: "feedback", threadId, turnId: turn.id, good } });
  return (
    <div className="msg-actions">
      {text && (
        <Button
          variant="ghost"
          muted
          icon={copied ? <Check size={16} /> : <Copy size={16} />}
          label={copied ? "已复制" : "复制"}
          onClick={() => copyReply(text).then(() => setCopied(true), fail("复制失败"))}
        />
      )}
      <Button variant="ghost" muted icon={<GitFork size={16} />} label="分支" onClick={() => forkThread(threadId, turn.id).catch(fail("分支失败"))} />
      <Button
        variant="ghost"
        muted
        icon={<Pin size={16} fill={pinned ? "currentColor" : "none"} />}
        label={pinned ? "取消固定章节" : "固定为章节"}
        aria-pressed={pinned}
        onClick={() => togglePin(threadId, turn.id, text || prompt || "")}
      />
      <Button variant="ghost" muted icon={<ThumbsUp size={16} />} label="回复很好" onClick={() => rate(true)} />
      <Button variant="ghost" muted icon={<ThumbsDown size={16} />} label="回复不佳" onClick={() => rate(false)} />
      <Popover
        open={menu}
        onClose={() => setMenu(false)}
        anchor={<Button variant="ghost" muted icon={<Ellipsis size={16} />} label="更多" aria-expanded={menu} onClick={() => setMenu(!menu)} />}
      >
        {text && (
          <MenuItem
            label="复制为 Markdown"
            onClick={() => {
              setMenu(false);
              copyText(text);
            }}
          />
        )}
        <MenuItem
          label="回退到这里"
          hint="删除这条消息及之后的内容"
          disabled={!idle}
          onClick={() => {
            setMenu(false);
            rewindHere(threadId, turn.id, prompt);
          }}
        />
      </Popover>
      <span className="msg-meta">
        {model}
        {turn.completedAt ? ` · ${timeAgo(turn.completedAt)}` : ""}
      </span>
    </div>
  );
}

const TurnView = memo(function TurnView({
  turn,
  threadId,
  cwd,
  timing,
  pendingItems,
  isLast,
  idle,
  model,
  fresh,
  notices,
  progress,
  stdin,
}: {
  turn: TurnState;
  threadId: string;
  cwd: string;
  timing: ThreadState["timing"];
  pendingItems: Set<string>;
  isLast: boolean;
  /** No turn is running, so history can be rewound from here. */
  idle: boolean;
  model: string;
  /** User messages that arrived after the transcript mounted. */
  fresh: Set<string>;
  notices: Notice[];
  progress: ThreadState["progress"];
  stdin: ThreadState["stdin"];
}) {
  const live = turn.status === "inProgress";
  // Items a finished turn left mid-flight (interrupt, failure) render as stopped, not spinning.
  const items = useMemo(
    () =>
      live
        ? turn.items
        : turn.items.map((item) =>
            "status" in item && item.status === "inProgress"
              ? ({ ...item, status: item.type === "commandExecution" || item.type === "fileChange" ? "declined" : "failed" } as ThreadItem)
              : item,
          ),
    [live, turn.items],
  );
  const prompt = items.find((item): item is ItemOf<"userMessage"> => item.type === "userMessage");
  const blocks = useMemo(() => toBlocks(items, prompt, pendingItems), [items, prompt, pendingItems]);
  const promptText = prompt ? messageText(prompt.content) : undefined;
  const finalText = items.findLast((item): item is ItemOf<"agentMessage"> => item.type === "agentMessage" && !!item.text)?.text;
  const pin = useChapters(threadId).userChapters.find((chapter) => chapter.afterId === turn.id);
  const reviews = (turn.reviews ?? []).filter((r) => r.review.status === "denied" || r.review.status === "timedOut");
  const placed = new Set(blocks.flatMap(blockIds));
  const loose = reviews.filter((r) => !r.targetItemId || !placed.has(r.targetItemId));
  const hooks = (turn.hooks ?? []).filter(hookVisible);
  const lastBlock = blocks.at(-1);
  // The todo row sits before the closing reply of a finished turn, else at the end.
  const planAt = !turn.plan ? -1 : !live && lastBlock?.kind === "item" && lastBlock.item.type === "agentMessage" ? blocks.length - 1 : blocks.length;
  const proposedPlan = isLast && !live && turn.items.some((item) => item.type === "plan");

  const itemLive = (item: ThreadItem) => live && (timing[item.id] ? timing[item.id][1] === undefined : item === turn.items.at(-1));
  const render = (item: ThreadItem): ReactNode => {
    const running = itemLive(item);
    switch (item.type) {
      case "userMessage":
        return <UserBubble item={item} entering={fresh.has(item.id)} receipt={live} />;
      case "agentMessage":
        return <AgentMessage item={item} streaming={running} />;
      case "reasoning":
        return <Reasoning item={item} live={running} />;
      case "commandExecution":
        return <CommandRow item={item} pending={pendingItems.has(item.id)} cwd={cwd} stdin={stdin[item.id]} />;
      case "fileChange":
        return <FileChangeCard item={item} pending={pendingItems.has(item.id)} cwd={cwd} />;
      case "mcpToolCall":
        return <McpCallRow item={item} progress={progress[item.id]} />;
      case "webSearch":
        return <WebSearchRow item={item} running={running} />;
      default:
        return <GenericRow item={item} live={running} />;
    }
  };
  const reviewRows = (list: typeof reviews) => list.map((review) => <ReviewRow key={review.id} review={review} threadId={threadId} turnId={turn.id} />);

  return (
    <section className="turn" data-turn-id={turn.id} data-live={live || undefined} data-last={isLast || undefined}>
      {prompt && (
        <div className="turn-prompt">
          <UserBubble
            item={prompt}
            entering={fresh.has(prompt.id)}
            onEdit={
              idle
                ? (text) => rewindAndSend(threadId, turn.id, [...prompt.content.filter((part) => part.type !== "text"), { type: "text", text, text_elements: [] }])
                : undefined
            }
          />
        </div>
      )}
      {pin && <ChapterHeading threadId={threadId} chapter={pin} />}
      <div className="agent-flow" data-cds="AssistantMessage" data-text-size="">
        {blocks.map((block, index) => (
          <Fragment key={blockIds(block)[0]}>
            {index === planAt && turn.plan && <PlanRow plan={turn.plan} />}
            {block.kind === "explore" ? (
              <ExplorationGroup items={block.items} cwd={cwd} />
            ) : block.kind === "commands" ? (
              <CommandGroup items={block.items} cwd={cwd} stdin={stdin} />
            ) : (
              render(block.item)
            )}
            {reviewRows(reviews.filter((r) => r.targetItemId && blockIds(block).includes(r.targetItemId)))}
          </Fragment>
        ))}
        {planAt === blocks.length && turn.plan && <PlanRow plan={turn.plan} />}
        {reviewRows(loose)}
        {hooks.map((run) => (
          <HookRow key={run.id} run={run} />
        ))}
        {notices.map((notice) => notice.turnId === turn.id && <NoticeRow key={notice.id} notice={notice} />)}
        {turn.status === "failed" && turn.error && <NoticeLine tone="danger" text={turn.error.message} detail={turn.error.additionalDetails} />}
        {turn.status === "interrupted" && <div className="turn-note">已中断</div>}
        {proposedPlan && (
          <div className="plan-actions">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setOverride(threadId, { planMode: false });
                sendMessage(threadId, [{ type: "text", text: "按照这个计划开始实施。", text_elements: [] }]).catch(fail("发送失败"));
              }}
            >
              按此计划实施
            </Button>
            <span className="muted small">将切换回默认模式并开始执行</span>
          </div>
        )}
      </div>
      {!live && <MessageActions threadId={threadId} turn={turn} text={finalText} prompt={promptText} model={model} idle={idle} pinned={!!pin} />}
    </section>
  );
});

// ---------------------------------------------------------------------------
// Find hits (U25): the find bar announces `codex:find`; the hit scrolls into view and its
// matches light up through the CSS Custom Highlight API.

function rangesOf(root: Element, term: string): Range[] {
  const needle = term.toLowerCase();
  const ranges: Range[] = [];
  if (!needle) return ranges;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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
  const el =
    root.querySelector(`[data-entry-id="${CSS.escape(hit.itemId)}"]`) ?? root.querySelector(`[data-turn-id="${CSS.escape(hit.turnId)}"]`);
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
  user: boolean;
  selection: string;
  code: string | null;
  href: string | null;
}

export function Transcript({ thread }: { thread: ThreadState }) {
  const requests = useStore((s) => s.requests);
  const defaultView = useStore((s) => s.defaultView);
  const view = thread.view ?? defaultView;
  const threadId = thread.meta.id;
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastUserScroll = useRef(0);
  const restore = useRef<number | null>(null);
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

  const chapters = useMemo(() => chapterList(threadTitle(thread.meta), thread.turns.map((turn) => turn.id), chapterStore), [thread.meta, thread.turns, chapterStore]);
  const thinkingNotice =
    view !== "normal" &&
    summariesOff(thread) &&
    thread.loaded &&
    !thread.turns.some((turn) => turn.items.some((item) => item.type === "reasoning" && [...item.summary, ...item.content].some(Boolean)));

  // Ctrl+O cycles normal -> thinking -> verbose; Ctrl+Shift+L quotes the selection into the composer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "o" && !event.shiftKey) {
        event.preventDefault();
        const current = getState().threads[threadId]?.view ?? getState().defaultView;
        updateThread(threadId, (t) => ({ ...t, view: nextView(current) }));
      } else if (key === "l" && event.shiftKey) {
        const selection = document.getSelection();
        const text = selection?.toString().trim();
        if (!text || !scroller.current?.contains(selection?.anchorNode ?? null)) return;
        event.preventDefault();
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

  // Follow streaming output only while pinned and not within 150ms of a user scroll.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restore.current !== null) {
      el.scrollTop = el.scrollHeight - restore.current;
      restore.current = null;
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
    flash(bubble, true);
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

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinned.current = distance <= 40;
    setShowJump(distance > 120);
  };
  const markUserScroll = () => {
    lastUserScroll.current = performance.now();
  };

  const loadOlder = () => {
    const el = scroller.current;
    if (el) restore.current = el.scrollHeight - el.scrollTop;
    loadTurns(threadId, true).catch(fail("加载更早的消息失败"));
  };

  // GF: the transcript's own right-click menu (compact).
  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const section = target.closest<HTMLElement>(".turn");
    if (!section?.dataset.turnId || target.closest("input, textarea")) return;
    event.preventDefault();
    const selected = document.getSelection();
    const selection = selected && section.contains(selected.anchorNode) ? selected.toString().trim() : "";
    setContext({
      x: event.clientX,
      y: event.clientY,
      turnId: section.dataset.turnId,
      user: !!target.closest(".user-row"),
      selection,
      code: target.closest(".md-code")?.querySelector("code")?.textContent ?? null,
      href: target.closest("a")?.getAttribute("href") ?? null,
    });
  };
  const contextTurn = context ? thread.turns.find((turn) => turn.id === context.turnId) : undefined;
  const contextMenu = (() => {
    if (!context || !contextTurn) return null;
    const close = (run: () => void) => () => {
      setContext(null);
      run();
    };
    const prompt = contextTurn.items.find((item) => item.type === "userMessage");
    const promptText = prompt?.type === "userMessage" ? messageText(prompt.content) : undefined;
    const reply = contextTurn.items.findLast((item): item is ItemOf<"agentMessage"> => item.type === "agentMessage" && !!item.text)?.text;
    const message = context.user ? promptText : reply;
    const pinnedHere = chapterStore.userChapters.some((chapter) => chapter.afterId === contextTurn.id);
    return (
      <>
        {context.selection && <MenuItem label="复制" kbd="Ctrl+C" onClick={close(() => copyText(context.selection))} />}
        {context.code !== null && <MenuItem label="复制代码" onClick={close(() => copyText(context.code ?? ""))} />}
        {context.href && (
          <>
            <MenuItem label="在浏览器中打开" onClick={close(() => window.open(context.href ?? "", "_blank", "noopener,noreferrer"))} />
            <MenuItem label="复制链接" onClick={close(() => copyText(context.href ?? ""))} />
          </>
        )}
        {(context.selection || context.code !== null || context.href) && <MenuSep />}
        {message && <MenuItem label="复制消息" onClick={close(() => (context.user ? copyText(message) : void copyReply(message).catch(fail("复制失败"))))} />}
        {message && !context.user && <MenuItem label="复制为 Markdown" onClick={close(() => copyText(message))} />}
        {(context.selection || message) && (
          <MenuItem
            label={context.selection ? "将选中内容作为上下文" : "将消息作为上下文"}
            kbd={context.selection ? "Ctrl+Shift+L" : undefined}
            onClick={close(() => appendComposerText(quoteText(context.selection || message || "")))}
          />
        )}
        {contextTurn.status !== "inProgress" && (
          <MenuItem label={pinnedHere ? "取消固定章节" : "固定为章节"} onClick={close(() => togglePin(threadId, contextTurn.id, reply || promptText || ""))} />
        )}
        <MenuSep />
        <MenuItem label="回退到这里" hint="删除这条消息及之后的内容" disabled={!idle} onClick={close(() => rewindHere(threadId, contextTurn.id, promptText))} />
        <MenuItem
          label="从这里分支"
          hint="新建会话，保留当前会话"
          disabled={contextTurn.status === "inProgress"}
          onClick={close(() => void forkThread(threadId, contextTurn.id).catch(fail("分支失败")))}
        />
      </>
    );
  })();

  return (
    <ViewContext value={view}>
      <div className="transcript-wrap">
        <div
          className="transcript"
          ref={scroller}
          onScroll={onScroll}
          onWheel={markUserScroll}
          onTouchMove={markUserScroll}
          onContextMenu={onContextMenu}
        >
          <div className="scroll-fade-strip-top" aria-hidden="true" />
          <div className="transcript-list">
            {thread.olderCursor && (
              <div className="load-older">
                <Button variant="ghost" size="sm" ink2 onClick={loadOlder} disabled={thread.loading}>
                  加载更早的消息
                </Button>
              </div>
            )}
            {!thread.loaded && thread.loading && (
              <div className="transcript-loading">
                <Skeleton lines={2} delay="2s" />
                <Skeleton lines={4} delay="2s" />
              </div>
            )}
            {thread.hooks.some(hookVisible) && (
              <div className="agent-flow thread-rows" data-text-size="">
                {thread.hooks.filter(hookVisible).map((run) => (
                  <HookRow key={run.id} run={run} />
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
                isLast={index === thread.turns.length - 1}
                idle={idle}
                model={model}
                fresh={fresh}
                notices={thread.notices}
                progress={thread.progress}
                stdin={thread.stdin}
              />
            ))}
            {(thinkingNotice || thread.notices.some((notice) => notice.turnId === null)) && (
              <div className="agent-flow thread-rows" data-text-size="">
                {thread.notices.map((notice) => notice.turnId === null && <NoticeRow key={notice.id} notice={notice} />)}
                {thinkingNotice && <div className="thinking-notice">思考摘要将从下一条回复开始显示。</div>}
              </div>
            )}
            <WorkingLine turn={liveTurn} timing={thread.timing} waiting={waiting} sending={thread.sending} tasks={thread.background.length} />
          </div>
        </div>
        <div className="transcript-fade" aria-hidden="true" />
        {showsToc(chapters) && <ChaptersToc threadId={threadId} chapters={chapters} scroller={scroller} />}
        <StickyPrompt scroller={scroller} turns={thread.turns} />
        {showJump && (
          <button
            type="button"
            className="jump-latest"
            aria-label="回到底部"
            data-tip="回到底部"
            onClick={() => {
              pinned.current = true;
              scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
            }}
          >
            <ArrowDown size={20} />
          </button>
        )}
        <PointerMenu at={context} onClose={() => setContext(null)}>
          {contextMenu}
        </PointerMenu>
      </div>
    </ViewContext>
  );
}

const EMPTY = new Set<string>();
