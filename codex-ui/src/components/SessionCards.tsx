// Claude 4.29's side-session cards in the transcript (live c3fef5c6f): a turn's proposals in one
// ledger card (Tb / nb / eb), a proposal's row and its actions (gb / pb / ub / fb / db), an offer
// asking before a task gets its own session, the rows of proposals being started or settled
// (cb / lb), a started session's row (Q_ / ev) and the start_session / dismiss_task tool rows
// (cv / nv). Their state is linked.ts's; the words are Claude's zh-Hans ones.

import { use, useEffect, useRef, useState, type ReactNode } from "react";
import type { ThreadItem } from "@protocol/v2/ThreadItem";
import { activeTurn, isArchivedThread, modelLabel, openThread, PRESETS, requestSessionId, threadCwd, effectiveSettings, inWorktreeRoot } from "../lib/codex";
import { acceptOffer, dismissFromCard, doItHere, keepOffer, muteOffers, setNewTaskPrompt, startProposal, type StartPicks } from "../lib/linked";
import { askingThreads } from "../lib/questions";
import { callTitle, cappedPermission, cardState, sessionCall, sessionMeta, type CardState, type Permission, type Proposal } from "../lib/side-sessions";
import { getState, useStore, type AppState } from "../lib/store";
import { EFFORT_LABELS } from "./Composer";
import { KeptIn, ToolRow, contentText, rowState, type RowExtra } from "./items";
import { Markdown } from "./content";
import { openSettings } from "./Settings";
import { Button, Icon, MenuItem, MenuSection, MenuSep, Popover, ShimmerText, StatusDot } from "./ui";

type McpItem = Extract<ThreadItem, { type: "mcpToolCall" }>;

/** The first line of a refusal, as the not-started row shows it (c3fef5c6f nv z_ 120). */
function reasonOf(item: McpItem): string | undefined {
  const text = item.error?.message || (item.result ? contentText(item.result.content) : "");
  const line = text.split(/\r?\n/).map((part) => part.trim()).find(Boolean);
  return line && (line.length > 120 ? `${line.slice(0, 119)}…` : line);
}

/** A session call that did not go through: no _meta, a failed status or an error (Codex marks isError results failed). */
const refusedCall = (item: McpItem) => item.status === "failed" || !!item.error || (item.status === "completed" && !sessionMeta(item));

/** Claude nv: 会话未启动 · {title} · {reason}. */
function NotStarted({ item, title, extra }: { item: McpItem; title: string; extra?: RowExtra }) {
  const reason = reasonOf(item);
  return <ToolRow verb="会话未启动" detail={reason ? `${title} · ${reason}` : title} status="done" extra={extra} />;
}

/**
 * start_session and dismiss_task as Claude draws them (c3fef5c6f cv / Z_ / $_): the verb for what
 * the call does, the task's title; a start that went through is the session's own row, an offer on
 * its card the card, a brief sent for an accepted offer nothing. A proposal that went through is in
 * its turn's ledger (Transcript), not here.
 */
export function SessionCallRow({ item, extra }: { item: McpItem; extra?: RowExtra }) {
  const threadId = use(KeptIn);
  const kind = sessionCall(item);
  const meta = sessionMeta(item);
  const waitingOffer = useStore((s) => (threadId && kind === "offer" ? s.offers[threadId] : undefined));
  const state = rowState(item.status);
  const title = callTitle(item);
  if (kind === "brief") return null;
  if (kind === "dismiss") {
    if (refusedCall(item)) return <ToolRow verb="撤回建议失败" detail={reasonOf(item)} status="done" extra={extra} />;
    const note = !meta ? undefined : meta.outcome === "dismissed" ? undefined : meta.outcome === "already_started" || meta.outcome === "spawn_in_flight" ? "建议已开始" : "无可撤回的建议";
    return <ToolRow verbs={["正在撤回建议", "已撤回建议"]} detail={note} status={state.status} outcome={state.outcome} extra={extra} />;
  }
  if (kind === "offer") {
    if (item.status === "inProgress" && threadId && waitingOffer) return <Ledger threadId={threadId} tools={[{ item, taskId: waitingOffer }]} />;
    if (item.status === "inProgress") return <ToolRow verbs={["正在提供新会话", "已提供新会话"]} detail={title} status="running" extra={extra} />;
    if (refusedCall(item)) return <NotStarted item={item} title={title ?? "正在启动会话"} extra={extra} />;
    if (meta?.outcome === "no_card") return <ToolRow verb="已在此会话中保留" detail={title} status="done" extra={extra} />;
    if (meta?.outcome === "kept" || meta?.outcome === "typed_past") return null;
    if (threadId && meta?.taskId && (meta.outcome === "offer_accepted" || meta.outcome === "offer_started")) return <Ledger threadId={threadId} tools={[{ item, taskId: meta.taskId }]} />;
    return <ToolRow verb="已提供新会话" detail={title} status="done" extra={extra} />;
  }
  if (refusedCall(item)) return <NotStarted item={item} title={title ?? "正在启动会话"} extra={extra} />;
  if (kind === "propose") return <ToolRow verbs={["正在提出任务建议", "已建议任务"]} detail={title} status={state.status} extra={extra} />;
  if (item.status === "inProgress" || !meta?.sessionId) return <ToolRow verbs={["正在启动会话", "已启动会话"]} detail={title} status={state.status} extra={extra} />;
  return <ChildRow sessionId={meta.sessionId} title={meta.title ?? title ?? "未命名任务"} frame="card" />;
}

// ---------------------------------------------------------------------------
// The ledger (c3fef5c6f Tb): one card for a turn's proposals, the started ones as session rows.

interface LedgerTool {
  item: McpItem;
  taskId: string;
}

interface Entry {
  key: string;
  taskId: string;
  title: string;
  state: CardState;
  proposal?: Proposal;
  sessionId?: string;
}

function useEntries(threadId: string, tools: readonly LedgerTool[]): Entry[] {
  const proposals = useStore((s) => s.proposals[threadId]);
  const outcomes = useStore((s) => s.proposalOutcomes);
  const spawning = useStore((s) => s.spawning);
  return tools.map(({ item, taskId }) => {
    const proposal = proposals?.find((entry) => entry.id === taskId);
    const outcome = outcomes[taskId];
    const state = cardState({ settled: item.status !== "inProgress", failed: refusedCall(item) && item.status !== "inProgress", taskId, queued: proposal, spawning: spawning.has(taskId), outcome });
    return { key: item.id, taskId, title: proposal?.title ?? sessionMeta(item)?.title ?? callTitle(item) ?? "未命名任务", state, proposal, sessionId: outcome?.sessionId };
  });
}

/** c3fef5c6f ob / Show more: past six rows the card shows five until 再显示 N 个. */
const FOLD_AT = 6;
const FOLDED = 5;

/** The proposals a turn made (or one offer), as their card (Tb), its rows by state (xb). */
export function Ledger({ threadId, tools }: { threadId: string; tools: readonly LedgerTool[] }) {
  const entries = useEntries(threadId, tools).filter((entry) => entry.state !== "kept_here");
  const [more, setMore] = useState(false);
  if (!entries.length) return null;
  // Nothing left to act on: the plain tool rows (jb → Zo).
  if (entries.every((entry) => entry.state === "proposing" || entry.state === "unavailable" || entry.state === "resolved"))
    return (
      <>
        {entries.map((entry) => (
          <ToolRow key={entry.key} verbs={["正在提出任务建议", "已建议任务"]} detail={entry.title} status={entry.state === "proposing" ? "running" : "done"} />
        ))}
      </>
    );
  // One sent to this session leaves nothing to show; one started is that session's own row.
  if (entries.length === 1 && entries[0].state === "sent_here") return null;
  if (entries.length === 1 && entries[0].state === "started" && entries[0].sessionId) return <ChildRow sessionId={entries[0].sessionId} title={entries[0].title} frame="card" />;
  const proposed = entries.filter((entry) => entry.state === "proposed" && entry.proposal && !entry.proposal.offer);
  const started = entries.filter((entry) => entry.state === "started").length;
  const shown = entries.length > FOLD_AT && !more ? entries.slice(0, FOLDED) : entries;
  const single = entries.length === 1 ? entries[0] : null;
  return (
    <div className="session-ledger" role="group" aria-label={`${entries.length} 个建议任务`}>
      <div className="session-ledger-box">
        {entries.length > 1 ? (
          <div className="session-ledger-head">
            <span>{`${entries.length} 个建议任务`}</span>
            {started > 0 && <span className="session-ledger-count">{`已启动 ${started} 项`}</span>}
            {proposed.length >= 2 && (
              <span className="session-ledger-all">
                <Button variant="ghost" size="sm" onMouseDown={(event) => event.preventDefault()} onClick={() => void startAll(threadId, proposed)}>
                  全部开始
                </Button>
              </span>
            )}
          </div>
        ) : single?.state === "proposed" ? (
          <div className="session-ledger-head">{single.proposal?.offer ? "要在单独的会话中启动吗？" : "新建会话"}</div>
        ) : null}
        {shown.map((entry) => (
          <EntryRow key={entry.key} threadId={threadId} entry={entry} />
        ))}
        {entries.length > FOLD_AT && (
          <div className="session-ledger-more">
            <Button variant="ghost" size="xs" icon={<Icon name={more ? "CaretUp" : "CaretDown"} size="sm" />} onClick={() => setMore(!more)}>
              {more ? "显示较少" : `再显示 ${entries.length - FOLDED} 个`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

async function startAll(threadId: string, entries: readonly Entry[]): Promise<void> {
  for (const entry of entries) await startProposal(threadId, entry.taskId, "card").catch(() => {});
}

const BUSY_LABEL: Partial<Record<CardState, string>> = { starting: "正在启动…", briefing: "正在撰写简报…", cloud_pending: "正在云端启动…" };
const SETTLED_LABEL: Partial<Record<CardState, string>> = { sent_here: "已发送到此会话", dismissed: "已忽略", start_failed: "无法启动" };

function EntryRow({ threadId, entry }: { threadId: string; entry: Entry }) {
  if (entry.state === "proposed" && entry.proposal) return <ProposalRow threadId={threadId} proposal={entry.proposal} />;
  const busy = BUSY_LABEL[entry.state];
  if (busy)
    return (
      <div className="session-ledger-row" data-proposed-task-state={entry.state} data-centered="">
        <ShimmerText className="session-ledger-busy">{entry.title}</ShimmerText>
        <span className="session-ledger-label">{busy}</span>
      </div>
    );
  if (entry.state === "started" && entry.sessionId)
    return (
      <div className="session-ledger-child" data-proposed-task-state="started">
        <ChildRow sessionId={entry.sessionId} title={entry.title} frame="listRow" />
      </div>
    );
  const label = SETTLED_LABEL[entry.state];
  const failed = entry.state === "start_failed";
  return (
    <div className="session-ledger-row" data-proposed-task-state={entry.state} data-centered="">
      <span className="session-ledger-settled" data-failed={failed || undefined}>{entry.title}</span>
      {label && <span className="session-ledger-label" data-failed={failed || undefined}>{label}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A proposal's row (gb): the title opens the brief, the line says where it starts, then the actions.

type Checkout = "folder" | "worktree" | "fork";

/** Where a proposal starts unless 选项 says otherwise: its own context, else the parent's checkout. */
function proposedCheckout(proposal: Proposal, parentInWorktree: boolean): Checkout {
  if (proposal.context === "fork") return "fork";
  return proposal.useWorktree ?? parentInWorktree ? "worktree" : "folder";
}

const CHECKOUT_LABEL: Record<Checkout, string> = { folder: "在此文件夹中", worktree: "在工作树中", fork: "此会话的分叉" };

function picksOf(checkout: Checkout, picks: StartPicks): StartPicks {
  return { ...picks, context: checkout === "fork" ? "fork" : "fresh", ...(checkout !== "fork" && { useWorktree: checkout === "worktree" }) };
}

function ProposalRow({ threadId, proposal }: { threadId: string; proposal: Proposal }) {
  const offer = !!proposal.offer;
  const parent = useStore((s) => s.threads[threadId]);
  const parentInWorktree = !!parent && inWorktreeRoot(threadCwd(parent));
  const proposed = proposedCheckout(proposal, parentInWorktree);
  const [checkout, setCheckout] = useState<Checkout>(proposed);
  const [picks, setPicks] = useState<StartPicks>({});
  const [options, setOptions] = useState(false);
  const [brief, setBrief] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const start = () => {
    if (busy) return;
    setBusy(true);
    const chosen = picksOf(checkout, { model: picks.model ?? proposal.model, effort: picks.effort ?? proposal.effort, permission: picks.permission ?? proposal.permission });
    const done = offer ? acceptOffer(threadId, proposal.id, chosen) : startProposal(threadId, proposal.id, "card", chosen).then(() => true, () => false);
    void done.finally(() => setBusy(false));
  };
  const here = () => (offer ? keepOffer(proposal.id) : void doItHere(threadId, proposal.id));
  useOfferKeys(root, offer, start, here, options ? () => setOptions(false) : undefined);
  const where = [
    checkout !== "folder" || proposed !== "folder" ? CHECKOUT_LABEL[checkout] : null,
    picks.permission ? `${PRESETS[picks.permission].label} 模式` : null,
  ].filter(Boolean);
  const tldr = offer ? undefined : proposal.prompt.split("\n", 1)[0].slice(0, 2000);
  const keep = (event: { preventDefault(): void }) => event.preventDefault();
  return (
    <div ref={root} className="session-ledger-row" data-proposed-task-state="proposed" data-proposed-task-offer={offer || undefined} data-column="">
      <div className="session-proposal-top">
        <div className="session-proposal-text">
          {offer ? (
            <span className="session-proposal-title">{proposal.title}</span>
          ) : (
            <Popover
              open={brief}
              onClose={() => setBrief(false)}
              placement="bottom-start"
              className="session-brief"
              anchor={
                <button type="button" className="session-proposal-title" aria-expanded={brief} onClick={() => setBrief(!brief)}>
                  {proposal.title}
                </button>
              }
            >
              <div className="session-brief-body">
                <Markdown text={proposal.prompt} />
              </div>
            </Popover>
          )}
          {(where.length > 0 || tldr) && (
            <span className="session-proposal-line">
              {where.length > 0 && (
                <span className="session-proposal-where" data-start-where="">
                  {where.join(" · ")}
                  {tldr ? " · " : null}
                </span>
              )}
              {tldr && <bdi>{tldr}</bdi>}
            </span>
          )}
        </div>
        {!offer && (
          <span className="session-proposal-dismiss">
            <Button variant="ghost" size="sm" icon={<Icon name="X" size="sm" />} label={`忽略建议 ${proposal.title}`} muted onMouseDown={keep} onClick={() => dismissFromCard(threadId, proposal.id)} />
          </span>
        )}
      </div>
      <span className="session-proposal-actions">
        <span className="session-proposal-lead">
          <Popover
            open={options}
            onClose={() => setOptions(false)}
            placement="bottom-start"
            className="session-options"
            anchor={
              <Button variant="ghost" size="sm" aria-expanded={options} onMouseDown={keep} onClick={() => setOptions(!options)}>
                选项
              </Button>
            }
          >
            <StartOptions parentId={threadId} checkout={checkout} proposed={proposed} picks={picks} proposal={proposal} onCheckout={setCheckout} onPicks={setPicks} />
          </Popover>
          {offer && <NeverAsk threadId={threadId} proposal={proposal} onNewSession={start} />}
        </span>
        <span className="session-proposal-buttons">
          <Button variant="ghost" size="sm" kbd={offer ? "Esc" : undefined} onMouseDown={keep} onClick={here}>
            在此处操作
          </Button>
          <Button variant="primary" size="sm" kbd={offer ? "Ctrl+Enter" : undefined} disabled={busy} onMouseDown={keep} onClick={start}>
            {offer ? "新建会话" : "开始"}
          </Button>
        </span>
      </span>
    </div>
  );
}

/** The 选项 popover (c91b1ad59 Fd): worktree, model, effort, permissions, within this session's own. */
function StartOptions({ parentId, checkout, proposed, picks, proposal, onCheckout, onPicks }: { parentId: string; checkout: Checkout; proposed: Checkout; picks: StartPicks; proposal: Proposal; onCheckout(value: Checkout): void; onPicks(value: StartPicks): void }) {
  const models = useStore((s) => s.models);
  const parent = useStore((s) => s.threads[parentId]);
  const settings = effectiveSettings(parent ?? null);
  const model = picks.model ?? proposal.model ?? settings.model;
  const efforts = models.find((m) => m.id === model || m.model === model)?.supportedReasoningEfforts.map((option) => option.reasoningEffort) ?? [];
  const effort = picks.effort ?? proposal.effort ?? settings.effort;
  const permission = picks.permission ?? proposal.permission ?? settings.permission;
  const fork = checkout === "fork";
  const asProposed = checkout === proposed && !picks.model && !picks.effort && !picks.permission;
  return (
    <div className="session-options-body" role="menu">
      <MenuSection title="工作树" />
      {(["folder", "worktree", "fork"] as const).map((value) => (
        <MenuItem key={value} label={CHECKOUT_LABEL[value]} checked={checkout === value} onClick={() => onCheckout(value)} />
      ))}
      {!fork && (
        <>
          <MenuSep />
          <MenuSection title="模型" />
          {models.map((m) => (
            <MenuItem key={m.id} label={modelLabel(m.id)} checked={m.id === model || m.model === model} onClick={() => onPicks({ ...picks, model: m.id, effort: undefined })} />
          ))}
          {efforts.length > 0 && (
            <>
              <MenuSep />
              <MenuSection title="思考强度" />
              {efforts.map((value) => (
                <MenuItem key={value} label={EFFORT_LABELS[value] ?? value} checked={value === effort} onClick={() => onPicks({ ...picks, effort: value })} />
              ))}
            </>
          )}
        </>
      )}
      <MenuSep />
      <MenuSection title="权限" />
      {(Object.keys(PRESETS) as Permission[]).filter((value) => cappedPermission(value, settings.permission) !== null).map((value) => (
        <MenuItem key={value} label={PRESETS[value].label} checked={value === permission} onClick={() => onPicks({ ...picks, permission: value })} />
      ))}
      <MenuSep />
      <MenuItem
        label="按 Codex 的建议启动"
        checked={asProposed}
        onClick={() => {
          onCheckout(proposed);
          onPicks({});
        }}
      />
    </div>
  );
}

/** db: 不再询问 → 始终新建会话 / 始终在此处执行 / 设置. */
function NeverAsk({ threadId, proposal, onNewSession }: { threadId: string; proposal: Proposal; onNewSession(): void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-start"
      anchor={
        <Button variant="ghost" size="sm" muted aria-expanded={open} onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen(!open)}>
          不再询问
        </Button>
      }
    >
      <div role="menu">
        <MenuItem
          label="始终新建会话"
          onClick={() => {
            setOpen(false);
            setNewTaskPrompt("new_session");
            onNewSession();
          }}
        />
        <MenuItem
          label="始终在此处执行"
          onClick={() => {
            setOpen(false);
            setNewTaskPrompt("here");
            muteOffers(threadId);
            keepOffer(proposal.id);
          }}
        />
        <MenuSep />
        <MenuItem
          label="设置"
          onClick={() => {
            setOpen(false);
            openSettings("codex", "setting-codex-new-task-prompt");
          }}
        />
      </div>
    </Popover>
  );
}

/** Text fields other than the composer, menus and dialogs keep their keys (shared-502 Jl). */
const TEXT_FIELD = "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role=textbox], [role=combobox]";
/** Claude armGraceMs: keys and clicks within 400ms of the card appearing are swallowed. */
const ARM_MS = 400;

/**
 * The offer card's keys (shared-502 Jl): Ctrl/⌘+Enter 新建会话, Esc 在此处操作 (or closes 选项 first).
 * They yield to a draft in the composer, IME, other text fields, open menus and dialogs, and to a
 * card scrolled out of view.
 */
function useOfferKeys(root: { current: HTMLElement | null }, enabled: boolean, accept: () => void, keep: () => void, closeOptions?: () => void) {
  const latest = useRef({ accept, keep, closeOptions });
  latest.current = { accept, keep, closeOptions };
  const since = useRef(Date.now());
  useEffect(() => {
    if (!enabled) return;
    let visible = true;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    if (root.current) observer.observe(root.current);
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || !visible) return;
      const { dialog, settings, palette, lightbox } = getState();
      if (dialog || settings || palette || lightbox || document.querySelector(".composer-popup")) return;
      const active = document.activeElement as HTMLElement | null;
      const composer = document.querySelector<HTMLTextAreaElement>(".composer-input");
      if ((active && !active.matches(".composer-input") && active.closest(TEXT_FIELD)) || composer?.value.trim()) return;
      const { accept: yes, keep: no, closeOptions } = latest.current;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (closeOptions) closeOptions();
        else if (!document.querySelector(".popover") && Date.now() - since.current >= ARM_MS) no();
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && !document.querySelector(".popover")) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat && Date.now() - since.current >= ARM_MS) yes();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("keydown", onKey, true);
    };
  }, [enabled, root]);
}

// ---------------------------------------------------------------------------
// A session another one started (Q_ / ev): its title and state; it opens the session.

type ChildState = "starting" | "working" | "needs_you" | "done" | "failed" | "start_failed" | "archived";

function childState(s: AppState, id: string): ChildState {
  const thread = s.threads[id];
  if (isArchivedThread(id)) return "archived";
  if (!thread) return "starting";
  if (s.requests.some((request) => requestSessionId(request, s.threads) === id) || askingThreads({ [id]: thread }, s.settledQuestions).length) return "needs_you";
  if (activeTurn(thread) || thread.meta.status.type === "active") return "working";
  if (s.pendingMessages[id]) return thread.turns.length ? "working" : "starting";
  if (s.links[id]?.unbriefed && !thread.turns.length) return "start_failed";
  const last = thread.turns.at(-1);
  if (last?.status === "failed" || thread.meta.status.type === "systemError") return "failed";
  return last || thread.meta.status.type !== "idle" || thread.meta.preview ? "done" : "starting";
}

const CHILD_LABEL: Record<ChildState, string> = { starting: "正在启动…", working: "处理中", needs_you: "需要输入", done: "已完成", failed: "失败", start_failed: "无法启动", archived: "已归档" };

/** c3fef5c6f ev, card (alone) or listRow (in the ledger). */
export function ChildRow({ sessionId, title, frame }: { sessionId: string; title: string; frame: "card" | "listRow" }) {
  const state = useStore((s) => childState(s, sessionId));
  const name = useStore((s) => s.threads[sessionId]?.meta.name?.trim()) || title;
  const busy = state === "working" || state === "starting";
  const caption = state === "start_failed" ? "Codex 在为此会话分配任务前就停止了。您可以自行在此发送任务，或归档此会话。" : undefined;
  const mark: ReactNode =
    state === "needs_you" || state === "failed" || state === "start_failed" ? (
      <span className="session-child-state" data-tone={state === "needs_you" ? "warning" : "danger"}>
        {CHILD_LABEL[state]}
      </span>
    ) : state === "working" ? (
      <StatusDot kind="running" />
    ) : state === "archived" ? (
      <span className="session-child-state">{CHILD_LABEL[state]}</span>
    ) : null;
  const open = () => void openThread(sessionId);
  return (
    <div
      className="session-child"
      data-frame={frame}
      data-side-session-state={state}
      role="button"
      tabIndex={0}
      aria-label={`打开会话 ${name}（${CHILD_LABEL[state]}）`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          open();
        }
      }}
    >
      <span className="session-child-text">
        <ShimmerText active={busy} className="session-child-title">
          {name}
        </ShimmerText>
        {caption && <span className="session-child-caption">{caption}</span>}
      </span>
      <span className="session-child-end">
        {mark}
        <Icon name="CaretRight" size="sm" className="session-child-caret" />
      </span>
    </div>
  );
}
