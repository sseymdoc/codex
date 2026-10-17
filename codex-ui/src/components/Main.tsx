// Main column: thread header + transcript under the floating dock (approvals +
// composer), the welcome screen for new chats, and the turn diff side panel.

import type { ThreadGoal } from "@protocol/v2/ThreadGoal";
import type { ThreadGoalStatus } from "@protocol/v2/ThreadGoalStatus";
import {
  Archive,
  BookOpen,
  Bug,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileDiff,
  FlaskConical,
  Folder,
  FolderOpen,
  GitBranch,
  GitFork,
  Goal,
  Minimize2,
  MoreHorizontal,
  PanelLeftOpen,
  Pause,
  Play,
  ScanSearch,
  Trash2,
  X,
} from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { archiveThread, clearGoal, compactThread, errorMessage, forkThread, loadTurns, refreshConfig, setGoalStatus } from "../lib/codex";
import { splitUnifiedDiff } from "../lib/diff";
import { basename, diffStats, formatDuration, formatTokens, greeting, samePath, threadMarkdown, threadTitle } from "../lib/format";
import { getState, setState, toast, useStore, type ThreadState } from "../lib/store";
import { Approvals } from "./Approvals";
import { Composer } from "./Composer";
import { FileDiffCard } from "./content";
import { Transcript } from "./Transcript";
import { MenuItem, MenuSection, Popover, StatusDot, UsageRing } from "./ui";

const fail = (title: string) => (error: unknown) => toast("error", title, errorMessage(error));

export function setComposerDraft(text: string) {
  window.dispatchEvent(new CustomEvent("composer-draft", { detail: text }));
}

function SidebarToggle() {
  const open = useStore((s) => s.sidebarOpen);
  if (open) return null;
  return (
    <button type="button" className="icon-btn" aria-label="展开侧栏" title="展开侧栏" onClick={() => setState({ sidebarOpen: true })}>
      <PanelLeftOpen size={16} />
    </button>
  );
}

const GOAL_LABELS: Record<ThreadGoalStatus, string> = {
  active: "进行中",
  paused: "已暂停",
  blocked: "受阻",
  usageLimited: "额度受限",
  budgetLimited: "预算用尽",
  complete: "已完成",
};

function GoalPill({ threadId, goal }: { threadId: string; goal: ThreadGoal }) {
  const [open, setOpen] = useState(false);
  const percent = goal.tokenBudget ? (goal.tokensUsed / goal.tokenBudget) * 100 : null;
  const act = (run: () => Promise<void>, title: string) => () => {
    setOpen(false);
    run().catch(fail(title));
  };
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      className="menu menu-wide"
      anchor={
        <button type="button" className="goal-pill" data-status={goal.status} title={goal.objective} onClick={() => setOpen(!open)}>
          {percent !== null ? (
            <UsageRing value={percent} size={14} stroke={2} />
          ) : (
            <StatusDot kind={goal.status === "active" ? "running" : goal.status === "complete" ? "ready" : "idle"} />
          )}
          <span>目标 · {GOAL_LABELS[goal.status]}</span>
        </button>
      }
    >
      <div className="goal-card">
        <div className="goal-kicker">
          <Goal size={13} /> 目标
        </div>
        <div className="goal-objective">{goal.objective}</div>
        <dl className="goal-stats">
          <div>
            <dt>状态</dt>
            <dd>{GOAL_LABELS[goal.status]}</dd>
          </div>
          <div>
            <dt>已用</dt>
            <dd className="tabular">
              {formatTokens(goal.tokensUsed)}
              {goal.tokenBudget ? ` / ${formatTokens(goal.tokenBudget)}` : ""}
            </dd>
          </div>
          <div>
            <dt>用时</dt>
            <dd className="tabular">{goal.timeUsedSeconds ? formatDuration(goal.timeUsedSeconds * 1000) : "—"}</dd>
          </div>
        </dl>
      </div>
      <div className="menu-sep" />
      {goal.status === "active" ? (
        <MenuItem icon={<Pause size={14} />} label="暂停" onClick={act(() => setGoalStatus(threadId, "paused"), "暂停失败")} />
      ) : (
        goal.status !== "complete" && <MenuItem icon={<Play size={14} />} label="继续推进" onClick={act(() => setGoalStatus(threadId, "active"), "继续失败")} />
      )}
      <MenuItem icon={<X size={14} />} label="清除目标" danger onClick={act(() => clearGoal(threadId), "清除失败")} />
    </Popover>
  );
}

/** Downloads the whole thread, paging in older turns first. */
async function exportThread(id: string): Promise<void> {
  while (getState().threads[id]?.olderCursor) await loadTurns(id, true);
  const thread = getState().threads[id];
  if (!thread) return;
  const title = threadTitle(thread.meta);
  const url = URL.createObjectURL(new Blob([threadMarkdown(title, thread.turns)], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.replace(/[\\/:*?"<>|\s]+/g, " ").trim().slice(0, 80) || "codex"}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

function ThreadHeader({ thread }: { thread: ThreadState }) {
  const [menu, setMenu] = useState(false);
  const panel = useStore((s) => s.panel);
  const goals = useStore((s) => s.features.some((feature) => feature.name === "goals" && feature.enabled));
  const { meta } = thread;
  const cwd = thread.settings?.cwd ?? meta.cwd;
  const hasDiff = thread.turns.some((turn) => turn.diff);
  const act = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };
  return (
    <header className="main-head">
      <SidebarToggle />
      <button type="button" className="head-title" title="重命名" onClick={() => setState({ dialog: { type: "rename", threadId: meta.id } })}>
        {threadTitle(meta)}
      </button>
      <span className="head-chip" title={cwd}>
        <Folder size={13} /> {basename(cwd)}
      </span>
      {meta.gitInfo?.branch && (
        <span className="head-chip mono" title={meta.gitInfo.sha ?? undefined}>
          <GitBranch size={13} /> {meta.gitInfo.branch}
        </span>
      )}
      <span className="head-spacer" />
      {thread.goal && <GoalPill threadId={meta.id} goal={thread.goal} />}
      {hasDiff && (
        <button
          type="button"
          className={`icon-btn ${panel === "diff" ? "active" : ""}`}
          title="查看改动"
          aria-label="查看改动"
          aria-pressed={panel === "diff"}
          onClick={() => setState({ panel: panel === "diff" ? null : "diff" })}
        >
          <FileDiff size={16} />
        </button>
      )}
      <Popover
        open={menu}
        onClose={() => setMenu(false)}
        placement="bottom-end"
        className="menu"
        anchor={
          <button type="button" className="icon-btn" aria-label="会话操作" title="会话操作" onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={16} />
          </button>
        }
      >
        <MenuItem icon={<ScanSearch size={14} />} label="审查代码" hint="/review" onClick={act(() => setState({ dialog: { type: "review", threadId: meta.id } }))} />
        <MenuItem icon={<Minimize2 size={14} />} label="压缩上下文" hint="/compact" onClick={act(() => compactThread(meta.id).catch(fail("压缩失败")))} />
        <MenuItem icon={<GitFork size={14} />} label="创建副本" hint="/fork" onClick={act(() => forkThread(meta.id).catch(fail("创建副本失败")))} />
        {goals && !thread.goal && <MenuItem icon={<Goal size={14} />} label="设定目标" hint="/goal" onClick={act(() => setComposerDraft("/goal "))} />}
        <MenuItem icon={<Download size={14} />} label="导出为 Markdown" onClick={act(() => exportThread(meta.id).catch(fail("导出失败")))} />
        <MenuItem
          icon={<Copy size={14} />}
          label="复制会话 ID"
          hint={meta.id.slice(0, 13)}
          onClick={act(() => {
            void navigator.clipboard.writeText(meta.id);
            toast("success", "已复制会话 ID");
          })}
        />
        <div className="menu-sep" />
        <MenuItem icon={<Archive size={14} />} label="归档" onClick={act(() => archiveThread(meta.id).catch(fail("归档失败")))} />
        <MenuItem icon={<Trash2 size={14} />} label="删除" danger onClick={act(() => setState({ dialog: { type: "delete", threadId: meta.id } }))} />
      </Popover>
    </header>
  );
}

export function ThreadView({ thread }: { thread: ThreadState }) {
  const cwd = thread.settings?.cwd ?? thread.meta.cwd;
  const dock = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(0);
  const [reading, setReading] = useState(false);
  // The transcript scrolls under the dock; its padding and the scrim track the dock's height.
  useLayoutEffect(() => {
    const el = dock.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setDockHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="main-col">
      <ThreadHeader thread={thread} />
      <div className="thread-body" style={{ "--dock-h": `${dockHeight}px` } as CSSProperties}>
        <Transcript thread={thread} onReading={setReading} />
        <div className="fc-scrim" aria-hidden="true" />
        <div className="dock" ref={dock}>
          <Approvals threadId={thread.meta.id} cwd={cwd} />
          <Composer threadId={thread.meta.id} autoFocus reading={reading} />
          <div className="dock-note">Codex 可能会出错，请检查重要的改动。</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Welcome

const STARTERS: { icon: ReactNode; label: string; hint: string; text?: string }[] = [
  {
    icon: <BookOpen size={16} />,
    label: "讲解这个代码库",
    hint: "整体架构、主要模块与协作方式",
    text: "请概述这个代码库：整体架构、主要模块，以及它们之间如何协作。",
  },
  {
    icon: <Bug size={16} />,
    label: "找出并修复一个 bug",
    hint: "挑出最重要的问题，修好并解释",
    text: "检查这个项目里可能存在的 bug，挑出最重要的一个修复它，并解释原因。",
  },
  {
    icon: <FlaskConical size={16} />,
    label: "补充测试",
    hint: "为最近的改动写测试并运行",
    text: "为最近改动的代码补充单元测试，并运行它们确认通过。",
  },
  { icon: <ScanSearch size={16} />, label: "审查代码改动", hint: "以审查者的视角列出问题与建议" },
];

function WorkspacePicker() {
  const cwd = useStore((s) => s.prefs.cwd);
  const threads = useStore((s) => s.threads);
  const [open, setOpen] = useState(false);
  const recent = useMemo(() => {
    const seen = new Map<string, number>();
    for (const { meta } of Object.values(threads)) {
      if (meta.parentThreadId) continue;
      seen.set(meta.cwd, Math.max(seen.get(meta.cwd) ?? 0, meta.recencyAt ?? meta.updatedAt));
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([path]) => path).slice(0, 6);
  }, [threads]);
  const choose = (path: string) => {
    setOpen(false);
    setState((s) => ({ prefs: { ...s.prefs, cwd: path } }));
    void refreshConfig();
  };
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-start"
      className="menu menu-wide"
      anchor={
        <button type="button" className="workspace-chip" title={cwd} onClick={() => setOpen(!open)}>
          <FolderOpen size={14} />
          <span>{basename(cwd) || "选择工作区"}</span>
          <ChevronDown size={12} className="chin-caret" />
        </button>
      }
    >
      <MenuSection title="最近的工作区" />
      {recent.map((path) => (
        <MenuItem key={path} icon={<Folder size={14} />} label={basename(path)} hint={path} checked={samePath(path, cwd)} onClick={() => choose(path)} />
      ))}
      {recent.length === 0 && <div className="menu-empty">暂无记录</div>}
      <MenuItem
        icon={<FolderOpen size={14} />}
        label="选择其他文件夹…"
        onClick={() => {
          setOpen(false);
          setState({ dialog: { type: "folder" } });
        }}
      />
    </Popover>
  );
}

export function Welcome() {
  const account = useStore((s) => s.account?.account);
  const name = account?.type === "chatgpt" && account.email ? account.email.split("@")[0] : null;
  const cwd = useStore((s) => s.prefs.cwd);
  return (
    <div className="main-col">
      <header className="main-head main-head-bare">
        <SidebarToggle />
      </header>
      <div className="welcome">
        <h1 className="welcome-title">
          <img src="/favicon.svg" alt="" width={34} height={34} className="welcome-mark" />
          <span>
            {greeting()}
            {name ? `，${name}` : ""}
          </span>
        </h1>
        <div className="welcome-workspace">
          <WorkspacePicker />
        </div>
        <div className="welcome-composer">
          <Approvals threadId={null} cwd={cwd} />
          <Composer threadId={null} autoFocus />
        </div>
        <div className="starters">
          {STARTERS.map((starter) => (
            <button
              key={starter.label}
              type="button"
              className="sheet-card"
              onClick={() => (starter.text ? setComposerDraft(starter.text) : setState({ dialog: { type: "review", threadId: null } }))}
            >
              <span className="sheet-card-under" aria-hidden="true" />
              <span className="sheet-card-page">
                <span className="sheet-card-icon">{starter.icon}</span>
                <span className="sheet-card-title">{starter.label}</span>
                <span className="sheet-card-hint">{starter.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff panel

export function DiffPanel({ thread }: { thread: ThreadState }) {
  const turns = thread.turns.filter((turn) => turn.diff);
  const [selected, setSelected] = useState<string | null>(null);
  const turn = turns.find((t) => t.id === selected) ?? turns.at(-1);
  const files = useMemo(() => (turn?.diff ? splitUnifiedDiff(turn.diff) : []), [turn?.diff]);
  const stats = turn?.diff ? diffStats(turn.diff) : null;
  return (
    <aside className="side-panel" aria-label="改动">
      <div className="side-head">
        <FileDiff size={15} />
        <span className="side-title">改动</span>
        {stats && (
          <span className="diff-stat">
            <span className="plus">+{stats.added}</span>
            <span className="minus">-{stats.removed}</span>
          </span>
        )}
        <span className="head-spacer" />
        <button type="button" className="icon-btn icon-btn-sm" aria-label="关闭" onClick={() => setState({ panel: null })}>
          <X size={15} />
        </button>
      </div>
      {turns.length > 1 && (
        <div className="side-turns">
          {turns.map((t, index) => (
            <button key={t.id} type="button" className={`chip-btn ${t === turn ? "active" : ""}`} onClick={() => setSelected(t.id)}>
              {t === turn && <Check size={12} />}第 {thread.turns.indexOf(t) + 1} 轮{index === turns.length - 1 ? "（最新）" : ""}
            </button>
          ))}
        </div>
      )}
      <div className="side-body">
        {files.length === 0 && <div className="side-empty">这个会话还没有文件改动</div>}
        {files.map((file) => (
          <FileDiffCard key={file.path} file={file} defaultOpen={files.length <= 4} />
        ))}
      </div>
    </aside>
  );
}
