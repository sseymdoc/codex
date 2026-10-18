// Main column (claude.ai audit W3, W4, W6): the chat header over the transcript and the
// composer dock, the new-session page, and the turn diff panel.

import type { ThreadGoal } from "@protocol/v2/ThreadGoal";
import type { ThreadGoalStatus } from "@protocol/v2/ThreadGoalStatus";
import {
  Archive,
  BookOpen,
  Bug,
  ChevronDown,
  Copy,
  Download,
  Eye,
  FileDiff,
  FlaskConical,
  GitFork,
  Goal,
  Minimize2,
  PanelRight,
  Pause,
  Play,
  ScanSearch,
  Trash2,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { archiveThread, clearGoal, compactThread, errorMessage, forkThread, loadTurns, setGoalStatus } from "../lib/codex";
import { filesStats, turnFiles } from "../lib/diff";
import { formatDuration, formatTokens, greeting, threadMarkdown, threadTitle } from "../lib/format";
import { VIEWS, type TranscriptView } from "../lib/session";
import { getState, setState, toast, updateThread, useStore, writePref, type ThreadState } from "../lib/store";
import { Approvals } from "./Approvals";
import { Composer, setComposerDraft } from "./Composer";
import { FileDiffCard } from "./content";
import { SidebarToggle } from "./Sidebar";
import { Transcript } from "./Transcript";
import { Button, MenuItem, MenuSep, Popover, Spark, StatusDot, Submenu, UsageRing } from "./ui";

const fail = (title: string) => (error: unknown) => toast("error", title, errorMessage(error));

export const VIEW_LABELS: Record<TranscriptView, string> = { normal: "标准", thinking: "思考", verbose: "详细" };

export const GOAL_LABELS: Record<ThreadGoalStatus, string> = {
  active: "进行中",
  paused: "已暂停",
  blocked: "受阻",
  usageLimited: "额度受限",
  budgetLimited: "预算用尽",
  complete: "已完成",
};

export function setThreadView(threadId: string, view: TranscriptView) {
  updateThread(threadId, (t) => ({ ...t, view }));
}

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
      className="menu-wide"
      anchor={
        <Button variant="ghost" size="sm" className="goal-pill" data-status={goal.status} tip={goal.objective} aria-expanded={open} onClick={() => setOpen(!open)}>
          {percent !== null ? <UsageRing value={percent} size={14} stroke={2} /> : <StatusDot kind={goal.status === "active" ? "running" : "idle"} />}
          目标 · {GOAL_LABELS[goal.status]}
        </Button>
      }
    >
      <div className="goal-card">
        <div className="goal-kicker">
          <Goal size={14} /> 目标
        </div>
        <div className="goal-objective">{goal.objective}</div>
        <dl className="goal-stats">
          <div>
            <dt>状态</dt>
            <dd>{GOAL_LABELS[goal.status]}</dd>
          </div>
          <div>
            <dt>已用</dt>
            <dd>
              {formatTokens(goal.tokensUsed)}
              {goal.tokenBudget ? ` / ${formatTokens(goal.tokenBudget)}` : ""}
            </dd>
          </div>
          <div>
            <dt>用时</dt>
            <dd>{goal.timeUsedSeconds ? formatDuration(goal.timeUsedSeconds * 1000) : "—"}</dd>
          </div>
        </dl>
      </div>
      <MenuSep />
      {goal.status === "active" ? (
        <MenuItem icon={<Pause size={16} />} label="暂停" onClick={act(() => setGoalStatus(threadId, "paused"), "暂停失败")} />
      ) : (
        goal.status !== "complete" && <MenuItem icon={<Play size={16} />} label="继续推进" onClick={act(() => setGoalStatus(threadId, "active"), "继续失败")} />
      )}
      <MenuItem icon={<X size={16} />} label="清除目标" danger onClick={act(() => clearGoal(threadId), "清除失败")} />
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

/** chat-header: absolute, 48 tall; the title split button, then the panes on the right. */
function ChatHeader({ thread }: { thread: ThreadState }) {
  const [menu, setMenu] = useState(false);
  const panel = useStore((s) => s.panel);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const defaultView = useStore((s) => s.defaultView);
  const goals = useStore((s) => s.features.some((feature) => feature.name === "goals" && feature.enabled));
  const { meta } = thread;
  const view = thread.view ?? defaultView;
  const cwd = thread.settings?.cwd ?? meta.cwd;
  const hasDiff = thread.turns.some((turn) => turnFiles(turn, cwd).length > 0);
  const act = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };
  return (
    <header className="chat-header">
      {!sidebarOpen && <SidebarToggle size="sm" />}
      <div className="title-split">
        <Button variant="ghost" size="sm" className="title-btn" tip="重命名" onClick={() => setState({ dialog: { type: "rename", threadId: meta.id } })}>
          <span className="btn-label">{threadTitle(meta)}</span>
        </Button>
        <Popover
          open={menu}
          onClose={() => setMenu(false)}
          placement="bottom-start"
          className="menu-wide"
          anchor={<Button variant="ghost" size="sm" icon={<ChevronDown size={16} />} label="会话菜单" aria-expanded={menu} onClick={() => setMenu(!menu)} />}
        >
          <Submenu icon={<Eye size={16} />} label="对话视图" value={VIEW_LABELS[view]} className="menu-model">
            {VIEWS.map((v) => (
              <MenuItem key={v} label={VIEW_LABELS[v]} kbd={v === view ? "Ctrl + O" : undefined} checked={v === view} onClick={act(() => setThreadView(meta.id, v))} />
            ))}
            {view !== defaultView && (
              <>
                <MenuSep />
                <MenuItem
                  label={`设为默认（${VIEW_LABELS[view]}）`}
                  onClick={act(() => {
                    writePref("codex-ui:view", view);
                    setState({ defaultView: view });
                  })}
                />
              </>
            )}
          </Submenu>
          <MenuSep />
          <MenuItem icon={<ScanSearch size={16} />} label="审查代码" kbd="/review" onClick={act(() => setState({ dialog: { type: "review", threadId: meta.id } }))} />
          <MenuItem icon={<Minimize2 size={16} />} label="压缩上下文" kbd="/compact" onClick={act(() => compactThread(meta.id).catch(fail("压缩失败")))} />
          <MenuItem icon={<GitFork size={16} />} label="创建分支会话" kbd="/fork" onClick={act(() => forkThread(meta.id).catch(fail("创建分支失败")))} />
          {goals && !thread.goal && <MenuItem icon={<Goal size={16} />} label="设定目标" kbd="/goal" onClick={act(() => setComposerDraft("/goal "))} />}
          <MenuItem icon={<Download size={16} />} label="导出为 Markdown" onClick={act(() => exportThread(meta.id).catch(fail("导出失败")))} />
          <MenuItem
            icon={<Copy size={16} />}
            label="复制会话 ID"
            onClick={act(() => {
              void navigator.clipboard.writeText(meta.id);
              toast("success", "已复制会话 ID");
            })}
          />
          <MenuSep />
          <MenuItem icon={<Archive size={16} />} label="归档" onClick={act(() => archiveThread(meta.id).catch(fail("归档失败")))} />
          <MenuItem icon={<Trash2 size={16} />} label="删除" danger onClick={act(() => setState({ dialog: { type: "delete", threadId: meta.id } }))} />
        </Popover>
      </div>
      <span className="spacer" />
      {thread.goal && <GoalPill threadId={meta.id} goal={thread.goal} />}
      {hasDiff && (
        <Button
          variant="ghost"
          size="sm"
          icon={<FileDiff size={18} />}
          label="查看改动"
          kbd="Ctrl+Shift+D"
          active={panel === "diff"}
          aria-pressed={panel === "diff"}
          onClick={() => setState({ panel: panel === "diff" ? null : "diff" })}
        />
      )}
      <Button
        variant="ghost"
        size="sm"
        icon={<PanelRight size={18} />}
        label="会话详情"
        active={panel === "details"}
        aria-pressed={panel === "details"}
        onClick={() => setState({ panel: panel === "details" ? null : "details" })}
      />
    </header>
  );
}

export function ThreadView({ thread }: { thread: ThreadState }) {
  const cwd = thread.settings?.cwd ?? thread.meta.cwd;
  return (
    <div className="main-col">
      <ChatHeader thread={thread} />
      <Transcript thread={thread} />
      <div className="dock">
        <Approvals threadId={thread.meta.id} cwd={cwd} />
        <Composer threadId={thread.meta.id} form="reply" autoFocus />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New session page

const STARTERS: { icon: ReactNode; label: string; hint: string; text?: string }[] = [
  {
    icon: <BookOpen size={18} />,
    label: "讲解这个代码库",
    hint: "整体架构、主要模块与协作方式",
    text: "请概述这个代码库：整体架构、主要模块，以及它们之间如何协作。",
  },
  {
    icon: <Bug size={18} />,
    label: "找出并修复一个 bug",
    hint: "挑出最重要的问题，修好并解释",
    text: "检查这个项目里可能存在的 bug，挑出最重要的一个修复它，并解释原因。",
  },
  {
    icon: <FlaskConical size={18} />,
    label: "补充测试",
    hint: "为最近的改动写测试并运行",
    text: "为最近改动的代码补充单元测试，并运行它们确认通过。",
  },
  { icon: <ScanSearch size={18} />, label: "审查代码改动", hint: "以审查者的视角列出问题与建议" },
];

export function Welcome() {
  const account = useStore((s) => s.account?.account);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const cwd = useStore((s) => s.prefs.cwd);
  const name = account?.type === "chatgpt" && account.email ? account.email.split("@")[0] : null;
  return (
    <div className="main-col">
      <header className="chat-header">{!sidebarOpen && <SidebarToggle size="sm" />}</header>
      <div className="welcome">
        <h1 className="greeting">
          <Spark className="greeting-mark" />
          <span>
            {greeting()}
            {name ? `，${name}` : ""}
          </span>
        </h1>
        <div className="home-composer">
          <Approvals threadId={null} cwd={cwd} />
          <Composer threadId={null} form="home" autoFocus />
        </div>
        <div className="starters">
          {STARTERS.map((starter) => (
            <button
              key={starter.label}
              type="button"
              className="sheet-card"
              data-sheet-kind="starter"
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
  const cwd = thread.settings?.cwd ?? thread.meta.cwd;
  const turns = thread.turns.filter((turn) => turnFiles(turn, cwd).length > 0);
  const [selected, setSelected] = useState<string | null>(null);
  const turn = turns.find((t) => t.id === selected) ?? turns.at(-1);
  const files = turn ? turnFiles(turn, cwd) : [];
  const stats = files.length ? filesStats(files) : null;
  return (
    <aside className="side-panel" aria-label="改动">
      <div className="side-head">
        <span className="side-title">改动</span>
        {stats && (
          <span className="diff-stat">
            <span className="plus">+{stats.added}</span>
            <span className="minus">−{stats.removed}</span>
          </span>
        )}
        <span className="spacer" />
        <Button variant="ghost" size="sm" muted icon={<X size={16} />} label="关闭" onClick={() => setState({ panel: null })} />
      </div>
      {turns.length > 1 && (
        <div className="side-turns">
          {turns.map((t, index) => (
            <Button key={t.id} variant={t === turn ? "secondary" : "ghost"} size="xs" ink2={t !== turn} onClick={() => setSelected(t.id)}>
              第 {thread.turns.indexOf(t) + 1} 轮{index === turns.length - 1 ? "（最新）" : ""}
            </Button>
          ))}
        </div>
      )}
      <div className="side-body scroll-fade-y">
        {files.length === 0 && <div className="side-empty">这个会话还没有文件改动</div>}
        {files.map((file) => (
          <FileDiffCard key={file.path} file={file} defaultOpen={files.length <= 4} />
        ))}
      </div>
    </aside>
  );
}
