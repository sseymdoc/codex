// Main column: thread header + transcript + approvals + composer, the welcome
// screen for new chats, and the turn diff side panel.

import {
  Archive,
  Check,
  ChevronDown,
  Copy,
  FileDiff,
  Folder,
  FolderOpen,
  GitBranch,
  GitFork,
  Minimize2,
  MoreHorizontal,
  PanelLeftOpen,
  ScanSearch,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { archiveThread, compactThread, errorMessage, forkThread, refreshConfig } from "../lib/codex";
import { basename, diffStats, greeting, samePath, threadTitle } from "../lib/format";
import { setState, toast, useStore, type ThreadState } from "../lib/store";
import { Approvals } from "./Approvals";
import { Composer } from "./Composer";
import { splitUnifiedDiff } from "../lib/diff";
import { FileDiffCard } from "./content";
import { Transcript } from "./Transcript";
import { MenuItem, MenuSection, Popover } from "./ui";

function SidebarToggle() {
  const open = useStore((s) => s.sidebarOpen);
  if (open) return null;
  return (
    <button type="button" className="icon-btn" aria-label="展开侧栏" title="展开侧栏" onClick={() => setState({ sidebarOpen: true })}>
      <PanelLeftOpen size={16} />
    </button>
  );
}

function ThreadHeader({ thread }: { thread: ThreadState }) {
  const [menu, setMenu] = useState(false);
  const panel = useStore((s) => s.panel);
  const { meta } = thread;
  const cwd = thread.settings?.cwd ?? meta.cwd;
  const hasDiff = thread.turns.some((turn) => turn.diff);
  const fail = (title: string) => (error: unknown) => toast("error", title, errorMessage(error));
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
        <span className="head-chip" title={meta.gitInfo.sha ?? undefined}>
          <GitBranch size={13} /> {meta.gitInfo.branch}
        </span>
      )}
      <span className="head-spacer" />
      {hasDiff && (
        <button
          type="button"
          className={`icon-btn ${panel === "diff" ? "active" : ""}`}
          title="查看改动"
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
          <button type="button" className="icon-btn" aria-label="会话操作" onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={16} />
          </button>
        }
      >
        <MenuItem icon={<ScanSearch size={14} />} label="审查代码" hint="/review" onClick={act(() => setState({ dialog: { type: "review", threadId: meta.id } }))} />
        <MenuItem icon={<Minimize2 size={14} />} label="压缩上下文" hint="/compact" onClick={act(() => compactThread(meta.id).catch(fail("压缩失败")))} />
        <MenuItem icon={<GitFork size={14} />} label="创建副本" hint="/fork" onClick={act(() => forkThread(meta.id).catch(fail("创建副本失败")))} />
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
  return (
    <div className="main-col">
      <ThreadHeader thread={thread} />
      <Transcript thread={thread} />
      <div className="dock">
        <Approvals threadId={thread.meta.id} cwd={cwd} />
        <Composer threadId={thread.meta.id} autoFocus />
        <div className="dock-note">Codex 可能会出错，请检查重要的改动。</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Welcome

const SUGGESTIONS = [
  { label: "讲解这个代码库", text: "请概述这个代码库：整体架构、主要模块，以及它们之间如何协作。" },
  { label: "找出并修复一个 bug", text: "检查这个项目里可能存在的 bug，挑出最重要的一个修复它，并解释原因。" },
  { label: "补充测试", text: "为最近改动的代码补充单元测试，并运行它们确认通过。" },
];

export function setComposerDraft(text: string) {
  window.dispatchEvent(new CustomEvent("composer-draft", { detail: text }));
}

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
          {greeting()}
          {name ? `，${name}` : ""}
        </h1>
        <div className="welcome-workspace">
          <WorkspacePicker />
        </div>
        <div className="welcome-composer">
          <Approvals threadId={null} cwd={cwd} />
          <Composer threadId={null} autoFocus />
        </div>
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s.label} type="button" className="suggestion" onClick={() => setComposerDraft(s.text)}>
              {s.label}
            </button>
          ))}
          <button type="button" className="suggestion" onClick={() => setState({ dialog: { type: "review", threadId: null } })}>
            <ScanSearch size={13} /> 审查代码改动
          </button>
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
