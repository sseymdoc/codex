// The 定时任务 page: Claude 4.29 Code's /epitaxy/scheduled (cbd6c85c8 vd / ad: the page shell
// cd75b47e6, the grid $u, cards cdbc75b4b Yr / Tr over cf8745532 u) holding the ChatGPT app's local
// scheduled tasks (lib/automations.ts). The route (store scheduledRoute) holds the open task, whose
// page is ScheduledDetail, and the dialog over either (ScheduledForm: new and edit).

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_SCHEDULE, describeRrule, rruleOf } from "../../context/rrule.mjs";
import { deleteAutomation, refreshAutomations, runNow, setAutomationStatus, useAutomations, type Automation } from "../lib/automations";
import { ensureThreads, errorMessage, fail, newChat, openThread, patchScheduled } from "../lib/codex";
import { DEFAULT_VIEW, filterCount, localCard, viewCards, type ListView, type Mark, type TaskCard } from "../lib/scheduled-view";
import { getState, toast, useStore, type ScheduledSeed } from "../lib/store";
import { chooseFolder } from "./Composer";
import { quietMenu, useLiftSlot } from "./Main";
import { ScheduledDetail } from "./ScheduledDetail";
import { ScheduledForm } from "./ScheduledForm";
import { Confirm } from "./Settings";
import { Button, Icon, MenuItem, MenuSection, MenuSep, Popover, Skeleton, StatusDot, type IconName } from "./ui";

const DESKTOP = typeof window !== "undefined" && !!window.codexDesktop;

/** sOxe0GRL7O, with when a local task cannot run here: Codex closed, or (in a browser) this page closed. */
const KEEP_AWAKE = `本地定时任务仅在您的电脑处于唤醒状态且联网时运行，${DESKTOP ? "Codex 关闭期间不会运行。" : "且需要保持此页面打开。"}`;

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
 * onSuccess): a cron task's page, a heartbeat's session (which reads its setup reply there).
 */
function opened(created: Automation) {
  if (created.kind === "heartbeat" && created.targetThreadId) void openThread(created.targetThreadId);
  else patchScheduled({ task: { id: created.id, source: "local" }, dialog: null });
}

export function ScheduledView() {
  const route = useStore((s) => s.scheduledRoute) ?? { task: null, dialog: null };
  const task = route.task;
  const name = useAutomations((s) => (task?.source === "local" ? (s.items?.find((a) => a.id === task.id)?.name ?? null) : null));
  // Claude's "<name> | Claude" on a task's page.
  useEffect(() => {
    document.title = `${task && name ? name : "定时任务"} - Codex`;
  }, [task, name]);
  // Coming to the page reads the tasks again: another process may have changed them unannounced.
  useEffect(() => void refreshAutomations(), []);
  return (
    // A task not (yet) found has no name to show: 定时任务 alone, its page offering the way back.
    <ScheduledFrame trail={task && name ? name : null}>
      {task ? <ScheduledDetail key={`${task.source}:${task.id}`} task={task} /> : <ScheduledList />}
      {route.dialog?.type === "form" && <ScheduledForm dialog={route.dialog} onClose={(created) => (created ? opened(created) : patchScheduled({ dialog: null }))} />}
    </ScheduledFrame>
  );
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
  const threads = useStore((s) => s.threads);
  const projects = useStore((s) => s.projects);
  // ponytail: the search, filters and sort live as long as the list does (Claude keeps them in the URL).
  const [view, setView] = useState<ListView>(DEFAULT_VIEW);
  const [starting, setStarting] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState<TaskCard | null>(null);
  const cards = useMemo(() => (items ?? []).map((t) => localCard(t, runs, threads, projects)), [items, runs, threads, projects]);
  const { shown, hiddenCompleted } = useMemo(() => viewCards(cards, view), [cards, view]);
  // A heartbeat's card names its session, which the sidebar may not have listed.
  useEffect(() => {
    const ids = (items ?? []).flatMap((t) => (t.kind === "heartbeat" && t.targetThreadId && !getState().threads[t.targetThreadId] ? [t.targetThreadId] : []));
    if (ids.length) void ensureThreads(ids);
  }, [items]);
  const patch = (next: Partial<ListView>) => setView((current) => ({ ...current, ...next }));
  const query = view.query.trim();
  const filtered = filterCount(view) > 0;
  const run = (card: TaskCard) => {
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
      <FilterMenu view={view} onChange={patch} />
      <SortMenu view={view} hidden={hiddenCompleted} onChange={patch} />
      <Button variant="primary" icon={<Icon name="Add" size="sm" />} onClick={() => newLocal()}>
        新建任务
      </Button>
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
  } else if (items === null) {
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
  } else if (!items.length) {
    // ponytail: no ca0c38004 stopwatch drawing over it; that is Claude Desktop's artwork, read off the
    // install as claude-marks.mjs does the working mark, should the page want it.
    body = (
      <div className="plugins-empty">
        <p className="plugins-empty-title">暂无定时任务。</p>
        <Button variant="primary" size="sm" icon={<Icon name="Add" size="sm" />} onClick={() => newLocal()}>
          新建任务
        </Button>
      </div>
    );
  } else if (!shown.length) {
    // Only completed tasks left out: ad says so and offers no 清除 (its gn kind "completed").
    body = (
      <div className="plugins-empty">
        <p className="plugins-note">
          {hiddenCompleted ? `已隐藏 ${hiddenCompleted} 个已完成的定时任务` : query && filtered ? "没有与您的搜索和筛选条件匹配的定时任务。" : query ? "没有与您的搜索匹配的定时任务。" : "没有符合这些筛选条件的定时任务。"}
        </p>
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
      {!!items?.length && (
        <p className="scheduled-banner">
          <Icon name="Info" size="sm" />
          <span>{KEEP_AWAKE}</span>
        </p>
      )}
      {/* The live search's count for screen readers (live: shared-140 qt statusNoMatch / statusMatching). */}
      <p role="status" className="sr-only">
        {items && query ? (shown.length ? `${shown.length} 个定时任务与“${query}”匹配` : `没有与“${query}”匹配的定时任务`) : ""}
      </p>
      {body}
      {items !== null && !query && !filtered && <Suggestions />}
      {deleting && (
        <Confirm
          title="删除定时任务？"
          description={`删除“${deleting.name}”？这将永久删除定时任务，并停止日后的运行。`}
          confirm="删除"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => deleteAutomation(deleting.id).catch(fail("无法删除定时任务。请重试。"))}
        />
      )}
    </>
  );
}

/** Filter (cbd6c85c8 Su): 计划 and 状态; 运行于 (全部 / 本地 / 云端) joins them with cloud tasks. */
function FilterMenu({ view, onChange }: { view: ListView; onChange(patch: Partial<ListView>): void }) {
  const [open, setOpen] = useState(false);
  const count = filterCount(view);
  const label = count ? `筛选定时任务，已启用 ${count} 个筛选条件` : "筛选定时任务";
  const group = <K extends "schedule" | "status">(key: K, title: string, options: [ListView[K], string][]) => (
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
          <span className="scheduled-card-place">
            <Icon name={card.place.icon} size={12} />
            <span className="truncate">{card.place.label}</span>
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
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      anchor={<Button variant="ghost" icon={<Icon name="DotsVertical" />} label={`${card.name} 的更多选项`} tip="" active={open} onClick={() => setOpen(!open)} />}
    >
      <MenuItem icon={<Icon name="Play" />} label="立即运行" disabled={!card.canRunNow || starting} onClick={act(onRun)} />
      {card.status !== "completed" && (
        <MenuItem
          icon={<Icon name={paused ? "Play" : "Pause"} />}
          label={paused ? "启用" : "暂停"}
          onClick={act(() => void setAutomationStatus(card.id, paused ? "ACTIVE" : "PAUSED").catch(fail(paused ? "无法启用计划。您可以重试。" : "无法暂停日程安排。您可以重试。")))}
        />
      )}
      {card.canEdit && <MenuItem icon={<Icon name="Edit" />} label="编辑" onClick={act(() => patchScheduled({ dialog: { type: "form", source: card.source, id: card.id, seed: null } }))} />}
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

/**
 * 推荐 (automations.scheduled.suggested.section.label): the ChatGPT app's local suggestions as
 * Claude's template rows (cdbc75b4b ei), each opening the form filled in.
 * ponytail: no 不感兴趣 for them, as the ChatGPT app has for the server's suggestions only.
 */
function Suggestions() {
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
      </ul>
    </section>
  );
}
