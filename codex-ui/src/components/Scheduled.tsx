// The 定时任务 page: Claude 4.29 Code's /epitaxy/scheduled (cbd6c85c8 vd / ad: the page shell
// cd75b47e6, the grid $u, cards cdbc75b4b Yr / Tr over cf8745532 u) holding the ChatGPT app's local
// scheduled tasks (lib/automations.ts) and the user's own cloud ones at chatgpt.com
// (lib/cloud-automations.ts). The route (store scheduledRoute) holds the open task, whose page is
// ScheduledDetail, and the dialog over either (ScheduledForm: new and edit; ScheduledShare: sharing
// a cloud task, importing a shared one).

import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_SCHEDULE, describeRrule, rruleOf } from "../../context/rrule.mjs";
import { deleteAutomation, refreshAutomations, runNow, setAutomationStatus, useAutomations, type Automation } from "../lib/automations";
import {
  cloudSuggestions,
  refreshCloud,
  removeCloudAutomation,
  runCloudNow,
  setCloudStatus,
  useCloudAutomations,
  watchCloud,
  type CloudAccess,
  type CloudAutomation,
  type CloudSuggestion,
} from "../lib/cloud-automations";
import { desktopToolsReady, ensureThreads, errorMessage, fail, logout, newChat, openThread, patchScheduled } from "../lib/codex";
import { DEFAULT_VIEW, EXPIRED, cloudCard, createPrompt, defaultName, filterCount, localCard, toolSuggestions, viewCards, type ListView, type Mark, type TaskCard } from "../lib/scheduled-view";
import { getState, toast, useStore, type ScheduledSeed } from "../lib/store";
import { chooseFolder } from "./Composer";
import { quietMenu, useLiftSlot } from "./Main";
import { ScheduledDetail, askCodex } from "./ScheduledDetail";
import { ScheduledForm } from "./ScheduledForm";
import { ImportDialog, ShareDialog } from "./ScheduledShare";
import { Confirm } from "./Settings";
import { Button, Icon, MenuItem, MenuSection, MenuSep, Popover, Skeleton, StatusDot, type IconName } from "./ui";

const DESKTOP = typeof window !== "undefined" && !!window.codexDesktop;

/** sOxe0GRL7O, with when a local task cannot run here: Codex closed, or (in a browser) this page closed. */
const KEEP_AWAKE = `本地定时任务仅在您的电脑处于唤醒状态且联网时运行，${DESKTOP ? "Codex 关闭期间不会运行。" : "且需要保持此页面打开。"}`;

/** Cloud tasks are offered: the account has them, or asking failed (still offered, as the ChatGPT app does). */
const cloudOffered = (access: CloudAccess) => access === "ok" || access === "error";

/**
 * Why a cloud task cannot be made now, as the new menu's 云端 says under it (no full stop, as the
 * page's other menu notes): still asking, not a ChatGPT login or one whose session expired (a 401
 * under it), a browser-mode page ChatGPT turns away.
 */
function cloudBlocked(access: CloudAccess, pending: boolean, chatgpt: boolean): string | undefined {
  if (pending) return "正在加载…";
  if (access === "signin") return chatgpt ? "登录会话已过期" : "需要使用 ChatGPT 账户登录 Codex";
  return access === "blocked" ? "需要在 Codex UI 桌面版中使用" : undefined;
}

/** The store holds a ChatGPT login: a signin is then its session expiring (CloudBanner). */
const useChatGPT = () => useStore((s) => s.account?.account?.type === "chatgpt");

/** chatgpt.com's own scheduled page (blocked here: the browser opens it signed in). */
const openChatGPT = () => void window.open("https://chatgpt.com/scheduled", "_blank", "noopener");

/** The ChatGPT app's three local suggestions (automation-row Le: inbox.automations.emptySuggestion.*), 你 as 您. */
const SUGGESTIONS: { id: string; icon: IconName; color: string; name: string; description: string; prompt: string; rrule: string }[] = [
  {
    id: "daily-brief",
    icon: "Sun",
    color: "var(--cds-chart-1)",
    name: "每日简报",
    description: "以日历、未读电子邮件和优先事项摘要开启每个工作日",
    prompt: "给我一份晨间简报，包含我的日程安排、重要未读邮件，以及今天需要我关注的事项。",
    rrule: rruleOf({ ...DEFAULT_SCHEDULE, mode: "weekdays", time: "08:00" }),
  },
  {
    id: "weekly-review",
    icon: "Checklist",
    color: "var(--cds-chart-7)",
    name: "每周回顾",
    description: "每周五将您最近的工作整理成简明的状态更新",
    prompt: "回顾我本周的工作，并起草一份简短的状态更新。",
    rrule: rruleOf({ ...DEFAULT_SCHEDULE, mode: "weekly", weekdays: ["FR"], time: "16:00" }),
  },
  {
    id: "follow-up-monitor",
    icon: "Search",
    color: "var(--cds-chart-3)",
    name: "跟进监控",
    description: "查看最近的电子邮箱和日历活动，并标记需要您关注的事项",
    prompt: "查看最近的电子邮箱和日历活动，突出重要变化，并标记任何需要我关注的事项。",
    rrule: rruleOf({ ...DEFAULT_SCHEDULE, mode: "weekdays", time: "09:00" }),
  },
];

const newLocal = (seed: ScheduledSeed | null = null) => patchScheduled({ dialog: { type: "form", source: "local", id: null, seed } });

/**
 * What a new task opens once saved (Claude vd: the new routine's page; the ChatGPT app's create
 * onSuccess): a cron or cloud task's page, a heartbeat's session (which reads its setup reply there).
 */
function opened(created: Automation | CloudAutomation) {
  if (!("kind" in created)) patchScheduled({ task: { id: created.id, source: "cloud" }, dialog: null });
  else if (created.kind === "heartbeat" && created.targetThreadId) void openThread(created.targetThreadId);
  else patchScheduled({ task: { id: created.id, source: "local" }, dialog: null });
}

const closeDialog = () => patchScheduled({ dialog: null });

export function ScheduledView() {
  const route = useStore((s) => s.scheduledRoute) ?? { task: null, dialog: null };
  const task = route.task;
  const localName = useAutomations((s) => (task?.source === "local" ? (s.items?.find((a) => a.id === task.id)?.name ?? null) : null));
  const cloudName = useCloudAutomations((s) => {
    const a = task?.source === "cloud" ? s.items?.find((b) => b.id === task.id) : undefined;
    return a ? a.title || defaultName("", a.prompt) : null;
  });
  const name = localName ?? cloudName;
  const access = useCloudAutomations((s) => s.access);
  // Cloud tasks are the account's: another login or model provider asks again.
  const account = useStore((s) => s.account);
  const provider = useStore((s) => s.config?.model_provider);
  // Claude's "<name> | Claude" on a task's page.
  useEffect(() => {
    document.title = `${task && name ? name : "定时任务"} - Codex`;
  }, [task, name]);
  // Coming to the page reads the tasks again: another process may have changed them unannounced.
  useEffect(() => void refreshAutomations(), []);
  useEffect(() => watchCloud(), [account, provider]);
  return (
    // A task not (yet) found has no name to show: 定时任务 alone, its page offering the way back.
    <ScheduledFrame trail={task && name ? name : null}>
      <PageBoundary key={task ? `${task.source}:${task.id}` : "list"}>
        {task ? <ScheduledDetail task={task} cloudBanner={<CloudBanner access={access} />} /> : <ScheduledList />}
        {route.dialog?.type === "form" && <ScheduledForm dialog={route.dialog} onClose={(created) => (created ? opened(created) : closeDialog())} />}
        {route.dialog?.type === "share" && <ShareDialog key={route.dialog.id} id={route.dialog.id} onClose={closeDialog} />}
        {route.dialog?.type === "import" && <ImportDialog onClose={closeDialog} />}
      </PageBoundary>
    </ScheduledFrame>
  );
}

/**
 * What a render that throws leaves (a task's data no parse foresaw): the page's frame and a way on,
 * not an app gone blank. 重试 closes the dialog and draws the page again; another task starts afresh.
 */
class PageBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: errorMessage(error) };
  }
  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="plugins-empty" role="alert">
        <Icon name="Warning" size={20} className="scheduled-warn" />
        <p className="plugins-empty-title">无法显示定时任务</p>
        <p className="plugins-note">{this.state.error}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            patchScheduled({ dialog: null });
            this.setState({ error: null });
          }}
        >
          重试
        </Button>
      </div>
    );
  }
}

/** The page column (as CustomizeFrame): 定时任务 › a task's name in the titlebar, the page scrolling under it. */
function ScheduledFrame({ trail, children }: { trail: string | null; children: ReactNode }) {
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const slot = useLiftSlot();
  const bar = (
    <header className="chat-header" data-tip-group="" data-density="compact" data-collapsed={(!sidebarOpen && !slot) || undefined}>
      <h1 className="draft-title cloud-title plugins-crumbs" data-testid="scheduled-crumb-bar">
        {trail === null ? (
          <span className="cloud-title-text">定时任务</span>
        ) : (
          <>
            <button type="button" className="plugins-crumb" onClick={() => patchScheduled({ task: null })}>
              定时任务
            </button>
            <Icon name="CaretRight" size={12} className="plugins-crumb-sep" />
            <span className="cloud-title-text">{trail}</span>
          </>
        )}
      </h1>
    </header>
  );
  return (
    <div className="main-col" data-testid="scheduled-page" onContextMenu={quietMenu}>
      {slot ? createPortal(bar, slot) : bar}
      <div className="plugins-scroll">
        <div className="plugins-page">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The list (ad)

function ScheduledList() {
  const items = useAutomations((s) => s.items);
  const runs = useAutomations((s) => s.runs);
  const error = useAutomations((s) => s.error);
  const access = useCloudAutomations((s) => s.access);
  const cloudItems = useCloudAutomations((s) => s.items);
  const cloudRuns = useCloudAutomations((s) => s.runs);
  const threads = useStore((s) => s.threads);
  const projects = useStore((s) => s.projects);
  const account = useStore((s) => s.account);
  // ponytail: the search, filters and sort live as long as the list does (Claude keeps them in the URL).
  const [view, setView] = useState<ListView>(DEFAULT_VIEW);
  const [starting, setStarting] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState<TaskCard | null>(null);
  const offered = cloudOffered(access);
  const tools = useStore(desktopToolsReady);
  const cards = useMemo(() => {
    const now = Date.now();
    const local = (items ?? []).map((t) => localCard(t, runs, threads, projects));
    return offered && cloudItems ? [...local, ...cloudItems.map((a) => cloudCard(a, cloudRuns[a.id]?.items, now))] : local;
  }, [items, runs, threads, projects, offered, cloudItems, cloudRuns]);
  const tasks = (items?.length ?? 0) + (offered ? (cloudItems?.length ?? 0) : 0);
  // A ChatGPT login's cloud still being asked (gateOf answers any other account at once).
  const asking = access === "unknown" && !!account;
  // Pending as ad is until its lists are in: with none here, the cloud being asked may hold them all.
  const loading = items === null || (!tasks && asking);
  const { shown, hiddenCompleted } = useMemo(() => viewCards(cards, view), [cards, view]);
  // A heartbeat's card names its session, which the sidebar may not have listed.
  useEffect(() => {
    const ids = (items ?? []).flatMap((t) => (t.kind === "heartbeat" && t.targetThreadId && !getState().threads[t.targetThreadId] ? [t.targetThreadId] : []));
    if (ids.length) void ensureThreads(ids);
  }, [items]);
  const patch = (next: Partial<ListView>) => setView((current) => ({ ...current, ...next }));
  const query = view.query.trim();
  const filtered = filterCount(view) > 0;
  // Why no card shows (ad gn / bn), on the page and to screen readers.
  const nothing = hiddenCompleted ? `已隐藏 ${hiddenCompleted} 个已完成的定时任务` : query && filtered ? "没有与您的搜索和筛选条件匹配的定时任务。" : query ? "没有与您的搜索匹配的定时任务。" : "没有符合这些筛选条件的定时任务。";
  const run = (card: TaskCard) => {
    // A cloud run is a ChatGPT message: the task opens in ChatGPT, which runs it.
    if (card.source === "cloud") return runCloudNow(card.id);
    setStarting((current) => new Set(current).add(card.id));
    runNow(card.id)
      .catch((cause) => toast("warning", `无法启动“${card.name}”。请重试。`, errorMessage(cause)))
      .finally(() => setStarting((current) => {
        const next = new Set(current);
        next.delete(card.id);
        return next;
      }));
  };

  const toolbar = (
    <div className="customize-toolbar">
      <label className="settings-search connectors-search">
        <Icon name="Search" size="sm" />
        <input type="search" value={view.query} placeholder="搜索定时任务…" aria-label="搜索定时任务" onChange={(event) => patch({ query: event.target.value })} />
      </label>
      <FilterMenu view={view} cloud={offered} onChange={patch} />
      <SortMenu view={view} hidden={hiddenCompleted} onChange={patch} />
      <NewMenu access={access} pending={asking} tools={tools} />
    </div>
  );

  let body: ReactNode;
  if (items === null && error) {
    body = (
      <div className="plugins-empty" role="alert">
        <Icon name="Warning" size={20} className="scheduled-warn" />
        <p className="plugins-empty-title">无法加载定时任务</p>
        <p className="plugins-note">{error}</p>
        <Button variant="secondary" size="sm" onClick={() => void refreshAutomations()}>
          重试
        </Button>
      </div>
    );
  } else if (loading) {
    body = (
      <div aria-busy="true">
        <span className="sr-only">正在加载定时任务</span>
        <ul role="list" className="scheduled-grid">
          {Array.from({ length: 8 }, (_, index) => (
            <li key={index}>
              <div className="scheduled-card">
                <Skeleton lines={3} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  } else if (!tasks) {
    // ponytail: no ca0c38004 stopwatch drawing over it; that is Claude Desktop's artwork, read off the
    // install as claude-marks.mjs does the working mark, should the page want it.
    // ad's button is there for a single way to make one only: with cloud tasks or 使用 Codex 创建 the
    // toolbar's menu offers them (a cloud the login cannot reach leaves 本地 alone). A cloud list that
    // failed, or a ChatGPT login whose session expired, may hold some: its banner says so, and no 暂无.
    body = access === "error" || (access === "signin" && account?.account?.type === "chatgpt") ? null : (
      <div className="scheduled-empty">
        <p>暂无定时任务。</p>
        {!offered && !tools && (
          <Button variant="primary" onClick={() => newLocal()}>
            新建任务
          </Button>
        )}
      </div>
    );
  } else if (!shown.length) {
    // Only completed tasks left out: ad says so and offers no 清除 (its gn kind "completed").
    body = (
      <div className="scheduled-none">
        <span>{nothing}</span>
        {!hiddenCompleted && (
          <Button variant="secondary" size="sm" onClick={() => setView((current) => ({ ...DEFAULT_VIEW, sort: current.sort, showCompleted: current.showCompleted }))}>
            清除
          </Button>
        )}
      </div>
    );
  } else {
    body = (
      <ul role="list" aria-label="定时任务" className="scheduled-grid">
        {shown.map((card) => (
          <Card key={card.key} card={card} starting={starting.has(card.id)} onRun={() => run(card)} onDelete={() => setDeleting(card)} />
        ))}
      </ul>
    );
  }

  return (
    <>
      <div className="scheduled-head">
        <h2 className="plugins-title">定时任务</h2>
        {toolbar}
      </div>
      {!!items?.length && <Banner>{KEEP_AWAKE}</Banner>}
      <CloudBanner access={access} />
      {/* The search's and filters' count for screen readers, as ad's En says it (the query's lines: live shared-140 qt statusNoMatch / statusMatching). */}
      <p role="status" className="sr-only">
        {!items || (!query && !filtered) ? "" : !shown.length && (hiddenCompleted || filtered) ? nothing : !query ? `${shown.length} 个定时任务` : shown.length ? `${shown.length} 个定时任务与“${query}”匹配` : `没有与“${query}”匹配的定时任务`}
      </p>
      {body}
      {!loading && !query && !filtered && <Suggestions tools={tools} asking={asking} />}
      {deleting && (
        <Confirm
          title="删除定时任务？"
          description={`删除“${deleting.name}”？这将永久删除定时任务，并停止日后的运行。`}
          confirm="删除"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => (deleting.source === "cloud" ? removeCloudAutomation(deleting.id) : deleteAutomation(deleting.id)).catch(fail("无法删除定时任务。请重试。"))}
        />
      )}
    </>
  );
}

/** shared-frame Banner Ik, neutral: its Info glyph (or `icon`), the text, an action after it. */
function Banner({ icon = "Info", action, children }: { icon?: IconName; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="scheduled-banner">
      <Icon name={icon} size="sm" />
      <span className="scheduled-banner-text">{children}</span>
      {action}
    </div>
  );
}

/**
 * The cloud's state when it is not just there: sign in with ChatGPT, or (a ChatGPT login ChatGPT
 * answers 401 even with a fresh token) sign in again, which as the ChatGPT app's auth recovery
 * (desktop.requirementsAuthRecovery: 重新登录) signs out to the sign-in page; a browser-mode page
 * ChatGPT turns away (Cloudflare), whose tasks open in ChatGPT instead; a list that failed. The
 * local tasks show either way.
 */
function CloudBanner({ access }: { access: CloudAccess }) {
  const error = useCloudAutomations((s) => s.error);
  const chatgpt = useChatGPT();
  if (access === "signin" && chatgpt)
    return (
      <Banner action={<Button variant="secondary" size="sm" onClick={() => void logout().catch(fail("退出登录失败"))}>重新登录</Button>}>
        登录会话已过期。请重新登录以使用云端定时任务。
      </Banner>
    );
  if (access === "signin") return <Banner>云端定时任务需要使用 ChatGPT 账户登录 Codex。</Banner>;
  if (access === "blocked")
    return (
      <Banner action={<Button variant="secondary" size="sm" onClick={openChatGPT}>在 ChatGPT 中打开</Button>}>
        云端定时任务需要在 Codex UI 桌面版中使用；也可以在 ChatGPT 中打开。
      </Banner>
    );
  if (access === "error")
    return (
      <Banner icon="Warning" action={<Button variant="secondary" size="sm" onClick={() => void refreshCloud()}>重试</Button>}>
        <span data-tip={error ?? undefined}>无法加载云端定时任务</span>
      </Banner>
    );
  return null;
}

/**
 * 新建任务 (ad's primaryAction): one button for a local task, or with cloud tasks a menu of 本地 and
 * 云端 (Or.local / Or.remote) and 从分享链接导入…, and with the model's tools 使用 Codex 创建
 * (inbox.automations.createWithCodex); a cloud the login cannot reach, or one still being asked
 * (`pending`: the menu already, so the button keeps its width), is shown disabled with why.
 */
function NewMenu({ access, pending, tools }: { access: CloudAccess; pending: boolean; tools: boolean }) {
  const [open, setOpen] = useState(false);
  const why = cloudBlocked(access, pending, useChatGPT());
  const cloud = cloudOffered(access) || !!why;
  // Its prompt names cloud tasks only while the cloud answers.
  const create = createPrompt(tools, cloudOffered(access));
  if (!cloud && !create)
    return (
      <Button variant="primary" icon={<Icon name="Add" size="sm" />} onClick={() => newLocal()}>
        新建任务
      </Button>
    );
  const pick = (then: () => void) => () => {
    setOpen(false);
    then();
  };
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      anchor={
        <Button variant="primary" icon={<Icon name="Add" size="sm" />} aria-expanded={open} onClick={() => setOpen(!open)}>
          新建任务
          <Icon name="CaretDown" size="sm" />
        </Button>
      }
    >
      <MenuItem icon={<Icon name="Laptop" />} label="本地" onClick={pick(() => newLocal())} />
      {cloud && <MenuItem icon={<Icon name="Cloud" />} label="云端" hint={why} disabled={!!why} onClick={pick(() => patchScheduled({ dialog: { type: "form", source: "cloud", id: null, seed: null } }))} />}
      <MenuSep />
      {/* Its prompt waits for the cloud's answer, as 云端 does. */}
      {create && <MenuItem icon={<Icon name="ChatAdd" />} label="使用 Codex 创建" hint={pending ? why : undefined} disabled={pending} onClick={pick(() => void askCodex(create))} />}
      {cloud && <MenuItem icon={<Icon name="Link" />} label="从分享链接导入…" hint={why} disabled={!!why} onClick={pick(() => patchScheduled({ dialog: { type: "import" } }))} />}
    </Popover>
  );
}

/** Filter (cbd6c85c8 Su): 计划 and 状态; 运行于 (全部 / 本地 / 云端) joins them with cloud tasks. */
function FilterMenu({ view, cloud, onChange }: { view: ListView; cloud: boolean; onChange(patch: Partial<ListView>): void }) {
  const [open, setOpen] = useState(false);
  const count = filterCount(view);
  const label = count ? `筛选定时任务，已启用 ${count} 个筛选条件` : "筛选定时任务";
  const group = <K extends "runsOn" | "schedule" | "status">(key: K, title: string, options: [ListView[K], string][]) => (
    <>
      <MenuSection title={title} />
      {options.map(([value, text]) => (
        <MenuItem key={value} label={text} checked={view[key] === value} onClick={() => onChange({ [key]: value })} />
      ))}
    </>
  );
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      anchor={<Button variant="ghost" icon={<Icon name="Filter" />} label={label} active={open || count > 0} onClick={() => setOpen(!open)} />}
    >
      {cloud && (
        <>
          {group("runsOn", "运行于", [["all", "全部"], ["local", "本地"], ["cloud", "云端"]])}
          <MenuSep />
        </>
      )}
      {group("schedule", "计划", [["all", "全部"], ["recurring", "定期"], ["once", "一次性"]])}
      <MenuSep />
      {group("status", "状态", [["all", "全部"], ["active", "已启用"], ["paused", "已暂停"], ["completed", "已完成"]])}
    </Popover>
  );
}

/** Sort (Sort): 下次运行 / 名称, then 包含已完成 with how many it hides. */
function SortMenu({ view, hidden, onChange }: { view: ListView; hidden: number; onChange(patch: Partial<ListView>): void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      anchor={<Button variant="ghost" icon={<Icon name="Sort" />} label="对定时任务排序" active={open} onClick={() => setOpen(!open)} />}
    >
      <MenuItem label="下次运行" checked={view.sort === "nextRun"} onClick={() => onChange({ sort: "nextRun" })} />
      <MenuItem label="名称" checked={view.sort === "name"} onClick={() => onChange({ sort: "name" })} />
      <MenuSep />
      <MenuItem
        toggle
        label="包含已完成"
        hint={hidden ? `已隐藏 ${hidden} 个已完成的定时任务` : undefined}
        checked={view.showCompleted}
        onClick={() => onChange({ showCompleted: !view.showCompleted })}
      />
    </Popover>
  );
}

/** A card's dot (cdbc75b4b Vr / rr): failed or waiting orange, running muted and pulsing, a new run blue. */
const DOT: Record<Mark, { kind: "blocked" | "running" | "unread"; label: string }> = {
  error: { kind: "blocked", label: "需要关注" },
  blocked: { kind: "blocked", label: "需要关注" },
  running: { kind: "running", label: "运行中" },
  unread: { kind: "unread", label: "新建运行" },
};

function Card({ card, starting, onRun, onDelete }: { card: TaskCard; starting: boolean; onRun(): void; onDelete(): void }) {
  const state = starting ? "正在启动…" : card.status === "completed" ? "已完成" : card.status === "paused" ? "已暂停" : "已启用";
  const schedule = !starting && card.status !== "completed";
  // Rr: past 280 characters, the first 279 and an ellipsis (the card clamps it to two lines besides).
  const description = card.description.length > 280 ? `${card.description.slice(0, 279)}…` : card.description;
  return (
    <li>
      <div data-grid-cell="" className="scheduled-card">
        <div className="scheduled-card-head">
          <button type="button" data-primary="" className="scheduled-card-title" onClick={() => patchScheduled({ task: { id: card.id, source: card.source } })}>
            {card.name}
          </button>
        </div>
        {card.mark && (
          <span className="scheduled-card-dot" data-dot={card.mark}>
            <StatusDot kind={DOT[card.mark].kind} />
            <span className="sr-only">{DOT[card.mark].label}</span>
          </span>
        )}
        {description && <div className="scheduled-card-desc">{description}</div>}
        <div className="scheduled-card-foot">
          {/* wr: the state word whole, the schedule after a · truncated. */}
          <span className="scheduled-card-state">
            <span>{state}</span>
            {schedule && <span className="truncate">{card.scheduleText}</span>}
          </span>
          {/* The card's title button covers it: its name is for screen readers only. */}
          <span className="scheduled-card-place">
            <Icon name={card.place.icon} size={12} />
            <span className="truncate" aria-hidden={card.source === "cloud" || undefined}>
              {card.place.label}
            </span>
            {card.source === "cloud" && <span className="sr-only">云端定时任务</span>}
          </span>
        </div>
        <div className="scheduled-card-menu">
          <CardMenu card={card} starting={starting} onRun={onRun} onDelete={onDelete} />
        </div>
      </div>
    </li>
  );
}

/** The ⋮ menu (cdbc75b4b Tr). */
function CardMenu({ card, starting, onRun, onDelete }: { card: TaskCard; starting: boolean; onRun(): void; onDelete(): void }) {
  const [open, setOpen] = useState(false);
  const act = (then: () => void) => () => {
    setOpen(false);
    then();
  };
  const paused = card.status === "paused";
  const pause = () => {
    const failed = fail(paused ? "无法启用计划。您可以重试。" : "无法暂停日程安排。您可以重试。");
    if (card.source === "cloud") void setCloudStatus(card.id, paused).catch(failed);
    else void setAutomationStatus(card.id, paused ? "ACTIVE" : "PAUSED").catch(failed);
  };
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      anchor={<Button variant="ghost" icon={<Icon name="DotsVertical" />} label={`${card.name} 的更多选项`} tip="" active={open} onClick={() => setOpen(!open)} />}
    >
      <MenuItem
        icon={<Icon name="Play" />}
        label="立即运行"
        title={card.runTip ?? undefined}
        disabled={!card.canRunNow || starting}
        onClick={act(onRun)}
      />
      {card.canPause && (
        <MenuItem
          icon={<Icon name={paused ? "Play" : "Pause"} />}
          label={paused ? "启用" : "暂停"}
          title={card.expired ? EXPIRED : undefined}
          disabled={card.expired}
          onClick={act(pause)}
        />
      )}
      {card.canEdit && <MenuItem icon={<Icon name="Edit" />} label="编辑" onClick={act(() => patchScheduled({ dialog: { type: "form", source: card.source, id: card.id, seed: null } }))} />}
      {card.canShare && <MenuItem icon={<Icon name="Link" />} label="分享" onClick={act(() => patchScheduled({ dialog: { type: "share", id: card.id } }))} />}
      {card.cwd && (
        <MenuItem
          icon={<Icon name="Projects" />}
          label="打开项目"
          onClick={act(() => {
            chooseFolder(card.cwd!);
            newChat();
          })}
        />
      )}
      {card.heartbeatThread && <MenuItem icon={<Icon name="ChatSimple" />} label="打开会话" onClick={act(() => void openThread(card.heartbeatThread!))} />}
      {card.canDelete && (
        <>
          <MenuSep />
          <MenuItem icon={<Icon name="Trash" />} label="删除" danger onClick={act(onDelete)} />
        </>
      )}
    </Popover>
  );
}

/** The cloud's suggestions last read, and for which account (another one reads its own). */
let suggested: { account: string; items: CloudSuggestion[] } | null = null;

/**
 * 推荐 (automations.scheduled.suggested.section.label): the ChatGPT app's local suggestions as
 * Claude's template rows (cdbc75b4b ei), each opening the form filled in; with the model's tools
 * (`tools`) the cloud's suggestions and the ChatGPT app's examples after them, each opening a session
 * that holds its prompt. Those wait while the cloud is being asked (`asking`) or its suggestions read,
 * not to show the examples and push them down.
 * ponytail: no 不感兴趣, which the ChatGPT app has for the server's suggestions.
 */
function Suggestions({ tools, asking }: { tools: boolean; asking: boolean }) {
  const access = useCloudAutomations((s) => s.access);
  // The account as the cloud's list tells them apart (a token refresh keeps it; a workspace does not).
  const account = useStore(({ account: a }) => (a?.account?.type === "chatgpt" ? `${a.account.email}:${a.account.planType}` : ""));
  const live = tools && access === "ok";
  const [read, setRead] = useState(suggested);
  // null: not read for this account yet.
  const cloud = read?.account === account ? read.items : null;
  useEffect(() => {
    if (!live) return;
    let current = true;
    cloudSuggestions().then(
      (items) => {
        suggested = { account, items };
        if (current) setRead(suggested);
      },
      // A failed read leaves what showed, else none (and the next visit asks again).
      () => current && setRead((shown) => (shown?.account === account ? shown : { account, items: [] })),
    );
    return () => {
      current = false;
    };
  }, [live, account]);
  const extra = asking || (live && cloud === null) ? [] : toolSuggestions(tools, live ? (cloud ?? []) : [], SUGGESTIONS.map((s) => s.name));
  return (
    <section className="plugins-section">
      <h3 className="plugins-section-title">
        <span className="plugins-section-name">推荐</span>
      </h3>
      <ul role="list" className="scheduled-suggestions">
        {SUGGESTIONS.map((item) => (
          <li key={item.id}>
            <button type="button" className="scheduled-suggestion" onClick={() => newLocal({ name: item.name, prompt: item.prompt, rrule: item.rrule })}>
              {/* Its glyph in the suggestion's color, Add under the pointer (ei). */}
              <span className="scheduled-suggestion-icon" style={{ color: item.color }} aria-hidden="true">
                <Icon name={item.icon} size={18} />
                <Icon name="Add" size={18} />
              </span>
              <span className="scheduled-suggestion-text">
                <span className="scheduled-suggestion-name">{item.name}</span>
                <span className="scheduled-suggestion-desc">{item.description}</span>
                <span className="scheduled-suggestion-when">{describeRrule(item.rrule)}</span>
              </span>
            </button>
          </li>
        ))}
        {extra.map((item) => (
          <li key={`codex:${item.id}`}>
            <button type="button" className="scheduled-suggestion" onClick={() => void askCodex(item.prompt)}>
              <span className="scheduled-suggestion-icon" aria-hidden="true">
                {item.emoji ? <span className="scheduled-suggestion-emoji">{item.emoji}</span> : <Icon name="ChatSimple" size={18} />}
                <Icon name="Add" size={18} />
              </span>
              <span className="scheduled-suggestion-text">
                <span className="scheduled-suggestion-name">{item.title || defaultName("", item.prompt)}</span>
                {item.description && <span className="scheduled-suggestion-desc">{item.description}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
