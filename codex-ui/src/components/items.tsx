// Renderers for each ThreadItem variant, shaped like the Code transcript of Claude Desktop
// 2.42304.0.0 (c96d752d0 JIe, the default design; class strings from c425fb3cf / cb6930dae):
// every tool call is one line of verb · detail · outcome · caret with no leading icon, the
// running verb shimmers and holds at least 650ms, and the body mounts on first open, then
// toggles without a height animation.

import type { HookRunSummary } from "@protocol/v2/HookRunSummary";
import type { ThreadItem } from "@protocol/v2/ThreadItem";
import type { TurnPlanStep } from "@protocol/v2/TurnPlanStep";
import type { UserInput } from "@protocol/v2/UserInput";
import { createContext, Fragment, isValidElement, use, useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { agentActivity, agentRunStatus } from "../lib/background";
import { openShellOutput } from "../lib/background-view";
import { activeTurn, approveDeniedAction, backgroundCommands, fail, loadAgent, loginMcpServer, modelLabel, openThread, readAgentReport, readImage, renameThread, requestThreadId } from "../lib/codex";
import { filesStats, parseDiff } from "../lib/diff";
import { basename, relativePath } from "../lib/format";
import { highlight } from "../lib/markdown";
import { openPane } from "../lib/panes";
import { promptLabel, withoutPrTags } from "../lib/pr";
import { answeredSome, askedMeta, receiptRows, unansweredLabel } from "../lib/asked";
import { parseReply, replyLabel } from "../lib/questions";
import { takeRise } from "../lib/reveal";
import { clockText, elapsedText, type TranscriptView } from "../lib/session";
import { toast, useStore, type Asked, type AutoReview, type Notice, type TurnState } from "../lib/store";
import { taskText } from "../lib/redact";
import { backgroundable, blockIds, commandDescription, commandSummary, groupSummary, limitParts, mcpLabel, planCard, quoteThinking, shellOf, stripAnsi, thoughtLines, type Block, type FilePart, type MarkActivity, type SummaryPart, type TodoLike } from "../lib/transcript";
import { setComposerDraft } from "./Composer";
import { DiffView, FileLink, Markdown, MentionText, openFileFrom, PlainLinks } from "./content";
import { openLightbox } from "./Lightbox";
import { Button, Icon, ShimmerText, Spinner, useNow, useReducedMotion } from "./ui";
import { MarkSlot, useHoldsMark, useSays, WorkingMark } from "./WorkingMark";
import { SessionCallRow } from "./SessionCards";
import { WorkflowRow } from "./Workflow";

/** The transcript view: normal hides thinking, thinking shows it, verbose also opens tool rows. */
export const ViewContext = createContext<TranscriptView>("normal");

/**
 * Where a tool row draws (c96d752d0 v2e): on its own; in a group's card, its body without an
 * outline of its own (cb6930dae inCard); or as the group's line while it runs (verb and detail).
 */
const RowMode = createContext<"row" | "card" | "line">("row");

/**
 * cc6e9624e: the rows and groups opened or closed by hand, for the last 50 sessions, so a session
 * reopened while the app runs finds them as it left them. Keyed by item id, or group: and the
 * group's first block.
 */
const kept = new Map<string, Map<string, boolean>>();
/** The open session, for what it keeps (Transcript). */
export const KeptIn = createContext<string | null>(null);
/** The item a row draws, for what it keeps (TurnView). */
export const RowKey = createContext<string | undefined>(undefined);
/**
 * A row or group of calls in the live turn (TurnView, c96d752d0 JIe turnRow): the turn's mark it
 * may hold plays `activity`, its clock counts from the turn's start (`since`, in seconds); `waits`:
 * the model waits on one of its calls; `tail`: it ends the turn so far (i2).
 */
export const TurnRow = createContext<{ tail: boolean; waits: boolean; since: number | null; activity: MarkActivity } | null>(null);
/** A group's line says the running label of the call it shows (c44e562e8 nye). */
const SaysLine = createContext(false);

/** $x / nS: open by hand, else `fallback`; kept for the session when the row has a key. */
function useOpen(key: string | undefined, fallback: boolean): [boolean, (open: boolean) => void] {
  const session = use(KeptIn);
  const [picked, setPicked] = useState(() => (session && key ? kept.get(session)?.get(key) : undefined));
  const pick = (open: boolean) => {
    setPicked(open);
    if (!session || !key) return;
    const keys = kept.get(session) ?? new Map<string, boolean>();
    kept.delete(session);
    kept.set(session, keys.set(key, open));
    if (kept.size > 50) kept.delete(kept.keys().next().value!);
  };
  return [picked ?? fallback, pick];
}

/**
 * A row's disclosure: kept per session (useOpen), open for good in the verbose view, its body
 * mounted from the first open, and opened by a find hit in its closed body (the rows engine's
 * Collapsible hiddenUntilFound). `root` goes on the element the find bar marks.
 */
function useDisclosure(key: string | undefined, fallback: boolean) {
  const verbose = use(ViewContext) === "verbose";
  const [picked, pick] = useOpen(key, fallback);
  const open = verbose || picked;
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reveal = () => pick(true);
    el.addEventListener("codex:find-open", reveal);
    return () => el.removeEventListener("codex:find-open", reveal);
  });
  return { verbose, open, pick, mounted, root };
}

type ItemOf<T extends ThreadItem["type"]> = Extract<ThreadItem, { type: T }>;
type RowStatus = "running" | "done" | "failed";
/** Said after the detail (JIe 26261–26273): Denied, Stopped, Blocked, and a failed call's 失败 in danger (shared-frame Vj). */
type Outcome = "denied" | "stopped" | "blocked" | "failed" | "unknown";

const OUTCOMES: Record<Outcome, string> = { denied: "已拒绝", stopped: "已停止", blocked: "已屏蔽", failed: "失败", unknown: "状态未知" };

/** What the turn knows about a row beyond its own items. */
export interface RowExtra {
  /** An approval request waits on it. */
  pending?: boolean;
  /** Tool hook feedback (c96d752d0 jz): ，收到 hook 反馈 after the detail, the texts in the body. */
  note?: string[];
  /** An auto-review blocked it: 已屏蔽, and its 仍然允许 key when it can be overridden. */
  blocked?: { badge: ReactNode };
  /** A proposed plan the next turn implements (questions.ts planApproved): 已批准计划. */
  approved?: boolean;
}

/**
 * A protocol status as a row's state. "stopped" is the transcript's own: the turn ended while
 * a foreground item still ran; detached processes keep their own lifecycle.
 */
export function rowState(status: string): { status: RowStatus; outcome?: Outcome } {
  if (status === "inProgress") return { status: "running" };
  if (status === "failed") return { status: "failed" };
  if (status === "unknown") return { status: "done", outcome: "unknown" };
  if (status === "declined") return { status: "done", outcome: "denied" };
  if (status === "stopped" || status === "interrupted") return { status: "done", outcome: "stopped" };
  return { status: "done" };
}

/** cd57a9664 z(): a shared row is running while any of its calls runs, else it is the last. */
function sharedState(statuses: string[]): { status: RowStatus; outcome?: Outcome } {
  return statuses.includes("inProgress") ? { status: "running" } : rowState(statuses.at(-1) ?? "completed");
}

/** Running and done; a failed call keeps its done verb (c96d752d0 JIe: `o ?? w.verb`) and says 失败 after the detail. */
type Verbs = readonly [string, string];

const verbFor = (status: RowStatus, [doing, done]: Verbs) => (status === "running" ? doing : done);

/**
 * uM(…, 650): whatever shows (a row running or not, the call a group's line runs) stays at
 * least 650ms before the latest value takes over (JIe 25941, v2e). Codex rows mount already
 * running, so the first value counts from mount. The rows design rests it (c63275c0a Mm with
 * cb6930dae to, restKey settled, fallHoldMs 650): settling (false, null) waits 650ms from the
 * fall however long the value showed, and leaving rest is at once.
 */
function useHeld<T>(value: T): T {
  const [held, setHeld] = useState(value);
  const since = useRef(0);
  useEffect(() => {
    since.current = performance.now();
  }, [held]);
  useEffect(() => {
    if (Object.is(value, held)) return;
    const rests = (v: T) => v === false || v === null;
    const wait = rests(held) ? 0 : rests(value) ? 650 : since.current + 650 - performance.now();
    if (wait <= 0) return setHeld(value);
    const timer = setTimeout(() => setHeld(value), wait);
    return () => clearTimeout(timer);
  }, [value, held]);
  return held;
}

/**
 * performance.now() as of the task's start, the same for everything in it: a group's line and the
 * working line its call's label reaches through useSays (flushed in the same commit) hold from
 * one instant.
 */
let taskClock: number | undefined;
function taskNow(): number {
  if (taskClock === undefined) {
    taskClock = performance.now();
    queueMicrotask(() => (taskClock = undefined));
  }
  return taskClock;
}

/** Holds due at the same instant swap from one timer, so in one render. */
const swapsDue = new Map<number, Set<() => void>>();
function swapAt(due: number, swap: () => void): () => void {
  let swaps = swapsDue.get(due);
  if (!swaps) {
    const all = (swaps = new Set());
    swapsDue.set(due, all);
    setTimeout(() => {
      swapsDue.delete(due);
      for (const run of all) run();
    }, due - performance.now());
  }
  swaps.add(swap);
  return () => void swaps.delete(swap);
}

/**
 * KM (shared-frame) as c734f318c TurnStatus holds its label: a busy label taking over from another
 * waits until it has held still 250ms and, when the one up took over that way too (armed), until
 * that one has shown 650ms; any other change (to or from blocked or done) swaps at once, unarmed.
 * The working line and a group's line are both TurnStatus, so one change swaps both in one frame.
 */
export function useHeldLabel(state: string, label: string | undefined): string | undefined {
  const key = `${state}|${label ?? ""}`;
  const [shown, setShown] = useState({ key, state, label, armed: false });
  const holds = shown.state === "busy" && state === "busy";
  if (key !== shown.key && !holds) setShown({ key, state, label, armed: false });
  const pending = key !== shown.key && holds;
  const since = useRef({ shown: 0, key, pending: 0 });
  useLayoutEffect(() => {
    since.current.shown = taskNow();
  }, [shown.key]);
  useLayoutEffect(() => {
    if (!pending) return void (since.current.key = shown.key);
    if (since.current.key !== key) Object.assign(since.current, { key, pending: taskNow() });
    const now = performance.now();
    const due = Math.max(since.current.pending + 250, shown.armed ? since.current.shown + 650 : now);
    const swap = () => setShown({ key, state, label, armed: true });
    if (due <= now) return swap();
    return swapAt(due, swap);
  }, [pending, key, state, label, shown.key, shown.armed]);
  return pending ? shown.label : label;
}

/** A local image as a data URL: undefined while it loads, null when it cannot be read. */
function useImage(path: string): string | null | undefined {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    readImage(path).then(
      (url) => live && setSrc(url),
      () => live && setSrc(null),
    );
    return () => {
      live = false;
    };
  }, [path]);
  return src;
}

/** c425fb3cf he: Copy ↔ Check, back after `ms`; it shows on hover of its body unless `always`. */
export function CopyKey({
  text,
  label = "复制",
  compact = false,
  always = false,
  ms = 1200,
  onCopied,
}: {
  /** The text to copy, or a copy that is already under way (rich text). */
  text: () => string | Promise<void>;
  label?: string;
  compact?: boolean;
  always?: boolean;
  ms?: number;
  onCopied?(): void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), ms);
    return () => clearTimeout(timer);
  }, [copied, ms]);
  return (
    <span className="copy-key" data-always={always || undefined}>
      <Button
        variant="ghost"
        size={compact ? "xs" : "md"}
        muted
        icon={copied ? <Icon name="Check" size={16} /> : <Icon name="Copy" size={16} />}
        label={copied ? "已复制" : label}
        onClick={(event) => {
          event.stopPropagation();
          const value = text();
          (typeof value === "string" ? navigator.clipboard.writeText(value) : value).then(
            () => {
              setCopied(true);
              onCopied?.();
            },
            () => {},
          );
        }}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// User message

export function messageText(content: UserInput[]): string {
  return content
    .filter((part): part is Extract<UserInput, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

/** c96d752d0 fz (no card renderer, so no CDS collapsible): over 1200 characters folds to 16rem. */
const FOLD_AT = 1200;

function LocalImage({ path, n }: { path: string; n: number }) {
  const src = useImage(path);
  if (src === null) {
    return (
      <span className="attachment-chip">
        <Icon name="Image" size={14} />
        {basename(path)}
      </span>
    );
  }
  return src ? (
    <img src={src} alt={basename(path) || `附加的图片 ${n}`} className="user-image zoomable" onClick={(event) => openLightbox(src, event.currentTarget)} />
  ) : (
    <span className="user-image" data-loading="" />
  );
}

/**
 * The CDS UserMessage bubble (shared-2 UX) as the Code transcript draws it: images above, the
 * text folding past 1200 characters behind 显示更多, then the hover row (`actions`: time, copy,
 * rewind, fork — the transcript decides which) or, for a message steered into the running
 * turn, the 已发送 receipt (c96d752d0 hI). A reply to mid-turn questions draws as Claude's
 * answered-question receipt instead (cb6930dae da): an outlined card, each question over its answer.
 */
export function UserBubble({
  item,
  entering = false,
  receipt = false,
  actions,
}: {
  item: ItemOf<"userMessage">;
  /** Sent after the transcript mounted: grow in (code-user-bubble-enter). */
  entering?: boolean;
  receipt?: boolean;
  actions?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const raw = messageText(item.content);
  const replies = parseReply(raw);
  const text = replyLabel(raw) ?? promptLabel(raw);
  const images = item.content.filter((part) => part.type === "image" || part.type === "localImage");
  const chips = item.content.filter((part) => part.type === "mention" || part.type === "skill");
  const tall = text.length > FOLD_AT;
  const folded = tall && !expanded;
  return (
    <div className="user-row" data-entry-id={item.id} data-client-id={item.clientId ?? undefined} data-reply={replies ? "" : undefined} data-entering={(entering && !replies) || undefined}>
      {text && (
        <h2 className="sr-only" data-find-omitted="">
          您说：{text}
        </h2>
      )}
      {images.length > 0 && (
        <div className="user-images" data-find-omitted="">
          {images.map((part, index) =>
            part.type === "localImage" ? (
              <LocalImage key={index} path={part.path} n={index + 1} />
            ) : part.type === "image" && "url" in part ? (
              <img key={index} src={part.url} alt={`附加的图片 ${index + 1}`} className="user-image zoomable" onClick={(event) => openLightbox(part.url, event.currentTarget)} />
            ) : (
              <span key={index} className="attachment-chip">
                <Icon name="Image" size={14} />
                附加的图片 {index + 1}
              </span>
            ),
          )}
        </div>
      )}
      {replies && (
        <div className="question-receipt" data-enter={entering || undefined}>
          {replies.map((reply, index) => (
            <div key={index}>
              <div className="question-receipt-q">{reply.question}</div>
              <div className="question-receipt-a">{reply.answer}</div>
            </div>
          ))}
        </div>
      )}
      {!replies && (text || chips.length > 0) && (
        <div className="user-bubble">
          {chips.length > 0 && (
            <div className="user-chips">
              {chips.map((part, index) => (
                <span key={index} className="mention-chip">
                  {part.type === "skill" ? "$" : "@"}
                  {"name" in part ? part.name : ""}
                </span>
              ))}
            </div>
          )}
          {folded && (
            <p className="sr-only" data-find-omitted="">
              {text}
            </p>
          )}
          <div className="user-text" data-folded={folded || undefined} inert={folded || undefined}>
            <MentionText text={text} />
          </div>
          {tall && (
            <Button variant="ghost" size="xs" className="user-fold" aria-expanded={expanded} data-find-omitted="" onClick={() => setExpanded(!expanded)}>
              {expanded ? "收起" : "显示更多"}
            </Button>
          )}
        </div>
      )}
      {receipt ? (
        <span className="receipt" role="status">
          <span className="receipt-check">
            <Icon name="Check" size="sm" />
          </span>
          已发送
        </span>
      ) : (
        actions && (
          <div className="row-actions" data-tip-group="" role="toolbar" aria-label="消息操作" data-find-omitted="">
            {actions}
          </div>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assistant text and reasoning

/**
 * c4a9ee384 Pu: while the reply streams, its row only grows with its text; a shrink of under
 * 200px (the text briefly re-parsed shorter) is held, a bigger one waits a frame.
 */
function useHeldHeight(row: RefObject<HTMLDivElement | null>, live: boolean): void {
  const flush = useRef(() => {});
  useLayoutEffect(() => {
    const outer = row.current;
    const inner = outer?.firstElementChild;
    if (!outer || !inner || !live) return;
    let held = 0;
    let applied = 0;
    let frame = 0;
    let started = false;
    let pending = false;
    const apply = () => {
      frame = 0;
      pending = false;
      started = true;
      applied = held;
      outer.style.minHeight = `${held}px`;
    };
    flush.current = () => {
      if (pending) apply();
    };
    const observer = new ResizeObserver((entries) => {
      let height = held;
      for (const entry of entries) {
        height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        if (height > held || height < held - 200) held = height;
      }
      if (held > applied) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        if (!started && !pending) {
          pending = true;
          return;
        }
        if (pending) held = Math.min(held, height);
        apply();
      } else if (held < applied && !frame) frame = requestAnimationFrame(apply);
    });
    observer.observe(inner, { box: "border-box" });
    return () => {
      observer.disconnect();
      flush.current = () => {};
      if (frame) cancelAnimationFrame(frame);
      outer.style.minHeight = "";
    };
  }, [row, live]);
  useLayoutEffect(() => flush.current());
}

/** c4a9ee384 Ou: message-fade-up, taken off when it ends (or after 1.5s). */
function riseOnce(el: HTMLElement): () => void {
  el.classList.add("message-fade-up");
  const done = () => {
    clearTimeout(timer);
    el.classList.remove("message-fade-up");
    el.removeEventListener("animationend", end);
    el.removeEventListener("animationcancel", end);
  };
  const end = (event: AnimationEvent) => {
    if (event.target === el && event.animationName === "message-fade-up") done();
  };
  const timer = setTimeout(done, 1500);
  el.addEventListener("animationend", end);
  el.addEventListener("animationcancel", end);
  return () => clearTimeout(timer);
}

/**
 * c4a9ee384 ku: the first time this text paints, it takes the rise its turn owes (Transcript).
 * The text paints before the row's ref lands, so the rise waits for `attach`.
 */
function useRise(row: RefObject<HTMLDivElement | null>, turnKey: string | undefined, animate: boolean) {
  const taken = useRef(false);
  const owed = useRef(false);
  const stop = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => stop.current?.(), []);
  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      row.current = el;
      if (el && owed.current) {
        owed.current = false;
        stop.current = riseOnce(el);
      }
    },
    [row],
  );
  const take = useCallback(() => {
    if (taken.current || turnKey === undefined) return;
    taken.current = true;
    if (!takeRise(turnKey) || !animate) return;
    if (row.current) stop.current = riseOnce(row.current);
    else owed.current = true;
  }, [row, turnKey, animate]);
  return { take, attach };
}

/**
 * The reply's text (c96d752d0 U5e via c4a9ee384 ju): paced and fading in while it streams, the
 * pacing dropped for good once you stop the turn (c06cf64bb ky interrupting).
 */
export function AgentMessage({
  item,
  streaming = false,
  stopping = false,
  turnKey,
  catching = false,
}: {
  item: ItemOf<"agentMessage">;
  streaming?: boolean;
  stopping?: boolean;
  turnKey?: string;
  catching?: boolean;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [unpaced, setUnpaced] = useState(false);
  if (stopping && !unpaced) setUnpaced(true);
  // c80ec48f8 At: whether the reply was catching up is read once, when this text mounts.
  const [caughtUp] = useState(catching);
  const reduced = useReducedMotion();
  useHeldHeight(row, streaming && !!item.text);
  const rise = useRise(row, turnKey, !reduced && !caughtUp);
  if (item.questions?.length) return <QuestionsRow questions={item.questions} />;
  if (!item.text) return null;
  return (
    <div ref={rise.attach} className={`agent-message ${item.phase === "commentary" ? "commentary" : ""}`} data-entry-id={item.id}>
      <Markdown text={withoutPrTags(item.text)} streaming={streaming} paced={!unpaced} revealKey={item.id} onFirstPaint={rise.take} voice breaks className="prose" />
      {item.memoryCitation && item.memoryCitation.entries.length > 0 && <MemoryCitation citation={item.memoryCitation} />}
    </div>
  );
}

/**
 * request_user_input_async reads like AskUserQuestion's row (c52b02f3f "Asked {header}" /
 * "{count} questions"); the questions list in the body and the docked question card takes the answer.
 */
function QuestionsRow({ questions }: { questions: { title: string; options: string[] | null }[] }) {
  return (
    <ToolRow verb="已提问" detail={questions.length > 1 ? `${questions.length} 个问题` : questions[0].title} status="done">
      <div className="tool-output">
        {questions.map((question, index) => (
          <div key={index}>
            {question.title}
            {question.options?.map((option, n) => (
              <div key={n} className="question-option">
                {n + 1}. {option}
              </div>
            ))}
          </div>
        ))}
      </div>
    </ToolRow>
  );
}

/**
 * request_user_input as Claude draws AskUserQuestion (c52b02f3f 询问中 / 已提问 {header}, cb6930dae
 * Da with $i): waiting, the running row; settled with any answer, the receipt alone; with none, the
 * row says why (· 已跳过). Codex keeps no item for it: the record is this machine's (asked.ts).
 */
export function AskedRow({ asked, asking }: { asked?: Asked; asking?: readonly { header: string; question: string }[] }) {
  if (asking) return <ToolRow verbs={["询问中", "已提问"]} detail={askedMeta(asking)} status="running" />;
  if (!asked) return null;
  if (!answeredSome(asked)) return <ToolRow verb="已提问" detail={`${askedMeta(asked.questions)} · ${unansweredLabel(asked.how)}`} status="done" />;
  return (
    <div className="question-receipt" data-entry-id={asked.itemId}>
      {receiptRows(asked).map((row, index) => (
        <div key={index}>
          <div className="question-receipt-q">{row.question}</div>
          <div className="question-receipt-a">{row.answer}</div>
        </div>
      ))}
    </div>
  );
}

function MemoryCitation({ citation }: { citation: NonNullable<ItemOf<"agentMessage">["memoryCitation"]> }) {
  return (
    <ToolRow verb="已读取记忆" detail={`${citation.entries.length} 条`} status="done">
      <ul className="memory-cites">
        {citation.entries.map((entry, index) => (
          <li key={index}>
            <FileLink path={entry.path} line={entry.lineStart}>
              {basename(entry.path)}:{entry.lineStart}
              {entry.lineEnd !== entry.lineStart ? `–${entry.lineEnd}` : ""}
            </FileLink>
            {entry.note && <span className="muted"> {entry.note}</span>}
          </li>
        ))}
      </ul>
    </ToolRow>
  );
}

/**
 * Thinking (default design, c96d752d0 UZ / G1): hidden in the normal view; in the thinking and
 * verbose views its lines show as plain text (cb6930dae Xs, no Markdown), italic and muted,
 * with 复制为引用 on hover.
 */
/**
 * Thinking, shown in the 思考 / 详细 views (c4de0b325 sM with the rows engine's hp() → pA): a
 * TurnStatus step 思考过程, open until you fold it (remembered per row), the text under it with
 * 复制为引用 (fA: `> **Thinking** (~N tok)`).
 */
export function Reasoning({ item }: { item: ItemOf<"reasoning"> }) {
  const view = use(ViewContext);
  const lines = thoughtLines(item);
  if (view === "normal" || !lines.length) return null;
  const text = lines.join("\n\n");
  return (
    <ToolRow entryId={item.id} verb="思考过程" status="done" defaultOpen bare>
      <div className="thinking" data-entry-id={item.id}>
        {lines.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
        <span className="thinking-copy" role="group" aria-label="思考操作">
          <CopyKey text={() => quoteThinking(text)} label="复制为引用" always onCopied={() => toast("neutral", "已复制")} />
        </span>
      </div>
    </ToolRow>
  );
}

// ---------------------------------------------------------------------------
// Tool rows

/** c227f4d5e Mw (CDS DiffIndicator, pill): the counts set left to right, read out as one phrase. */
export function DiffStat({ added, removed, enter }: { added: number; removed: number; enter: boolean }) {
  return (
    <span className="diff-pill" dir="ltr" data-enter={enter || undefined}>
      <span aria-hidden="true" className="plus">
        <span>+</span>
        {added}
      </span>
      <span aria-hidden="true" className="minus">
        <span>−</span>
        {removed}
      </span>
      <span className="sr-only">{`新增 ${added}，删除 ${removed}`}</span>
    </span>
  );
}

/** c425fb3cf Q: the body as plain content with the hover copy key at its end; `standalone` (an MCP row) in a card. */
function PlainBody({ copy, standalone, children }: { copy: () => string; standalone?: boolean; children: ReactNode }) {
  const body = (
    <div className="tool-plain" data-standalone={standalone || undefined}>
      <div className="tool-plain-main">{children}</div>
      <CopyKey text={copy} />
    </div>
  );
  return standalone ? (
    <div className="tool-card">
      <div className="tool-card-box">{body}</div>
    </div>
  ) : (
    body
  );
}

/** A label's text: its strings, and its elements' children's (a file link's name). */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : "";
}

export function ToolRow({
  entryId,
  verb,
  verbs,
  detail,
  code = false,
  status,
  outcome,
  extra,
  model,
  heartbeat,
  asking = false,
  stat,
  badge,
  trail,
  children,
  bare = false,
  standalone = false,
  after,
  defaultOpen = false,
  onOpen,
  copy,
}: {
  /** The item it shows, for find hits and the plan card's 打开计划. */
  entryId?: string;
  verb?: ReactNode;
  /** In place of `verb`, by the status it shows: running while held, and in a group's line (Ey runningVerb). */
  verbs?: Verbs;
  detail?: ReactNode;
  /** A command summary or a file name: primary ink instead of the verb's. */
  code?: boolean;
  status: RowStatus;
  outcome?: Outcome;
  extra?: RowExtra;
  /** The agent's model, right after the verb (JIe ve2). */
  model?: string | null;
  /** A running sub-agent's latest tool and how many it has called, after the model (BOe heartbeat). */
  heartbeat?: { tool: string; count: number } | null;
  /** The sub-agent it opens waits on your approval: 需要批准 at the end, before the caret (BOe X). */
  asking?: boolean;
  stat?: { added: number; removed: number };
  /** Inline at the end of the line, outside the toggle (仍然允许). */
  badge?: ReactNode;
  /** After the outcome, outside the toggle (c4de0b325 B2): 查看实时输出 on a call running in the background. */
  trail?: ReactNode;
  children?: ReactNode;
  /** The body brings its own card and copy keys. */
  bare?: boolean;
  standalone?: boolean;
  /** Under the line whether or not it is open (tool images, cb6930dae Hu). */
  after?: ReactNode;
  defaultOpen?: boolean;
  /** The line opens something instead of a body (a sub-agent's session): a still caret. */
  onOpen?(): void;
  /** What the body's copy key takes, in place of the body's text. */
  copy?: () => string;
}) {
  const mode = use(RowMode);
  const turnRow = use(TurnRow);
  const held = useHeld(status === "running");
  const shown: RowStatus = held ? "running" : status;
  const ran = useRef(false);
  if (status === "running") ran.current = true;
  const [liveAtMount] = useState(status === "running");
  const rowKey = use(RowKey);
  const { verbose, open, pick: setPicked, mounted, root } = useDisclosure(rowKey, defaultOpen);
  const body = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const hasDetail = detail !== undefined && detail !== null && detail !== "";
  const pending = !!extra?.pending;
  // c96d752d0 JIe $e / ZAe: a call's own row in the live turn holds the turn's mark while the model
  // waits on it (and the 650ms it holds that) or, ending the turn so far, once its call went
  // through; never while it waits on approval. Marked it is a busy TurnStatus (the mark, the whole
  // running label under the shimmer, the turn's clock); let go, it is the step again at once.
  const waited = useHeld(status === "running" && !!turnRow?.waits);
  const marked = useHoldsMark(!!turnRow && mode === "row" && !onOpen && !pending && (waited || (turnRow.tail && status === "done" && !outcome && !extra?.blocked)));
  // cb6930dae Ia (c63275c0a Eh): waited on but holding no mark (the working line under the plan
  // card took it), it says its running label to that line instead, as a group's line does its call's.
  const saysLine = use(SaysLine);
  const says = mode === "line" ? saysLine : !!turnRow && mode === "row" && !onOpen && !pending && waited && !marked;
  useSays(says ? textOf(verbs ? verbs[0] : verb) + (hasDetail ? ` ${textOf(detail)}` : "") : undefined, rowKey);
  const clock = useTurnClock(turnRow?.since, marked);
  // shared-9 _C rowUnclipped: a row with nothing to open whose label or meta is cut off opens in
  // place instead, its line wrapping whole; measured while it shows as a plain row.
  const bodyless = !onOpen && mode === "row" && (children === undefined || children === null || children === false) && !extra?.note?.length;
  const [clipped, setClipped] = useState(false);
  const [unclipped, setUnclipped] = useState(false);
  useLayoutEffect(() => {
    const el = lineRef.current;
    if (!bodyless || marked || unclipped || !el || typeof ResizeObserver === "undefined") return;
    const check = () => setClipped([...el.querySelectorAll<HTMLElement>(".tool-verb, .tool-detail, .tool-live")].some((part) => part.scrollWidth > part.clientWidth + 1));
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, [bodyless, marked, unclipped]);
  const unclips = bodyless && !marked && (clipped || unclipped);
  // One waiting on approval keeps its done verb, as it always has.
  const word = verbs ? verbFor(pending ? "done" : shown, verbs) : verb;
  // A file's +N −N counts while it runs too (FileRow), unlike Claude's, which waits for it to settle.
  const pill = stat && (stat.added > 0 || stat.removed > 0) ? <DiffStat added={stat.added} removed={stat.removed} enter={ran.current} /> : null;
  // The call a group's line holds, or a row holding the mark, reads as running for as long as it
  // shows: verb and detail as one label under the secondary shimmer (c52b02f3f $t "runningVerb meta").
  const runningLabel = (
    <ShimmerText variant="secondary" className="tool-live">
      {verbs ? verbs[0] : verb}
      {hasDetail && (
        <>
          {" "}
          <PlainLinks value>{detail}</PlainLinks>
        </>
      )}
    </ShimmerText>
  );
  if (mode === "line") {
    return (
      <>
        {runningLabel}
        {pill}
      </>
    );
  }
  // In a group's card, images under the line move into the body (c96d752d0 Bz hoistImages).
  const tucked = mode === "card" && after ? after : null;
  const note = extra?.note?.length ? extra.note : null;
  const content = children !== undefined && children !== null && children !== false;
  const hasBody = !onOpen && (content || !!note || !!tucked);
  const toggles = hasBody && !verbose;
  const said = extra?.blocked ? "blocked" : (outcome ?? (shown === "failed" ? "failed" : undefined));
  // c96d752d0 JIe C: a plain detail runs into the label as one string (正在运行 命令), so it
  // shimmers, morphs and truncates with the verb; a file name or command stays the step's meta (E).
  const joined = hasDetail && !code && !pending;
  const label = joined ? (
    <>
      {word}{" "}
      <span className="tool-detail">
        <PlainLinks value>{detail}</PlainLinks>
      </span>
    </>
  ) : (
    word
  );
  // The whole line toggles; the label is the keyboard's button, so file links in a file name's
  // detail and keys in the badge never sit inside a button.
  const Head = toggles || onOpen || unclips ? "button" : "span";
  // shared-9 dp: selecting the cut-off text does not fold it back.
  const unclip = () => {
    const selection = getSelection();
    if (selection && !selection.isCollapsed && lineRef.current?.contains(selection.anchorNode)) return;
    setUnclipped(!unclipped);
  };
  return (
    <div
      ref={root}
      className="tool-row"
      data-entry-id={entryId}
      data-find-ids={rowKey?.split(":")[0]}
      data-find-closed={(hasBody && !open) || undefined}
      data-status={shown}
      data-pending={pending || undefined}
      data-marked={marked || undefined}
      data-unclipped={unclipped || undefined}
    >
      <div ref={lineRef} className="tool-line" data-toggles={toggles || !!onOpen || unclips || undefined} data-open={open || undefined} onClick={onOpen ?? (toggles ? () => setPicked(!open) : unclips ? unclip : undefined)}>
        {marked && (
          <span className="working-mark-slot">
            <WorkingMark activity={turnRow?.activity} />
          </span>
        )}
        <Head className="tool-head" data-joined={joined || marked || undefined} {...(Head === "button" ? { type: "button" as const, "aria-expanded": toggles ? open : unclips ? unclipped : undefined } : {})}>
          {/* c734f318c Step: the label morphs between states (HM), busy under the secondary shimmer. */}
          {marked ? (
            runningLabel
          ) : (
            <Morph morphKey={pending ? "pending" : shown} live={liveAtMount} className="tool-verb">
              {shown === "running" ? (
                <ShimmerText variant="secondary" className={joined ? "tool-live" : undefined}>
                  {label}
                </ShimmerText>
              ) : (
                label
              )}
            </Morph>
          )}
        </Head>
        {model && <span className="tool-model">{modelLabel(model)}</span>}
        {heartbeat && (
          <>
            <span className="tool-heartbeat">
              {model ? "· " : ""}
              {heartbeat.tool}
            </span>
            <span className="tool-model">· {heartbeat.count}</span>
          </>
        )}
        {pending ? (
          <span className="tool-outcome" data-tone="warning">
            需要批准
          </span>
        ) : (
          hasDetail &&
          code &&
          !marked && (
            <span className="tool-detail" data-kind="code">
              {detail}
            </span>
          )
        )}
        {note && <span className="tool-note">, 收到 hook 反馈</span>}
        {shown !== "running" && !marked && said && (
          <span className="tool-outcome" data-tone={said === "failed" ? "danger" : undefined}>
            {OUTCOMES[said]}
          </span>
        )}
        {asking && (
          <span className="tool-outcome" data-tone="warning">
            需要批准
          </span>
        )}
        {trail && (
          <span className="tool-trail" onClick={(event) => event.stopPropagation()}>
            {trail}
          </span>
        )}
        {(shown === "running" || marked) && <span className="sr-only">运行中</span>}
        {pill}
        {clock && <span className="working-segment">{clock}</span>}
        {onOpen ? <Icon name="CaretRight" size="sm" className="tool-caret" data-still="" /> : toggles && <Icon name="CaretRight" size="xs" className="tool-caret" />}
        {(badge || extra?.blocked?.badge) && (
          <span className="tool-badges" onClick={(event) => event.stopPropagation()}>
            {badge}
            {extra?.blocked?.badge}
          </span>
        )}
      </div>
      {hasBody && mounted && (
        <div className="tool-body" ref={body} hidden={!open}>
          {note && (
            <div className="tool-notes">
              {note.map((text, index) => (
                <div key={index}>{text}</div>
              ))}
            </div>
          )}
          {content &&
            (bare ? (
              children
            ) : (
              <PlainBody copy={copy ?? (() => body.current?.querySelector<HTMLElement>(".tool-plain-main")?.innerText ?? "")} standalone={standalone && mode === "row"}>
                {children}
              </PlainBody>
            ))}
          {tucked}
        </div>
      )}
      {!tucked && after}
    </div>
  );
}

/** The turn's clock on a row holding its mark (c96d752d0 WM, the working line's): from 2s on, after the +N −N. */
function useTurnClock(since: number | null | undefined, active: boolean): string | null {
  useNow(active);
  const seconds = active && since != null ? Math.floor(Date.now() / 1000 - since) : 0;
  return seconds >= 2 ? elapsedText(seconds) : null;
}

/** cb6930dae Co: 运行中 (Running, as the row's verb) and, past 10 seconds, the time it has run; the copy key always shows. */
function RunningFooter({ startedAt, copy, background }: { startedAt?: number; copy: () => string; background?: ReactNode }) {
  const now = useNow(startedAt !== undefined);
  const seconds = startedAt === undefined ? 0 : (now - startedAt) / 1000;
  return (
    <div className="cmd-running">
      <span>
        运行中
        {seconds >= 10 && <span className="cmd-running-time"> {clockText(seconds)}</span>}
      </span>
      {background}
      <CopyKey text={copy} compact always />
    </div>
  );
}

/**
 * cb6930dae is / as: 在后台运行 on a command the experimental backend can stop waiting on; while it is
 * the session's only one, its tooltip names Ctrl+B (the shortcut Transcript handles).
 */
function BackgroundKey({ item }: { item: ItemOf<"commandExecution"> }) {
  const session = use(KeptIn);
  const supported = useStore((s) => s.server.info?.codexUiBackgroundTerminals === true);
  const only = useStore((s) => !!session && backgroundable(activeTurn(s.threads[session])?.items ?? []).length === 1);
  if (!supported || !session || !backgroundable([item]).length) return null;
  return (
    <Button variant="ghost" size="xs" className="cmd-background" tip={only ? "在后台运行" : undefined} kbd={only ? "ctrl+b" : undefined} aria-keyshortcuts={only ? "Control+B" : undefined} onClick={() => void backgroundCommands(session, [item.processId!])}>
      在后台运行
    </Button>
  );
}

/**
 * cb6930dae Cu outside a card: an outlined card headed Bash / PowerShell; the command on the
 * code surface after `$` / `>` with a compact copy key (copies "$ cmd\n\noutput"), the output
 * (ANSI stripped, danger when it failed) up to 400px, and the running footer.
 */
function CommandCard({ item, footer, startedAt }: { item: ItemOf<"commandExecution">; footer: boolean; startedAt?: number }) {
  const inCard = use(RowMode) === "card";
  const { shell, script } = shellOf(item.command);
  const prompt = shell === "powershell" ? ">" : "$";
  const output = item.aggregatedOutput ? stripAnsi(item.aggregatedOutput).trimEnd() : "";
  const copy = () => [script && `${prompt} ${script}`, output].filter(Boolean).join("\n\n");
  // cb6930dae cf: a call you declined or one the turn's end cut off says so under its output.
  const ended = item.status as string;
  const outcome = ended === "declined" ? "已拒绝" : ended === "stopped" || ended === "interrupted" ? "已中断" : null;
  const main = (
    <>
      {script && (
        <div className="cmd-line">
          <span className="cmd-prompt" aria-hidden="true">
            {prompt}{" "}
          </span>
          <code className="cmd-code hljs" dangerouslySetInnerHTML={{ __html: highlight(script, shell) }} />
          {!footer && <CopyKey text={copy} compact />}
        </div>
      )}
      {output && (
        <pre className="cmd-output" data-failed={item.status === "failed" || undefined} tabIndex={0} role="group" aria-label="工具输出">
          {output}
        </pre>
      )}
      {outcome && <div className="cmd-outcome">{outcome}</div>}
      {footer && <RunningFooter startedAt={startedAt} copy={copy} background={<BackgroundKey item={item} />} />}
    </>
  );
  // Cu inCard: the command and its output straight on the group's card, no title or outline.
  if (inCard) {
    return (
      <div className="tool-plain">
        <div className="tool-card-main" data-bare="">
          {main}
        </div>
        {!script && output && <CopyKey text={copy} />}
      </div>
    );
  }
  return (
    <div className="tool-card">
      <div className="tool-card-box">
        <div className="tool-card-head">
          <span className="tool-card-title">{shell === "powershell" ? "PowerShell" : "Bash"}</span>
          {!script && output && <CopyKey text={copy} />}
        </div>
        <div className="tool-card-main">{main}</div>
      </div>
    </div>
  );
}

/** c52b02f3f fn: Read / Grep / LS / Bash, by what the command does. */
function commandLine(item: ItemOf<"commandExecution">): { verb?: string; verbs?: Verbs; detail?: ReactNode; code?: boolean } {
  const description = commandDescription(item.description);
  if (description) return { verb: description };
  const one = item.commandActions.length === 1 ? item.commandActions[0] : null;
  if (one?.type === "read") return { verbs: ["正在读取", "已读取"], detail: <FileLink path={one.path}>{basename(one.path)}</FileLink>, code: true };
  if (one?.type === "listFiles") return { verbs: ["正在列出", "已列出"], detail: one.path ?? undefined };
  if (one?.type === "search") return { verbs: ["正在搜索", "已搜索"], detail: one.query ?? undefined };
  const { shell, script } = shellOf(item.command);
  const summary = commandSummary(script, shell);
  return { verbs: ["正在运行", "运行了"], detail: summary ?? "命令", code: summary !== null };
}

/** One command, or a run of reads of one file sharing the first one's line. */
/** c63275c0a bh: 查看实时输出, opening the call's shell in 后台任务. */
function LiveOutputKey({ itemId }: { itemId: string }) {
  const session = use(KeptIn);
  return (
    <button type="button" className="tool-live-output" onClick={() => session && openShellOutput(session, itemId)}>
      查看实时输出
    </button>
  );
}

export function CommandRow({ items, startedAt, extra }: { items: ItemOf<"commandExecution">[]; startedAt?: number; extra?: RowExtra }) {
  const state = sharedState(items.map((item) => item.status));
  const line = commandLine(items[0]);
  // c4de0b325 B2 liveOutputTaskId: a call still running in the background links its live output.
  const backgrounded = items.find((item) => item.backgrounded === true && item.status === "inProgress");
  return (
    <ToolRow {...line} status={state.status} outcome={state.outcome} extra={extra} trail={backgrounded && <LiveOutputKey itemId={backgrounded.id} />} bare>
      {items.map((item) => (
        <CommandCard key={item.id} item={item} footer={item.status === "inProgress" && !extra?.pending} startedAt={startedAt} />
      ))}
    </ToolRow>
  );
}

/**
 * The user's own `!` command (c19e90103 Vg), not a tool row: the command in a fence, then its
 * output in an outlined box up to 160px, 正在运行… until it ends, （无输出） when it printed nothing.
 */
export function UserShell({ item }: { item: ItemOf<"commandExecution"> }) {
  const { script } = shellOf(item.command);
  const output = item.aggregatedOutput ? stripAnsi(item.aggregatedOutput).trimEnd() : "";
  return (
    <div className="user-shell" data-entry-id={item.id}>
      {script && (
        <div className="md-code" data-single={!script.includes("\n") || undefined}>
          <pre>
            <code className="hljs" dangerouslySetInnerHTML={{ __html: highlight(script, "bash") }} />
          </pre>
        </div>
      )}
      <div className="user-shell-output">
        <pre>{output || (item.status === "inProgress" ? "正在运行…" : "（无输出）")}</pre>
      </div>
    </div>
  );
}

/**
 * A file row's +N −M: the lines of its changes. An update's lines are its hunks' (a pure move has
 * none); an add or a delete is the whole file as is.
 */
const fileStat = (parts: FilePart[]) =>
  filesStats(parts.map(({ change }) => ({ path: change.path, kind: change.kind.type, diff: change.diff, whole: change.kind.type !== "update" })));

/** Write / Edit while running read as Claude's zh-Hans has them (Creating 创建中, Editing 编辑中). */
const FILE_VERBS = {
  add: ["创建中", "已创建"],
  update: ["编辑中", "已编辑"],
  delete: ["正在删除", "已删除"],
} as const;

/** cb6930dae vu: the file's path and a copy key over its diff (400px), on the code surface. */
function DiffCard({ change, cwd }: { change: FilePart["change"]; cwd: string }) {
  const inCard = use(RowMode) === "card";
  const path = change.kind.type === "update" && change.kind.move_path ? change.kind.move_path : change.path;
  const head = (
    <div className="diff-card-head">
      <FileLink path={path} className="diff-card-path">
        {relativePath(path, cwd)}
      </FileLink>
      <CopyKey text={() => change.diff} />
    </div>
  );
  const diff = <DiffView diff={change.diff} path={path} kind={change.kind.type} whole={change.kind.type !== "update"} />;
  // vu inCard: the path over a code surface without an outline of its own.
  if (inCard) {
    return (
      <div className="diff-bare">
        {head}
        <div className="diff-card">{diff}</div>
      </div>
    );
  }
  return (
    <div className="tool-card">
      <div className="diff-card">
        {head}
        {diff}
      </div>
    </div>
  );
}

/**
 * Edit / Write (c52b02f3f 932–955): one row per file — 已编辑 / 已创建 / 已删除 and its name,
 * +N −M — and adjacent changes to that file share it. The counts grow while Codex writes the
 * patch (item/fileChange/patchUpdated), where Claude's wait for it to settle; its diff opens once
 * it settles, or while an approval waits on it.
 */
export function FileRow({ parts, cwd, extra }: { parts: FilePart[]; cwd: string; extra?: RowExtra }) {
  const state = sharedState(parts.map((part) => part.item.status));
  const { change } = parts[0];
  const move = change.kind.type === "update" ? change.kind.move_path : null;
  const stat = fileStat(parts);
  // A change with no lines (an empty file made or deleted, a pure move) gets no diff card, as Claude
  // builds none for an edit with no contents (c254f7f8c); a row of only those opens nothing.
  const writing = state.status === "running" && !extra?.pending;
  const shown = writing ? [] : parts.filter((part) => parseDiff(part.change.diff, part.change.kind.type, part.change.kind.type !== "update").length > 0);
  return (
    <ToolRow
      verbs={FILE_VERBS[change.kind.type]}
      detail={
        <FileLink path={move ?? change.path} preferDiff={state.status !== "failed"}>
          {basename(change.path)}
          {move ? ` → ${basename(move)}` : ""}
        </FileLink>
      }
      code
      status={state.status}
      outcome={state.outcome}
      extra={extra}
      stat={stat}
      bare
    >
      {shown.length > 0 && shown.map((part) => <DiffCard key={`${part.item.id}:${part.index}`} change={part.change} cwd={cwd} />)}
    </ToolRow>
  );
}

const CODE_ARGS = new Set(["command", "cmd", "script", "shell", "code", "pattern", "regex", "glob"]);

/** cb6930dae Au / ju: one `key: value` line per argument, non-strings as one-line JSON. */
function ArgRows({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  const entries: [string, unknown][] = typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [["input", value]];
  if (!entries.length) return null;
  return (
    <div className="tool-args">
      {entries.map(([key, arg]) => (
        <div key={key} className="tool-arg">
          <span className="tool-arg-key">{key}:</span>{" "}
          {typeof arg === "string" ? CODE_ARGS.has(key) ? <span className="tool-arg-code">{arg}</span> : arg : <span className="tool-arg-code">{JSON.stringify(arg)}</span>}
        </div>
      ))}
    </div>
  );
}

/** cb6930dae Hu: tool images under the line, 360px tall at most; a click opens the preview. */
function ToolImages({ srcs }: { srcs: string[] }) {
  return (
    <div className="tool-images">
      {srcs.map((src, index) => (
        <button
          key={index}
          type="button"
          className="tool-image-key"
          aria-label="查看截图"
          onClick={(event: MouseEvent<HTMLButtonElement>) => openLightbox(src, event.currentTarget.querySelector("img") ?? event.currentTarget)}
        >
          <img className="tool-image" alt="" src={src} />
        </button>
      ))}
    </div>
  );
}

export function contentText(content: unknown[]): string {
  return content
    .map((part) => {
      const block = part as { type?: string; text?: string };
      return block.type === "text" && block.text ? block.text : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function contentImages(content: unknown[]): string[] {
  return content.flatMap((part) => {
    const block = part as { type?: string; data?: string; mimeType?: string };
    return block.type === "image" && block.data ? [`data:${block.mimeType ?? "image/png"};base64,${block.data}`] : [];
  });
}

/** codex_ui_desktop's terminal tools as rows: running and done. */
const TERMINAL_VERBS: Partial<Record<string, [string, string]>> = {
  list_terminal_tabs: ["正在列出终端标签页", "已列出终端标签页"],
  open_terminal_tab: ["正在打开终端", "已打开终端"],
  run_in_terminal: ["正在终端中运行", "已在终端中运行"],
  read_terminal: ["正在读取终端", "已读取终端"],
  stop_terminal_tab: ["正在停止终端", "已停止终端"],
};

/**
 * An MCP call (c52b02f3f default branch): 已使用 {server}: {tool}, in a card of its arguments
 * and result text; images hang under the line. U17's latest progress is the running detail.
 */
export function McpRow({ item, progress, extra }: { item: ItemOf<"mcpToolCall">; progress?: string; extra?: RowExtra }) {
  if (item.server === "codex_ui_desktop" && item.tool === "set_session_title") return <SessionRenameRow item={item} extra={extra} />;
  if (item.server === "codex_ui_desktop" && item.tool === "enter_plan_mode") return <EnterPlanRow item={item} extra={extra} />;
  // c4de0b325 Cj mark_chapter "lifted-out": the chapter's heading where the model marked it (its
  // row in the chapters list: transcript.ts agentChapters).
  if (item.server === "codex_ui_desktop" && item.tool === "mark_chapter") {
    const title = (item.arguments as { title?: unknown } | null)?.title;
    return item.status === "completed" && !item.error && typeof title === "string" && title.trim() ? (
      <h2 id={`epitaxy-ch-${item.id}`} className="chapter-heading">
        {title.trim()}
      </h2>
    ) : null;
  }
  if (item.server === "codex_ui_desktop" && ["start_session", "dismiss_task", "send_message", "hand_off_to_session", "list_start_targets"].includes(item.tool)) return <SessionCallRow item={item} extra={extra} />;
  // wrap_up fills the next-step box (TurnBox), not a row.
  if (item.server === "codex_ui_desktop" && item.tool === "wrap_up") return null;
  const state = rowState(item.status);
  const label = mcpLabel(item.server, item.tool);
  // The terminal tools name what they did; run_in_terminal shows its command.
  const terminal = item.server === "codex_ui_desktop" ? TERMINAL_VERBS[item.tool] : undefined;
  const command = item.tool === "run_in_terminal" ? (item.arguments as { command?: unknown } | null)?.command : undefined;
  const text = item.result ? contentText(item.result.content) : "";
  const images = item.result ? contentImages(item.result.content) : [];
  const structured = item.result?.structuredContent;
  return (
    <ToolRow
      verbs={terminal ?? [`正在使用 ${label}`, `已使用 ${label}`]}
      detail={typeof command === "string" ? command : state.status === "running" ? progress : undefined}
      status={state.status}
      outcome={state.outcome}
      extra={extra}
      standalone
      after={images.length > 0 && <ToolImages srcs={images} />}
    >
      <ArgRows value={item.arguments} />
      {item.error && (
        <div className="tool-output" data-failed="">
          {item.error.message}
        </div>
      )}
      {text ? (
        <div className="tool-output">{stripAnsi(text)}</div>
      ) : structured !== null && structured !== undefined ? (
        <div className="tool-output">{JSON.stringify(structured)}</div>
      ) : null}
    </ToolRow>
  );
}

/**
 * enter_plan_mode as Claude draws EnterPlanMode (c52b02f3f): 制定计划, 已开始规划 or 启动规划失败
 * (declined or unavailable), its reason in the card.
 */
function EnterPlanRow({ item, extra }: { item: ItemOf<"mcpToolCall">; extra?: RowExtra }) {
  const state = rowState(item.status);
  const failed = state.status === "failed";
  const reason = failed ? item.error?.message || (item.result ? contentText(item.result.content) : "") : "";
  return (
    // The failedVerb says it, so no 失败 after it.
    <ToolRow verbs={["制定计划", failed ? "启动规划失败" : "已开始规划"]} status={failed ? "done" : state.status} outcome={state.outcome} extra={extra} standalone>
      {reason ? (
        <div className="tool-output" data-failed="">
          {reason}
        </div>
      ) : null}
    </ToolRow>
  );
}

/** c52b02f3f Mt: a completed call whose result names the very title it was given. */
function renamedOf(item: ItemOf<"mcpToolCall">, title: string): { threadId: string; title: string; previousTitle?: string } | undefined {
  const meta = item.result?._meta;
  const rename = meta && typeof meta === "object" && !Array.isArray(meta) ? meta.codexUiSessionRenamed : undefined;
  if (item.status !== "completed" || !rename || typeof rename !== "object" || Array.isArray(rename)) return undefined;
  const { threadId, title: renamed, previousTitle } = rename;
  if (typeof threadId !== "string" || !threadId || typeof renamed !== "string" || !renamed || renamed.trim() !== title) return undefined;
  return { threadId, title: renamed, ...(typeof previousTitle === "string" && previousTitle.trim() && previousTitle.length <= 2000 && { previousTitle }) };
}

/**
 * set_session_title (c52b02f3f 65040): 已重命名会话 with the new title as its meta. Open, the
 * rename (cb6930dae bc): 原名称 / 改为, and 撤销重命名 while the session open here still has the
 * new name; once its name is the old one again, 改为 is struck through and 已恢复为 says so.
 */
function SessionRenameRow({ item, extra }: { item: ItemOf<"mcpToolCall">; extra?: RowExtra }) {
  const state = rowState(item.status);
  const args = item.arguments;
  const title = args && typeof args === "object" && !Array.isArray(args) && typeof args.title === "string" ? args.title.trim() : "";
  const rename = renamedOf(item, title);
  const current = useStore((s) => (rename && s.activeId === rename.threadId ? (s.threads[rename.threadId]?.meta.name ?? undefined) : undefined));
  const [busy, setBusy] = useState(false);
  const undo = rename?.previousTitle === undefined || rename.previousTitle === rename.title || current === undefined
    ? "unavailable"
    : current === rename.previousTitle ? "undone" : current === rename.title ? "available" : "unavailable";
  const restore = () => {
    if (undo !== "available" || busy || !rename?.previousTitle) return;
    setBusy(true);
    renameThread(rename.threadId, rename.previousTitle).catch(fail("重命名失败。您可以重试。")).finally(() => setBusy(false));
  };
  const failed = state.status === "failed";
  const text = item.result ? contentText(item.result.content) : "";
  return (
    // Claude's failedVerb says it, so no 失败 after the meta.
    <ToolRow verbs={["正在重命名会话", failed ? "重命名会话失败" : "已重命名会话"]} detail={title || undefined} code status={failed ? "done" : state.status} outcome={state.outcome} extra={extra} standalone>
      {rename ? (
        <div className="rename-rows">
          {rename.previousTitle !== undefined && (
            <div className="rename-row">
              <span className="rename-label">原名称</span>
              <span className="rename-value">{rename.previousTitle}</span>
            </div>
          )}
          <div className="rename-row">
            <span className="rename-label">改为</span>
            <span className="rename-value" data-undone={undo === "undone" || undefined}>{rename.title}</span>
          </div>
          {undo !== "unavailable" && (
            <div className="rename-row rename-undo">
              <span className="rename-label" aria-hidden="true" />
              {undo === "available" && (
                <Button variant="secondary" size="xs" disabled={busy} onClick={restore}>
                  撤销重命名
                </Button>
              )}
              <span className="rename-note" role="status">{undo === "undone" ? `已恢复为 ${rename.previousTitle}` : null}</span>
            </div>
          )}
        </div>
      ) : item.error ? (
        <div className="tool-output" data-failed="">
          {item.error.message}
        </div>
      ) : text ? (
        <div className="tool-output">{text}</div>
      ) : null}
    </ToolRow>
  );
}

/** WebSearch / WebFetch (c52b02f3f 973–988) and the browser tool's find (shared-130). */
export function WebSearchRow({ item, running }: { item: ItemOf<"webSearch">; running: boolean }) {
  const action = item.action;
  const status = running ? "running" : "done";
  if (action?.type === "openPage") return <ToolRow verbs={["正在获取", "已获取"]} detail={action.url ?? ""} status={status} />;
  if (action?.type === "findInPage") {
    const pattern = action.pattern;
    if (pattern) return <ToolRow verbs={[`正在查找“${pattern}”`, `已找到“${pattern}”`]} status={status} />;
    return <ToolRow verbs={["正在页面中查找", "在页面中找到"]} status={status} />;
  }
  const query = item.query || (action?.type === "search" ? (action.query ?? action.queries?.[0]) : "") || "";
  return <ToolRow verbs={["正在搜索网页", "已搜索网页"]} detail={query} status={status} />;
}

/** A session notice line (c96d752d0 Lq) for what Codex says outside the tool rows; the detail shows on hover. */
function SessionLine({ text, detail, children }: { text: string; detail?: string | null; children?: ReactNode }) {
  return (
    <div className="session-line" data-find-omitted="">
      <span className="session-line-text" role="status" data-tip={detail || undefined} tabIndex={detail ? 0 : undefined}>
        {text}
      </span>
      {children}
    </div>
  );
}

function ImageGeneration({ item, live }: { item: ItemOf<"imageGeneration">; live: boolean }) {
  const src = "result" in item && item.result ? `data:image/png;base64,${item.result}` : null;
  if (item.failure?.type === "usageLimitExceeded") {
    const at = item.failure.resetsAt;
    const when = at ? new Date(at > 1e12 ? at : at * 1000).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
    return <SessionLine text="已达到图片生成限额" detail={when ? `${when} 重置` : undefined} />;
  }
  if (!src) {
    return (
      <ToolRow
        verbs={["正在生成图片", "已生成图片"]}
        detail={item.savedPath ? <FileLink path={item.savedPath}>{basename(item.savedPath)}</FileLink> : undefined}
        code={!!item.savedPath}
        status={live ? "running" : "done"}
      />
    );
  }
  return (
    <div className="image-gen" data-entry-id={item.id}>
      <img src={src} alt={item.revisedPrompt ?? "生成的图片"} className="generated-image zoomable" onClick={(event) => openLightbox(src, event.currentTarget)} />
      {item.revisedPrompt && <div className="image-caption">{item.revisedPrompt}</div>}
    </div>
  );
}

/** Reading an image is Read (c52b02f3f 924): its name, and the image hangs under the line. */
function ImageViewRow({ item }: { item: ItemOf<"imageView"> }) {
  const src = useImage(item.path);
  return <ToolRow verbs={["正在读取", "已读取"]} detail={<FileLink path={item.path}>{basename(item.path)}</FileLink>} code status="done" after={src && <ToolImages srcs={[src]} />} />;
}

// ---------------------------------------------------------------------------
// Tool groups

/** One row of a group: its block, the row drawn for it, whether it runs or waits on approval, and whether its call went through. */
export interface GroupRow {
  key: string;
  block: Block;
  node: ReactNode;
  running: boolean;
  pending: boolean;
  ok: boolean;
}

/**
 * v2e in the rows design (c24951e9f D, up.Phrases): the parts ", " apart in the line's own ink, one
 * whose calls all failed saying so after its meta (已读取 AGENTS.md（1 个失败）); only the old
 * counted line drew its verb in danger. 以及另外 N 项操作 never truncates. `link`: the last part's file
 * opens from its name (ZC, Jg), a click target that stays out of the line button's tab order.
 */
function GroupParts({ parts, link }: { parts: SummaryPart[]; link: boolean }) {
  const rest = parts.at(-1)?.rest ? parts.at(-1) : undefined;
  const shown = (rest ? parts.slice(0, -1) : parts).map((part) => (part.isError ? { ...part, meta: part.failedMeta ?? part.meta } : part));
  const file = link && !rest ? shown.at(-1)?.file : undefined;
  const names = (
    <span className="tool-group-names">
      {shown.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && ", "}
          {part.verb}
          {part.meta && " "}
          {file && index === shown.length - 1 ? (
            <span
              className="tool-group-file"
              data-tip={file.path}
              data-path={file.path}
              onClick={(event) => {
                event.stopPropagation();
                openFileFrom(event, file.path, file.preferDiff);
              }}
            >
              {part.meta}
            </span>
          ) : (
            part.meta
          )}
        </Fragment>
      ))}
      {rest && ","}
    </span>
  );
  return rest ? (
    <span className="tool-group-split">
      {names}
      <span className="tool-group-rest">{` ${rest.verb}`}</span>
    </span>
  ) : (
    names
  );
}

/**
 * cb6930dae wa / Da / Oa: when the label's key changes the old label fades up and out, the new
 * one in from 3px below, and the width glides between them; a new text under the same key only
 * glides (180ms, cubic-bezier(.2,0,0,1)), or with `swapOnly` (shared-frame HM) takes its width at
 * once. A plain span until the key first changes, unless it was live when it mounted (Ca).
 */
export function Morph({ morphKey, live, swapOnly = false, className, children }: { morphKey: string; live: boolean; swapOnly?: boolean; className: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  const [first] = useState(morphKey);
  const [moved, setMoved] = useState(live);
  if (!moved && morphKey !== first) setMoved(true);
  if (reduced || !moved) return <span className={className}>{children}</span>;
  return (
    <Glide morphKey={morphKey} enterFirst={!live} swapOnly={swapOnly} className={className}>
      {children}
    </Glide>
  );
}

function Glide({ morphKey, enterFirst, swapOnly, className, children }: { morphKey: string; enterFirst: boolean; swapOnly: boolean; className: string; children: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  const latest = useRef(children);
  const [key, setKey] = useState(morphKey);
  const [enter, setEnter] = useState(enterFirst);
  const [leaving, setLeaving] = useState<{ key: string; node: ReactNode }[]>([]);
  if (key !== morphKey) {
    setKey(morphKey);
    setEnter(true);
    setLeaving((list) => [...list.filter((item) => item.key !== morphKey), { key, node: latest.current }]);
  }
  const glide = useRef<{ owner: string | undefined; release(): void } | null>(null);
  const last = useRef<{ key: string; text: string; width?: number } | null>(null);
  useLayoutEffect(() => {
    latest.current = children;
    const el = box.current;
    if (!el || typeof el.animate !== "function") return;
    const was = last.current;
    let next: HTMLElement | undefined;
    let old: HTMLElement | undefined;
    const gone: HTMLElement[] = [];
    for (const child of el.children) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.dataset.morphKey === morphKey) next = child;
      else {
        gone.push(child);
        if (!old || child.dataset.morphKey === was?.key) old = child;
      }
    }
    if (!next) return;
    const text = next.textContent ?? "";
    if (was?.key === morphKey && (swapOnly || was.text === text)) return;
    // fC WV: of the labels on their way out only the one that shows most stays seen; the rest
    // keep fading with no width, so two never overlap.
    let seen = old;
    for (const face of gone) if (seen && Number(getComputedStyle(face).opacity) > Number(getComputedStyle(seen).opacity)) seen = face;
    const going = glide.current;
    const from = was === null ? undefined : going ? el.getBoundingClientRect().width : was.key === morphKey ? was.width : old?.getBoundingClientRect().width;
    if (from !== undefined) going?.release();
    const to = next.getBoundingClientRect().width;
    for (const face of gone) {
      const hidden = face !== seen;
      face.style.visibility = hidden ? "hidden" : "";
      face.style.width = hidden ? "0px" : "";
      face.style.overflow = hidden ? "hidden" : "";
    }
    if (from === undefined) {
      last.current = { key: morphKey, text };
      return;
    }
    last.current = { key: morphKey, text, width: to };
    if (Math.abs(from - to) < 0.5 && (going === null || old === undefined)) return;
    el.dataset.gliding = "";
    const animation = el.animate([{ width: `${from}px` }, { width: `${to}px` }], { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "forwards" });
    const release = () => {
      animation.cancel();
      delete el.dataset.gliding;
      if (glide.current?.release === release) glide.current = null;
    };
    // With a label on its way out the width holds until that label has left (below); a new text
    // under the same key lets go when it lands.
    const owner = old?.dataset.morphKey;
    if (owner === undefined) animation.onfinish = release;
    glide.current = { owner, release };
  });
  // fC: the glide lets go only once the label it waited on is out of the DOM, never from its
  // animationend: React drops the label a task later, after a paint that would spring the slot
  // back to that label's width for a frame.
  useLayoutEffect(() => {
    const going = glide.current;
    if (going?.owner !== undefined && !leaving.some((item) => item.key === going.owner)) going.release();
  }, [leaving]);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries.at(-1)?.contentRect.width;
      if (last.current && width !== undefined && !glide.current) last.current.width = width;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <span ref={box} className="morph">
      {leaving.map((item) => (
        <span
          key={item.key}
          data-morph-key={item.key}
          data-exit=""
          aria-hidden="true"
          className={className}
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget) return;
            setLeaving((list) => list.filter((other) => other.key !== item.key));
          }}
        >
          {item.node}
        </span>
      ))}
      <span key={morphKey} data-morph-key={morphKey} data-enter={enter || undefined} className={className}>
        {children}
      </span>
    </span>
  );
}

/**
 * c96d752d0 v2e, the default design: adjacent tool rows fold into one line that says what they
 * did (c24951e9f), +N −N over their edits and 需要批准 while one waits. While a call runs and
 * none waits (R), the line reads as that call; each line holds 650ms with the counts it had
 * (uM, Xe), and a change of line morphs (wa). Settled on one clean file, its name opens it (ZC).
 * It opens into an outlined card with a row per call: closed at first, kept per session ($x),
 * open for good in the verbose view. `id`: its first block; `blocked`: calls an auto-review stopped.
 */
export function ToolGroup({ id, rows, blocked }: { id: string; rows: GroupRow[]; blocked: ReadonlySet<string> }) {
  const { verbose, open, pick, mounted, root } = useDisclosure(`group:${id}`, false);
  const ids = rows.flatMap(({ block }) => blockIds(block));
  const waiting = rows.some((row) => row.pending);
  const stats = rows.map(({ block }) => (block.kind === "file" ? fileStat(block.parts) : null));
  // The rows of a patch Codex is still writing all run at once, in path order: the line follows the
  // one whose counts moved last, the file being written, so its +N −N grows on the line.
  const moved = useRef<{ sigs: Map<string, string>; key: string | null }>({ sigs: new Map(), key: null });
  const sigs = new Map(rows.map((row, n) => [row.key, JSON.stringify(stats[n])]));
  for (const row of rows) {
    const before = moved.current.sigs.get(row.key);
    if (row.running && before !== undefined && before !== sigs.get(row.key)) moved.current.key = row.key;
  }
  moved.current.sigs = sigs;
  const runs = rows.filter((row) => row.running);
  const running = waiting ? null : ((runs.find((row) => row.key === moved.current.key) ?? runs[0])?.key ?? null);
  const [liveAtMount] = useState(running !== null);
  const held = useHeld(running);
  const shownKey = held !== null && !rows.some((row) => row.key === held) ? running : held;
  const live = rows.find((row) => row.key === shownKey);
  const stat = { added: 0, removed: 0 };
  for (const next of stats) {
    if (!next) continue;
    stat.added += next.added;
    stat.removed += next.removed;
  }
  const parts = limitParts(groupSummary(rows.map((row) => row.block), blocked));
  const keys = rows.map((row) => row.key);
  const fresh = { sig: JSON.stringify([parts, stat, waiting, keys]), parts, stat, waiting, keys };
  const [counted, setCounted] = useState(fresh);
  if (shownKey === running && counted.sig !== fresh.sig) setCounted(fresh);
  const view = shownKey !== running && counted.keys.every((key) => keys.includes(key)) ? counted : fresh;
  // c96d752d0 XAe: in the live turn the line holds the turn's mark while the model waits on one of
  // its calls (reading as the running one) or, ending the turn so far, on its last call once that
  // went through (as that call's running label, ky); never while one waits on approval. Let go, the
  // mark folds away and the label morphs to the counts. Waited on with the mark taken by the working
  // line under the plan card, it says the running call's label there (c44e562e8 nye).
  const turnRow = use(TurnRow);
  const waited = useHeld(!!turnRow?.waits && running !== null);
  const last = rows.at(-1);
  const tail = turnRow?.tail && last?.ok ? last : undefined;
  const marked = useHoldsMark(!!turnRow && !waiting && (waited || !!tail));
  const clock = useTurnClock(turnRow?.since, marked);
  const shownRow = marked && !waited ? tail : live;
  // shared-9 gR: the line is a TurnStatus (c63275c0a Oh), holding a new call's label as the working
  // line does while it says that label there at once, so the two swap in the same frame.
  const heldKey = useHeldLabel(shownRow ? "busy" : "done", shownRow?.key);
  const showing = rows.find((row) => row.key === heldKey) ?? shownRow;
  const says = !!turnRow && !waiting && waited && !marked;
  return (
    <div ref={root} className="tool-group" data-busy={live || view.waiting ? "" : undefined} data-marked={marked || undefined} data-find-ids={ids.join(" ")} data-find-closed={!open || undefined}>
      <button type="button" className="tool-group-line" aria-expanded={open} onClick={() => !verbose && pick(!open)}>
        {(running !== null || marked) && <span className="sr-only">运行中</span>}
        <MarkSlot shown={marked} activity={turnRow?.activity} />
        <Morph morphKey={showing ? showing.key : view.waiting ? "blocked" : "settled"} live={liveAtMount} className="tool-group-label">
          {showing ? (
            <SaysLine value={says && showing.key === shownRow?.key}>
              <RowMode value="line">{showing.node}</RowMode>
            </SaysLine>
          ) : (
            <>
              {/* shared-14 h2: waiting on your approval, the line is TurnStatus blocked, 需要您的输入 in the warning badge. */}
              {view.waiting ? <span className="badge badge-warning">需要您的输入</span> : <GroupParts parts={view.parts} link />}
              {(view.stat.added > 0 || view.stat.removed > 0) && <DiffStat added={view.stat.added} removed={view.stat.removed} enter={false} />}
            </>
          )}
        </Morph>
        {clock && <span className="working-segment">{clock}</span>}
        <Icon name="CaretRight" size="xs" className="tool-caret" />
      </button>
      {/* Oh runningWords: the call taking over says its label before the line shows it. */}
      {says && shownRow && showing && shownRow.key !== showing.key && (
        <span hidden>
          <SaysLine value>
            <RowMode value="line">{shownRow.node}</RowMode>
          </SaysLine>
        </span>
      )}
      {mounted && (
        <div className="tool-group-card" hidden={!open}>
          <RowMode value="card">
            {rows.map((row) => (
              <Fragment key={row.key}>{row.node}</Fragment>
            ))}
          </RowMode>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event rows: lines injected into the conversation (c96d752d0 tN / nN): a verb, a linked
// subject and a caret over a plain body.

function EventRow({
  verb,
  subject,
  caretLabel,
  onOpen,
  children,
}: {
  verb: ReactNode;
  subject?: ReactNode;
  /** The caret's accessible name, open or closed. */
  caretLabel?(open: boolean): string;
  /** Called the first time the body opens (lazy reports). */
  onOpen?(): void;
  /** undefined: nothing to open. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const expandable = children !== undefined;
  const toggle = () => {
    if (!expandable) return;
    if (!open) onOpen?.();
    setOpen(!open);
  };
  return (
    <div className="event-row">
      <div className="event-head">
        <button type="button" className="event-verb" aria-expanded={expandable ? open : undefined} onClick={toggle}>
          {verb}
        </button>
        {subject}
        {expandable && (
          <button type="button" className="event-caret" aria-label={caretLabel?.(open) ?? (open ? "折叠" : "展开")} aria-expanded={open} onClick={toggle}>
            <Icon name="CaretRight" size={14} className="tool-caret" />
          </button>
        )}
      </div>
      {expandable && open && <div className="event-body">{children}</div>}
    </div>
  );
}

export function useAgentName(threadId: string, fallback?: string): string {
  return useStore((s) => {
    const meta = s.threads[threadId]?.meta;
    // Claude's zh-Hans calls an unnamed sender 子代理 (c96d752d0 "subagent"), not 智能体.
    return meta?.agentNickname || meta?.name || fallback || "子代理";
  });
}

/** c96d752d0 hN: a report over 1200 characters folds to 16rem under a 3rem fade. */
function FoldText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const tall = text.length > 1200;
  return (
    <>
      <div className="report-text" data-folded={(tall && !open) || undefined}>
        {text}
      </div>
      {tall && (
        <Button variant="ghost" size="xs" className="report-fold" aria-expanded={open} data-find-omitted="" onClick={() => setOpen(!open)}>
          {open ? "收起" : "显示更多"}
        </Button>
      )}
    </>
  );
}

/** 消息来自 〈agent〉 (c96d752d0 nN "Message from"): the sub-agent's report loads on first open. */
function ReportRow({ threadId, text, fallback }: { threadId: string; text?: string | null; fallback?: string }) {
  const name = useAgentName(threadId, fallback);
  const [body, setBody] = useState<string | undefined>(text ?? undefined);
  const load = () => {
    if (body !== undefined) return;
    readAgentReport(threadId).then(
      (report) => setBody(report ?? ""),
      () => setBody(""),
    );
  };
  return (
    <EventRow
      verb="消息来自"
      subject={
        <button type="button" className="event-subject" onClick={() => void openThread(threadId)}>
          <bdi>{name}</bdi>
        </button>
      }
      caretLabel={(open) => `${open ? "隐藏" : "显示"}来自 ${name} 的消息`}
      onOpen={load}
    >
      {body ? <FoldText text={body} /> : null}
    </EventRow>
  );
}

// Claude's zh-Hans words for them (7VnPkTzSZN / Jq80oWyQZp).
const SEND_VERBS = ["正在向智能体发送消息", "已向智能体发送消息"] as const;
const STOP_VERBS = ["正在停止任务", "已停止任务"] as const;

// c52b02f3f 989–1062 / Rn / Poll: Task, SendMessage, Poll and TaskStop.
const COLLAB_VERBS: Record<string, Verbs> = {
  spawnAgent: ["智能体运行中", "已运行智能体"],
  sendInput: SEND_VERBS,
  sendMessage: SEND_VERBS,
  followupTask: SEND_VERBS,
  resumeAgent: SEND_VERBS,
  wait: ["正在等待结果", "已等待结果"],
  closeAgent: STOP_VERBS,
  interruptAgent: STOP_VERBS,
};

/** The running sub-agent you can open (JIe 26166–26176): a 318px card with a still caret. */
function AgentCard({ threadId, name }: { threadId: string; name: string }) {
  return (
    <button type="button" className="agent-card" onClick={() => void openThread(threadId)}>
      <Icon name="AgentsSimple" size="sm" className="agent-card-icon" />
      <span className="agent-card-text">
        <ShimmerText>{name}</ShimmerText>
      </span>
      <Icon name="CaretRight" size="sm" className="agent-card-caret" />
      <span className="sr-only">运行中</span>
    </button>
  );
}

/**
 * A spawned sub-agent (BOe for Task / Agent). Codex's spawn returns at once, as Claude's background
 * agents do, so the row runs until the agent ends (BOe ue: the call or its task running), holding no
 * mark (the call is over). Alone it is the card until the agent's first tool call (its
 * subagentActivity) or a wait on your approval (mt); then 智能体运行中 {name}, its model and
 * heartbeat (· {latest tool} · {calls}); ended, 已停止 or 失败. It opens the agent's record.
 */
function SpawnedRow({ threadId, name, model, state, extra }: { threadId: string; name: string; model: string | null; state: { status: RowStatus; outcome?: Outcome }; extra?: RowExtra }) {
  const alone = use(RowMode) === "row";
  const child = useStore((s) => s.threads[threadId]);
  // BOe X: the agent waits on your approval (its card docks in this session).
  const asking = useStore((s) => s.requests.some((request) => requestThreadId(request) === threadId));
  const run = child ? agentRunStatus(child) : null;
  const running = state.status === "running" || run === "running";
  useEffect(() => {
    if (running) void loadAgent(threadId);
  }, [running, threadId]);
  const activity = running ? agentActivity(child) : null;
  if (running && alone && !activity?.toolCalls && !asking) return <AgentCard threadId={threadId} name={name} />;
  const ended = !running && (run === "stopped" || run === "failed") ? run : undefined;
  return (
    <ToolRow
      verbs={COLLAB_VERBS.spawnAgent}
      detail={name}
      model={child?.meta.model ?? model}
      heartbeat={activity?.lastTool ? { tool: activity.lastTool, count: activity.toolCalls } : null}
      status={running ? "running" : ended === "failed" ? "failed" : state.status}
      outcome={state.outcome ?? (ended === "stopped" ? "stopped" : undefined)}
      extra={extra}
      asking={asking}
      onOpen={() => void openThread(threadId)}
    />
  );
}

function CollabRow({ item, extra }: { item: ItemOf<"collabAgentToolCall">; extra?: RowExtra }) {
  const state = rowState(item.status);
  const receivers = item.receiverThreadIds;
  const one = receivers.length === 1 ? receivers[0] : null;
  // Its name as text, so the running label the row says to the working line has it (textOf).
  const oneName = useAgentName(one ?? "");
  if (item.tool === "spawnAgent" && one) return <SpawnedRow threadId={one} name={oneName} model={item.model} state={state} extra={extra} />;
  if (item.tool === "wait" && state.status !== "running") {
    const reports = receivers.filter((id) => item.agentsStates[id]?.message);
    if (reports.length) {
      return (
        <>
          {reports.map((id) => (
            <ReportRow key={id} threadId={id} text={item.agentsStates[id]?.message} />
          ))}
        </>
      );
    }
  }
  if (item.tool === "listAgents") {
    const count = Object.keys(item.agentsStates).length;
    return <ToolRow verbs={["正在列出智能体", count ? `已列出 ${count} 个智能体` : "未找到其他智能体"]} status={state.status} outcome={state.outcome} extra={extra} />;
  }
  const prompt = item.prompt?.trim() ?? "";
  return (
    <ToolRow verbs={COLLAB_VERBS[item.tool] ?? SEND_VERBS} detail={one ? oneName : prompt.split("\n")[0]} model={item.tool === "spawnAgent" ? item.model : undefined} status={state.status} outcome={state.outcome} extra={extra}>
      {!one && prompt.includes("\n") ? <div className="tool-output">{prompt}</div> : undefined}
    </ToolRow>
  );
}

function AgentActivityRow({ item }: { item: ItemOf<"subAgentActivity"> }) {
  const path = item.agentPath.split("/").filter(Boolean).pop() ?? item.agentPath;
  const name = useAgentName(item.agentThreadId, path);
  if (item.kind === "completed") return <ReportRow threadId={item.agentThreadId} fallback={path} />;
  // A MultiAgentV2 spawn is this item alone, no collabAgentToolCall.
  if (item.kind === "started") return <SpawnedRow threadId={item.agentThreadId} name={name} model={item.model} state={{ status: "done" }} />;
  const verb = item.kind === "interrupted" ? "已停止任务" : "已向智能体发送消息";
  return <ToolRow verb={verb} detail={name} status="done" onOpen={() => void openThread(item.agentThreadId)} />;
}

// ---------------------------------------------------------------------------
// Hooks, auto-review, notices, plans

/**
 * c96d752d0 NZ: a UserPromptSubmit hook stopped the prompt. The card says why and 编辑提示
 * puts the prompt back into the composer.
 */
export function PromptBlocked({ run, prompt }: { run: HookRunSummary; prompt?: string }) {
  const [edited, setEdited] = useState(false);
  const hint =
    run.statusMessage?.trim() ||
    run.entries
      .map((entry) => entry.text)
      .join("\n")
      .trim() ||
    "UserPromptSubmit 钩子已在此提示词到达 Codex 之前将其拦截。";
  return (
    <div className="hook-card">
      <div className="hook-card-head">
        <Icon name="Warning" size="sm" className="hook-card-icon" />
        <span>钩子已阻止您的提示词</span>
      </div>
      <div className="hook-card-body">
        <span className="hook-card-hint">{hint}</span>
        {prompt && !edited && (
          <div className="hook-card-actions">
            <Button
              variant="primary"
              onClick={() => {
                setComposerDraft(prompt);
                setEdited(true);
              }}
            >
              编辑提示词
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Other hook runs that did not simply pass: one sentence each, not a tool row. */
export function HookLine({ run }: { run: HookRunSummary }) {
  const text = run.status === "failed" ? "钩子运行失败" : run.status === "stopped" ? "钩子已停止本轮" : "钩子已阻止此操作";
  return <SessionLine text={text} detail={run.statusMessage || run.entries.map((entry) => entry.text).join("\n") || run.sourcePath} />;
}

/** 仍然允许 on a row the auto-review blocked (Codex: thread/approveGuardianDeniedAction). */
export function AllowKey({ review, threadId, turnId }: { review: AutoReview; threadId: string; turnId: string }) {
  const [busy, setBusy] = useState(false);
  if (review.overridden) return <span className="review-done">已允许</span>;
  return (
    <Button
      variant="secondary"
      size="xs"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        approveDeniedAction(threadId, turnId, review.id)
          .catch(fail("允许失败"))
          .finally(() => setBusy(false));
      }}
    >
      仍然允许
    </Button>
  );
}

const RISK: Record<string, string> = { low: "低", medium: "中等", high: "高", critical: "严重" };

/** U2: an auto-review with no row of its own to block gets its own line. */
export function ReviewRow({ review, threadId, turnId }: { review: AutoReview; threadId: string; turnId: string }) {
  const { status, riskLevel, rationale } = review.review;
  return (
    <ToolRow
      verb={status === "timedOut" ? "自动审查超时" : "自动审查已拒绝"}
      detail={[review.summary, riskLevel ? `${RISK[riskLevel] ?? riskLevel}风险` : ""].filter(Boolean).join(" · ")}
      status="done"
      badge={status === "denied" && review.overridable ? <AllowKey review={review} threadId={threadId} turnId={turnId} /> : undefined}
    >
      {rationale ? <div className="tool-output">{rationale}</div> : undefined}
    </ToolRow>
  );
}

/** U3 / U4: reroutes, verification, auth recovery and MCP sign-in as session notices with inline links. */
export function NoticeRow({ notice }: { notice: Notice }) {
  const [busy, setBusy] = useState(false);
  const threadId = useStore((s) => s.activeId);
  const server = notice.server;
  const actions: ReactNode[] = [];
  if (notice.url) {
    actions.push(
      <a className="session-link" href={notice.url} target="_blank" rel="noopener noreferrer">
        了解更多
      </a>,
    );
  }
  if (notice.kind === "mcpReauth" && server) {
    actions.push(
      <button
        type="button"
        className="session-link"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => {
          setBusy(true);
          loginMcpServer(server, threadId)
            .catch(fail("登录失败"))
            .finally(() => setBusy(false));
        }}
      >
        重新登录
      </button>,
    );
  }
  return (
    <SessionLine text={notice.text} detail={notice.detail}>
      {actions.map((action, index) => (
        <span key={index} className="session-action">
          {index > 0 && (
            <span className="session-dot" aria-hidden="true">
              {" · "}
            </span>
          )}
          {action}
        </span>
      ))}
    </SessionLine>
  );
}

/** c96d752d0 Wq: a warning icon and the error, with 查看详情 when there is more, then any `action`. */
/**
 * cb1a6e506 I (the error card hY draws): an outlined card, its headline on a tinted band after the
 * warning glyph, the hint under it, then 查看详情 and the actions on one row.
 */
export function ErrorRow({ headline, hint, details, actions }: { headline: string; hint?: string; details?: string | null; actions?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="error-row" role="group" aria-label={headline}>
      <div className="error-row-head">
        <Icon name="Warning" size="sm" className="error-row-icon" />
        <span>{headline}</span>
      </div>
      {hint && <div className="error-row-hint">{hint}</div>}
      {(details || actions) && (
        <div className="error-row-foot">
          {details && (
            <button type="button" className="details-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
              查看详情
              <Icon name="CaretRight" size="sm" className="tool-caret" />
            </button>
          )}
          {actions && <div className="error-row-actions">{actions}</div>}
        </div>
      )}
      {details && open && (
        <div className="details-box error-row-details" data-tip-group="">
          <span>{details}</span>
          <span className="details-copy">
            <CopyKey text={() => details} label="复制详细信息" always />
          </span>
        </div>
      )}
    </div>
  );
}

const TODO_STATES: Record<string, string> = { completed: "已完成", inProgress: "进行中", pending: "未完成" };

/** Threads whose plan card has been on screen (cccc2cf0a lA). */
const shownPlanCards = new Set<string>();

/**
 * The plan card under the latest turn (cf74bc599 EpitaxyTurnBox: cccc2cf0a CT, the ET card around
 * DT); planCard decides what it shows. Claude's card has no line for the plan's explanation.
 */
export function PlanCard({ threadId, turn, todos, waiting, background }: { threadId: string; turn: TurnState | undefined; todos: readonly TodoLike[] | undefined; waiting: boolean; background: { itemId: string }[] }) {
  const card = planCard(turn, todos, waiting, background);
  // pA fades the card in as it shows up, but finishes the fade for one already there as the view
  // mounts, and for one back in a thread that showed it before when nothing ran since (lA).
  const view = useRef<{ mounted: boolean; ran: boolean; fade: boolean | null }>({ mounted: false, ran: false, fade: null }).current;
  if (turn?.status === "inProgress") view.ran = true;
  if (!card) view.fade = null;
  else view.fade ??= view.mounted && !(shownPlanCards.has(threadId) && !view.ran);
  useEffect(() => {
    view.mounted = true;
  }, [view]);
  useEffect(() => {
    if (card) shownPlanCards.add(threadId);
  });
  if (!card) return null;
  return (
    <div className="turn-plan" data-text-size="" data-fade={view.fade ? "" : undefined}>
      {card.fromBefore && <p className="turn-plan-note">您上一条消息之前的计划</p>}
      {card.start > 0 && (
        <p className="turn-plan-note" data-indent="">
          {card.start} 个较早的步骤
        </p>
      )}
      <ul role="list" className="turn-plan-steps">
        {card.visible.map((step, index) => (
          <li key={card.start + index} data-status={step.status}>
            <span className="turn-plan-icon">
              {step.status === "completed" ? (
                <Icon name="CheckCircleFilled" size="sm" />
              ) : step.status === "inProgress" ? (
                card.spin ? <Spinner size={12} /> : <Icon name="DotsCircle" size="sm" />
              ) : (
                <Icon name="Placeholder" size="sm" />
              )}
              <span className="sr-only">{TODO_STATES[step.status]}</span>
            </span>
            <div className="turn-plan-step">
              <Markdown text={step.step} breaks className="epitaxy" />
              {index === card.tasksAt && (
                <Button variant="ghost" size="xs" ink2 className="turn-plan-tasks" onClick={() => openPane("background")}>
                  {card.tasks} 个正在运行的任务
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {card.openAfter > 0 && (
        <p className="turn-plan-note" data-indent="">
          {card.openAfter} 项待完成
        </p>
      )}
    </div>
  );
}

/**
 * Task rows (cb6930dae yb, its default look): a 16px status cell (Check, a spinner on the open
 * step, Placeholder), then the step in Alluvium markdown (Nn, c19e90103 Ix), a single newline a
 * line break; done steps struck through. Each step goes through Nv's preprocessing first: secrets
 * masked, an unclosed private key cut, control characters shown (taskText). The plan pane's 任务
 * and a 待办事项 row's body.
 */
export function TodoList({ steps }: { steps: TurnPlanStep[] }) {
  const texts = steps.map((step) => taskText(step.step));
  return (
    <ul role="list" className="plan-todos">
      {steps.map((step, index) => (
        <li key={index} className="plan-todo" data-status={step.status}>
          <span className="plan-todo-icon">
            {step.status === "completed" ? <Icon name="Check" size="sm" /> : step.status === "inProgress" ? <Spinner size={12} /> : <Icon name="Placeholder" size="sm" />}
            <span className="sr-only">{TODO_STATES[step.status]}</span>
          </span>
          <Markdown text={texts[index]} breaks className="epitaxy plan-todo-text" />
        </li>
      ))}
    </ul>
  );
}

/**
 * An update_plan call (store.ts TodoUpdate) as Claude's TodoWrite row (c52b02f3f: 已更新待办事项,
 * 已清除待办事项 with no steps and then no body, no meta), open on the steps as that call set them;
 * its copy key takes their text a line each (cb6930dae W_). Codex says nothing of the call until
 * it is done, so 正在更新待办事项 shows only while the row holds the turn's mark as its tail (ky).
 */
export function TodoRow({ update }: { update: TodoLike }) {
  if (!update.steps.length) return <ToolRow verb="已清除待办事项" status="done" />;
  return (
    <ToolRow verbs={["正在更新待办事项", "已更新待办事项"]} status="done" copy={() => update.steps.map((step) => taskText(step.step)).join("\n")}>
      <TodoList steps={update.steps} />
    </ToolRow>
  );
}

// ---------------------------------------------------------------------------
// Everything else

/**
 * A proposed plan (ExitPlanMode: c52b02f3f verbs, cb6930dae Rd body), open: the plan as a quote,
 * under 已批准计划 once the plan card's 接受 opened the next turn.
 */
function PlanRow({ item, live, approved }: { item: ItemOf<"plan">; live: boolean; approved: boolean }) {
  const text = item.text ? <div className="plan-text" data-live={live || undefined}>{item.text}</div> : null;
  return (
    <ToolRow entryId={item.id} verbs={["正在提议计划", "已提出计划"]} status={live ? "running" : "done"} defaultOpen bare>
      {live ? (
        text
      ) : (
        <div className="plan-settled">
          {approved && (
            <div className="plan-approved">
              <Icon name="CheckCircle" size="sm" />
              <span>已批准计划</span>
            </div>
          )}
          {text}
        </div>
      )}
    </ToolRow>
  );
}

/** A dynamic workflow run, in the session it runs in. */
function WorkflowEntry({ item }: { item: Extract<ThreadItem, { type: "workflow" }> }) {
  const session = use(KeptIn);
  const active = useStore((s) => s.activeId);
  return <WorkflowRow item={item} threadId={session ?? active} />;
}

export function GenericRow({ item, live, extra }: { item: ThreadItem; live: boolean; extra?: RowExtra }) {
  switch (item.type) {
    case "imageView":
      return <ImageViewRow item={item} />;
    case "imageGeneration":
      return <ImageGeneration item={item} live={live} />;
    case "contextCompaction":
      // c80ec48f8 He / c96d752d0 jM: a quiet line once done; while it runs the working line says so.
      return live ? null : (
        <div className="compacted" data-entry-id={item.id}>
          已压缩会话
        </div>
      );
    case "enteredReviewMode":
      return (
        <div className="divider-note">
          <Icon name="Search" size={14} /> 开始代码审查{item.review ? `：${item.review}` : ""}
        </div>
      );
    case "exitedReviewMode":
      return (
        <div className="review-card">
          <div className="card-head">
            <Icon name="Search" size={14} />
            <span>审查结果</span>
          </div>
          <Markdown text={item.review} className="prose" breaks />
        </div>
      );
    case "plan":
      return <PlanRow item={item} live={live} approved={!live && !!extra?.approved} />;
    case "hookPrompt":
      // c96d752d0 yI.hook: "Hook re-prompted Claude".
      return (
        <EventRow verb="Hook 已重新提示 Codex">
          {item.fragments.map((fragment, index) => (
            <div key={index} className="report-text">
              {fragment.text}
            </div>
          ))}
        </EventRow>
      );
    case "dynamicToolCall": {
      const state = item.success === false ? { status: "failed" as const, outcome: undefined } : rowState(item.status);
      const name = item.namespace ? `${item.namespace}.${item.tool}` : item.tool;
      const texts = item.contentItems?.flatMap((part) => (part.type === "inputText" ? [part.text] : [])) ?? [];
      const images = item.contentItems?.flatMap((part) => (part.type === "inputImage" ? [part.imageUrl] : [])) ?? [];
      return (
        <ToolRow
          verbs={[`正在使用 ${name}`, `已使用 ${name}`]}
          status={state.status}
          outcome={state.outcome}
          extra={extra}
          after={images.length > 0 && <ToolImages srcs={images} />}
        >
          <ArgRows value={item.arguments} />
          {texts.length > 0 && <div className="tool-output">{texts.join("\n\n")}</div>}
          {item.contentItems?.map((part, index) => part.type === "inputAudio" && <audio key={index} controls src={part.audioUrl} />)}
        </ToolRow>
      );
    }
    case "collabAgentToolCall":
      return <CollabRow item={item} extra={extra} />;
    case "subAgentActivity":
      return <AgentActivityRow item={item} />;
    case "workflow":
      return <WorkflowEntry item={item} />;
    case "sleep": {
      // shared-130 "Waiting {count} seconds" / "Waited {count} seconds".
      const seconds = Math.max(1, Math.round(item.durationMs / 1000));
      return <ToolRow verbs={[`等待 ${seconds} 秒`, `已等待 ${seconds} 秒`]} status={live ? "running" : "done"} />;
    }
    case "functionCallOutput":
      return (
        <ToolRow verb={`已使用 ${item.name}`} status="done" extra={extra}>
          <div className="tool-output">{typeof item.output === "string" ? item.output : JSON.stringify(item.output)}</div>
        </ToolRow>
      );
    default:
      return null;
  }
}
