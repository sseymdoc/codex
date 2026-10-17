// Renderers for each ThreadItem variant.

import type { CommandAction } from "@protocol/v2/CommandAction";
import type { ThreadItem } from "@protocol/v2/ThreadItem";
import type { UserInput } from "@protocol/v2/UserInput";
import {
  Bot,
  Brain,
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
  Plug,
  ScanSearch,
  Sparkles,
  Terminal,
  Webhook,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { basename, formatDuration, relativePath } from "../lib/format";
import { FileDiffCard, Markdown } from "./content";
import { Collapse, CopyButton, QuietDots, Spinner, StatusDot } from "./ui";

type ItemOf<T extends ThreadItem["type"]> = Extract<ThreadItem, { type: T }>;

// ---------------------------------------------------------------------------
// User message

export function UserBubble({ item }: { item: ItemOf<"userMessage"> }) {
  const [expanded, setExpanded] = useState(false);
  const text = item.content
    .filter((part): part is Extract<UserInput, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const images = item.content.filter((part) => part.type === "image" || part.type === "localImage");
  const chips = item.content.filter((part) => part.type === "mention" || part.type === "skill");
  const long = text.length > 900 || text.split("\n").length > 14;
  return (
    <div className="user-row">
      {images.length > 0 && (
        <div className="user-images">
          {images.map((part, index) =>
            part.type === "image" && "url" in part ? (
              <img key={index} src={part.url} alt="附件图片" className="user-image" />
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
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assistant text and reasoning

export function AgentMessage({ item }: { item: ItemOf<"agentMessage"> }) {
  if (!item.text) return null;
  return (
    <div className={`agent-message ${item.phase === "commentary" ? "commentary" : ""}`}>
      <Markdown text={item.text} />
    </div>
  );
}

/** First markdown heading-ish line of a reasoning summary, used as a live status. */
function reasoningTitle(summary: string[]): string | null {
  const last = summary.filter(Boolean).at(-1);
  const bold = last && /\*\*(.+?)\*\*/.exec(last);
  return bold ? bold[1] : null;
}

export function Reasoning({ item, live, timing }: { item: ItemOf<"reasoning">; live: boolean; timing?: [number, number?] }) {
  const [open, setOpen] = useState(false);
  const text = [...item.summary, ...item.content].filter(Boolean).join("\n\n");
  if (!live && !text) return null;
  const title = reasoningTitle(item.summary);
  const seconds = timing?.[1] ? formatDuration(timing[1] - timing[0]) : null;
  const expanded = live || open;
  return (
    <div className={`thinking ${live ? "live" : ""}`}>
      <button type="button" className="thinking-head" disabled={live} onClick={() => setOpen(!open)}>
        {live ? <QuietDots /> : <Brain size={14} className="row-icon" />}
        <span className={live ? "shimmer" : ""}>{live ? (title ? `思考中：${title}` : "思考中…") : seconds ? `已思考 ${seconds}` : "思考过程"}</span>
        {!live && text && <ChevronRight size={13} className={`chev ${open ? "open" : ""}`} />}
      </button>
      {text && (
        <Collapse open={expanded}>
          <div className="thinking-body">
            <Markdown text={text} />
          </div>
        </Collapse>
      )}
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
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`tool-row status-${status} ${open ? "open" : ""}`}>
      <button type="button" className="tool-head" onClick={() => children && setOpen(!open)} aria-expanded={open}>
        <span className="row-icon">{icon}</span>
        <span className="tool-label">{label}</span>
        {pending && (
          <span className="badge badge-clay">
            <StatusDot kind="clay" /> 等待批准
          </span>
        )}
        <span className="tool-meta">
          {meta}
          {status === "running" && !pending && <Spinner size={12} />}
          {status === "failed" && <X size={13} className="fail-icon" />}
          {status === "declined" && <CircleSlash size={13} className="fail-icon" />}
        </span>
        {children && <ChevronRight size={13} className={`chev ${open ? "open" : ""}`} />}
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
      icon={<Terminal size={14} />}
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
      icon={running ? <FolderSearch size={14} /> : <FileSearch size={14} />}
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
          <span className="badge badge-clay">
            <StatusDot kind="clay" /> 等待批准
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
        if (block.type === "image" && block.data) return <img key={index} className="tool-image" alt="工具输出" src={`data:${block.mimeType ?? "image/png"};base64,${block.data}`} />;
        return <pre key={index} className="code-pre">{jsonText(part)}</pre>;
      })}
    </>
  );
}

export function McpCallRow({ item }: { item: ItemOf<"mcpToolCall"> }) {
  return (
    <ToolRow
      icon={<Plug size={14} />}
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
  return <ToolRow icon={<Globe size={14} />} label={label} status="done" />;
}

export function GenericRow({ item, live }: { item: ThreadItem; live: boolean }) {
  switch (item.type) {
    case "imageView":
      return <ToolRow icon={<ImageIcon size={14} />} label={<>查看图片 <code className="inline-code">{basename(item.path)}</code></>} status="done" />;
    case "imageGeneration": {
      const src = "result" in item && item.result ? `data:image/png;base64,${item.result}` : null;
      return (
        <div className="image-gen">
          <div className="change-head">
            <span className="row-icon">{live ? <Spinner size={13} /> : <Sparkles size={14} />}</span>
            <span>{live ? "正在生成图片…" : "生成的图片"}</span>
          </div>
          {src && <img src={src} alt={item.revisedPrompt ?? "生成的图片"} className="generated-image" />}
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
      return <ToolRow icon={<Webhook size={14} />} label={<span className="muted">Hook 注入了上下文</span>} status="done">{item.fragments.map((f, i) => <pre key={i} className="code-pre">{f.text}</pre>)}</ToolRow>;
    case "dynamicToolCall":
      return (
        <ToolRow icon={<Plug size={14} />} label={item.tool} status={statusOf(item.status)}>
          <pre className="code-pre">{jsonText(item.arguments)}</pre>
        </ToolRow>
      );
    case "collabAgentToolCall":
      return (
        <ToolRow icon={<Bot size={14} />} label={<>子代理 · {item.tool}{item.model && <span className="muted"> · {item.model}</span>}</>} status={statusOf(item.status)}>
          {item.prompt && <Markdown text={item.prompt} />}
        </ToolRow>
      );
    case "subAgentActivity":
      return <ToolRow icon={<Bot size={14} />} label={<>子代理 {item.agentPath} <span className="muted">{item.kind}</span></>} status="done" />;
    case "sleep":
      return <ToolRow icon={<Clock size={14} />} label={`等待 ${formatDuration(item.durationMs)}`} status={live ? "running" : "done"} />;
    case "functionCallOutput":
      return (
        <ToolRow icon={<Terminal size={14} />} label={<span className="muted">{item.name} 的输出</span>} status="done">
          <pre className="code-pre">{jsonText(item.output)}</pre>
        </ToolRow>
      );
    default:
      return null;
  }
}
