// Renderers for each ThreadItem variant, shaped like the Code transcript of Claude Desktop
// 2.42304.0.0 (c96d752d0; class strings from c425fb3cf): a tool is one line of verb · detail ·
// caret with no leading icon (MCP calls and sub-agents keep theirs), the running verb
// shimmers, and the body mounts on first open, then toggles without a height animation.

import type { CommandAction } from "@protocol/v2/CommandAction";
import type { HookRunSummary } from "@protocol/v2/HookRunSummary";
import type { ThreadItem } from "@protocol/v2/ThreadItem";
import type { UserInput } from "@protocol/v2/UserInput";
import { Bot, Check, ChevronRight, Copy, Image as ImageIcon, Info, ListChecks, Pencil, Plug, ScanSearch, TriangleAlert } from "lucide-react";
import { createContext, use, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { approveDeniedAction, errorMessage, loginMcpServer, openThread, readAgentReport } from "../lib/codex";
import { basename, diffStats, formatDuration, relativePath } from "../lib/format";
import type { TranscriptView } from "../lib/session";
import { toast, useStore, type AutoReview, type Notice, type TurnState } from "../lib/store";
import { agentCell, agentPulse, agentTally, HOOK_EVENTS, quoteThinking } from "../lib/transcript";
import { DiffView, FileDiffCard, FileLink, Markdown } from "./content";
import { openLightbox } from "./Lightbox";
import { Button, CopyButton, ShimmerText, StatusDot } from "./ui";

/** The transcript view: normal hides thinking, thinking shows it, verbose also opens tool rows. */
export const ViewContext = createContext<TranscriptView>("normal");

type ItemOf<T extends ThreadItem["type"]> = Extract<ThreadItem, { type: T }>;
type RowStatus = "running" | "done" | "failed" | "declined";

/** The clicked thumbnail is where the preview grows from (W17 image preview). */
const zoom = (src: string) => (event: MouseEvent<HTMLElement>) => openLightbox(src, event.currentTarget);

const fail = (title: string) => (error: unknown) => toast("error", title, errorMessage(error));

// ---------------------------------------------------------------------------
// User message

export function messageText(content: UserInput[]): string {
  return content
    .filter((part): part is Extract<UserInput, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

/** shared-2 UX collapseThreshold: a taller bubble folds behind 显示更多. */
const FOLD_AT = 300;

/**
 * The CDS UserMessage bubble (shared-2 UX). `onEdit` turns it into an editor in place
 * (取消 / 保存, c96d752d0 lP) that rewinds the thread to this message and sends the edit.
 */
export function UserBubble({
  item,
  onEdit,
  entering = false,
  receipt = false,
}: {
  item: ItemOf<"userMessage">;
  onEdit?: (text: string) => Promise<void>;
  /** Sent after the transcript mounted: grow in (code-user-bubble-enter). */
  entering?: boolean;
  /** Steered into the running turn: the 已发送 receipt (c96d752d0 hI). */
  receipt?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tall, setTall] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const text = messageText(item.content);
  const images = item.content.filter((part) => part.type === "image" || part.type === "localImage");
  const chips = item.content.filter((part) => part.type === "mention" || part.type === "skill");
  useLayoutEffect(() => {
    if (body.current) setTall(body.current.scrollHeight > FOLD_AT);
  }, [text]);

  if (draft !== null && onEdit) {
    const unchanged = !draft.trim() || draft.trim() === text.trim();
    const save = () => {
      if (unchanged || busy) return;
      setBusy(true);
      onEdit(draft.trim())
        .then(() => setDraft(null))
        .catch(fail("重新发送失败"))
        .finally(() => setBusy(false));
    };
    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        save();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDraft(null);
      }
    };
    return (
      <div className="user-row" data-entry-id={item.id}>
        <div className="user-bubble" data-editing="" data-text-size="">
          <textarea
            className="user-edit-input"
            value={draft}
            autoFocus
            aria-label="编辑消息"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="user-edit-actions">
          <Button variant="ghost" size="xs" onClick={() => setDraft(null)}>
            取消
          </Button>
          <Button variant="primary" size="xs" disabled={busy || unchanged} onClick={save}>
            保存
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="user-row" data-entry-id={item.id} data-client-id={item.clientId ?? undefined} data-entering={entering || undefined}>
      {images.length > 0 && (
        <div className="user-images">
          {images.map((part, index) =>
            part.type === "image" && "url" in part ? (
              <img key={index} src={part.url} alt="附件图片" className="user-image zoomable" onClick={zoom(part.url)} />
            ) : (
              <span key={index} className="attachment-chip">
                <ImageIcon size={14} />
                {part.type === "localImage" ? basename(part.path) : "图片"}
              </span>
            ),
          )}
        </div>
      )}
      {(text || chips.length > 0) && (
        <div className="user-bubble" data-text-size="">
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
          <div ref={body} className="user-text" data-folded={(tall && !expanded) || undefined}>
            {text}
          </div>
          {tall && !expanded && <span className="sr-only">消息已折叠</span>}
          {tall && (
            <Button variant="ghost" size="xs" className="user-fold" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              {expanded ? "收起" : "显示更多"}
            </Button>
          )}
        </div>
      )}
      {receipt && (
        <span className="receipt">
          <span className="receipt-check">
            <Check size={12} />
          </span>
          已发送
        </span>
      )}
      {text && (
        <div className="row-actions">
          <CopyButton text={text} />
          {onEdit && <Button variant="ghost" size="xs" muted icon={<Pencil size={16} />} label="编辑消息" onClick={() => setDraft(text)} />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assistant text and reasoning

export function AgentMessage({ item, streaming }: { item: ItemOf<"agentMessage">; streaming?: boolean }) {
  if (item.questions?.length) return <QuestionsCard id={item.id} questions={item.questions} />;
  if (!item.text) return null;
  return (
    <div className={`agent-message ${item.phase === "commentary" ? "commentary" : ""}`} data-entry-id={item.id}>
      <Markdown text={item.text} streaming={streaming} voice className="prose" />
      {item.memoryCitation && item.memoryCitation.entries.length > 0 && <MemoryCitation citation={item.memoryCitation} />}
    </div>
  );
}

/**
 * request_user_input_async: read-only, like the 2.42304 AskUserQuestion transcript card whose
 * renderer never gets a submit row (07 §7.3); the answer goes through the composer.
 */
function QuestionsCard({ id, questions }: { id: string; questions: { title: string; options: string[] | null }[] }) {
  return (
    <div className="questions-card" data-entry-id={id}>
      {questions.map((question, index) => (
        <div key={index} className="question">
          <div className="question-title">{question.title}</div>
          {question.options && (
            <ol className="question-options">
              {question.options.map((option, n) => (
                <li key={n}>
                  <span className="question-key">{n + 1}</span>
                  {option}
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
    </div>
  );
}

function MemoryCitation({ citation }: { citation: NonNullable<ItemOf<"agentMessage">["memoryCitation"]> }) {
  return (
    <ToolRow verb="引用了记忆" detail={`${citation.entries.length} 条`} status="done">
      <ul className="memory-list">
        {citation.entries.map((entry, index) => (
          <li key={index}>
            <FileLink path={entry.path} line={entry.lineStart}>
              <code className="inline-code">
                {basename(entry.path)}:{entry.lineStart}
                {entry.lineEnd !== entry.lineStart ? `–${entry.lineEnd}` : ""}
              </code>
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
 * verbose views the whole text shows, italic and muted, with 复制为引用 on hover.
 */
export function Reasoning({ item, live }: { item: ItemOf<"reasoning">; live: boolean }) {
  const view = use(ViewContext);
  const text = [...item.summary, ...item.content].filter(Boolean).join("\n\n");
  if (view === "normal" || !text) return null;
  return (
    <div className="thinking" data-entry-id={item.id}>
      <Markdown text={text} streaming={live} />
      <span className="thinking-copy">
        <CopyButton text={quoteThinking(text)} label="复制为引用" />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool rows

function ToolRow({
  verb,
  detail,
  meta,
  icon,
  status,
  pending,
  badge,
  children,
  after,
  defaultOpen = false,
  copy,
}: {
  verb: ReactNode;
  detail?: ReactNode;
  /** After the detail: exit code, duration, progress. */
  meta?: ReactNode;
  /** Only MCP calls and sub-agents lead with an icon. */
  icon?: ReactNode;
  status: RowStatus;
  pending?: boolean;
  /** Inline after the line, outside the toggle (仍然允许). */
  badge?: ReactNode;
  children?: ReactNode;
  /** Under the line while the body is closed (a running command's tail, the agent grid). */
  after?: ReactNode;
  defaultOpen?: boolean;
  /** Text for the body's hover copy key; the body's own text otherwise. */
  copy?: string;
}) {
  const verbose = use(ViewContext) === "verbose";
  const [picked, setPicked] = useState(defaultOpen);
  const open = verbose || picked;
  const [mounted, setMounted] = useState(open);
  const body = useRef<HTMLDivElement>(null);
  if (open && !mounted) setMounted(true);
  const toggles = !!children && !verbose;
  // The whole line toggles; the verb is the keyboard's button, so file links in the detail
  // and keys in the badge are not nested inside it.
  const Head = toggles ? "button" : "span";
  return (
    <div className="tool-row" data-status={status}>
      <div className="tool-line" data-toggles={toggles || undefined} data-open={open || undefined} onClick={toggles ? () => setPicked(!open) : undefined}>
        <Head className="tool-head" {...(toggles ? { type: "button" as const, "aria-expanded": open } : {})}>
          {icon && <span className="tool-icon">{icon}</span>}
          <span className="tool-verb">{status === "running" ? <ShimmerText>{verb}</ShimmerText> : verb}</span>
        </Head>
        {detail !== undefined && detail !== "" && <span className="tool-detail">{detail}</span>}
        {meta}
        {toggles && <ChevronRight size={14} className="tool-caret" />}
        {(pending || badge) && (
          <span className="tool-badges" onClick={(event) => event.stopPropagation()}>
            {pending && (
              <span className="badge badge-warning">
                <StatusDot kind="blocked" /> 等待批准
              </span>
            )}
            {badge}
          </span>
        )}
      </div>
      {children && mounted && (
        <div className="tool-body" ref={body} hidden={!open}>
          {children}
          <BodyCopy text={() => copy ?? body.current?.innerText ?? ""} />
        </div>
      )}
      {!open && after}
    </div>
  );
}

/** v.body: every tool body copies on hover (复制 -> 已复制, back after 1200ms). */
function BodyCopy({ text }: { text: () => string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <span className="tool-body-copy">
      <Button
        variant="ghost"
        size="xs"
        muted
        icon={copied ? <Check size={16} /> : <Copy size={16} />}
        label={copied ? "已复制" : "复制"}
        onClick={() => navigator.clipboard.writeText(text().trim()).then(() => setCopied(true), fail("复制失败"))}
      />
    </span>
  );
}

function statusOf(status: string): RowStatus {
  if (status === "inProgress") return "running";
  if (status === "failed") return "failed";
  if (status === "declined") return "declined";
  return "done";
}

const took = (ms: number | null, status: RowStatus) =>
  ms !== null && status !== "running" ? <span className="tool-meta">· 用时 {formatDuration(ms)}</span> : null;

function actionParts(action: CommandAction, cwd: string, running: boolean): { verb: string; detail: ReactNode } {
  const verb = (doing: string, done: string) => (running ? doing : done);
  switch (action.type) {
    case "read":
      return {
        verb: verb("正在读取", "已读取"),
        detail: (
          <FileLink path={action.path}>
            <code>{relativePath(action.path, cwd)}</code>
          </FileLink>
        ),
      };
    case "listFiles":
      return { verb: verb("正在列出", "已列出"), detail: <code>{action.path ? relativePath(action.path, cwd) : "."}</code> };
    case "search":
      return {
        verb: verb("正在搜索", "已搜索"),
        detail: (
          <>
            <code>{action.query ?? ""}</code>
            {action.path && <> 于 {relativePath(action.path, cwd)}</>}
          </>
        ),
      };
    default:
      return { verb: verb("正在运行", "已运行"), detail: <code>{action.command}</code> };
  }
}

export function isExploration(item: ThreadItem): item is ItemOf<"commandExecution"> {
  return (
    item.type === "commandExecution" &&
    item.commandActions.length > 0 &&
    item.commandActions.every((action) => action.type !== "unknown") &&
    item.status !== "failed" &&
    item.status !== "declined"
  );
}

function OutputBlock({ output, live }: { output: string; live?: boolean }) {
  const text = output.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  const shown = live ? text.split("\n").slice(-8).join("\n") : text;
  return <pre className="cmd-output" data-live={live || undefined}>{shown || " "}</pre>;
}

export function CommandRow({
  item,
  pending,
  cwd,
  stdin,
}: {
  item: ItemOf<"commandExecution">;
  pending: boolean;
  cwd: string;
  /** U30: what the agent typed into the running process (terminalInteraction). */
  stdin?: string[];
}) {
  const status = statusOf(item.status);
  const running = status === "running";
  const actions = item.commandActions.length ? item.commandActions : [{ type: "unknown", command: item.command } as CommandAction];
  const parts =
    actions.length === 1
      ? actionParts(actions[0], cwd, running)
      : { verb: running ? "正在运行" : "已运行", detail: <code>{actions.map((action) => action.command).join(" && ")}</code> };
  const verb = status === "failed" ? "运行失败" : status === "declined" ? "已拒绝运行" : parts.verb;
  const exit = item.exitCode !== null && item.exitCode !== 0 ? `退出码 ${item.exitCode}` : null;
  return (
    <ToolRow
      verb={
        <>
          {item.source === "userShell" && <span className="shell-mark">!</span>}
          {verb}
        </>
      }
      detail={parts.detail}
      status={status}
      pending={pending}
      defaultOpen={item.source === "userShell"}
      copy={item.aggregatedOutput || item.command}
      after={running && item.aggregatedOutput ? <OutputBlock output={item.aggregatedOutput} live /> : null}
      meta={
        <>
          {exit && <span className="tool-meta fail-text">· {exit}</span>}
          {took(item.durationMs, status)}
        </>
      }
    >
      <div className="command-detail">
        <div className="kv-label">命令</div>
        <div className="command-line">
          <code>{item.command}</code>
          <CopyButton text={item.command} label="复制命令" />
        </div>
        <div className="command-cwd">{item.cwd}</div>
        {stdin?.map((line, index) => (
          <div key={index} className="command-stdin">
            输入 <code>{line.replace(/\r?\n$/, "")}</code>
          </div>
        ))}
        <div className="kv-label">输出</div>
        {item.aggregatedOutput ? <OutputBlock output={item.aggregatedOutput} /> : <div className="kv-empty">无输出</div>}
      </div>
    </ToolRow>
  );
}

/** Two or more commands in a row fold into 已运行 N 条命令 (shared-130 "Ran {count} commands"). */
export function CommandGroup({ items, cwd, stdin }: { items: ItemOf<"commandExecution">[]; cwd: string; stdin: Record<string, string[]> }) {
  const live = items.findLast((item) => item.status === "inProgress");
  return (
    <ToolRow
      verb={live ? "正在运行" : `已运行 ${items.length} 条命令`}
      detail={live ? <code>{live.command}</code> : undefined}
      status={live ? "running" : "done"}
      after={live?.aggregatedOutput ? <OutputBlock output={live.aggregatedOutput} live /> : null}
      copy={items.map((item) => item.command).join("\n")}
    >
      <div className="tool-group">
        {items.map((item) => (
          <CommandRow key={item.id} item={item} pending={false} cwd={cwd} stdin={stdin[item.id]} />
        ))}
      </div>
    </ToolRow>
  );
}

/** A run of read / list / search commands folds into one line: 已读取 3 个文件 · 2 次搜索. */
export function ExplorationGroup({ items, cwd }: { items: ItemOf<"commandExecution">[]; cwd: string }) {
  const actions = items.flatMap((item) => item.commandActions.map((action) => ({ item, action })));
  const live = actions.findLast(({ item }) => item.status === "inProgress");
  const count = (type: CommandAction["type"]) => actions.filter(({ action }) => action.type === type).length;
  const [read, list, search] = [count("read"), count("listFiles"), count("search")];
  let verb: string;
  let detail: ReactNode;
  if (live || actions.length === 1) {
    ({ verb, detail } = actionParts((live ?? actions[0]).action, cwd, !!live));
  } else if (!read && !list) {
    verb = "已搜索";
    detail = `${search} 次`;
  } else {
    verb = read ? "已读取" : "已列出";
    detail = [read && `${read} 个文件`, list && `${list} 个目录`, search && `${search} 次搜索`].filter(Boolean).join(" · ");
  }
  return (
    <ToolRow verb={verb} detail={detail} status={live ? "running" : "done"}>
      <div className="explore-list">
        {actions.map(({ item, action }, index) => {
          const parts = actionParts(action, cwd, false);
          return (
            <div key={`${item.id}:${index}`}>
              {parts.verb} {parts.detail}
            </div>
          );
        })}
      </div>
    </ToolRow>
  );
}

function changeStats(diff: string, kind: string): { added: number; removed: number } {
  if (diff.includes("@@")) return diffStats(diff);
  const lines = diff.replace(/\n$/, "").split("\n").length;
  return kind === "delete" ? { added: 0, removed: lines } : { added: lines, removed: 0 };
}

/** 已编辑 X +3 −1 (Edited {fileName}); the diff opens below it. */
export function FileChangeCard({ item, pending, cwd }: { item: ItemOf<"fileChange">; pending: boolean; cwd: string }) {
  const status = statusOf(item.status);
  const kinds = new Set(item.changes.map((change) => change.kind.type));
  const settled = kinds.size === 1 && kinds.has("add") ? "已创建" : kinds.size === 1 && kinds.has("delete") ? "已删除" : "已编辑";
  const verb =
    status === "running" ? (pending ? "请求修改" : "正在编辑") : status === "declined" ? "已拒绝修改" : status === "failed" ? "修改失败" : settled;
  const total = item.changes.reduce(
    (sum, change) => {
      const stats = changeStats(change.diff, change.kind.type);
      return { added: sum.added + stats.added, removed: sum.removed + stats.removed };
    },
    { added: 0, removed: 0 },
  );
  const files = item.changes.map((change) => ({
    path: relativePath(change.path, cwd),
    kind: change.kind.type,
    diff: change.diff,
    movePath: change.kind.type === "update" && change.kind.move_path ? relativePath(change.kind.move_path, cwd) : null,
  }));
  const one = files.length === 1 ? files[0] : null;
  return (
    <ToolRow
      verb={verb}
      copy={item.changes.map((change) => change.diff).join("\n")}
      detail={
        <>
          {one ? (
            <FileLink path={item.changes[0].kind.type === "update" && item.changes[0].kind.move_path ? item.changes[0].kind.move_path : item.changes[0].path}>
              <code>{one.movePath ? `${one.path} → ${one.movePath}` : one.path}</code>
            </FileLink>
          ) : (
            `${files.length} 个文件`
          )}
          {(total.added > 0 || total.removed > 0) && (
            <span className="diff-stat">
              <span className="plus">+{total.added}</span>
              <span className="minus">−{total.removed}</span>
            </span>
          )}
        </>
      }
      status={status}
      pending={pending}
      defaultOpen={!!one && one.diff.length < 4000}
    >
      {one ? (
        <div className="file-diff open">
          <DiffView diff={one.diff} path={one.movePath ?? one.path} kind={one.kind} />
        </div>
      ) : (
        <div className="change-files">
          {files.map((file) => (
            <FileDiffCard key={file.path} file={file} />
          ))}
        </div>
      )}
    </ToolRow>
  );
}

function jsonText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function McpContent({ content }: { content: unknown[] }) {
  return (
    <>
      {content.map((part, index) => {
        const block = part as { type?: string; text?: string; data?: string; mimeType?: string };
        if (block.type === "text" && block.text) return <pre key={index} className="code-pre">{block.text}</pre>;
        if (block.type === "image" && block.data) {
          const src = `data:${block.mimeType ?? "image/png"};base64,${block.data}`;
          return <img key={index} className="tool-image zoomable" alt="工具输出" src={src} onClick={zoom(src)} />;
        }
        return <pre key={index} className="code-pre">{jsonText(part)}</pre>;
      })}
    </>
  );
}

function resultText(content: unknown[]): string {
  return content
    .map((part) => {
      const block = part as { type?: string; text?: string };
      return block.type === "text" && block.text ? block.text : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/** The server's icon, then `server · tool`, shimmering while it runs; U17 adds the latest progress. */
export function McpCallRow({ item, progress }: { item: ItemOf<"mcpToolCall">; progress?: string }) {
  const status = statusOf(item.status);
  return (
    <ToolRow
      icon={<Plug size={16} />}
      verb={
        <span className="tool-name">
          {item.server} · {item.tool}
        </span>
      }
      status={status}
      meta={
        <>
          {status === "running" && progress && <span className="tool-meta">· {progress}</span>}
          {took(item.durationMs, status)}
        </>
      }
      copy={(item.result && resultText(item.result.content)) || jsonText(item.arguments)}
    >
      <div className="kv-label">参数</div>
      <pre className="code-pre">{jsonText(item.arguments)}</pre>
      {item.result && (
        <>
          <div className="kv-label">结果</div>
          <McpContent content={item.result.content} />
          {item.result.structuredContent !== null && <pre className="code-pre">{jsonText(item.result.structuredContent)}</pre>}
        </>
      )}
      {item.error && <div className="error-text">{item.error.message}</div>}
    </ToolRow>
  );
}

/** app-server's v2 WebSearchAction is camelCase (openPage / findInPage, ext/items web_search.rs). */
export function WebSearchRow({ item, running }: { item: ItemOf<"webSearch">; running: boolean }) {
  const action = item.action;
  const status = running ? "running" : "done";
  if (action?.type === "openPage") return <ToolRow verb={running ? "正在打开网页" : "已打开网页"} detail={action.url ?? ""} status={status} />;
  if (action?.type === "findInPage") {
    return <ToolRow verb={running ? "正在网页中查找" : "已在网页中查找"} detail={<code>{action.pattern ?? ""}</code>} status={status} />;
  }
  const query = item.query || (action?.type === "search" ? (action.query ?? action.queries?.join("、")) : "") || "";
  return <ToolRow verb={running ? "正在搜索网页" : "已搜索网页"} detail={query} status={status} />;
}

function ImageGeneration({ item, live }: { item: ItemOf<"imageGeneration">; live: boolean }) {
  const src = "result" in item && item.result ? `data:image/png;base64,${item.result}` : null;
  if (item.failure?.type === "usageLimitExceeded") {
    const at = item.failure.resetsAt;
    const when = at ? new Date(at > 1e12 ? at : at * 1000).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
    return <NoticeLine tone="warning" text="图片生成额度已用完" detail={when ? `${when} 重置` : undefined} />;
  }
  if (!src) {
    return (
      <ToolRow
        verb={live ? "正在生成图片" : "已生成图片"}
        detail={item.savedPath ? <FileLink path={item.savedPath}>{basename(item.savedPath)}</FileLink> : undefined}
        status={live ? "running" : "done"}
      />
    );
  }
  return (
    <div className="image-gen" data-entry-id={item.id}>
      <img src={src} alt={item.revisedPrompt ?? "生成的图片"} className="generated-image zoomable" onClick={zoom(src)} />
      {item.revisedPrompt && <div className="image-caption">{item.revisedPrompt}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event rows: lines injected into the conversation (W13 desktop side-session reports,
// c96d752d0 tN / nN): a verb, a linked subject and a caret over a plain body.

export function EventRow({
  verb,
  subject,
  onOpen,
  children,
}: {
  verb: ReactNode;
  subject?: ReactNode;
  /** Called the first time the body opens (lazy reports). */
  onOpen?(): void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toggle = () => {
    if (!children) return;
    if (!open) onOpen?.();
    setOpen(!open);
  };
  return (
    <div className="event-row">
      <div className="event-head">
        <button type="button" className="event-verb" aria-expanded={children ? open : undefined} onClick={toggle}>
          {verb}
        </button>
        {subject}
        {children && (
          <button type="button" className="event-caret" aria-label={open ? "收起" : "展开"} aria-expanded={open} onClick={toggle}>
            <ChevronRight size={14} className="tool-caret" />
          </button>
        )}
      </div>
      {children && open && <div className="event-body">{children}</div>}
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

/** The sub-agent's session: underlined like a link, opens it. */
function AgentLink({ threadId, fallback }: { threadId: string; fallback?: string }) {
  const name = useAgentName(threadId, fallback);
  return (
    <button type="button" className="event-subject" onClick={() => void openThread(threadId)}>
      <bdi>{name}</bdi>
    </button>
  );
}

/** 收到的消息来自 〈agent〉 (Received message from): the report loads on first open. */
function ReportRow({ threadId, text, fallback }: { threadId: string; text?: string | null; fallback?: string }) {
  const [body, setBody] = useState<string | undefined>(text ?? undefined);
  const load = () => {
    if (body !== undefined) return;
    readAgentReport(threadId).then(
      (report) => setBody(report ?? ""),
      () => setBody(""),
    );
  };
  return (
    <EventRow verb="收到的消息来自" subject={<AgentLink threadId={threadId} fallback={fallback} />} onOpen={load}>
      {body === undefined ? <div className="muted">加载中…</div> : body ? <div className="report-text">{body}</div> : <div className="muted">没有汇报内容</div>}
    </EventRow>
  );
}

/** W18 workflow agent grid: one 6px cell per agent; running cells breathe out of step. */
function AgentGrid({ states }: { states: string[] }) {
  const cells = states.map(agentCell);
  const tally = agentTally(cells);
  const label = `${tally.done}/${cells.length} 个代理已完成，${tally.running} 个运行中，${tally.stalled} 个停滞，${tally.error} 个失败`;
  return (
    <div className="agent-grid" role="img" aria-label={label} data-tip={label}>
      {cells.map((cell, index) => {
        const pulse = agentPulse(index);
        const style =
          cell === "running" ? ({ "--epitaxy-pulse-dur": `${pulse.duration.toFixed(2)}s`, "--epitaxy-pulse-delay": `${pulse.delay.toFixed(2)}s` } as CSSProperties) : undefined;
        return <span key={index} className="agent-cell" data-state={cell} style={style} />;
      })}
    </div>
  );
}

const COLLAB_VERBS: Record<string, [string, string]> = {
  spawnAgent: ["正在启动", "已启动"],
  sendInput: ["正在发送给", "已发送给"],
  sendMessage: ["正在发送给", "已发送给"],
  followupTask: ["正在交代", "已交代"],
  resumeAgent: ["正在恢复", "已恢复"],
  wait: ["正在等待", "已等待"],
  closeAgent: ["正在关闭", "已关闭"],
  interruptAgent: ["正在中断", "已中断"],
};

function CollabRow({ item }: { item: ItemOf<"collabAgentToolCall"> }) {
  const status = statusOf(item.status === "interrupted" ? "failed" : item.status);
  const receivers = item.receiverThreadIds;
  const grid = receivers.length >= 2 ? <AgentGrid states={receivers.map((id) => item.agentsStates[id]?.status ?? "pendingInit")} /> : null;
  if (item.tool === "wait" && status !== "running") {
    const reports = receivers.filter((id) => item.agentsStates[id]?.message);
    if (reports.length === 1) return <ReportRow threadId={reports[0]} text={item.agentsStates[reports[0]]?.message} />;
    if (reports.length > 1) {
      return (
        <EventRow verb={`收到 ${reports.length} 条消息`}>
          {reports.map((id) => (
            <ReportRow key={id} threadId={id} text={item.agentsStates[id]?.message} />
          ))}
        </EventRow>
      );
    }
  }
  if (item.tool === "listAgents") {
    const count = Object.keys(item.agentsStates).length;
    return <ToolRow icon={<Bot size={16} />} verb={status === "running" ? "正在列出代理" : `已列出 ${count} 个代理`} status={status} />;
  }
  const [doing, done] = COLLAB_VERBS[item.tool] ?? ["正在调用", "已调用"];
  const verb = status === "failed" ? `${done}失败` : status === "running" ? doing : done;
  const names = receivers.length === 1 ? <AgentName threadId={receivers[0]} /> : receivers.length > 1 ? `${receivers.length} 个子代理` : "子代理";
  const model = [item.model, item.reasoningEffort].filter(Boolean).join(" · ");
  return (
    <ToolRow
      icon={<Bot size={16} />}
      verb={verb}
      detail={names}
      status={status}
      meta={model ? <span className="tool-meta">· {model}</span> : null}
      after={status === "running" ? grid : null}
    >
      {item.prompt && <Markdown text={item.prompt} />}
      {grid}
      {receivers.length > 0 && (
        <div className="agent-links">
          {receivers.map((id) => (
            <AgentLink key={id} threadId={id} />
          ))}
        </div>
      )}
    </ToolRow>
  );
}

function AgentActivityRow({ item }: { item: ItemOf<"subAgentActivity"> }) {
  const path = item.agentPath.split("/").filter(Boolean).pop() ?? item.agentPath;
  if (item.kind === "completed") return <ReportRow threadId={item.agentThreadId} fallback={path} />;
  const verb = item.kind === "started" ? "已启动" : item.kind === "interrupted" ? "已中断" : "已发送给";
  const model = [item.model, item.reasoningEffort].filter(Boolean).join(" · ");
  return (
    <ToolRow
      icon={<Bot size={16} />}
      verb={verb}
      detail={<AgentLink threadId={item.agentThreadId} fallback={path} />}
      status="done"
      meta={model ? <span className="tool-meta">· {model}</span> : null}
    />
  );
}

// ---------------------------------------------------------------------------
// Hooks, auto-review, notices, plans

/** U1: a hook run that is running, blocked, failed, stopped or said something (hookVisible). */
export function HookRow({ run }: { run: HookRunSummary }) {
  const event = HOOK_EVENTS[run.eventName] ?? run.eventName;
  const verb =
    run.status === "running"
      ? "正在运行 Hook"
      : run.status === "blocked"
        ? run.eventName === "userPromptSubmit"
          ? "Hook 拦截了你的消息"
          : "Hook 拦截了操作"
        : run.status === "stopped"
          ? "Hook 停止了本轮"
          : run.status === "failed"
            ? "Hook 运行失败"
            : "Hook";
  const status: RowStatus = run.status === "running" ? "running" : run.status === "completed" ? "done" : "failed";
  const kinds: Record<string, string> = { warning: "警告", stop: "停止", feedback: "反馈", context: "上下文", error: "错误" };
  const ms = run.durationMs === null ? null : Number(run.durationMs);
  return (
    <ToolRow verb={verb} detail={run.statusMessage ? `${event} · ${run.statusMessage}` : event} status={status} meta={took(ms, status)}>
      {run.entries.map((entry, index) => (
        <div key={index} className="hook-entry" data-kind={entry.kind}>
          <span className="hook-kind">{kinds[entry.kind] ?? entry.kind}</span>
          <span className="hook-text">{entry.text}</span>
        </div>
      ))}
      <div className="command-cwd">{run.sourcePath}</div>
    </ToolRow>
  );
}

const RISK: Record<string, string> = { low: "低", medium: "中", high: "高", critical: "严重" };

/** U2: a denied or timed-out auto-review gets its own line, with 仍然允许 when it can be overridden. */
export function ReviewRow({ review, threadId, turnId }: { review: AutoReview; threadId: string; turnId: string }) {
  const [busy, setBusy] = useState(false);
  const { status, riskLevel, rationale } = review.review;
  const allow = () => {
    setBusy(true);
    approveDeniedAction(threadId, turnId, review.id)
      .catch(fail("允许失败"))
      .finally(() => setBusy(false));
  };
  return (
    <ToolRow
      verb={status === "timedOut" ? "自动审查超时" : "自动审查已拒绝"}
      detail={review.summary}
      status="failed"
      meta={riskLevel ? <span className="tool-meta">· 风险{RISK[riskLevel] ?? riskLevel}</span> : null}
      badge={
        status === "denied" && review.overridable ? (
          review.overridden ? (
            <span className="review-done">已允许</span>
          ) : (
            <Button variant="secondary" size="xs" disabled={busy} onClick={allow}>
              仍然允许
            </Button>
          )
        ) : null
      }
    >
      {rationale ? <div className="review-rationale">{rationale}</div> : null}
    </ToolRow>
  );
}

/** One line in the conversation (c96d752d0 sessionNotice, epitaxy-hint-fade-in). */
export function NoticeLine({
  tone,
  text,
  detail,
  children,
}: {
  tone?: "warning" | "danger";
  text: string;
  detail?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="notice-row" data-tone={tone}>
      <span className="notice-icon">{tone ? <TriangleAlert size={14} /> : <Info size={14} />}</span>
      <span className="notice-text">
        {text}
        {detail && <span className="notice-detail">{detail}</span>}
      </span>
      {children}
    </div>
  );
}

const NOTICE_WARN = new Set<Notice["kind"]>(["warning", "guardian", "mcpFailed", "mcpReauth", "strictReview", "reroute", "verification"]);

/** U3 / U4: thread-scoped warnings, reroutes, MCP failures (重新登录 for mcpReauth). */
export function NoticeRow({ notice }: { notice: Notice }) {
  const [busy, setBusy] = useState(false);
  const server = notice.server;
  return (
    <NoticeLine tone={NOTICE_WARN.has(notice.kind) ? "warning" : undefined} text={notice.text} detail={notice.detail}>
      {notice.url && (
        <a className="notice-link" href={notice.url} target="_blank" rel="noopener noreferrer">
          了解更多
        </a>
      )}
      {notice.kind === "mcpReauth" && server && (
        <Button
          variant="secondary"
          size="xs"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            loginMcpServer(server)
              .catch(fail("登录失败"))
              .finally(() => setBusy(false));
          }}
        >
          重新登录
        </Button>
      )}
    </NoticeLine>
  );
}

/** turn/plan/updated: 已更新待办 (Updated todos); the Progress card lives in the session rail. */
export function PlanRow({ plan }: { plan: NonNullable<TurnState["plan"]> }) {
  const done = plan.steps.filter((step) => step.status === "completed").length;
  return (
    <ToolRow verb="已更新待办" detail={`${done}/${plan.steps.length} 已完成`} status="done">
      {plan.explanation && <div className="todo-explain">{plan.explanation}</div>}
      <ol className="todo-list">
        {plan.steps.map((step, index) => (
          <li key={index} data-status={step.status}>
            <span className="todo-mark" aria-hidden="true">
              {step.status === "completed" ? <Check size={12} /> : null}
            </span>
            <span>{step.step}</span>
          </li>
        ))}
      </ol>
    </ToolRow>
  );
}

// ---------------------------------------------------------------------------
// Everything else

export function GenericRow({ item, live }: { item: ThreadItem; live: boolean }) {
  switch (item.type) {
    case "imageView":
      return (
        <ToolRow
          verb="已查看图片"
          detail={
            <FileLink path={item.path}>
              <code>{basename(item.path)}</code>
            </FileLink>
          }
          status="done"
        />
      );
    case "imageGeneration":
      return <ImageGeneration item={item} live={live} />;
    case "contextCompaction":
      return <ToolRow verb={live ? "正在压缩会话" : "已压缩会话"} status={live ? "running" : "done"} />;
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
      return (
        <div className="plan-card">
          <div className="card-head">
            <ListChecks size={14} />
            <span>提议的计划</span>
          </div>
          <Markdown text={item.text} className="prose" />
        </div>
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
      const status = statusOf(item.status);
      return (
        <ToolRow
          verb={<span className="tool-name">{item.tool}</span>}
          detail={item.namespace ?? undefined}
          status={item.success === false ? "failed" : status}
          meta={took(item.durationMs, status)}
        >
          <pre className="code-pre">{jsonText(item.arguments)}</pre>
          {item.contentItems?.map((part, index) =>
            part.type === "inputText" ? (
              <pre key={index} className="code-pre">
                {part.text}
              </pre>
            ) : part.type === "inputImage" ? (
              <img key={index} className="tool-image zoomable" alt="工具输出" src={part.imageUrl} onClick={zoom(part.imageUrl)} />
            ) : (
              <audio key={index} controls src={part.audioUrl} />
            ),
          )}
        </ToolRow>
      );
    }
    case "collabAgentToolCall":
      return <CollabRow item={item} />;
    case "subAgentActivity":
      return <AgentActivityRow item={item} />;
    case "sleep":
      return (
        <ToolRow
          verb={live ? "正在等待" : "已等待"}
          detail={`${Math.max(1, Math.round(item.durationMs / 1000))} 秒`}
          status={live ? "running" : "done"}
        />
      );
    case "functionCallOutput":
      return (
        <ToolRow verb={`${item.name} 的输出`} status="done">
          <pre className="code-pre">{jsonText(item.output)}</pre>
        </ToolRow>
      );
    default:
      return null;
  }
}
