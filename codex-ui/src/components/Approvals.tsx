// Server -> client requests docked above the composer (W18 epitaxy-approval-card, c12c146ad):
// command / file-change / permission approvals and MCP elicitations in one card shell with up to
// two ghost cards for the requests still waiting behind it; request_user_input as the paged
// question card (W19, the reachable shared-5 DE version). Option sets and replies mirror
// codex-rs/tui/src/bottom_pane/approval_overlay.rs and mcp_server_elicitation.rs.

import type { ServerRequest } from "@protocol/ServerRequest";
import type { JsonValue } from "@protocol/serde_json/JsonValue";
import type { CommandExecutionApprovalDecision } from "@protocol/v2/CommandExecutionApprovalDecision";
import type { McpElicitationPrimitiveSchema } from "@protocol/v2/McpElicitationPrimitiveSchema";
import type { McpElicitationSchema } from "@protocol/v2/McpElicitationSchema";
import type { McpServerElicitationAction } from "@protocol/v2/McpServerElicitationAction";
import type { McpServerElicitationRequestResponse } from "@protocol/v2/McpServerElicitationRequestResponse";
import type { PermissionsRequestApprovalResponse } from "@protocol/v2/PermissionsRequestApprovalResponse";
import type { ToolRequestUserInputResponse } from "@protocol/v2/ToolRequestUserInputResponse";
import { ArrowRight, ChevronLeft, ChevronRight, CornerDownLeft, ExternalLink, FilePen, Globe, KeyRound, Plug, ShieldAlert, Terminal, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { requestThreadId, resolveRequest } from "../lib/codex";
import { externalUrl, relativePath, samePath } from "../lib/format";
import { useStore } from "../lib/store";
import { Button, Kbd, MenuSelect } from "./ui";

type RequestOf<M extends ServerRequest["method"]> = Extract<ServerRequest, { method: M }>;

interface Choice {
  label: string;
  key?: string;
  tone?: "primary" | "danger";
  result: unknown;
}

/** One line for a waiting request (the sidebar's blocked row). */
export function requestSummary(request: ServerRequest): string {
  switch (request.method) {
    case "item/commandExecution/requestApproval": {
      const { networkApprovalContext: network, command } = request.params;
      return network ? `访问网络 ${network.host}` : command ? `运行 ${command}` : "运行命令";
    }
    case "item/fileChange/requestApproval":
      return "修改文件";
    case "item/permissions/requestApproval":
      return "授予额外权限";
    case "item/tool/requestUserInput":
      return request.params.questions[0]?.question ?? "回答问题";
    case "mcpServer/elicitation/request":
      return request.params.message || `MCP 服务器「${request.params.serverName}」请求确认`;
    default:
      return "等待你的确认";
  }
}

/** Codex desktop's account check; there is nothing to show for it here (F-27). */
function isUserVerification(request: ServerRequest): boolean {
  return request.method === "mcpServer/elicitation/request" && (request.params as { mode: string }).mode === "openai/userVerification";
}

const declined = new Set<ServerRequest["id"]>();

function focusComposer() {
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus());
}

/**
 * Take focus from an idle composer so the card's keys work right away, like the TUI overlay.
 * Otherwise Esc reaches the composer and interrupts the whole turn.
 */
function useFocusWhenIdle(root: RefObject<HTMLElement | null>, selector: string, id: ServerRequest["id"]) {
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    const idle = !active || active === document.body || (active.classList.contains("composer-input") && !(active as HTMLTextAreaElement).value);
    if (idle) root.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [id]);
}

/** epitaxy-approval-body: a scroll region (role group, 「请求详情」, focusable) once it overflows. */
function ApprovalBody({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollHeight > el.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={`approval-body${scrolls ? " scroll-fade-y" : ""}`} {...(scrolls ? { role: "group", "aria-label": "请求详情", tabIndex: 0 } : {})}>
      {children}
    </div>
  );
}

/** Card shell with y/a/n-style shortcuts while focus is inside the card. */
function ApprovalCard({
  request,
  icon,
  title,
  children,
  choices,
}: {
  request: ServerRequest;
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  choices: Choice[];
}) {
  const root = useRef<HTMLDivElement>(null);
  useFocusWhenIdle(root, ".approval-choice", request.id);

  const choose = (choice: Choice) => {
    resolveRequest(request.id, choice.result);
    focusComposer();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).matches("input, textarea, select") || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key === "Escape" ? "esc" : event.key.toLowerCase();
    const choice = choices.find((c) => c.key === key);
    if (choice) {
      event.preventDefault();
      choose(choice);
    }
  };

  return (
    <div className="approval-card" ref={root} onKeyDown={onKeyDown} role="alertdialog" aria-label="需要你的确认">
      <span className="approval-backdrop" aria-hidden="true" />
      <div className="approval-head">
        <span className="approval-icon">{icon}</span>
        <span className="approval-title">{title}</span>
      </div>
      {children && <ApprovalBody>{children}</ApprovalBody>}
      <div className="approval-choices">
        {choices.map((choice) => (
          <Button
            key={choice.label}
            variant={choice.tone === "primary" ? "primary" : "secondary"}
            className={`approval-choice ${choice.tone === "danger" ? "danger" : ""}`}
            onClick={() => choose(choice)}
          >
            <span>{choice.label}</span>
            {choice.key && <Kbd>{choice.key === "esc" ? "Esc" : choice.key.toUpperCase()}</Kbd>}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Reason({ text }: { text?: string | null }) {
  return text ? <div className="approval-reason">{text}</div> : null;
}

// ---------------------------------------------------------------------------
// Command execution

function prefixLabel(command: string[]): string {
  const parts = command[0]?.match(/(^|[\\/])(ba|z)?sh(\.exe)?$/) && command[1] === "-lc" ? command.slice(2) : command;
  return parts.join(" ");
}

function location(path: string, root: string): string {
  if (samePath(path, root)) return "工作区根目录";
  const relative = relativePath(path, root);
  return relative === path ? path : `./${relative}`;
}

function commandChoices(params: RequestOf<"item/commandExecution/requestApproval">["params"]): Choice[] {
  const network = params.networkApprovalContext;
  const experimental = (params as { availableDecisions?: CommandExecutionApprovalDecision[] | null }).availableDecisions;
  const decisions: CommandExecutionApprovalDecision[] = experimental ?? [
    "accept",
    ...(params.proposedExecpolicyAmendment ? [{ acceptWithExecpolicyAmendment: { execpolicy_amendment: params.proposedExecpolicyAmendment } }] : []),
    "acceptForSession",
    ...(params.proposedNetworkPolicyAmendments ?? []).map((amendment) => ({ applyNetworkPolicyAmendment: { network_policy_amendment: amendment } })),
    "decline",
    "cancel",
  ];
  const choices: Choice[] = [];
  for (const decision of decisions) {
    const result = { decision };
    if (decision === "accept") choices.push({ label: network ? "仅允许这一次" : "允许", key: "y", tone: "primary", result });
    else if (decision === "acceptForSession")
      choices.push({ label: network ? "允许，本会话内都允许该主机" : "允许，本会话内不再询问此命令", key: "a", result });
    else if (decision === "decline") choices.push({ label: "拒绝，跳过此命令继续", key: "n", result });
    else if (decision === "cancel") choices.push({ label: "拒绝，并告诉 Codex 换种做法", key: "esc", tone: "danger", result });
    else if ("acceptWithExecpolicyAmendment" in decision) {
      const prefix = prefixLabel(decision.acceptWithExecpolicyAmendment.execpolicy_amendment);
      if (!prefix.includes("\n")) choices.push({ label: `允许，以后不再询问以「${prefix}」开头的命令`, key: "p", result });
    } else if ("applyNetworkPolicyAmendment" in decision) {
      const { action, host } = decision.applyNetworkPolicyAmendment.network_policy_amendment;
      choices.push(
        action === "allow"
          ? { label: `允许，以后始终允许访问 ${host}`, key: "p", result }
          : { label: `拒绝，以后始终屏蔽 ${host}`, result },
      );
    }
  }
  return choices;
}

function CommandApproval({ request, cwd }: { request: RequestOf<"item/commandExecution/requestApproval">; cwd: string }) {
  const { params } = request;
  const network = params.networkApprovalContext;
  const stdin = params.kind === "writeStdin";
  return (
    <ApprovalCard
      request={request}
      icon={network ? <Globe size={16} /> : <Terminal size={16} />}
      title={network ? `允许访问网络主机 ${network.host}？` : stdin ? "允许向正在运行的终端写入输入？" : "允许运行这条命令？"}
      choices={commandChoices(params)}
    >
      <Reason text={params.reason} />
      {params.command && (
        <pre className="approval-command">
          <span className="prompt">$ </span>
          {params.command}
        </pre>
      )}
      {params.cwd && <div className="approval-meta">位置：{location(params.cwd, cwd)}</div>}
      {network && <div className="approval-meta">协议：{network.protocol}</div>}
    </ApprovalCard>
  );
}

// ---------------------------------------------------------------------------
// File changes and extra permissions

function FileChangeApproval({ request }: { request: RequestOf<"item/fileChange/requestApproval"> }) {
  const { params } = request;
  return (
    <ApprovalCard
      request={request}
      icon={<FilePen size={16} />}
      title="允许 Codex 修改这些文件？"
      choices={[
        { label: "允许", key: "y", tone: "primary", result: { decision: "accept" } },
        { label: "允许，本会话内不再询问这些文件", key: "a", result: { decision: "acceptForSession" } },
        { label: "拒绝，并告诉 Codex 换种做法", key: "esc", tone: "danger", result: { decision: "cancel" } },
      ]}
    >
      <Reason text={params.reason} />
      {params.grantRoot && <div className="approval-meta">请求写入权限：{params.grantRoot}</div>}
      <div className="approval-meta">改动内容见上方对话中的文件卡片。</div>
    </ApprovalCard>
  );
}

function PermissionsApproval({ request }: { request: RequestOf<"item/permissions/requestApproval"> }) {
  const { params } = request;
  const { network, fileSystem } = params.permissions;
  const grant = (scope: "turn" | "session", strictAutoReview = false): PermissionsRequestApprovalResponse => ({
    permissions: {
      ...(network ? { network } : {}),
      ...(fileSystem ? { fileSystem } : {}),
    },
    scope,
    ...(strictAutoReview ? { strictAutoReview } : {}),
  });
  const rows: string[] = [];
  if (network?.enabled) rows.push("访问网络");
  // The server mirrors legacy read/write paths into `entries`; list each grant once.
  if (fileSystem?.entries?.length) {
    for (const { access, path } of fileSystem.entries) {
      const target = path.type === "path" ? location(path.path, params.cwd) : path.type === "glob_pattern" ? path.pattern : JSON.stringify(path.value);
      rows.push(`${access === "write" ? "写入" : access === "read" ? "读取" : "禁止访问"} ${target}`);
    }
  } else {
    for (const path of fileSystem?.read ?? []) rows.push(`读取 ${location(path, params.cwd)}`);
    for (const path of fileSystem?.write ?? []) rows.push(`写入 ${location(path, params.cwd)}`);
  }
  return (
    <ApprovalCard
      request={request}
      icon={<ShieldAlert size={16} />}
      title="Codex 请求额外的权限"
      choices={[
        { label: "授予本轮", key: "y", tone: "primary", result: grant("turn") },
        { label: "授予本轮，并严格审查后续命令", key: "r", result: grant("turn", true) },
        { label: "授予本次会话", key: "a", result: grant("session") },
        { label: "拒绝，不授予权限继续", key: "n", tone: "danger", result: { permissions: {}, scope: "turn" } satisfies PermissionsRequestApprovalResponse },
      ]}
    >
      <Reason text={params.reason} />
      <ul className="approval-list">
        {rows.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </ApprovalCard>
  );
}

// ---------------------------------------------------------------------------
// request_user_input: one question at a time ({i} / {n} with ‹ ›), number keys pick, a pick moves
// on to the next question and the last one submits; 「其他」 is an inline field.

const OTHER = "\u0000other";

function QuestionCard({ request }: { request: RequestOf<"item/tool/requestUserInput"> }) {
  const { questions, isBlocking } = request.params;
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState<"next" | "prev" | undefined>(undefined);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const root = useRef<HTMLDivElement>(null);
  useFocusWhenIdle(root, ".ask-option, .ask-other input", request.id);
  const q = questions[page];
  const last = page === questions.length - 1;
  const options = q?.options ?? [];

  const answerOf = (id: string, picked = answers) => (picked[id] === OTHER ? other[id]?.trim() : picked[id]?.trim()) || "";
  const go = (next: number) => {
    setDir(next > page ? "next" : "prev");
    setPage(next);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(".ask-option, .ask-other input")?.focus());
  };
  const submit = (picked: Record<string, string>) => {
    const response: ToolRequestUserInputResponse = { answers: {} };
    for (const question of questions) {
      const value = answerOf(question.id, picked);
      response.answers[question.id] = { answers: value ? [value] : [] };
    }
    resolveRequest(request.id, response);
    focusComposer();
  };
  const advance = (picked: Record<string, string>) => (last ? submit(picked) : go(page + 1));
  const choose = (value: string) => {
    const picked = { ...answers, [q.id]: value };
    setAnswers(picked);
    advance(picked);
  };
  const dismiss = () => {
    resolveRequest(request.id, { answers: {} } satisfies ToolRequestUserInputResponse);
    focusComposer();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
      return;
    }
    if ((event.target as HTMLElement).matches("input") || event.ctrlKey || event.metaKey || event.altKey) return;
    const index = Number(event.key) - 1;
    if (/^[1-9]$/.test(event.key) && options[index]) {
      event.preventDefault();
      choose(options[index].label);
    }
  };

  if (!q) return null;
  const field = (placeholder: string, isOther: boolean) => (
    <label className="ask-other">
      {isOther && <span className="ask-key">{options.length + 1}</span>}
      <input
        type={q.isSecret ? "password" : "text"}
        value={(isOther ? other[q.id] : answers[q.id]) ?? ""}
        placeholder={placeholder}
        aria-label={isOther ? "其他回答" : q.question}
        onChange={(event) => {
          const value = event.target.value;
          if (isOther) {
            setOther({ ...other, [q.id]: value });
            setAnswers({ ...answers, [q.id]: OTHER });
          } else setAnswers({ ...answers, [q.id]: value });
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing || !event.currentTarget.value.trim()) return;
          event.preventDefault();
          advance(isOther ? { ...answers, [q.id]: OTHER } : answers);
        }}
      />
    </label>
  );

  return (
    <div className="approval-card ask" ref={root} role="dialog" aria-label="Codex 的提问" onKeyDown={onKeyDown}>
      <span className="approval-backdrop" aria-hidden="true" />
      <div key={page} className="ask-page" data-dir={dir}>
        {q.header && <div className="ask-header">{q.header}</div>}
        <div className="ask-title" data-headed={q.header ? "" : undefined}>
          <span className="ask-question">{q.question}</span>
          {questions.length > 1 && (
            <span className="ask-pager">
              <Button variant="ghost" size="xs" muted icon={<ChevronLeft size={12} />} label="上一题" disabled={page === 0} onClick={() => go(page - 1)} />
              {page + 1} / {questions.length}
              <Button variant="ghost" size="xs" muted icon={<ChevronRight size={12} />} label="下一题" disabled={last} onClick={() => go(page + 1)} />
            </span>
          )}
          <Button variant="ghost" size="xs" muted icon={<X size={14} />} label="关闭" kbd="Esc" onClick={dismiss} />
        </div>
        <div className="ask-list scroll-fade-y" role="radiogroup" aria-label={q.question}>
          {options.map((option, index) => (
            <div key={option.label}>
              <button type="button" role="radio" aria-checked={answers[q.id] === option.label} className="ask-option" onClick={() => choose(option.label)}>
                <span className="ask-key">{index + 1}</span>
                <span className="ask-text">
                  <span className="ask-label">{option.label}</span>
                  {option.description && <span className="ask-desc">{option.description}</span>}
                </span>
                {last ? <CornerDownLeft size={16} className="ask-arrow" /> : <ArrowRight size={16} className="ask-arrow" />}
              </button>
              {(index < options.length - 1 || q.isOther) && <div className="ask-sep" />}
            </div>
          ))}
          {options.length > 0 ? q.isOther && field("其他", true) : field("输入你的回答", false)}
        </div>
      </div>
      <div className="ask-foot">
        <span>{!isBlocking ? "Codex 不会等你回答" : options.length ? "选择一个选项后发送" : "输入回答后发送"}</span>
        <span className="ask-foot-actions">
          <Button size="sm" variant="ghost" onClick={() => advance(answers)}>
            跳过
          </Button>
          <Button size="sm" variant="primary" disabled={!answerOf(q.id)} onClick={() => advance(answers)}>
            {last ? "提交" : "下一题"}
          </Button>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MCP elicitation

type FieldValue = string | number | boolean | string[];

function enumOptions(schema: McpElicitationPrimitiveSchema): { value: string; label: string }[] | null {
  const s = schema as {
    enum?: string[];
    enumNames?: string[];
    oneOf?: { const: string; title: string }[];
    items?: { enum?: string[]; anyOf?: { const: string; title: string }[] };
  };
  if (s.oneOf) return s.oneOf.map((o) => ({ value: o.const, label: o.title }));
  if (s.enum) return s.enum.map((value, i) => ({ value, label: s.enumNames?.[i] ?? value }));
  if (s.items?.anyOf) return s.items.anyOf.map((o) => ({ value: o.const, label: o.title }));
  if (s.items?.enum) return s.items.enum.map((value) => ({ value, label: value }));
  return null;
}

function initialValue(schema: McpElicitationPrimitiveSchema): FieldValue | undefined {
  return (schema as { default?: FieldValue }).default;
}

function ElicitationField({
  name,
  schema,
  required,
  value,
  onChange,
}: {
  name: string;
  schema: McpElicitationPrimitiveSchema;
  required: boolean;
  value: FieldValue | undefined;
  onChange(value: FieldValue | undefined): void;
}) {
  const title = schema.title ?? name;
  const options = enumOptions(schema);
  let control: ReactNode;
  if (schema.type === "boolean") {
    control = (
      <label className="question-option">
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        <span className="question-option-label">{title}</span>
      </label>
    );
  } else if (schema.type === "array" && options) {
    const selected = Array.isArray(value) ? value : [];
    control = (
      <div className="question-options">
        {options.map((option) => (
          <label key={option.value} className={`question-option ${selected.includes(option.value) ? "selected" : ""}`}>
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={(event) => onChange(event.target.checked ? [...selected, option.value] : selected.filter((v) => v !== option.value))}
            />
            <span className="question-option-label">{option.label}</span>
          </label>
        ))}
      </div>
    );
  } else if (options) {
    control = (
      <MenuSelect
        label={title}
        value={typeof value === "string" ? value : ""}
        placeholder="请选择…"
        options={required ? options : [{ value: "", label: "不选" }, ...options]}
        onChange={(next) => onChange(next || undefined)}
      />
    );
  } else if (schema.type === "number" || schema.type === "integer") {
    const numeric = schema as { minimum?: number; maximum?: number };
    control = (
      <input
        className="input"
        type="number"
        step={schema.type === "integer" ? 1 : "any"}
        min={numeric.minimum}
        max={numeric.maximum}
        value={typeof value === "number" ? value : ""}
        onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
      />
    );
  } else {
    const format = (schema as { format?: string }).format;
    control = (
      <input
        className="input"
        type={format === "email" ? "email" : format === "uri" ? "url" : format === "date" ? "date" : format === "date-time" ? "datetime-local" : "text"}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    );
  }
  return (
    <fieldset className="question">
      {schema.type !== "boolean" && (
        <legend className="question-header">
          {title}
          {required && <span className="required">*</span>}
        </legend>
      )}
      {schema.description && <div className="question-text">{schema.description}</div>}
      {control}
    </fieldset>
  );
}

/** A form elicitation with nothing to fill in is a yes/no question; MCP tool-call approvals arrive this way. */
function isConfirmation(params: RequestOf<"mcpServer/elicitation/request">["params"]): boolean {
  return params.mode === "form" && Object.keys(params.requestedSchema.properties ?? {}).length === 0;
}

// Option set and replies mirror codex-rs/tui/src/bottom_pane/mcp_server_elicitation.rs.
function ElicitationApproval({ request }: { request: RequestOf<"mcpServer/elicitation/request"> }) {
  const { params } = request;
  const meta = (params._meta ?? {}) as {
    codex_approval_kind?: string;
    persist?: string | string[];
    tool_title?: string;
    tool_params?: Record<string, JsonValue>;
    tool_params_display?: { name: string; display_name?: string; value: JsonValue }[];
  };
  const toolCall = meta.codex_approval_kind === "mcp_tool_call";
  const persist = ([] as string[]).concat(meta.persist ?? []);
  const reply = (action: McpServerElicitationAction, extra: JsonValue = null): McpServerElicitationRequestResponse => ({ action, content: null, _meta: extra });
  const args: [string, JsonValue][] = meta.tool_params_display?.length
    ? meta.tool_params_display.map((p) => [p.display_name || p.name, p.value])
    : Object.entries(meta.tool_params ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const choices: Choice[] = [{ label: "允许", key: "y", tone: "primary", result: reply("accept") }];
  if (persist.includes("session")) choices.push({ label: "允许，本会话内不再询问", key: "a", result: reply("accept", { persist: "session" }) });
  if (persist.includes("always")) choices.push({ label: "始终允许", key: "p", result: reply("accept", { persist: "always" }) });
  if (!toolCall) choices.push({ label: "拒绝，不提供并继续", key: "n", result: reply("decline") });
  choices.push(
    toolCall
      ? { label: "取消这次工具调用", key: "esc", tone: "danger", result: reply("cancel", { codex_approval_cancellation_reason: "user" }) }
      : { label: "取消请求", key: "esc", tone: "danger", result: reply("cancel") },
  );
  return (
    <ApprovalCard
      request={request}
      icon={<Plug size={16} />}
      title={toolCall ? `允许 MCP 服务器「${params.serverName}」运行工具${meta.tool_title ? `「${meta.tool_title}」` : ""}？` : `MCP 服务器「${params.serverName}」请求确认`}
      choices={choices}
    >
      <Reason text={params.message} />
      {args.length > 0 && (
        <ul className="approval-list">
          {args.map(([name, value]) => (
            <li key={name}>
              {name}: {typeof value === "string" ? value : JSON.stringify(value)}
            </li>
          ))}
        </ul>
      )}
    </ApprovalCard>
  );
}

function ElicitationRequest({ request }: { request: RequestOf<"mcpServer/elicitation/request"> }) {
  const { params } = request;
  const typed = params.mode === "form" || ((params.mode === "openai/form" || params.mode === "openaiForm") && typeof params.requestedSchema === "object" && params.requestedSchema !== null && "properties" in params.requestedSchema);
  const schema = typed ? (params as { requestedSchema: McpElicitationSchema }).requestedSchema : null;
  const link = params.mode === "url" ? externalUrl(params.url) : null;
  const [values, setValues] = useState<Record<string, FieldValue | undefined>>(() =>
    Object.fromEntries(Object.entries(schema?.properties ?? {}).map(([key, field]) => [key, field && initialValue(field)])),
  );
  const missing = (schema?.required ?? []).some((key) => values[key] === undefined || values[key] === "");
  const root = useRef<HTMLDivElement>(null);
  // The link comes first so Enter opens it rather than confirming an unvisited URL.
  useFocusWhenIdle(root, "a, input, select, .approval-choice:not(:disabled)", request.id);

  const respond = (action: McpServerElicitationAction) => {
    const content = action === "accept" && schema ? Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) : null;
    resolveRequest(request.id, { action, content: content as McpServerElicitationRequestResponse["content"], _meta: null } satisfies McpServerElicitationRequestResponse);
    focusComposer();
  };

  return (
    <div
      ref={root}
      className="approval-card"
      role="dialog"
      aria-label="MCP 服务器请求"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          respond("cancel");
        }
      }}
    >
      <span className="approval-backdrop" aria-hidden="true" />
      <div className="approval-head">
        <span className="approval-icon">{params.mode === "url" ? <KeyRound size={16} /> : <Plug size={16} />}</span>
        <span className="approval-title">MCP 服务器「{params.serverName}」需要你的输入</span>
      </div>
      <form
        className="approval-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!missing) respond("accept");
        }}
      >
        <ApprovalBody>
          <div className="approval-reason">{params.message}</div>
          {params.mode === "url" && (
            <>
              <pre className="approval-command">{params.url}</pre>
              {link ? (
                <a className="btn btn-secondary btn-sm" href={link} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} />
                  打开链接
                </a>
              ) : (
                <div className="approval-meta">出于安全考虑，只能打开不含账号密码的 https 链接。</div>
              )}
            </>
          )}
          {schema &&
            Object.entries(schema.properties).map(([key, field]) =>
              field ? (
                <ElicitationField
                  key={key}
                  name={key}
                  schema={field}
                  required={schema.required?.includes(key) ?? false}
                  value={values[key]}
                  onChange={(value) => setValues({ ...values, [key]: value })}
                />
              ) : null,
            )}
          {!schema && params.mode !== "url" && <pre className="code-pre">{JSON.stringify(params.requestedSchema, null, 2)}</pre>}
        </ApprovalBody>
        <div className="approval-choices">
          <Button type="submit" variant="primary" className="approval-choice" disabled={missing || (params.mode === "url" && !link)}>
            {params.mode === "url" ? "我已完成" : "提交"}
          </Button>
          <Button className="approval-choice" onClick={() => respond("decline")}>
            拒绝，不提供并继续
          </Button>
          <Button className="approval-choice danger" onClick={() => respond("cancel")}>
            取消请求 <Kbd>Esc</Kbd>
          </Button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Approvals({ threadId, cwd }: { threadId: string | null; cwd: string }) {
  const requests = useStore((s) => s.requests);

  // F-27: user verification is Codex desktop's own flow; decline it wherever it comes from.
  useEffect(() => {
    for (const request of requests) {
      if (!isUserVerification(request) || declined.has(request.id)) continue;
      declined.add(request.id);
      resolveRequest(request.id, { action: "decline", content: null, _meta: null } satisfies McpServerElicitationRequestResponse);
    }
  }, [requests]);

  const mine = requests.filter((request) => requestThreadId(request) === threadId && !isUserVerification(request));
  const current = mine[0];
  if (!current) return null;

  let card: ReactNode = null;
  const key = String(current.id);
  switch (current.method) {
    case "item/commandExecution/requestApproval":
      card = <CommandApproval key={key} request={current} cwd={cwd} />;
      break;
    case "item/fileChange/requestApproval":
      card = <FileChangeApproval key={key} request={current} />;
      break;
    case "item/permissions/requestApproval":
      card = <PermissionsApproval key={key} request={current} />;
      break;
    case "item/tool/requestUserInput":
      card = <QuestionCard key={key} request={current} />;
      break;
    case "mcpServer/elicitation/request":
      card = isConfirmation(current.params) ? <ElicitationApproval key={key} request={current} /> : <ElicitationRequest key={key} request={current} />;
      break;
  }
  if (!card) return null;

  // Ghost cards: one per request still waiting behind this one, at most two.
  const ghosts = Math.min(2, mine.length - 1);
  return (
    <div className="approvals">
      <div className="approval-stack">
        {Array.from({ length: ghosts }, (_, index) => (
          <span key={index} className="approval-ghost" style={{ "--n": index + 1 } as CSSProperties} aria-hidden="true" />
        ))}
        {card}
      </div>
    </div>
  );
}
