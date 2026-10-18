// Renderers for each ThreadItem variant.

import type { CommandAction } from "@protocol/v2/CommandAction";
import type { ThreadItem } from "@protocol/v2/ThreadItem";
import type { UserInput } from "@protocol/v2/UserInput";
import {
  Bot,
  Check,
  ChevronRight,
  CircleDashed,
  CircleSlash,
  Clock,
  FileSearch,
  FolderSearch,
  Globe,
  Image as ImageIcon,
  ListChecks,
  Minimize2,
  Pencil,
  Plug,
  ScanSearch,
  Sparkles,
  Terminal,
  Webhook,
  X,
} from "lucide-react";
import { createContext, use, useState, type KeyboardEvent, type ReactNode } from "react";
import { errorMessage } from "../lib/codex";
import { basename, formatDuration, relativePath } from "../lib/format";
import { setState, toast } from "../lib/store";
import { FileDiffCard, Markdown } from "./content";
import type { TranscriptView } from "../lib/session";
import { Button, Collapse, CopyButton, Spinner, StatusDot } from "./ui";

/** The transcript view: normal hides thinking, thinking shows it, verbose also opens tool rows. */
export const ViewContext = createContext<TranscriptView>("normal");

type ItemOf<T extends ThreadItem["type"]> = Extract<ThreadItem, { type: T }>;

const zoom = (src: string) => () => setState({ lightbox: src });

// ---------------------------------------------------------------------------
// User message

export function messageText(content: UserInput[]): string {
  return content
    .filter((part): part is Extract<UserInput, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

/** `onEdit` rewinds the thread to just before this message and sends the edited text instead. */
export function UserBubble({ item, onEdit }: { item: ItemOf<"userMessage">; onEdit?: (text: string) => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const text = messageText(item.content);
  const images = item.content.filter((part) => part.type === "image" || part.type === "localImage");
  const chips = item.content.filter((part) => part.type === "mention" || part.type === "skill");
  const long = text.length > 900 || text.split("\n").length > 14;

  if (draft !== null && onEdit) {
    const save = () => {
      if (!draft.trim() || busy) return;
      setBusy(true);
      onEdit(draft.trim())
        .then(() => setDraft(null))
        .catch((error) => toast("error", "重新发送失败", errorMessage(error)))
        .finally(() => setBusy(false));
    };
    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        save();
      } else if (event.key === "Escape") {
        event.preventDefault();
        setDraft(null);
      }
    };
    return (
      <div className="user-row">
        <div className="user-edit">
          <textarea
            className="user-edit-input"
            value={draft}
            rows={Math.min(12, draft.split("\n").length)}
            autoFocus
            aria-label="编辑消息"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="user-edit-foot">
            <span className="muted">从这里重新开始：仅回退对话记录，不会撤销已修改的文件</span>
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button variant="primary" size="sm" disabled={!draft.trim() || busy} onClick={save}>
              {busy ? "发送中…" : "发送"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="user-row">
      {images.length > 0 && (
        <div className="user-images">
          {images.map((part, index) =>
            part.type === "image" && "url" in part ? (
              <img key={index} src={part.url} alt="附件图片" className="user-image zoomable" onClick={zoom(part.url)} />
            ) : (
              <span key={index} className="attachment-chip">
                <ImageIcon size={13} />
                {part.type === "localImage" ? basename(part.path) : "图片"}
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
          <div className={`user-text ${long && !expanded ? "clamped" : ""}`}>{text}</div>
          {long && (
            <button type="button" className="link-btn" onClick={() => setExpanded(!expanded)}>
              {expanded ? "收起" : "展开全部"}
            </button>
          )}
        </div>
      )}
      {text && (
        <div className="row-actions">
          <CopyButton text={text} />
          {onEdit && <Button variant="ghost" size="xs" muted icon={<Pencil size={16} />} label="编辑并重新发送" onClick={() => setDraft(text)} />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assistant text and reasoning

export function AgentMessage({ item, streaming }: { item: ItemOf<"agentMessage">; streaming?: boolean }) {
  if (!item.text) return null;
  return (
    <div className={`agent-message ${item.phase === "commentary" ? "commentary" : ""}`}>
      <Markdown text={item.text} streaming={streaming} voice className="prose" />
    </div>
  );
}

/**
 * Thinking (default design): hidden in the normal view; in the thinking and verbose
 * views the whole text shows, italic and muted, with a copy control on hover.
 */
export function Reasoning({ item, live }: { item: ItemOf<"reasoning">; live: boolean }) {
  const view = use(ViewContext);
  const text = [...item.summary, ...item.content].filter(Boolean).join("\n\n");
  if (view === "normal" || !text) return null;
  return (
    <div className={`thinking ${live ? "live" : ""}`}>
      <Markdown text={text} streaming={live} />
      <span className="thinking-copy">
        <CopyButton text={text} label="复制思考内容" />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool rows

function ToolRow({
  icon,
  label,
  status,
  meta,
  children,
  after,
  defaultOpen = false,
  pending,
}: {
  icon: ReactNode;
  label: ReactNode;
  status: "running" | "done" | "failed" | "declined";
  meta?: ReactNode;
  children?: ReactNode;
  /** Rendered below the row regardless of the disclosure state. */
  after?: ReactNode;
  defaultOpen?: boolean;
  pending?: boolean;
}) {
  const verbose = use(ViewContext) === "verbose";
  const [picked, setOpen] = useState(defaultOpen);
  const open = verbose || picked;
  return (
    <div className={`tool-row status-${status} ${open ? "open" : ""}`}>
      <button type="button" className="tool-head" onClick={() => children && !verbose && setOpen(!open)} aria-expanded={children ? open : undefined}>
        <span className="row-icon">{icon}</span>
        <span className="tool-label">{label}</span>
        {pending && (
          <span className="badge badge-warning">
            <StatusDot kind="blocked" /> 等待批准
          </span>
        )}
        <span className="tool-meta">
          {meta}
          {status === "running" && !pending && <Spinner size={12} />}
          {status === "failed" && <X size={14} className="fail-text" />}
          {status === "declined" && <CircleSlash size={14} className="fail-text" />}
        </span>
        {children && <ChevronRight size={14} className="tool-caret" />}
      </button>
      {children && (
        <Collapse open={open}>
          <div className="tool-body">{children}</div>
        </Collapse>
      )}
      {!open && after}
    </div>
  );
}

function statusOf(status: string): "running" | "done" | "failed" | "declined" {
  if (status === "inProgress") return "running";
  if (status === "failed") return "failed";
  if (status === "declined") return "declined";
  return "done";
}

function actionLabel(action: CommandAction, cwd: string): ReactNode {
  switch (action.type) {
    case "read":
      return (
        <>
          读取 <code className="inline-code">{relativePath(action.path, cwd)}</code>
        </>
      );
    case "listFiles":
      return (
        <>
          列出 <code className="inline-code">{action.path ? relativePath(action.path, cwd) : "."}</code>
        </>
      );
    case "search":
      return (
        <>
          搜索 <code className="inline-code">{action.query ?? ""}</code>
          {action.path && <span className="muted"> 于 {relativePath(action.path, cwd)}</span>}
        </>
      );
    default:
      return <code className="inline-code">{action.command}</code>;
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
  return <pre className={`terminal ${live ? "terminal-live" : ""}`}>{shown || " "}</pre>;
}

export function CommandRow({ item, pending, cwd }: { item: ItemOf<"commandExecution">; pending: boolean; cwd: string }) {
  const status = statusOf(item.status);
  const actions = item.commandActions.length ? item.commandActions : [{ type: "unknown", command: item.command } as CommandAction];
  const label =
    actions.length === 1 ? actionLabel(actions[0], cwd) : <code className="inline-code">{actions.map((a) => a.command).join(" && ")}</code>;
  const exit = item.exitCode !== null && item.exitCode !== 0 ? `退出码 ${item.exitCode}` : null;
  return (
    <ToolRow
      icon={<Terminal size={16} />}
      label={
        <>
          {item.source === "userShell" && <span className="muted">! </span>}
          {label}
        </>
      }
      status={status}
      pending={pending}
      defaultOpen={item.source === "userShell"}
      after={status === "running" && item.aggregatedOutput ? <OutputBlock output={item.aggregatedOutput} live /> : null}
      meta={
        <>
          {exit && <span className="fail-text">{exit}</span>}
          {item.durationMs !== null && status !== "running" && <span>{formatDuration(item.durationMs)}</span>}
        </>
      }
    >
      <div className="command-detail">
        <div className="command-line">
          <span className="prompt">$</span>
          <code>{item.command}</code>
          <CopyButton text={item.command} label="复制命令" />
        </div>
        <div className="command-cwd">{item.cwd}</div>
        {item.aggregatedOutput ? <OutputBlock output={item.aggregatedOutput} /> : <div className="muted small">无输出</div>}
      </div>
    </ToolRow>
  );
}

export function ExplorationGroup({ items, cwd }: { items: ItemOf<"commandExecution">[]; cwd: string }) {
  const running = items.some((item) => item.status === "inProgress");
  const counts = { read: 0, listFiles: 0, search: 0 };
  for (const item of items) for (const action of item.commandActions) if (action.type in counts) counts[action.type as keyof typeof counts]++;
  const parts = [
    counts.read && `读取 ${counts.read} 个文件`,
    counts.search && `搜索 ${counts.search} 次`,
    counts.listFiles && `列出 ${counts.listFiles} 个目录`,
  ].filter(Boolean);
  return (
    <ToolRow
      icon={running ? <FolderSearch size={16} /> : <FileSearch size={16} />}
      label={<span>{running ? "正在探索" : "已探索"}<span className="muted"> · {parts.join("，")}</span></span>}
      status={running ? "running" : "done"}
    >
      <div className="explore-list">
        {items.map((item) => (
          <div key={item.id} className="explore-item">
            {item.commandActions.map((action, index) => (
              <div key={index}>{actionLabel(action, cwd)}</div>
            ))}
          </div>
        ))}
      </div>
    </ToolRow>
  );
}

export function FileChangeCard({ item, pending, cwd }: { item: ItemOf<"fileChange">; pending: boolean; cwd: string }) {
  const status = statusOf(item.status);
  const verb = status === "running" ? (pending ? "请求修改" : "正在修改") : status === "declined" ? "已拒绝修改" : status === "failed" ? "修改失败" : "已修改";
  return (
    <div className={`change-card status-${status}`}>
      <div className="change-head">
        <span className="row-icon">{status === "done" ? <Check size={14} /> : status === "running" ? <CircleDashed size={14} /> : <X size={14} />}</span>
        <span>
          {verb} {item.changes.length} 个文件
        </span>
        {pending && (
          <span className="badge badge-warning">
            <StatusDot kind="blocked" /> 等待批准
          </span>
        )}
      </div>
      <div className="change-files">
        {item.changes.map((change) => (
          <FileDiffCard
            key={change.path}
            defaultOpen={item.changes.length === 1 && change.diff.length < 4000}
            file={{
              path: relativePath(change.path, cwd),
              kind: change.kind.type,
              diff: change.diff,
              movePath: change.kind.type === "update" && change.kind.move_path ? relativePath(change.kind.move_path, cwd) : null,
            }}
          />
        ))}
      </div>
    </div>
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

export function McpCallRow({ item }: { item: ItemOf<"mcpToolCall"> }) {
  return (
    <ToolRow
      icon={<Plug size={16} />}
      label={
        <>
          <span className="muted">{item.server} · </span>
          {item.tool}
        </>
      }
      status={statusOf(item.status)}
      meta={item.durationMs !== null && <span>{formatDuration(item.durationMs)}</span>}
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

export function WebSearchRow({ item }: { item: ItemOf<"webSearch"> }) {
  const action = item.action;
  const label =
    action?.type === "openPage" ? (
      <>打开网页 <span className="muted">{action.url}</span></>
    ) : action?.type === "findInPage" ? (
      <>在页面中查找 <code className="inline-code">{action.pattern}</code></>
    ) : (
      <>搜索网页 <code className="inline-code">{item.query || action?.type === "search" && (action.query ?? action.queries?.join("、")) || ""}</code></>
    );
  return <ToolRow icon={<Globe size={16} />} label={label} status="done" />;
}

export function GenericRow({ item, live }: { item: ThreadItem; live: boolean }) {
  switch (item.type) {
    case "imageView":
      return <ToolRow icon={<ImageIcon size={16} />} label={<>查看图片 <code className="inline-code">{basename(item.path)}</code></>} status="done" />;
    case "imageGeneration": {
      const src = "result" in item && item.result ? `data:image/png;base64,${item.result}` : null;
      return (
        <div className="image-gen">
          <div className="change-head">
            <span className="row-icon">{live ? <Spinner size={13} /> : <Sparkles size={14} />}</span>
            <span>{live ? "正在生成图片…" : "生成的图片"}</span>
          </div>
          {src && <img src={src} alt={item.revisedPrompt ?? "生成的图片"} className="generated-image zoomable" onClick={zoom(src)} />}
          {item.revisedPrompt && <div className="muted small">{item.revisedPrompt}</div>}
        </div>
      );
    }
    case "contextCompaction":
      return (
        <div className="divider-note">
          <Minimize2 size={13} /> 上下文已压缩
        </div>
      );
    case "enteredReviewMode":
      return (
        <div className="divider-note">
          <ScanSearch size={13} /> 开始代码审查{item.review ? `：${item.review}` : ""}
        </div>
      );
    case "exitedReviewMode":
      return (
        <div className="review-card">
          <div className="change-head">
            <span className="row-icon">
              <ScanSearch size={14} />
            </span>
            <span>审查结果</span>
          </div>
          <Markdown text={item.review} />
        </div>
      );
    case "plan":
      return (
        <div className="plan-card">
          <div className="change-head">
            <span className="row-icon">
              <ListChecks size={14} />
            </span>
            <span>提议的计划</span>
          </div>
          <Markdown text={item.text} />
        </div>
      );
    case "hookPrompt":
      return <ToolRow icon={<Webhook size={16} />} label={<span className="muted">Hook 注入了上下文</span>} status="done">{item.fragments.map((f, i) => <pre key={i} className="code-pre">{f.text}</pre>)}</ToolRow>;
    case "dynamicToolCall":
      return (
        <ToolRow icon={<Plug size={16} />} label={item.tool} status={statusOf(item.status)}>
          <pre className="code-pre">{jsonText(item.arguments)}</pre>
        </ToolRow>
      );
    case "collabAgentToolCall":
      return (
        <ToolRow icon={<Bot size={16} />} label={<>子代理 · {item.tool}{item.model && <span className="muted"> · {item.model}</span>}</>} status={statusOf(item.status)}>
          {item.prompt && <Markdown text={item.prompt} />}
        </ToolRow>
      );
    case "subAgentActivity":
      return <ToolRow icon={<Bot size={16} />} label={<>子代理 {item.agentPath} <span className="muted">{item.kind}</span></>} status="done" />;
    case "sleep":
      return <ToolRow icon={<Clock size={16} />} label={`等待 ${formatDuration(item.durationMs)}`} status={live ? "running" : "done"} />;
    case "functionCallOutput":
      return (
        <ToolRow icon={<Terminal size={16} />} label={<span className="muted">{item.name} 的输出</span>} status="done">
          <pre className="code-pre">{jsonText(item.output)}</pre>
        </ToolRow>
      );
    default:
      return null;
  }
}
