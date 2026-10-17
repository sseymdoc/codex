// Server -> client requests docked above the composer: command / file-change /
// permission approvals, request_user_input questions and MCP elicitations.
// Option sets and semantics mirror codex-rs/tui/src/bottom_pane/approval_overlay.rs.

import type { ServerRequest } from "@protocol/ServerRequest";
import type { CommandExecutionApprovalDecision } from "@protocol/v2/CommandExecutionApprovalDecision";
import type { McpElicitationPrimitiveSchema } from "@protocol/v2/McpElicitationPrimitiveSchema";
import type { McpElicitationSchema } from "@protocol/v2/McpElicitationSchema";
import type { McpServerElicitationAction } from "@protocol/v2/McpServerElicitationAction";
import type { McpServerElicitationRequestResponse } from "@protocol/v2/McpServerElicitationRequestResponse";
import type { PermissionsRequestApprovalResponse } from "@protocol/v2/PermissionsRequestApprovalResponse";
import type { ToolRequestUserInputResponse } from "@protocol/v2/ToolRequestUserInputResponse";
import { ExternalLink, FilePen, Globe, KeyRound, MessageCircleQuestion, Plug, ShieldAlert, Terminal } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { openThread, requestThreadId, resolveRequest } from "../lib/codex";
import { relativePath, samePath, threadTitle } from "../lib/format";
import { getState, useStore } from "../lib/store";
import { Kbd, StatusDot } from "./ui";

type RequestOf<M extends ServerRequest["method"]> = Extract<ServerRequest, { method: M }>;

interface Choice {
  label: string;
  key?: string;
  tone?: "primary" | "danger";
  result: unknown;
}

function focusComposer() {
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus());
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

  // Take focus from an idle composer so the shortcuts work right away, like the TUI overlay.
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    const idle = !active || active === document.body || (active.classList.contains("composer-input") && !(active as HTMLTextAreaElement).value);
    if (idle) root.current?.querySelector<HTMLButtonElement>(".approval-choice")?.focus();
  }, [request.id]);

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
    <div className="approval" ref={root} onKeyDown={onKeyDown} role="alertdialog" aria-label="需要你的确认">
      <div className="approval-head">
        <span className="approval-icon">{icon}</span>
        <span className="approval-title">{title}</span>
        <StatusDot kind="clay" />
      </div>
      {children && <div className="approval-body">{children}</div>}
      <div className="approval-choices">
        {choices.map((choice) => (
          <button
            key={choice.label}
            type="button"
            className={`approval-choice ${choice.tone ?? ""}`}
            onClick={() => choose(choice)}
          >
            <span>{choice.label}</span>
            {choice.key && <Kbd>{choice.key === "esc" ? "Esc" : choice.key.toUpperCase()}</Kbd>}
          </button>
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
      icon={network ? <Globe size={15} /> : <Terminal size={15} />}
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
      icon={<FilePen size={15} />}
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
  for (const path of fileSystem?.read ?? []) rows.push(`读取 ${path}`);
  for (const path of fileSystem?.write ?? []) rows.push(`写入 ${path}`);
  for (const { access, path } of fileSystem?.entries ?? []) {
    const target = path.type === "path" ? path.path : path.type === "glob_pattern" ? path.pattern : JSON.stringify(path.value);
    rows.push(`${access === "write" ? "写入" : access === "read" ? "读取" : "禁止访问"} ${target}`);
  }
  return (
    <ApprovalCard
      request={request}
      icon={<ShieldAlert size={15} />}
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
// request_user_input

function UserInputRequest({ request }: { request: RequestOf<"item/tool/requestUserInput"> }) {
  const { questions } = request.params;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const complete = questions.every((q) => (answers[q.id] === "__other__" ? other[q.id]?.trim() : answers[q.id]?.trim()));

  const submit = () => {
    const response: ToolRequestUserInputResponse = { answers: {} };
    for (const q of questions) {
      const value = answers[q.id] === "__other__" ? other[q.id] : answers[q.id];
      response.answers[q.id] = { answers: value?.trim() ? [value.trim()] : [] };
    }
    resolveRequest(request.id, response);
    focusComposer();
  };

  return (
    <div className="approval" role="dialog" aria-label="Codex 的提问">
      <div className="approval-head">
        <span className="approval-icon">
          <MessageCircleQuestion size={15} />
        </span>
        <span className="approval-title">Codex 需要你的回答</span>
        <StatusDot kind="clay" />
      </div>
      <form
        className="approval-body question-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (complete) submit();
        }}
      >
        {questions.map((q) => (
          <fieldset key={q.id} className="question">
            {q.header && <legend className="question-header">{q.header}</legend>}
            <div className="question-text">{q.question}</div>
            {q.options?.length ? (
              <div className="question-options">
                {[...q.options, ...(q.isOther ? [{ label: "__other__", description: "" }] : [])].map((option) => (
                  <label key={option.label} className={`question-option ${answers[q.id] === option.label ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name={q.id}
                      checked={answers[q.id] === option.label}
                      onChange={() => setAnswers({ ...answers, [q.id]: option.label })}
                    />
                    <span>
                      <span className="question-option-label">{option.label === "__other__" ? "其他" : option.label}</span>
                      {option.description && <span className="question-option-desc">{option.description}</span>}
                    </span>
                  </label>
                ))}
                {answers[q.id] === "__other__" && (
                  <input
                    className="input"
                    autoFocus
                    type={q.isSecret ? "password" : "text"}
                    value={other[q.id] ?? ""}
                    placeholder="输入你的回答"
                    onChange={(event) => setOther({ ...other, [q.id]: event.target.value })}
                  />
                )}
              </div>
            ) : (
              <input
                className="input"
                type={q.isSecret ? "password" : "text"}
                value={answers[q.id] ?? ""}
                placeholder="输入你的回答"
                onChange={(event) => setAnswers({ ...answers, [q.id]: event.target.value })}
              />
            )}
          </fieldset>
        ))}
        <div className="approval-choices">
          <button type="submit" className="approval-choice primary" disabled={!complete}>
            提交回答
          </button>
          <button
            type="button"
            className="approval-choice"
            onClick={() => {
              resolveRequest(request.id, { answers: {} } satisfies ToolRequestUserInputResponse);
              focusComposer();
            }}
          >
            跳过
          </button>
        </div>
      </form>
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
      <select className="input" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value || undefined)}>
        <option value="">请选择…</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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

function ElicitationRequest({ request }: { request: RequestOf<"mcpServer/elicitation/request"> }) {
  const { params } = request;
  const typed = params.mode === "form" || ((params.mode === "openai/form" || params.mode === "openaiForm") && typeof params.requestedSchema === "object" && params.requestedSchema !== null && "properties" in params.requestedSchema);
  const schema = typed ? (params as { requestedSchema: McpElicitationSchema }).requestedSchema : null;
  const [values, setValues] = useState<Record<string, FieldValue | undefined>>(() =>
    Object.fromEntries(Object.entries(schema?.properties ?? {}).map(([key, field]) => [key, field && initialValue(field)])),
  );
  const missing = (schema?.required ?? []).some((key) => values[key] === undefined || values[key] === "");

  const respond = (action: McpServerElicitationAction) => {
    const content = action === "accept" && schema ? Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) : null;
    resolveRequest(request.id, { action, content: content as McpServerElicitationRequestResponse["content"], _meta: null } satisfies McpServerElicitationRequestResponse);
    focusComposer();
  };

  return (
    <div
      className="approval"
      role="dialog"
      aria-label="MCP 服务器请求"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          respond("cancel");
        }
      }}
    >
      <div className="approval-head">
        <span className="approval-icon">{params.mode === "url" ? <KeyRound size={15} /> : <Plug size={15} />}</span>
        <span className="approval-title">MCP 服务器「{params.serverName}」需要你的输入</span>
        <StatusDot kind="clay" />
      </div>
      <form
        className="approval-body question-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!missing) respond("accept");
        }}
      >
        <div className="approval-reason">{params.message}</div>
        {params.mode === "url" && (
          <a className="btn btn-secondary btn-sm" href={params.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={13} />
            <span className="btn-label">打开链接</span>
          </a>
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
        <div className="approval-choices">
          <button type="submit" className="approval-choice primary" disabled={missing}>
            {params.mode === "url" ? "我已完成" : "提交"}
          </button>
          <button type="button" className="approval-choice" onClick={() => respond("decline")}>
            拒绝，不提供并继续
          </button>
          <button type="button" className="approval-choice danger" onClick={() => respond("cancel")}>
            取消请求 <Kbd>Esc</Kbd>
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Approvals({ threadId, cwd }: { threadId: string | null; cwd: string }) {
  const requests = useStore((s) => s.requests);
  const mine = requests.filter((request) => requestThreadId(request) === threadId);
  const others = requests.filter((request) => {
    const id = requestThreadId(request);
    return id && id !== threadId;
  });
  const current = mine[0];
  const otherThread = others.length ? requestThreadId(others[0]) : null;

  let card: ReactNode = null;
  if (current) {
    switch (current.method) {
      case "item/commandExecution/requestApproval":
        card = <CommandApproval key={String(current.id)} request={current} cwd={cwd} />;
        break;
      case "item/fileChange/requestApproval":
        card = <FileChangeApproval key={String(current.id)} request={current} />;
        break;
      case "item/permissions/requestApproval":
        card = <PermissionsApproval key={String(current.id)} request={current} />;
        break;
      case "item/tool/requestUserInput":
        card = <UserInputRequest key={String(current.id)} request={current} />;
        break;
      case "mcpServer/elicitation/request":
        card = <ElicitationRequest key={String(current.id)} request={current} />;
        break;
    }
  }

  if (!card && !otherThread) return null;
  return (
    <div className="approvals">
      {otherThread && (
        <button type="button" className="approval-elsewhere" onClick={() => void openThread(otherThread)}>
          <StatusDot kind="clay" />
          {(() => {
            const meta = getState().threads[otherThread]?.meta;
            return `会话「${meta ? threadTitle(meta) : "其他会话"}」正在等待你的确认`;
          })()}
          <span className="muted">前往 →</span>
        </button>
      )}
      {card}
      {mine.length > 1 && <div className="approval-more muted small">还有 {mine.length - 1} 个请求排队中</div>}
    </div>
  );
}
