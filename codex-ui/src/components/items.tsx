// Renderers for each ThreadItem variant, shaped like the Code transcript of Claude Desktop
// 2.42304.0.0 (c96d752d0 JIe, the default design; class strings from c425fb3cf / cb6930dae):
// every tool call is one line of verb · detail · outcome · caret with no leading icon, the
// running verb shimmers and holds at least 650ms, and the body mounts on first open, then
// toggles without a height animation.

import type { HookRunSummary } from "@protocol/v2/HookRunSummary";
import type { ThreadItem } from "@protocol/v2/ThreadItem";
import type { UserInput } from "@protocol/v2/UserInput";
import { Check, ChevronRight, Circle, Copy, Image as ImageIcon, ScanSearch, TriangleAlert, Users } from "lucide-react";
import { createContext, use, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { approveDeniedAction, errorMessage, loginMcpServer, modelLabel, openThread, readAgentReport, readImage } from "../lib/codex";
import { basename, diffStats, relativePath } from "../lib/format";
import { highlight } from "../lib/markdown";
import { clockText, type TranscriptView } from "../lib/session";
import { toast, useStore, type AutoReview, type Notice, type TurnState } from "../lib/store";
import { commandSummary, mcpLabel, quoteThinking, shellOf, stripAnsi, type FilePart } from "../lib/transcript";
import { setComposerDraft } from "./Composer";
import { DiffView, FileLink, Markdown } from "./content";
import { openLightbox } from "./Lightbox";
import { Button, ShimmerText, Spinner } from "./ui";

/** The transcript view: normal hides thinking, thinking shows it, verbose also opens tool rows. */
export const ViewContext = createContext<TranscriptView>("normal");

type ItemOf<T extends ThreadItem["type"]> = Extract<ThreadItem, { type: T }>;
type RowStatus = "running" | "done" | "failed";
/** Said after the detail (JIe 26261–26273): Denied, Stopped, Blocked. */
type Outcome = "denied" | "stopped" | "blocked";

const OUTCOMES: Record<Outcome, string> = { denied: "已拒绝", stopped: "已停止", blocked: "已拦截" };

/** What the turn knows about a row beyond its own items. */
export interface RowExtra {
  /** An approval request waits on it. */
  pending?: boolean;
  /** Tool hook feedback (c96d752d0 jz): ，收到 hook 反馈 after the detail, the texts in the body. */
  note?: string[];
  /** An auto-review blocked it: 已拦截, and its 仍然允许 key when it can be overridden. */
  blocked?: { badge: ReactNode };
}

const fail = (title: string) => (error: unknown) => toast("danger", title, errorMessage(error));

/**
 * A protocol status as a row's state. "stopped" is the transcript's own: the turn ended while
 * the item still ran, so it reads 已停止 instead of spinning or claiming a failure.
 */
function rowState(status: string): { status: RowStatus; outcome?: Outcome } {
  if (status === "inProgress") return { status: "running" };
  if (status === "failed") return { status: "failed" };
  if (status === "declined") return { status: "done", outcome: "denied" };
  if (status === "stopped" || status === "interrupted") return { status: "done", outcome: "stopped" };
  return { status: "done" };
}

/** cd57a9664 z(): a shared row is running while any of its calls runs, else it is the last. */
function sharedState(statuses: string[]): { status: RowStatus; outcome?: Outcome } {
  return statuses.includes("inProgress") ? { status: "running" } : rowState(statuses.at(-1) ?? "completed");
}

const verbFor = (status: RowStatus, [doing, done, failed]: readonly [string, string, string]) =>
  status === "running" ? doing : status === "failed" ? failed : done;

/** uM(…, 650): once shown, the running state stays at least 650ms (JIe 25941). */
function useHeld(running: boolean): boolean {
  const [held, setHeld] = useState(running);
  const since = useRef(0);
  useEffect(() => {
    if (running) {
      since.current = Date.now();
      setHeld(true);
      return;
    }
    const timer = setTimeout(() => setHeld(false), Math.max(0, since.current + 650 - Date.now()));
    return () => clearTimeout(timer);
  }, [running]);
  return running || held;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
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
        icon={copied ? <Check size={16} /> : <Copy size={16} />}
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
        <ImageIcon size={14} />
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
 * turn, the 已发送 receipt (c96d752d0 hI).
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
  const text = messageText(item.content);
  const images = item.content.filter((part) => part.type === "image" || part.type === "localImage");
  const chips = item.content.filter((part) => part.type === "mention" || part.type === "skill");
  const tall = text.length > FOLD_AT;
  const folded = tall && !expanded;
  return (
    <div className="user-row" data-entry-id={item.id} data-client-id={item.clientId ?? undefined} data-entering={entering || undefined}>
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
                <ImageIcon size={14} />
                附加的图片 {index + 1}
              </span>
            ),
          )}
        </div>
      )}
      {(text || chips.length > 0) && (
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
            {text}
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
            <Check size={12} />
          </span>
          已发送
        </span>
      ) : (
        actions && (
          <div className="row-actions" role="toolbar" aria-label="消息操作" data-find-omitted="">
            {actions}
          </div>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assistant text and reasoning

export function AgentMessage({ item, streaming }: { item: ItemOf<"agentMessage">; streaming?: boolean }) {
  if (item.questions?.length) return <QuestionsRow questions={item.questions} />;
  if (!item.text) return null;
  return (
    <div className={`agent-message ${item.phase === "commentary" ? "commentary" : ""}`} data-entry-id={item.id}>
      <Markdown text={item.text} streaming={streaming} voice className="prose" />
      {item.memoryCitation && item.memoryCitation.entries.length > 0 && <MemoryCitation citation={item.memoryCitation} />}
    </div>
  );
}

/**
 * request_user_input_async reads like AskUserQuestion's row (c52b02f3f "Asked {header}" /
 * "{count} questions"); the questions list in the body and the answer goes through the composer.
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

function MemoryCitation({ citation }: { citation: NonNullable<ItemOf<"agentMessage">["memoryCitation"]> }) {
  return (
    <ToolRow verb="已读取记忆" detail={`${citation.entries.length} 条`} status="done">
      <ul className="memory-list">
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
 * Thinking (default design, c96d752d0 UZ): hidden in the normal view; in the thinking and
 * verbose views the whole text shows as plain text (cb6930dae Xs, no Markdown), italic and
 * muted, with 复制为引用 on hover.
 */
export function Reasoning({ item }: { item: ItemOf<"reasoning"> }) {
  const view = use(ViewContext);
  const text = [...item.summary, ...item.content].filter(Boolean).join("\n\n");
  if (view === "normal" || !text) return null;
  return (
    <div className="thinking" data-entry-id={item.id}>
      {text}
      <span className="thinking-copy">
        <CopyKey text={() => quoteThinking(text)} label="复制为引用" always onCopied={() => toast("neutral", "已复制")} />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool rows

function DiffStat({ added, removed, enter }: { added: number; removed: number; enter: boolean }) {
  return (
    <span className="diff-stat" data-enter={enter || undefined}>
      <span className="plus">+{added}</span>
      <span className="minus">−{removed}</span>
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

function ToolRow({
  entryId,
  verb,
  detail,
  code = false,
  status,
  outcome,
  extra,
  model,
  stat,
  badge,
  children,
  bare = false,
  standalone = false,
  after,
  defaultOpen = false,
  onOpen,
}: {
  /** The item it shows, for find hits and the plan card's 打开计划. */
  entryId?: string;
  verb: ReactNode;
  detail?: ReactNode;
  /** A command summary or a file name: primary ink instead of the verb's. */
  code?: boolean;
  status: RowStatus;
  outcome?: Outcome;
  extra?: RowExtra;
  /** The agent's model, right after the verb (JIe ve2). */
  model?: string | null;
  stat?: { added: number; removed: number };
  /** Inline at the end of the line, outside the toggle (仍然允许). */
  badge?: ReactNode;
  children?: ReactNode;
  /** The body brings its own card and copy keys. */
  bare?: boolean;
  standalone?: boolean;
  /** Under the line whether or not it is open (tool images, cb6930dae Hu). */
  after?: ReactNode;
  defaultOpen?: boolean;
  /** The line opens something instead of a body (a sub-agent's session): a still caret. */
  onOpen?(): void;
}) {
  const verbose = use(ViewContext) === "verbose";
  const held = useHeld(status === "running");
  const shown: RowStatus = held ? "running" : status;
  const ran = useRef(false);
  if (status === "running") ran.current = true;
  const [picked, setPicked] = useState(defaultOpen);
  const open = verbose || picked;
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const body = useRef<HTMLDivElement>(null);
  const note = extra?.note?.length ? extra.note : null;
  const content = children !== undefined && children !== null && children !== false;
  const hasBody = !onOpen && (content || !!note);
  const toggles = hasBody && !verbose;
  const pending = !!extra?.pending;
  const said = extra?.blocked ? "blocked" : outcome;
  // The whole line toggles; the verb is the keyboard's button, so file links in the detail and
  // keys in the badge never sit inside a button.
  const Head = toggles || onOpen ? "button" : "span";
  return (
    <div className="tool-row" data-entry-id={entryId} data-status={shown} data-pending={pending || undefined}>
      <div className="tool-line" data-toggles={toggles || !!onOpen || undefined} data-open={open || undefined} onClick={onOpen ?? (toggles ? () => setPicked(!open) : undefined)}>
        <Head className="tool-head" {...(Head === "button" ? { type: "button" as const, "aria-expanded": toggles ? open : undefined } : {})}>
          <span className="tool-verb">{shown === "running" ? <ShimmerText>{verb}</ShimmerText> : verb}</span>
        </Head>
        {model && <span className="tool-model">{modelLabel(model)}</span>}
        {pending ? (
          <span className="tool-outcome" data-tone="warning">
            需要批准
          </span>
        ) : (
          detail !== undefined &&
          detail !== null &&
          detail !== "" && (
            <span className="tool-detail" data-kind={code ? "code" : undefined}>
              {detail}
            </span>
          )
        )}
        {note && <span className="tool-note">，收到 hook 反馈</span>}
        {shown !== "running" && said && <span className="tool-outcome">{OUTCOMES[said]}</span>}
        {shown === "running" && <span className="sr-only">运行中</span>}
        {shown !== "running" && stat && (stat.added > 0 || stat.removed > 0) && <DiffStat added={stat.added} removed={stat.removed} enter={ran.current} />}
        {onOpen ? <ChevronRight size={14} className="tool-caret" data-still="" /> : toggles && <ChevronRight size={14} className="tool-caret" />}
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
              <PlainBody copy={() => body.current?.querySelector<HTMLElement>(".tool-plain-main")?.innerText ?? ""} standalone={standalone}>
                {children}
              </PlainBody>
            ))}
        </div>
      )}
      {after}
    </div>
  );
}

/** cb6930dae Co: 正在运行 and, past 10 seconds, the time it has run; the copy key always shows. */
function RunningFooter({ startedAt, copy }: { startedAt?: number; copy: () => string }) {
  const now = useNow(startedAt !== undefined);
  const seconds = startedAt === undefined ? 0 : (now - startedAt) / 1000;
  return (
    <div className="cmd-running">
      <span>
        正在运行
        {seconds >= 10 && <span className="cmd-running-time"> {clockText(seconds)}</span>}
      </span>
      <CopyKey text={copy} compact always />
    </div>
  );
}

/**
 * cb6930dae Cu outside a card: an outlined card headed Bash / PowerShell; the command on the
 * code surface after `$` / `>` with a compact copy key (copies "$ cmd\n\noutput"), the output
 * (ANSI stripped, danger when it failed) up to 400px, and the running footer.
 */
function CommandCard({ item, footer, startedAt }: { item: ItemOf<"commandExecution">; footer: boolean; startedAt?: number }) {
  const { shell, script } = shellOf(item.command);
  const prompt = shell === "powershell" ? ">" : "$";
  const output = item.aggregatedOutput ? stripAnsi(item.aggregatedOutput).replace(/\s+$/, "") : "";
  const copy = () => [script && `${prompt} ${script}`, output].filter(Boolean).join("\n\n");
  return (
    <div className="tool-card">
      <div className="tool-card-box">
        <div className="tool-card-head">
          <span className="tool-card-title">{shell === "powershell" ? "PowerShell" : "Bash"}</span>
          {!script && output && <CopyKey text={copy} />}
        </div>
        <div className="tool-card-main">
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
          {footer && <RunningFooter startedAt={startedAt} copy={copy} />}
        </div>
      </div>
    </div>
  );
}

/** c52b02f3f fn: Read / Grep / LS / Bash, by what the command does. */
function commandLine(item: ItemOf<"commandExecution">, status: RowStatus): { verb: string; detail?: ReactNode; code?: boolean } {
  const one = item.commandActions.length === 1 ? item.commandActions[0] : null;
  if (one?.type === "read") {
    return { verb: verbFor(status, ["正在读取", "已读取", "读取失败"]), detail: <FileLink path={one.path}>{basename(one.path)}</FileLink>, code: true };
  }
  if (one?.type === "listFiles") return { verb: verbFor(status, ["正在列出", "已列出", "列出失败"]), detail: one.path ?? undefined };
  if (one?.type === "search") return { verb: verbFor(status, ["正在搜索", "已搜索", "搜索失败"]), detail: one.query ?? undefined };
  const { shell, script } = shellOf(item.command);
  const summary = commandSummary(script, shell);
  return { verb: verbFor(status, ["正在运行", "已运行", "运行失败"]), detail: summary ?? "一条命令", code: summary !== null };
}

/** One command, or a run of reads of one file sharing the first one's line. */
export function CommandRow({ items, startedAt, extra }: { items: ItemOf<"commandExecution">[]; startedAt?: number; extra?: RowExtra }) {
  const state = sharedState(items.map((item) => item.status));
  const line = commandLine(items[0], extra?.pending ? "done" : state.status);
  return (
    <ToolRow verb={line.verb} detail={line.detail} code={line.code} status={state.status} outcome={state.outcome} extra={extra} bare>
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
  const output = item.aggregatedOutput ? stripAnsi(item.aggregatedOutput).replace(/\s+$/, "") : "";
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

function changeStats(diff: string, kind: string): { added: number; removed: number } {
  if (diff.includes("@@")) return diffStats(diff);
  const lines = diff.replace(/\n$/, "").split("\n").length;
  return kind === "delete" ? { added: 0, removed: lines } : { added: lines, removed: 0 };
}

const FILE_VERBS = {
  add: ["正在创建", "已创建", "写入失败"],
  update: ["正在编辑", "已编辑", "编辑失败"],
  delete: ["正在删除", "已删除", "删除失败"],
} as const;

/** cb6930dae vu: the file's path and a copy key over its diff (400px), on the code surface. */
function DiffCard({ change, cwd }: { change: FilePart["change"]; cwd: string }) {
  const path = change.kind.type === "update" && change.kind.move_path ? change.kind.move_path : change.path;
  return (
    <div className="tool-card">
      <div className="diff-card">
        <div className="diff-card-head">
          <FileLink path={path} className="diff-card-path">
            {relativePath(path, cwd)}
          </FileLink>
          <CopyKey text={() => change.diff} />
        </div>
        <DiffView diff={change.diff} path={path} kind={change.kind.type} />
      </div>
    </div>
  );
}

/**
 * Edit / Write (c52b02f3f 932–955): one row per file — 已编辑 / 已创建 / 已删除 and its name,
 * +N −M once it settles — and adjacent changes to that file share it.
 */
export function FileRow({ parts, cwd, extra }: { parts: FilePart[]; cwd: string; extra?: RowExtra }) {
  const state = sharedState(parts.map((part) => part.item.status));
  const { change } = parts[0];
  const move = change.kind.type === "update" ? change.kind.move_path : null;
  const stat = parts.reduce(
    (sum, part) => {
      const next = changeStats(part.change.diff, part.change.kind.type);
      return { added: sum.added + next.added, removed: sum.removed + next.removed };
    },
    { added: 0, removed: 0 },
  );
  return (
    <ToolRow
      verb={verbFor(extra?.pending ? "done" : state.status, FILE_VERBS[change.kind.type])}
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
      {parts.map((part) => (
        <DiffCard key={`${part.item.id}:${part.index}`} change={part.change} cwd={cwd} />
      ))}
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

function contentText(content: unknown[]): string {
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

/**
 * An MCP call (c52b02f3f default branch): 已使用 {server}: {tool}, in a card of its arguments
 * and result text; images hang under the line. U17's latest progress is the running detail.
 */
export function McpRow({ item, progress, extra }: { item: ItemOf<"mcpToolCall">; progress?: string; extra?: RowExtra }) {
  const state = rowState(item.status);
  const label = mcpLabel(item.server, item.tool);
  const text = item.result ? contentText(item.result.content) : "";
  const images = item.result ? contentImages(item.result.content) : [];
  const structured = item.result?.structuredContent;
  return (
    <ToolRow
      verb={state.status === "running" ? `正在使用 ${label}` : `已使用 ${label}`}
      detail={state.status === "running" ? progress : undefined}
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

/** WebSearch / WebFetch (c52b02f3f 973–988) and the browser tool's find (shared-130). */
export function WebSearchRow({ item, running }: { item: ItemOf<"webSearch">; running: boolean }) {
  const action = item.action;
  const status = running ? "running" : "done";
  if (action?.type === "openPage") return <ToolRow verb={running ? "正在获取" : "已获取"} detail={action.url ?? ""} status={status} />;
  if (action?.type === "findInPage") {
    const pattern = action.pattern;
    if (pattern) return <ToolRow verb={running ? `正在查找“${pattern}”` : `已找到“${pattern}”`} status={status} />;
    return <ToolRow verb={running ? "正在网页中查找" : "已在网页中查找"} status={status} />;
  }
  const query = item.query || (action?.type === "search" ? (action.query ?? action.queries?.[0]) : "") || "";
  return <ToolRow verb={running ? "正在搜索网页" : "已搜索网页"} detail={query} status={status} />;
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
    return <SessionLine text="图片生成额度已用完" detail={when ? `${when} 重置` : undefined} />;
  }
  if (!src) {
    return (
      <ToolRow
        verb={live ? "正在生成图片" : "已生成图片"}
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
  return <ToolRow verb="已读取" detail={<FileLink path={item.path}>{basename(item.path)}</FileLink>} code status="done" after={src && <ToolImages srcs={[src]} />} />;
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
          <button type="button" className="event-caret" aria-label={caretLabel?.(open) ?? (open ? "收起" : "展开")} aria-expanded={open} onClick={toggle}>
            <ChevronRight size={14} className="tool-caret" />
          </button>
        )}
      </div>
      {expandable && open && <div className="event-body">{children}</div>}
    </div>
  );
}

function useAgentName(threadId: string, fallback?: string): string {
  return useStore((s) => {
    const meta = s.threads[threadId]?.meta;
    return meta?.agentNickname || meta?.name || fallback || "子代理";
  });
}

function AgentName({ threadId }: { threadId: string }) {
  return <>{useAgentName(threadId)}</>;
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

const SEND_VERBS = ["正在向代理发送消息", "已向代理发送消息", "向代理发送消息失败"] as const;
const STOP_VERBS = ["正在停止任务", "已停止任务", "停止任务失败"] as const;

// c52b02f3f 989–1062 / Rn / Poll: Task, SendMessage, Poll and TaskStop.
const COLLAB_VERBS: Record<string, readonly [string, string, string]> = {
  spawnAgent: ["正在运行代理", "已运行代理", "代理运行失败"],
  sendInput: SEND_VERBS,
  sendMessage: SEND_VERBS,
  followupTask: SEND_VERBS,
  resumeAgent: SEND_VERBS,
  wait: ["正在等待结果", "已等待结果", "等待结果失败"],
  closeAgent: STOP_VERBS,
  interruptAgent: STOP_VERBS,
};

/** The running sub-agent you can open (JIe 26166–26176): a 318px card with a still caret. */
function AgentCard({ threadId }: { threadId: string }) {
  return (
    <button type="button" className="agent-card" onClick={() => void openThread(threadId)}>
      <Users size={16} className="agent-card-icon" />
      <span className="agent-card-text">
        <ShimmerText>
          <AgentName threadId={threadId} />
        </ShimmerText>
      </span>
      <ChevronRight size={14} className="agent-card-caret" />
      <span className="sr-only">运行中</span>
    </button>
  );
}

function CollabRow({ item, extra }: { item: ItemOf<"collabAgentToolCall">; extra?: RowExtra }) {
  const state = rowState(item.status);
  const receivers = item.receiverThreadIds;
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
    return <ToolRow verb={state.status === "running" ? "正在列出代理" : count ? `已列出 ${count} 个代理` : "未找到其他代理"} status={state.status} outcome={state.outcome} extra={extra} />;
  }
  const one = receivers.length === 1 ? receivers[0] : null;
  const spawn = item.tool === "spawnAgent";
  if (spawn && one && state.status === "running") return <AgentCard threadId={one} />;
  const prompt = item.prompt?.trim() ?? "";
  return (
    <ToolRow
      verb={verbFor(state.status, COLLAB_VERBS[item.tool] ?? SEND_VERBS)}
      detail={one ? <AgentName threadId={one} /> : prompt.split("\n")[0]}
      model={spawn ? item.model : undefined}
      status={state.status}
      outcome={state.outcome}
      extra={extra}
      onOpen={spawn && one ? () => void openThread(one) : undefined}
    >
      {!one && prompt.includes("\n") ? <div className="tool-output">{prompt}</div> : undefined}
    </ToolRow>
  );
}

function AgentActivityRow({ item }: { item: ItemOf<"subAgentActivity"> }) {
  const path = item.agentPath.split("/").filter(Boolean).pop() ?? item.agentPath;
  const name = useAgentName(item.agentThreadId, path);
  if (item.kind === "completed") return <ReportRow threadId={item.agentThreadId} fallback={path} />;
  const verb = item.kind === "started" ? "已运行代理" : item.kind === "interrupted" ? "已停止任务" : "已向代理发送消息";
  return (
    <ToolRow verb={verb} detail={name} model={item.kind === "started" ? item.model : undefined} status="done" onOpen={() => void openThread(item.agentThreadId)} />
  );
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
    "一个 UserPromptSubmit hook 在提示送达 Codex 之前将其拦截。";
  return (
    <div className="hook-card">
      <div className="hook-card-head">
        <TriangleAlert size={14} className="hook-card-icon" />
        <span>一个 hook 拦截了您的提示</span>
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
              编辑提示
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Other hook runs that did not simply pass: one sentence each, not a tool row. */
export function HookLine({ run }: { run: HookRunSummary }) {
  const text = run.status === "failed" ? "Hook 运行失败" : run.status === "stopped" ? "Hook 停止了本轮" : "Hook 拦截了此操作";
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

const RISK: Record<string, string> = { low: "低", medium: "中", high: "高", critical: "严重" };

/** U2: an auto-review with no row of its own to block gets its own line. */
export function ReviewRow({ review, threadId, turnId }: { review: AutoReview; threadId: string; turnId: string }) {
  const { status, riskLevel, rationale } = review.review;
  return (
    <ToolRow
      verb={status === "timedOut" ? "自动审查超时" : "自动审查已拒绝"}
      detail={[review.summary, riskLevel ? `风险${RISK[riskLevel] ?? riskLevel}` : ""].filter(Boolean).join(" · ")}
      status="failed"
      badge={status === "denied" && review.overridable ? <AllowKey review={review} threadId={threadId} turnId={turnId} /> : undefined}
    >
      {rationale ? <div className="tool-output">{rationale}</div> : undefined}
    </ToolRow>
  );
}

/** Codex's own warnings group into one line (c96d752d0 wN); the other notices read as sentences (Lq). */
const SYSTEM_NOTICES = new Set<Notice["kind"]>(["warning", "guardian"]);

export const isSystemNotice = (notice: Notice) => SYSTEM_NOTICES.has(notice.kind);

/** c96d752d0 wN: {n} 条 Codex 通知 — every one warns, so it starts open (and stays open in verbose). */
export function SystemNotices({ notices }: { notices: Notice[] }) {
  const verbose = use(ViewContext) === "verbose";
  const [picked, setPicked] = useState(true);
  const open = verbose || picked;
  return (
    <div className="notice-group" data-find-omitted="">
      <button type="button" className="notice-group-head" aria-expanded={open} onClick={() => !verbose && setPicked(!open)}>
        <TriangleAlert size={14} className="notice-warning" aria-label="警告" />
        <span className="notice-group-title">{notices.length === 1 ? "Codex 通知" : `${notices.length} 条 Codex 通知`}</span>
        <ChevronRight size={14} className="tool-caret" />
      </button>
      {open && (
        <div className="notice-group-body">
          {notices.map((notice) => (
            <div key={notice.id} className="notice-item">
              {notices.length > 1 && <TriangleAlert size={14} className="notice-warning" aria-label="警告" />}
              <span className="notice-item-text">{notice.detail ? `${notice.text}\n${notice.detail}` : notice.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
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

/** c96d752d0 Wq: a warning icon and the error, with 查看详情 when there is more. */
export function ErrorRow({ text, details }: { text: string; details?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="error-row">
      <div className="error-row-head">
        <TriangleAlert size={14} className="error-row-icon" />
        <span>{text}</span>
      </div>
      {details && (
        <>
          <button type="button" className="details-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            查看详情
            <ChevronRight size={14} className="tool-caret" />
          </button>
          {open && (
            <div className="details-box">
              <span>{details}</span>
              <span className="details-copy">
                <CopyKey text={() => details} label="复制详情" always />
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const TODO_STATES: Record<string, string> = { completed: "已完成", inProgress: "进行中", pending: "未完成" };

/** TodoWrite (c52b02f3f 1063–1071, cb6930dae Lu): 已更新待办, the steps with a check, a spinner or a ring. */
export function PlanRow({ plan }: { plan: NonNullable<TurnState["plan"]> }) {
  if (!plan.steps.length) return <ToolRow verb="已清空待办" status="done" />;
  return (
    <ToolRow verb="已更新待办" status="done" bare>
      <div className="todo-body">
        {plan.explanation && <div className="todo-explain">{plan.explanation}</div>}
        <ul className="todo-items">
          {plan.steps.map((step, index) => (
            <li key={index} data-status={step.status}>
              <span className="todo-icon" aria-hidden="true">
                {step.status === "completed" ? <Check size={12} /> : step.status === "inProgress" ? <Spinner size={12} inherit /> : <Circle size={12} />}
              </span>
              <span className="sr-only">{TODO_STATES[step.status]}</span>
              <span className="todo-text">{step.step}</span>
            </li>
          ))}
        </ul>
      </div>
    </ToolRow>
  );
}

// ---------------------------------------------------------------------------
// Everything else

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
          <ScanSearch size={14} /> 开始代码审查{item.review ? `：${item.review}` : ""}
        </div>
      );
    case "exitedReviewMode":
      return (
        <div className="review-card">
          <div className="card-head">
            <ScanSearch size={14} />
            <span>审查结果</span>
          </div>
          <Markdown text={item.review} className="prose" />
        </div>
      );
    case "plan":
      // ExitPlanMode (c52b02f3f 1079–1085, cb6930dae Ru); open, since Codex has no plan pane.
      return (
        <ToolRow entryId={item.id} verb={live ? "正在提出计划" : "已提出计划"} status={live ? "running" : "done"} defaultOpen bare>
          <div className="plan-text">{item.text}</div>
        </ToolRow>
      );
    case "hookPrompt":
      // c96d752d0 yI.hook: "Hook re-prompted Claude".
      return (
        <EventRow verb="Hook 重新提示了 Codex">
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
          verb={state.status === "running" ? `正在使用 ${name}` : `已使用 ${name}`}
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
    case "sleep": {
      // shared-130 "Waiting {count} seconds" / "Waited {count} seconds".
      const seconds = Math.max(1, Math.round(item.durationMs / 1000));
      return <ToolRow verb={live ? `正在等待 ${seconds} 秒` : `已等待 ${seconds} 秒`} status={live ? "running" : "done"} />;
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
