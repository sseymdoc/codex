// Server -> client requests docked above the composer, as Claude Desktop 2.42304.0.0's Code tab docks
// them: tool approval cards (c96d752d0 Rj in the c12c146ad shell, up to two ghost cards for what
// waits behind), the docked question card (ccae33cda Lt, state machine c8cf7b513; also for Codex's
// mid-turn questions, which are transcript items rather than requests), the plan card for
// a finished plan-mode turn (c96d752d0 aDe) and MCP form / link requests, which Codex must answer,
// drawn after the chat-side ElicitationModal (c385ec32f). Keys are window-wide (ccbc7e432 chords,
// c6ffe955f digits) and, like allow clicks, wait 400ms after a card shows (shared-10 qx).

import { browserRequest, useBrowser } from "../lib/browser";
import type { RequestId } from "@protocol/RequestId";
import type { ServerRequest } from "@protocol/ServerRequest";
import type { JsonValue } from "@protocol/serde_json/JsonValue";
import type { McpElicitationPrimitiveSchema } from "@protocol/v2/McpElicitationPrimitiveSchema";
import type { McpElicitationSchema } from "@protocol/v2/McpElicitationSchema";
import type { McpServerElicitationAction } from "@protocol/v2/McpServerElicitationAction";
import type { McpServerElicitationRequestResponse } from "@protocol/v2/McpServerElicitationRequestResponse";
import type { NetworkApprovalProtocol } from "@protocol/v2/NetworkApprovalProtocol";
import type { PermissionsRequestApprovalResponse } from "@protocol/v2/PermissionsRequestApprovalResponse";
import type { RequestPermissionProfile } from "@protocol/v2/RequestPermissionProfile";
import type { ToolRequestUserInputQuestion } from "@protocol/v2/ToolRequestUserInputQuestion";
import type { ToolRequestUserInputResponse } from "@protocol/v2/ToolRequestUserInputResponse";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { commandDecisions, commandSlots, fieldError, fieldShown, formContent, formShown, prefixLabel, stdinInput, type CommandParams, type FieldValue } from "../lib/approvals";
import {
  activeTurn,
  autoReviewAvailable,
  effectiveSettings,
  errorMessage,
  interrupt,
  presetAllowed,
  requestThreadId,
  resolveRequest,
  sendMessage,
  setOverride,
} from "../lib/codex";
import { basename, externalUrl, relativePath, samePath } from "../lib/format";
import { replyText, waitingQuestions, type AsyncQuestion } from "../lib/questions";
import { getState, settleQuestions, toast, useStore, type PermissionPreset, type ThreadState } from "../lib/store";
import { Button, Checkbox, Icon, Kbd, MenuItem, MenuSelect, Popover, type IconName } from "./ui";

type RequestOf<M extends ServerRequest["method"]> = Extract<ServerRequest, { method: M }>;

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
      return request.params.message || `MCP 服务器“${request.params.serverName}”请求确认`;
    default:
      return "等待您的确认";
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

/** onMouseDown for buttons that leave the focus where it is (ccae33cda jt). */
const keepFocus = (event: { preventDefault(): void }) => event.preventDefault();

// ---------------------------------------------------------------------------
// Keys

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

type Chord = "deny" | "once" | "persistent";

/** The chords for Kbd (a Mac passes its own symbols, lib/shortcut.ts) and their aria-keyshortcuts. */
const CHORDS: Record<Chord, { keys: string; aria: string }> = {
  deny: { keys: "esc", aria: "Escape" },
  once: { keys: MAC ? "⌘+⏎" : "ctrl+enter", aria: MAC ? "Meta+Enter" : "Control+Enter" },
  persistent: { keys: MAC ? "⇧+⌘+⏎" : "ctrl+shift+enter", aria: MAC ? "Shift+Meta+Enter" : "Control+Shift+Enter" },
};

/** A button's chord keycaps, at its end and hidden from assistive tech (aria-keyshortcuts names them). */
function ChordCaps({ chord }: { chord: Chord }) {
  return (
    <span className="approval-chord" aria-hidden="true">
      <Kbd>{CHORDS[chord].keys}</Kbd>
    </span>
  );
}

const GRACE_MS = 400;

/**
 * False for 400ms after the card shows, the window comes back into focus or the page becomes
 * visible: an allow key or click then is swallowed, so input meant for what was there before cannot
 * approve (shared-10 qx, ccbc7e432 armGraceMs).
 */
function useArmed(): () => boolean {
  const since = useRef(Date.now());
  useEffect(() => {
    const arm = () => {
      since.current = Date.now();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") arm();
    };
    window.addEventListener("focus", arm);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", arm);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return () => Date.now() - since.current >= GRACE_MS;
}

/** onClickCapture around allow buttons: a click within the grace is swallowed (deny is never held back). */
function guardClicks(armed: () => boolean) {
  return (event: { preventDefault(): void; stopPropagation(): void }) => {
    if (armed()) return;
    event.preventDefault();
    event.stopPropagation();
  };
}

interface CardKeys {
  /** Esc. */
  deny?: () => void;
  /** Ctrl+Enter. */
  once?: () => void;
  /** Ctrl+Shift+Enter. */
  persistent?: () => void;
  /** 1–9 by position. A persistent one fires only away from the composer, or from its own button. */
  digits?: { run: () => void; persistent?: boolean }[];
  /** Digits only from outside the card; inside it the card's own keys pick (ccae33cda Lt). */
  digitsOutside?: boolean;
}

const TEXT_FIELD = "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role=textbox], [role=combobox], [role=searchbox]";

/** A dialog, page overlay, menu or composer popup has the keyboard; the card's keys yield to it. */
function keysTaken(): boolean {
  const { dialog, settings, palette, lightbox } = getState();
  return !!(dialog || settings || palette || lightbox) || document.querySelector(".popover, .composer-popup") !== null;
}

/**
 * The card's window-wide keys, in the capture phase so they come before the composer (ccbc7e432,
 * c6ffe955f): Esc and the chords work from the composer too, digits only while it is empty; a text
 * field anywhere else keeps its keys. Allow keys within the grace are swallowed.
 */
function useCardKeys(root: RefObject<HTMLElement | null>, keys: CardKeys, armed: () => boolean, enabled = true) {
  const latest = useRef({ keys, armed });
  latest.current = { keys, armed };
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || keysTaken()) return;
      const { keys: k, armed: ready } = latest.current;
      const active = document.activeElement as HTMLElement | null;
      const inComposer = !!active?.matches(".composer-input");
      if (!inComposer && active?.closest(TEXT_FIELD)) return;
      const swallow = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (event.key === "Escape") {
        if (!k.deny) return;
        swallow();
        if (!event.repeat) k.deny();
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey) {
        if (!k.once) return;
        swallow();
        if (!event.repeat && ready()) (event.shiftKey ? k.persistent : k.once)?.();
      } else if (/^[1-9]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const digit = k.digits?.[Number(event.key) - 1];
        const inside = !!active && !!root.current?.contains(active);
        if (!digit || (inside && k.digitsOutside) || active?.closest("[role^=menu], [role=listbox], [role=option], [role=tab]")) return;
        if (!inside && document.querySelector<HTMLTextAreaElement>(".composer-input")?.value) return;
        if (digit.persistent && (inComposer || (inside && active?.dataset.approvalDigit !== event.key))) return;
        swallow();
        if (!event.repeat && ready()) digit.run();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [root, enabled]);
}

// ---------------------------------------------------------------------------
// Card pieces

/** Whether an element's content overflows it (c003a371e), rechecked as it or its children resize. */
function useOverflow(ref: RefObject<HTMLElement | null>): boolean {
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    const resize = new ResizeObserver(check);
    const watch = () => {
      resize.disconnect();
      resize.observe(el);
      for (const child of el.children) resize.observe(child);
      check();
    };
    const mutation = new MutationObserver(watch);
    mutation.observe(el, { childList: true });
    watch();
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, [ref]);
  return overflows;
}

/** A scroll region that becomes a labelled, focusable group once it overflows (c12c146ad V). */
function ScrollGroup({ label, className, children }: { label: string; className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const overflows = useOverflow(ref);
  return (
    <div ref={ref} className={`${className} scroll-fade-y`} {...(overflows ? { role: "group", "aria-label": label, tabIndex: 0 } : {})}>
      {children}
    </div>
  );
}

/** epitaxy-approval-body: everything above the buttons, title included, scrolling inside the card (c12c146ad H). */
function ApprovalBody({ children }: { children: ReactNode }) {
  return (
    <ScrollGroup label="请求详情" className="approval-body">
      {children}
    </ScrollGroup>
  );
}

/** The card surface under the content: surface-panel with shadow-panel-sm (c12c146ad N). */
function Backdrop() {
  return <span className="approval-backdrop" aria-hidden="true" />;
}

/** The title row (shared-5 EA): leading, the title, a subtitle under it, trailing controls. */
function Head({ leading, subtitle, trailing, children }: { leading?: ReactNode; subtitle?: ReactNode; trailing?: ReactNode; children: ReactNode }) {
  return (
    <div className="approval-head">
      <span className="approval-head-text">
        <span className="approval-head-line">
          {leading}
          <span className="approval-title">{children}</span>
        </span>
        {subtitle && <span className="approval-subtitle">{subtitle}</span>}
      </span>
      {trailing && <span className="approval-head-trailing">{trailing}</span>}
    </div>
  );
}

/** Description and Reason rows: secondary text scrolling past three lines (c96d752d0 lj in kC). */
function TextRow({ label, text }: { label: string; text?: string | null }) {
  return text ? (
    <ScrollGroup label={label} className="approval-reason">
      {text}
    </ScrollGroup>
  ) : null;
}

/** A footnote line with an icon, like the folder line (c96d752d0 approval-folder-line). */
function FootLine({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="approval-foot">
      <Icon name={icon} size="sm" />
      <span>{children}</span>
    </div>
  );
}

interface MenuChoice {
  label: string;
  hint?: string;
  run(): void;
}

// ponytail: a local CDS SplitDropdownButton; move to ui.tsx if another surface needs one.
function SplitButton({ button, primary, menuLabel, items }: { button: ReactNode; primary?: boolean; menuLabel: string; items: MenuChoice[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="approval-split" role="group">
      {button}
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        placement="top-end"
        anchor={
          <Button
            variant={primary ? "primary" : "secondary"}
            className="approval-caret"
            icon={<Icon name="CaretDown" size={16} />}
            label={menuLabel}
            tip=""
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          />
        }
      >
        {items.map((item) => (
          <MenuItem
            key={item.label}
            label={item.label}
            hint={item.hint}
            onClick={() => {
              setOpen(false);
              item.run();
            }}
          />
        ))}
      </Popover>
    </div>
  );
}

function location(path: string, root: string): string {
  if (samePath(path, root)) return "工作区根目录";
  const relative = relativePath(path, root);
  return relative === path ? path : `./${relative}`;
}

// ---------------------------------------------------------------------------
// Tool approvals (c96d752d0 Rj): Deny on the left, the allows on the right with Allow once last.

interface Act {
  label: string;
  /** What resolveRequest answers. */
  result: unknown;
  /** The button's tooltip, or the menu row's hint. */
  tip?: string;
  /** Runs after the answer. */
  then?: () => void;
}

interface Slots {
  deny: Act;
  session?: Act;
  always?: Act;
  once: Act;
  /** 更多允许选项 on Allow once. */
  more?: Act[];
}

/** 允许并切换到自动模式 (c96d752d0 Cn2), offered while no session-wide allow is: approve, then auto-review the rest. */
function autoOffer(threadId: string | null, once: unknown): Act[] | undefined {
  const thread = threadId ? getState().threads[threadId] : undefined;
  if (!thread || !autoReviewAvailable() || !presetAllowed("auto") || effectiveSettings(thread).reviewer === "auto_review") return undefined;
  const id = thread.meta.id;
  return [
    {
      label: "允许并切换到 Auto",
      tip: "本次会话的其余操作将由自动模式审查。",
      result: once,
      then: () => setOverride(id, { planMode: false, permission: "auto", reviewer: "auto_review" }),
    },
  ];
}

interface ElicitationMeta {
  codex_approval_kind?: string;
  persist?: string | string[];
  tool_title?: string;
  tool_params?: Record<string, JsonValue>;
  tool_params_display?: { name: string; display_name?: string; value: JsonValue }[];
}

const metaOf = (params: { _meta: JsonValue | null }) => (params._meta ?? {}) as ElicitationMeta;

/** The answers behind a tool card's buttons; Allow once is also what a notification's 允许一次 sends. */
function toolSlots(request: ServerRequest): Slots | null {
  switch (request.method) {
    case "item/commandExecution/requestApproval": {
      const params = request.params as CommandParams;
      const { deny = "cancel", session, always, once = "accept" } = commandSlots(commandDecisions(params));
      const alwaysTip =
        always && typeof always === "object"
          ? "acceptWithExecpolicyAmendment" in always
            ? `以后不再询问以“${prefixLabel(always.acceptWithExecpolicyAmendment.execpolicy_amendment)}”开头的命令`
            : `以后始终允许访问 ${always.applyNetworkPolicyAmendment.network_policy_amendment.host}`
          : undefined;
      return {
        deny: { label: "拒绝", result: { decision: deny } },
        session: session && { label: "在本次会话中允许", result: { decision: session }, tip: params.additionalPermissions ? "在本次会话中允许这些权限" : undefined },
        always: always && { label: "始终允许", result: { decision: always }, tip: alwaysTip },
        once: { label: "允许一次", result: { decision: once } },
        more: session ? undefined : autoOffer(params.threadId, { decision: once }),
      };
    }
    case "item/fileChange/requestApproval":
      // decline lets the turn go on, as Claude's deny does (the TUI sends cancel, which stops it).
      return {
        deny: { label: "拒绝", result: { decision: "decline" } },
        session: { label: "在本次会话中允许", result: { decision: "acceptForSession" } },
        once: { label: "允许一次", result: { decision: "accept" } },
      };
    case "item/permissions/requestApproval": {
      const { network, fileSystem } = request.params.permissions;
      const grant = (scope: "turn" | "session", strictAutoReview = false): PermissionsRequestApprovalResponse => ({
        permissions: { ...(network ? { network } : {}), ...(fileSystem ? { fileSystem } : {}) },
        scope,
        ...(strictAutoReview ? { strictAutoReview } : {}),
      });
      return {
        deny: { label: "拒绝", result: { permissions: {}, scope: "turn" } satisfies PermissionsRequestApprovalResponse },
        session: { label: "在本次会话中允许", result: grant("session") },
        once: { label: "允许一次", result: grant("turn") },
        more: [{ label: "允许并严格审查本轮后续命令", result: grant("turn", true) }],
      };
    }
    case "mcpServer/elicitation/request": {
      const meta = metaOf(request.params);
      const toolCall = meta.codex_approval_kind === "mcp_tool_call";
      const persist = ([] as string[]).concat(meta.persist ?? []);
      const reply = (action: McpServerElicitationAction, extra: JsonValue = null): McpServerElicitationRequestResponse => ({ action, content: null, _meta: extra });
      const once = reply("accept");
      return {
        // A Codex tool call can only be cancelled (TUI mcp_server_elicitation.rs); any other request
        // declines, as Claude's verdict deny does (shared-104 hA).
        deny: { label: "拒绝", result: toolCall ? reply("cancel", { codex_approval_cancellation_reason: "user" }) : reply("decline") },
        session: persist.includes("session") ? { label: "在本次会话中允许", result: reply("accept", { persist: "session" }) } : undefined,
        always: persist.includes("always") ? { label: "始终允许", result: reply("accept", { persist: "always" }), tip: "不再为此工具询问" } : undefined,
        once: { label: "允许一次", result: once },
        more: toolCall && !persist.includes("session") ? autoOffer(request.params.threadId, once) : undefined,
      };
    }
    default:
      return null;
  }
}

const ONCE_METHODS: ServerRequest["method"][] = ["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval"];

/**
 * Answers a waiting command, file-change or permissions request exactly as its card's 允许一次 does
 * (a desktop notification's button); false for any other request.
 */
export function allowRequestOnce(requestId: RequestId): boolean {
  const request = getState().requests.find((r) => r.id === requestId);
  const once = request && ONCE_METHODS.includes(request.method) ? toolSlots(request)?.once : undefined;
  if (!request || !once) return false;
  resolveRequest(request.id, once.result);
  return true;
}

interface Choice {
  act: Act;
  chord: Chord;
  persistent?: boolean;
  primary?: boolean;
  more?: Act[];
}

function ChoiceButton({ choice, digit, onChoose }: { choice: Choice; digit?: number; onChoose(act: Act): void }) {
  const { act, chord, primary, more } = choice;
  const button = (
    <Button
      variant={primary ? "primary" : "secondary"}
      className="approval-choice"
      tip={act.tip}
      data-approval-digit={digit}
      data-approval-primary={primary || undefined}
      aria-keyshortcuts={CHORDS[chord].aria}
      onClick={() => onChoose(act)}
    >
      <span className="approval-choice-label">{act.label}</span>
      {digit !== undefined && <Kbd>{digit}</Kbd>}
      <ChordCaps chord={chord} />
    </Button>
  );
  if (!more?.length) return button;
  return <SplitButton button={button} primary={primary} menuLabel="更多允许选项" items={more.map((item) => ({ label: item.label, hint: item.tip, run: () => onChoose(item) }))} />;
}

/** Arrow keys walk the card's buttons; Enter on the card itself focuses the primary one (c6ffe955f). */
function walkButtons(event: KeyboardEvent<HTMLDivElement>) {
  const actions = event.currentTarget.querySelector(".approval-actions");
  const target = event.target as HTMLElement;
  if (!actions) return;
  const buttons = [...actions.querySelectorAll<HTMLElement>("button:not(:disabled)")];
  if (event.key.startsWith("Arrow")) {
    if ((target !== event.currentTarget && !actions.contains(target)) || !buttons.length) return;
    event.preventDefault();
    event.stopPropagation();
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    buttons[index === -1 ? (step === 1 ? 0 : buttons.length - 1) : (index + step + buttons.length) % buttons.length].focus();
  } else if (event.key === "Enter" && target === event.currentTarget && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    (buttons.find((button) => button.hasAttribute("data-approval-primary")) ?? buttons.at(-1))?.focus();
  }
}

function ToolCard({ onResolve, action, title, slots, children }: { onResolve(result: unknown): void; action: string; title: string; slots: Slots; children?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const armed = useArmed();
  const choose = (act: Act) => {
    onResolve(act.result);
    act.then?.();
    focusComposer();
  };
  // In the dock a session-wide allow takes Always allow into its menu (Rj Ht2 / Fn2).
  const allows: Choice[] = [
    ...(slots.session
      ? [{ act: slots.session, chord: "persistent" as const, persistent: true, more: slots.always && [slots.always] }]
      : slots.always
        ? [{ act: slots.always, chord: "persistent" as const, persistent: true }]
        : []),
    { act: slots.once, chord: "once", primary: true, more: slots.more },
  ];
  const choices: Choice[] = [{ act: slots.deny, chord: "deny" }, ...allows];
  // Deny is 1; a persistent allow has a number only when no session-wide one is offered (Rj Bn2).
  const digitOf = (choice: Choice, index: number) => (choice.persistent && slots.session ? undefined : index + 1);
  const persistent = slots.session ?? slots.always;
  useCardKeys(
    root,
    {
      deny: () => choose(slots.deny),
      once: () => choose(slots.once),
      persistent: persistent && (() => choose(persistent)),
      digits: choices.map((choice, index) => ({ run: digitOf(choice, index) === undefined ? () => {} : () => choose(choice.act), persistent: choice.persistent })),
    },
    armed,
  );
  return (
    <div ref={root} className="approval-card tool" tabIndex={0} role="group" aria-label={`权限请求：${action}`} onKeyDown={walkButtons}>
      <Backdrop />
      <ApprovalBody>
        <div className="approval-detail">
          <Head>{title}</Head>
          {children && <div className="approval-rows">{children}</div>}
        </div>
      </ApprovalBody>
      <div className="approval-actions">
        <ChoiceButton choice={choices[0]} digit={1} onChoose={choose} />
        <div className="approval-allows" onClickCapture={guardClicks(armed)}>
          {allows.map((choice, index) => (
            <ChoiceButton key={choice.act.label} choice={choice} digit={digitOf(choice, index + 1)} onChoose={choose} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** What a grant adds, a row each (c96d752d0 TT): the network, then file system access. */
function Capabilities({ profile, cwd }: { profile: RequestPermissionProfile; cwd: string }) {
  const rows: { icon: IconName; text: string }[] = [];
  if (profile.network?.enabled) rows.push({ icon: "Globe", text: "访问网络" });
  const fileSystem = profile.fileSystem;
  // The server mirrors legacy read/write paths into `entries`; list each grant once.
  if (fileSystem?.entries?.length) {
    for (const { access, path } of fileSystem.entries) {
      const target = path.type === "path" ? location(path.path, cwd) : path.type === "glob_pattern" ? path.pattern : JSON.stringify(path.value);
      rows.push(
        access === "write"
          ? { icon: "Edit", text: `写入 ${target}` }
          : access === "read"
            ? { icon: "File", text: `读取 ${target}` }
            : { icon: "Prohibit", text: `禁止访问 ${target}` },
      );
    }
  } else {
    for (const path of fileSystem?.read ?? []) rows.push({ icon: "File", text: `读取 ${location(path, cwd)}` });
    for (const path of fileSystem?.write ?? []) rows.push({ icon: "Edit", text: `写入 ${location(path, cwd)}` });
  }
  if (!rows.length) return null;
  return (
    <div className="approval-caps">
      {rows.map((row) => (
        <div key={row.text} className="approval-cap">
          <Icon name={row.icon} size="md" />
          <span>{row.text}</span>
        </div>
      ))}
    </div>
  );
}

const SCHEMES: Record<NetworkApprovalProtocol, string> = { http: "http", https: "https", socks5Tcp: "socks5-tcp", socks5Udp: "socks5-udp" };

function CommandApproval({ request, cwd }: { request: RequestOf<"item/commandExecution/requestApproval">; cwd: string }) {
  const params = request.params as CommandParams;
  const network = params.networkApprovalContext;
  const stdin = params.kind === "writeStdin";
  const extra = params.additionalPermissions as RequestPermissionProfile | null | undefined;
  const verb = network ? "访问" : stdin ? "写入终端" : "运行";
  // The TUI shows what goes to the terminal escaped ("Input: {input:?}").
  const input = stdin && params.command ? stdinInput(params.command) : null;
  return (
    <ToolCard
      onResolve={(result) => resolveRequest(request.id, result)}
      action={network ? `${verb} ${network.host}` : verb}
      title={network ? `允许 Codex ${verb} ${network.host}？` : `允许 Codex ${verb} 吗？`}
      slots={toolSlots(request)!}
    >
      <TextRow label="原因" text={params.reason} />
      {extra && <Capabilities profile={extra} cwd={params.cwd ?? cwd} />}
      {!network && params.command && <div className="approval-command">{input !== null ? JSON.stringify(input) : params.command}</div>}
      {network ? (
        <FootLine icon="Globe">
          {SCHEMES[network.protocol]}://{network.host}
        </FootLine>
      ) : (
        params.cwd && <FootLine icon="Folder">{location(params.cwd, cwd)}</FootLine>
      )}
    </ToolCard>
  );
}

function FileChangeApproval({ request, cwd }: { request: RequestOf<"item/fileChange/requestApproval">; cwd: string }) {
  const { params } = request;
  const files =
    useStore((s) => {
      const item = s.threads[params.threadId]?.turns.find((turn) => turn.id === params.turnId)?.items.find((i) => i.id === params.itemId);
      return item?.type === "fileChange" ? item.changes : undefined;
    }) ?? [];
  const single = files.length === 1 ? files[0] : undefined;
  // Edit / Write (c96d752d0 sj): the file name in the title, its path as the detail.
  const verb = single?.kind.type === "add" ? "写入" : "编辑";
  const target = single ? basename(single.path) : files.length > 1 ? `${files.length} 个文件` : "";
  return (
    <ToolCard onResolve={(result) => resolveRequest(request.id, result)} action={target ? `${verb} ${target}` : verb} title={target ? `允许 Codex ${verb} ${target}？` : `允许 Codex ${verb} 吗？`} slots={toolSlots(request)!}>
      <TextRow label="原因" text={params.reason} />
      {files.length > 0 && <div className="approval-command">{files.map((file) => relativePath(file.path, cwd)).join("\n")}</div>}
      {params.grantRoot && <FootLine icon="Folder">请求写入权限：{location(params.grantRoot, cwd)}</FootLine>}
    </ToolCard>
  );
}

function PermissionsApproval({ request }: { request: RequestOf<"item/permissions/requestApproval"> }) {
  const { params } = request;
  return (
    <ToolCard onResolve={(result) => resolveRequest(request.id, result)} action="使用这些功能" title="允许 Codex 使用这些功能吗？" slots={toolSlots(request)!}>
      <TextRow label="原因" text={params.reason} />
      <Capabilities profile={params.permissions} cwd={params.cwd} />
    </ToolCard>
  );
}

/** A form elicitation with nothing to fill in is a yes/no question; MCP tool-call approvals arrive this way. */
function isConfirmation(params: RequestOf<"mcpServer/elicitation/request">["params"]): boolean {
  return params.mode === "form" && Object.keys(params.requestedSchema.properties ?? {}).length === 0;
}

/** "Allow Claude to <b>use {label}</b>?" with what was sent in a framed list (c96d752d0 Mj, ca31fdde5 $a). */
function ElicitationApproval({ request }: { request: RequestOf<"mcpServer/elicitation/request"> }) {
  const { params } = request;
  const meta = metaOf(params);
  const toolCall = meta.codex_approval_kind === "mcp_tool_call";
  const label = meta.tool_title || params.serverName;
  const args: [string, JsonValue][] = meta.tool_params_display?.length
    ? meta.tool_params_display.map((p) => [p.display_name || p.name, p.value])
    : Object.entries(meta.tool_params ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return (
    <ToolCard
      onResolve={(result) => resolveRequest(request.id, result)}
      action={toolCall ? `使用 ${label}` : params.serverName}
      title={toolCall ? `允许 Codex 使用 ${label} 吗？` : `${params.serverName} 请求您提供输入`}
      slots={toolSlots(request)!}
    >
      {toolCall && meta.tool_title && <FootLine icon="Connectors">{params.serverName}</FootLine>}
      <TextRow label="描述" text={params.message} />
      {args.length > 0 && (
        <div className="approval-sent">
          <ul role="list" aria-label="Codex 发送的内容">
            {args.map(([name, value]) => (
              <li key={name}>
                <span className="approval-sent-name">{name}</span>
                <span className={typeof value === "string" ? "approval-sent-value" : "approval-sent-value code"}>
                  {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ToolCard>
  );
}

// ---------------------------------------------------------------------------
// Questions (ccae33cda Lt): one question at a time; a pick moves on, the last submits.

const OTHER = -1;

/** request_user_input: the turn waits for the answers; closing the card stops it. */
function RequestQuestions({ request }: { request: RequestOf<"item/tool/requestUserInput"> }) {
  const { questions, threadId } = request.params;
  const submit = (answers: (string[] | undefined)[]) => {
    const response: ToolRequestUserInputResponse = { answers: {} };
    questions.forEach((question, index) => (response.answers[question.id] = { answers: answers[index] ?? [] }));
    resolveRequest(request.id, response);
  };
  // Dismiss stops the turn, as the TUI's interrupt in the question view does; Claude's answer says
  // "do not proceed, wait for next instruction" (shared-5).
  const dismiss = () => {
    if (activeTurn(getState().threads[threadId])) void interrupt(threadId);
    else resolveRequest(request.id, { answers: {} } satisfies ToolRequestUserInputResponse);
  };
  return <QuestionCard questions={questions} onSubmit={submit} onDismiss={dismiss} />;
}

/**
 * request_user_input_async: the turn runs on. The answers go out as one reply message (Codex
 * desktop: skipped questions stay out, Send now steers); closing or skipping them all sends nothing.
 */
function AsyncQuestions({ threadId, questions, onSettle }: { threadId: string; questions: AsyncQuestion[]; onSettle(ids: string[], settled: boolean): void }) {
  const ids = questions.map((question) => question.id);
  const submit = (answers: (string[] | undefined)[]) => {
    const replies = questions.flatMap((question, index) => {
      const answer = answers[index]?.[0]?.trim();
      return answer ? [{ questionItemId: question.id, question: question.title, answer }] : [];
    });
    onSettle(ids, true);
    if (!replies.length) return;
    sendMessage(threadId, [{ type: "text", text: replyText(replies), text_elements: [] }]).catch((error) => {
      onSettle(ids, false);
      toast("danger", "发送失败", errorMessage(error));
    });
  };
  // The free-text answer is always there (the tool's contract), as 其他 when there are options.
  const asked = questions.map((question) => ({
    id: question.id,
    header: "",
    question: question.title,
    isOther: question.options.length > 0,
    isSecret: false,
    options: question.options.map((label) => ({ label, description: "" })),
  }));
  return <QuestionCard questions={asked} onSubmit={submit} onDismiss={() => onSettle(ids, true)} />;
}

function QuestionCard({
  questions,
  onSubmit,
  onDismiss,
}: {
  questions: ToolRequestUserInputQuestion[];
  /** Each question's answer by position; a skipped one has none. */
  onSubmit(answers: (string[] | undefined)[]): void;
  onDismiss(): void;
}) {
  const [page, setPage] = useState(0);
  const [answers, setAnswers] = useState<(string[] | undefined)[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [other, setOther] = useState("");
  const [open, setOpen] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const engaged = useRef(false);
  const armed = useArmed();
  const q = questions[page];
  const options = q?.options ?? [];
  const last = page === questions.length - 1;
  // Codex questions may have no options: then the field alone answers.
  const typed = options.length === 0;
  const choice = typed ? (other.trim() ? OTHER : null) : picked;
  // An empty Other answers "Something else", as Claude's does (c8cf7b513 J).
  const answer = (): string[] => (choice === null ? [] : choice === OTHER ? [other.trim() || "Something else"] : [options[choice].label]);

  /** Shows a question with the answer it had, if any (c8cf7b513 G). */
  const show = (index: number, all: (string[] | undefined)[]) => {
    const previous = all[index]?.[0];
    const at = previous === undefined ? -1 : (questions[index]?.options ?? []).findIndex((option) => option.label === previous);
    setPage(index);
    setPicked(at >= 0 ? at : previous ? OTHER : null);
    setOther(at >= 0 || !previous ? "" : previous);
  };
  const record = (value: string[]) => {
    const all = [...answers];
    all[page] = value;
    setAnswers(all);
    if (!last) return show(page + 1, all);
    onSubmit(all);
    focusComposer();
  };
  const submit = () => {
    if (choice !== null) record(answer());
  };
  // Skip keeps a pick if there is one, else answers nothing (c8cf7b513 oe).
  const skip = () => record(answer());
  const pick = (index: number) => (index === OTHER ? setPicked(OTHER) : record([options[index].label]));
  const toggle = () => {
    const card = root.current;
    if (open && card && [...card.querySelectorAll(".ask-list, .ask-foot")].some((part) => part.contains(document.activeElement))) card.focus({ preventScroll: true });
    setOpen(!open);
  };

  // After a pick inside the card the next question keeps the focus there (ccae33cda Lt).
  useEffect(() => {
    if (engaged.current) root.current?.focus({ preventScroll: true });
  }, [page]);
  // Picking Other puts the caret in its field (c8cf7b513).
  useEffect(() => {
    if (picked === OTHER) root.current?.querySelector<HTMLElement>(".ask-field")?.focus();
  }, [picked]);

  useCardKeys(
    root,
    {
      // Only while 提交 can go: otherwise Ctrl+Enter stays the composer's (queue), as a mid-turn
      // question docks while the turn runs on.
      once: choice === null ? undefined : submit,
      digits: [
        ...options.map((_, index) => ({
          run: () => {
            engaged.current = false;
            pick(index);
          },
        })),
        ...(q?.isOther && !typed ? [{ run: () => setPicked(OTHER) }] : []),
      ],
      digitsOutside: true,
    },
    armed,
    open && !!q,
  );

  /** Keys with the focus in the card: digits only pick, ↑ ↓ move the pick, Enter goes on (c8cf7b513 ce). */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.matches("button, a")) return;
    const inField = target.matches(".ask-field");
    const digit = /^[1-9]$/.test(event.key) ? Number(event.key) : 0;
    const order = [...options.keys(), ...(q?.isOther && !typed ? [OTHER] : [])];
    const stop = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (!inField && digit && digit <= order.length) {
      stop();
      setPicked(order[digit - 1]);
    } else if (!inField && (event.key === "ArrowDown" || event.key === "ArrowUp") && order.length) {
      stop();
      const at = picked === null ? -1 : order.indexOf(picked);
      const next = event.key === "ArrowDown" ? order[(at + 1) % order.length] : order[at <= 0 ? order.length - 1 : at - 1];
      setPicked(next);
      if (next !== OTHER) root.current?.focus();
    } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && choice !== null) {
      stop();
      submit();
    }
  };

  if (!q) return null;
  const fieldProps = {
    className: "input ask-field",
    value: other,
    placeholder: "在此输入您自己的答案",
    "aria-label": typed ? q.question : "其他选项",
    tabIndex: typed || picked === OTHER ? 0 : -1,
    onChange: (event: { target: { value: string } }) => {
      setOther(event.target.value);
      if (!typed && picked !== OTHER) setPicked(OTHER);
    },
  };
  const field = q.isSecret ? <input type="password" {...fieldProps} /> : <textarea rows={1} {...fieldProps} />;
  return (
    <div
      ref={root}
      className="approval-card ask"
      tabIndex={0}
      data-collapsed={!open || undefined}
      onKeyDown={open ? onKeyDown : undefined}
      onFocus={() => {
        if (open) engaged.current = true;
      }}
    >
      <Backdrop />
      <ApprovalBody>
        <Head
          leading={
            questions.length > 1 && (
              <span className="ask-step">
                {page + 1}/{questions.length}
              </span>
            )
          }
          subtitle={q.header || undefined}
          trailing={
            <span className="ask-tools">
              <Button variant="ghost" icon={<Icon name="CaretRight" size={16} className="ask-caret" />} label="查看问题选项" aria-expanded={open} onMouseDown={keepFocus} onClick={toggle} />
              <Button variant="ghost" icon={<Icon name="X" size={16} />} label="忽略问题" onMouseDown={keepFocus} onClick={onDismiss} />
            </span>
          }
        >
          <span className="ask-question">{q.question}</span>
        </Head>
        {open && (
          <div className="ask-list">
            {options.map((option, index) => (
              <button key={`${index}-${option.label}`} type="button" className="ask-option" data-picked={picked === index || undefined} onClick={() => pick(index)}>
                <span className="ask-text">
                  <span className="ask-label">{option.label}</span>
                  {option.description && <span className="ask-desc">{option.description}</span>}
                </span>
                <span className="ask-key">
                  <Kbd>{index + 1}</Kbd>
                </span>
              </button>
            ))}
            {typed
              ? field
              : q.isOther && (
                  <div className="ask-other" data-picked={picked === OTHER || undefined}>
                    <button type="button" className="ask-other-pick" onClick={() => pick(OTHER)}>
                      <span className="ask-label">其他</span>
                      <span className="ask-key">
                        <Kbd>{options.length + 1}</Kbd>
                      </span>
                    </button>
                    {field}
                  </div>
                )}
          </div>
        )}
      </ApprovalBody>
      {open && (
        <div className="ask-foot">
          {page > 0 && (
            <Button className="ask-back" onMouseDown={keepFocus} onClick={() => show(page - 1, answers)}>
              返回
            </Button>
          )}
          <Button onMouseDown={keepFocus} onClick={skip}>
            跳过
          </Button>
          <Button variant="primary" className="approval-choice" disabled={choice === null} aria-keyshortcuts={CHORDS.once.aria} onMouseDown={keepFocus} onClick={submit}>
            <span className="approval-choice-label">{last ? "提交" : "下一步"}</span>
            <ChordCaps chord="once" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan (c96d752d0 aDe). Codex sends no plan request: a plan-mode turn that ended with a proposed plan
// gets this card (TUI plan_implementation.rs). Accept leaves plan mode in the picked mode and asks for
// the implementation; Revise sends the feedback and stays in plan mode; Reject just closes the card.

type AcceptMode = "default" | "acceptEdits" | "auto" | "bypass";

/** Claude's modes as the composer maps them onto Codex presets (Composer.tsx MODE_PRESET). */
const ACCEPT: Record<AcceptMode, { label: string; preset: PermissionPreset }> = {
  default: { label: "接受", preset: "read-only" },
  acceptEdits: { label: "接受并允许编辑", preset: "auto" },
  auto: { label: "接受并开启自动模式", preset: "auto" },
  bypass: { label: "接受并绕过权限", preset: "full-access" },
};

function send(threadId: string, text: string) {
  void sendMessage(threadId, [{ type: "text", text, text_elements: [] }]).catch((error) => toast("danger", "发送失败", errorMessage(error)));
}

function PlanApproval({ threadId, turnId, onSettle }: { threadId: string; turnId: string; onSettle(): void }) {
  const [revising, setRevising] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const feedback = useRef<HTMLTextAreaElement>(null);
  const armed = useArmed();
  // The modes the mode menu offers, auto first when it is there (c227f4d5e Dt2 / Et2).
  const modes = (["acceptEdits", "auto", "bypass"] as const).filter((mode) => presetAllowed(ACCEPT[mode].preset) && (mode !== "auto" || autoReviewAvailable()));
  const trust: AcceptMode = modes.includes("auto") ? "auto" : modes.includes("acceptEdits") ? "acceptEdits" : "default";
  const manual = presetAllowed("read-only");
  const accept = (mode: AcceptMode) => {
    const thread = getState().threads[threadId];
    // As the composer's mode menu does: the reviewer follows the mode once auto-review is in play.
    const reviewer = autoReviewAvailable() || (thread && effectiveSettings(thread).reviewer === "auto_review") ? (mode === "auto" ? "auto_review" : "user") : undefined;
    onSettle();
    setOverride(threadId, { planMode: false, permission: ACCEPT[mode].preset, ...(reviewer ? { reviewer } : {}) });
    // TUI PLAN_IMPLEMENTATION_CODING_MESSAGE.
    send(threadId, "Implement the plan.");
  };
  const revise = () => {
    const text = feedback.current?.value.trim();
    onSettle();
    if (text) send(threadId, text);
  };
  // Claude opens the plan file in a pane; Codex's plan is the turn's plan item in the transcript.
  const openPlan = () => {
    const plan = getState().threads[threadId]?.turns.find((turn) => turn.id === turnId)?.items.findLast((item) => item.type === "plan");
    const target = (plan && document.querySelector(`[data-entry-id="${CSS.escape(plan.id)}"]`)) ?? document.querySelector(`[data-turn-id="${CSS.escape(turnId)}"]`);
    target?.scrollIntoView({ block: "start" });
  };

  useEffect(() => {
    if (revising) feedback.current?.focus();
  }, [revising]);
  useCardKeys(
    root,
    {
      deny: () => setRevising(!revising),
      once: revising ? undefined : () => accept(trust),
      persistent: manual ? () => accept("default") : undefined,
    },
    armed,
  );

  const primary = (
    <Button variant="primary" className="approval-choice" data-approval-primary aria-keyshortcuts={CHORDS.once.aria} onMouseDown={keepFocus} onClick={() => accept(trust)}>
      <span className="approval-choice-label">{ACCEPT[trust].label}</span>
      <ChordCaps chord="once" />
    </Button>
  );
  return (
    <div ref={root} className="approval-card">
      <Backdrop />
      <ApprovalBody>
        <Head
          trailing={
            <button type="button" className="link-btn approval-link" onClick={openPlan}>
              打开计划
            </button>
          }
        >
          Codex 提出了一个计划
        </Head>
        {revising && (
          <textarea
            ref={feedback}
            className="input approval-feedback"
            rows={3}
            aria-label="计划反馈"
            placeholder="应该更改什么？（可选）"
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.preventDefault();
                setRevising(false);
              } else if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                revise();
              }
            }}
          />
        )}
      </ApprovalBody>
      {revising ? (
        <div className="approval-actions plan">
          <Button onMouseDown={keepFocus} onClick={() => setRevising(false)}>
            返回
          </Button>
          <Button variant="primary" onMouseDown={keepFocus} onClick={revise}>
            修订
          </Button>
        </div>
      ) : (
        <div className="approval-actions plan">
          <div>
            <Button onMouseDown={keepFocus} onClick={onSettle}>
              拒绝
            </Button>
            <Button className="approval-choice" aria-keyshortcuts={CHORDS.deny.aria} onMouseDown={keepFocus} onClick={() => setRevising(true)}>
              <span className="approval-choice-label">修改…</span>
              <ChordCaps chord="deny" />
            </Button>
          </div>
          <div onClickCapture={guardClicks(armed)}>
            {trust !== "default" && manual && (
              <Button className="approval-choice" aria-keyshortcuts={CHORDS.persistent.aria} onMouseDown={keepFocus} onClick={() => accept("default")}>
                <span className="approval-choice-label">{ACCEPT.default.label}</span>
                <ChordCaps chord="persistent" />
              </Button>
            )}
            {modes.length > 1 ? (
              <SplitButton button={primary} primary menuLabel="更多接受选项" items={modes.map((mode) => ({ label: ACCEPT[mode].label, run: () => accept(mode) }))} />
            ) : (
              primary
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MCP forms and links: the chat-side ElicitationModal (c385ec32f) in the dock's card shell.

function enumOptions(schema: McpElicitationPrimitiveSchema): { value: string; label: string }[] | null {
  const s = schema as {
    enum?: string[];
    enumNames?: string[];
    oneOf?: { const: string; title: string }[];
    items?: { enum?: string[]; anyOf?: { const: string; title: string }[] };
  };
  if (s.oneOf) return s.oneOf.map((o) => ({ value: o.const, label: o.title || o.const }));
  if (s.enum) return s.enum.map((value, i) => ({ value, label: s.enumNames?.[i] || value }));
  if (s.items?.anyOf) return s.items.anyOf.map((o) => ({ value: o.const, label: o.title || o.const }));
  if (s.items?.enum) return s.items.enum.map((value) => ({ value, label: value }));
  return null;
}

/** A default in the form its control edits: a date-time as local time, a date as YYYY-MM-DD (c385ec32f ne). */
function initialValue(schema: McpElicitationPrimitiveSchema): FieldValue | undefined {
  const value = (schema as { default?: FieldValue }).default;
  const format = (schema as { format?: string }).format;
  if (typeof value !== "string") return value;
  if (format === "date") return value.slice(0, 10);
  if (format !== "date-time") return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/(?:Z|[+-]\d{2}:?\d{2})$/, "");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** A value as the reset button compares it: blank, or unticked with no default, counts as unset (c385ec32f q2). */
function valueKey(value: FieldValue | undefined, schema: McpElicitationPrimitiveSchema, initial: FieldValue | undefined): string {
  const blank = value === undefined || value === "" || (Array.isArray(value) && !value.length) || (schema.type === "boolean" && initial === undefined && value === false);
  return blank ? "" : JSON.stringify(Array.isArray(value) ? [...value].sort() : value);
}

/** A form field (c385ec32f W): the label with * and a reset button, the control, its description, the error. */
function ElicitationField({
  name,
  schema,
  required,
  value,
  initial,
  error,
  onChange,
  onBlur,
}: {
  name: string;
  schema: McpElicitationPrimitiveSchema;
  required: boolean;
  value: FieldValue | undefined;
  initial: FieldValue | undefined;
  error?: string;
  /** `check`: report a problem right away (choices); text waits for the blur. */
  onChange(value: FieldValue | undefined, check: boolean): void;
  onBlur(): void;
}) {
  const id = useId();
  const title = schema.title || name;
  const options = enumOptions(schema);
  const ids = { label: `${id}-label`, description: `${id}-description`, error: `${id}-error` };
  const describedBy = [schema.description && ids.description, error && ids.error].filter(Boolean).join(" ") || undefined;
  const label = (
    <>
      {title}
      {required && (
        <span className="elicit-required" aria-hidden="true">
          *
        </span>
      )}
    </>
  );
  const common = { id, "aria-labelledby": ids.label, "aria-describedby": describedBy, "aria-required": required || undefined, "aria-invalid": error ? true : undefined };
  let control: ReactNode = null;
  if (schema.type === "array" && options) {
    const picked = Array.isArray(value) ? value : [];
    control = (
      <div className="elicit-checks" role="group" aria-labelledby={ids.label} aria-describedby={describedBy}>
        {options.map((option) => (
          <Checkbox
            key={option.value}
            checked={picked.includes(option.value)}
            label={option.label}
            onChange={(on) => onChange(on ? [...picked, option.value] : picked.filter((v) => v !== option.value), true)}
          />
        ))}
      </div>
    );
  } else if (options) {
    // A single choice is a clearable select with no empty item (c385ec32f r3).
    control = (
      <span className="elicit-select">
        <MenuSelect label={title} value={typeof value === "string" ? value : ""} options={options} onChange={(next) => onChange(next, true)} />
        {typeof value === "string" && value && <Button variant="ghost" size="xs" muted icon={<Icon name="X" size={12} />} label="清除选择" onClick={() => onChange(undefined, true)} />}
      </span>
    );
  } else if (schema.type === "number" || schema.type === "integer") {
    const integer = schema.type === "integer";
    control = (
      <input
        {...common}
        className="input"
        type="number"
        step={integer ? 1 : "any"}
        value={typeof value === "number" ? value : ""}
        onChange={(event) => {
          const text = event.target.value;
          const next = Number(text);
          if (!text) onChange(undefined, true);
          else if (!Number.isNaN(next) && (!integer || Number.isInteger(next))) onChange(next, true);
        }}
        onKeyDown={(event) => {
          if (integer && (event.key === "." || event.key === "e" || event.key === "E")) event.preventDefault();
        }}
        onBlur={onBlur}
      />
    );
  } else if (schema.type === "string") {
    const format = (schema as { format?: string }).format;
    const text = typeof value === "string" ? value : "";
    const set = (event: { target: { value: string } }) => onChange(event.target.value || undefined, false);
    control =
      format === "date" || format === "date-time" ? (
        <input {...common} className="input" type={format === "date" ? "date" : "datetime-local"} step={format === "date" ? undefined : "any"} value={text} onChange={set} onBlur={onBlur} />
      ) : format === "email" || format === "uri" ? (
        <input {...common} className="input" type="text" inputMode={format === "email" ? "email" : "url"} dir="ltr" value={text} onChange={set} onBlur={onBlur} />
      ) : (
        <textarea {...common} className="input elicit-text" rows={1} value={text} onChange={set} onBlur={onBlur} />
      );
  }
  const changed = valueKey(value, schema, initial) !== valueKey(initial, schema, initial);
  return (
    <div className="elicit-field" data-field={name}>
      <div className="elicit-label-row">
        {schema.type === "boolean" ? (
          <Checkbox
            checked={value === true}
            label={label}
            onChange={(on) => onChange(on, true)}
            id={id}
            aria-describedby={describedBy}
            aria-required={required || undefined}
            aria-invalid={error ? true : undefined}
          />
        ) : (
          <label className="elicit-label" id={ids.label} htmlFor={options ? undefined : id}>
            {label}
          </label>
        )}
        {changed && <Button variant="ghost" size="xs" muted icon={<Icon name="ArrowCounterClockwise" size={12} />} label={`重置 ${title}`} onClick={() => onChange(initial, false)} />}
      </div>
      {control}
      {schema.description && (
        <div className="elicit-description" id={ids.description}>
          {schema.description}
        </div>
      )}
      {error && (
        <div className="elicit-error" id={ids.error}>
          <Icon name="WarningCircle" size="sm" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function ElicitationRequest({ request }: { request: RequestOf<"mcpServer/elicitation/request"> }) {
  const { params } = request;
  const raw = params.mode === "url" ? null : params.requestedSchema;
  const schema = raw && typeof raw === "object" && !Array.isArray(raw) && typeof raw.properties === "object" && raw.properties !== null ? (raw as McpElicitationSchema) : null;
  const answerable = schema !== null && formShown(schema);
  const link = params.mode === "url" ? externalUrl(params.url) : null;
  const [initial] = useState(() => Object.fromEntries(Object.entries(schema?.properties ?? {}).map(([key, field]) => [key, field && initialValue(field)])));
  const [values, setValues] = useState<Record<string, FieldValue | undefined>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const root = useRef<HTMLDivElement>(null);
  const armed = useArmed();
  const title = params.mode === "url" ? `${params.serverName} 想要打开一个 URL` : `${params.serverName} 请求您提供输入`;

  const respond = (action: McpServerElicitationAction, content: Record<string, FieldValue> | null = null) => {
    resolveRequest(request.id, { action, content, _meta: null } satisfies McpServerElicitationRequestResponse);
    focusComposer();
  };
  // Closing the chat-side dialog (Esc) cancels the request.
  useCardKeys(root, { deny: () => respond("cancel") }, armed);

  const problem = (key: string, value: FieldValue | undefined) => {
    const field = schema?.properties[key];
    return field ? fieldError(field, value, schema?.required?.includes(key) ?? false) : null;
  };
  const report = (key: string, message: string | null) =>
    setErrors((current) => {
      const next = { ...current };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!schema || !answerable || !armed()) return;
    const found = Object.keys(schema.properties).flatMap((key) => {
      const message = problem(key, values[key]);
      return message ? [[key, message] as const] : [];
    });
    if (!found.length) return respond("accept", formContent(schema, values));
    setErrors(Object.fromEntries(found));
    root.current?.querySelector(`[data-field="${CSS.escape(found[0][0])}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const openLink = () => {
    if (!link || !armed()) return;
    window.open(link, "_blank", "noopener");
    respond("accept");
  };

  return (
    <div ref={root} className="approval-card tool" role="group" aria-label={title}>
      <Backdrop />
      <form className="approval-form" noValidate onSubmit={submit}>
        <ApprovalBody>
          <div className="approval-detail">
            <Head>{title}</Head>
            <div className="approval-rows">
              {params.message && <p className="approval-text">{params.message}</p>}
              {params.mode === "url" ? (
                <div className="approval-url">
                  <Icon name="ArrowOutSquare" size="md" />
                  {link ? <span className="approval-url-text">{link}</span> : <span className="approval-url-error">无法从此处打开此链接。如需继续，请选择拒绝。</span>}
                </div>
              ) : !answerable ? (
                <p className="approval-text danger">此表单无法在此处显示。请拒绝以继续。</p>
              ) : (
                Object.entries(schema.properties).map(([key, field]) =>
                  field && fieldShown(field) ? (
                    <ElicitationField
                      key={key}
                      name={key}
                      schema={field}
                      required={schema.required?.includes(key) ?? false}
                      value={values[key]}
                      initial={initial[key]}
                      error={errors[key]}
                      onChange={(value, check) => {
                        setValues((current) => ({ ...current, [key]: value }));
                        report(key, check ? problem(key, value) : null);
                      }}
                      onBlur={() => report(key, problem(key, values[key]))}
                    />
                  ) : null,
                )
              )}
            </div>
          </div>
        </ApprovalBody>
        <div className="approval-actions">
          <Button onClick={() => respond("decline")}>拒绝</Button>
          {(params.mode === "url" || answerable) && (
            <div className="approval-allows" onClickCapture={guardClicks(armed)}>
              {params.mode === "url" ? (
                <Button variant="primary" disabled={!link} onClick={openLink}>
                  打开链接（接受）
                </Button>
              ) : (
                <Button type="submit" variant="primary">
                  提交
                </Button>
              )}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Plan turns closed with 拒绝, 修改 or 接受 in this window. */
const settledPlans = new Set<string>();

/** A plan-mode session whose last turn ended with a proposed plan and nothing queued after it (TUI maybe_prompt_plan_implementation). */
function planTurnOf(thread: ThreadState | undefined): string | null {
  if (!thread?.planMode || thread.queue.length > 0) return null;
  const last = thread.turns.at(-1);
  return last?.status === "completed" && last.items.some((item) => item.type === "plan") ? last.id : null;
}

/** The session's mid-turn questions waiting on the user, as a string the store selector can compare. */
function questionsJson(thread: ThreadState | undefined, settled: ReadonlySet<string>): string {
  const open = waitingQuestions(thread, settled);
  return open.length ? JSON.stringify(open) : "";
}

export function Approvals({ threadId, cwd }: { threadId: string | null; cwd: string }) {
  const browser = useBrowser(threadId ?? "", cwd);
  const browserApproval = browser?.approvals?.[0];
  const requests = useStore((s) => s.requests);
  const planTurn = useStore((s) => (threadId ? planTurnOf(s.threads[threadId]) : null));
  const asked = useStore((s) => (threadId ? questionsJson(s.threads[threadId], s.settledQuestions) : ""));
  const [, setSettled] = useState(0);

  // F-27: user verification is Codex desktop's own flow; decline it wherever it comes from.
  useEffect(() => {
    for (const request of requests) {
      if (!isUserVerification(request) || declined.has(request.id)) continue;
      declined.add(request.id);
      resolveRequest(request.id, { action: "decline", content: null, _meta: null } satisfies McpServerElicitationRequestResponse);
    }
  }, [requests]);

  const mine = requests.filter((request) => requestThreadId(request) === threadId && !isUserVerification(request));
  const plan = threadId && planTurn && !settledPlans.has(planTurn) ? planTurn : null;
  const questions = asked ? (JSON.parse(asked) as AsyncQuestion[]) : [];
  const depth = mine.length + (browser?.approvals?.length ?? 0) + (questions.length ? 1 : 0) + (plan ? 1 : 0);
  // cc43287c9 data-skip-approval-enter: cards already waiting when the session opens come in without
  // the promote animation, until the dock has been empty once.
  const [calm, setCalm] = useState(depth > 0);
  if (calm && depth === 0) setCalm(false);

  const current = mine[0];
  let card: ReactNode = null;
  if (current) {
    const key = String(current.id);
    switch (current.method) {
      case "item/commandExecution/requestApproval":
        card = <CommandApproval key={key} request={current} cwd={cwd} />;
        break;
      case "item/fileChange/requestApproval":
        card = <FileChangeApproval key={key} request={current} cwd={cwd} />;
        break;
      case "item/permissions/requestApproval":
        card = <PermissionsApproval key={key} request={current} />;
        break;
      case "item/tool/requestUserInput":
        card = <RequestQuestions key={key} request={current} />;
        break;
      case "mcpServer/elicitation/request":
        card = isConfirmation(current.params) ? <ElicitationApproval key={key} request={current} /> : <ElicitationRequest key={key} request={current} />;
        break;
    }
  } else if (browserApproval && threadId) {
    card = <ToolCard key={browserApproval.id} action="使用浏览器" title={browserApproval.title}
      onResolve={(decision) => {
        void browserRequest(threadId, cwd, "approve", { id: browserApproval.id, decision })
          .catch((error) => toast("danger", "浏览器授权失败", error.message));
      }}
      slots={{
        deny: { label: "拒绝", result: 0 },
        once: { label: "允许一次", result: 1 },
        always: browserApproval.remember ? { label: "始终允许", result: 2 } : undefined,
      }}><TextRow label="说明" text={browserApproval.detail} /></ToolCard>;
  } else if (questions.length && threadId) {
    const settle = (ids: string[], settled: boolean) => {
      settleQuestions(ids, settled);
      setSettled((n) => n + 1);
    };
    // A changed set starts the card over, so its answers stay with their questions.
    card = <AsyncQuestions key={questions.map((question) => question.id).join("\n")} threadId={threadId} questions={questions} onSettle={settle} />;
  } else if (plan && threadId) {
    const settle = () => {
      settledPlans.add(plan);
      setSettled((n) => n + 1);
    };
    card = <PlanApproval key={plan} threadId={threadId} turnId={plan} onSettle={settle} />;
  }
  if (!card) return null;

  // Ghost cards: one per card still waiting behind this one, at most two.
  const ghosts = Math.min(2, depth - 1);
  return (
    <div className="approvals" data-skip-enter={calm || undefined}>
      <div className="approval-stack">
        {Array.from({ length: ghosts }, (_, index) => (
          <span key={index} className="approval-ghost" style={{ "--n": index + 1 } as CSSProperties} aria-hidden="true" />
        ))}
        {card}
      </div>
    </div>
  );
}
