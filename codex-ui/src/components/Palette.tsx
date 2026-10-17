// Command palette (Ctrl/Cmd+K): jump to a thread or run an app command.

import {
  FlaskConical,
  FolderOpen,
  Gauge,
  MessageSquare,
  PanelLeft,
  ScanSearch,
  Search,
  Settings,
  SquarePen,
  SunMoon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { newChat, openThread } from "../lib/codex";
import { basename, threadTitle, timeAgo } from "../lib/format";
import { getState, setState, useStore } from "../lib/store";
import { saveTheme } from "./Settings";
import { Kbd } from "./ui";

interface Entry {
  id: string;
  icon: ReactNode;
  label: string;
  hint?: string;
  run(): void;
}

const COMMANDS: Entry[] = [
  { id: "new", icon: <SquarePen size={15} />, label: "新建会话", run: newChat },
  { id: "review", icon: <ScanSearch size={15} />, label: "审查代码改动", run: () => setState((s) => ({ dialog: { type: "review", threadId: s.activeId } })) },
  { id: "folder", icon: <FolderOpen size={15} />, label: "选择工作区…", run: () => setState({ dialog: { type: "folder" } }) },
  { id: "sidebar", icon: <PanelLeft size={15} />, label: "显示或隐藏侧栏", run: () => setState((s) => ({ sidebarOpen: !s.sidebarOpen })) },
  {
    id: "theme",
    icon: <SunMoon size={15} />,
    label: "切换浅色 / 深色",
    run: () => saveTheme(document.documentElement.classList.contains("dark") ? "light" : "dark"),
  },
  { id: "usage", icon: <Gauge size={15} />, label: "账户与用量", run: () => setState({ settings: "account" }) },
  { id: "labs", icon: <FlaskConical size={15} />, label: "实验功能", run: () => setState({ settings: "labs" }) },
  { id: "settings", icon: <Settings size={15} />, label: "打开设置", run: () => setState({ settings: "general" }) },
];

function PaletteDialog() {
  const threads = useStore((s) => s.threads);
  const ids = useStore((s) => s.list.ids);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const close = () => setState({ palette: false });

  const q = query.trim().toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(q);
  const recent: Entry[] = ids
    .map((id) => threads[id])
    .filter((thread) => thread && (!q || matches(threadTitle(thread.meta)) || matches(thread.meta.cwd)))
    .slice(0, q ? 20 : 8)
    .map((thread) => ({
      id: thread.meta.id,
      icon: <MessageSquare size={15} />,
      label: threadTitle(thread.meta),
      hint: `${basename(thread.meta.cwd)} · ${timeAgo(thread.meta.recencyAt ?? thread.meta.updatedAt)}`,
      run: () => void openThread(thread.meta.id),
    }));
  const commands = COMMANDS.filter((command) => !q || matches(command.label));
  const entries = [...recent, ...commands];

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const run = (entry: Entry | undefined) => {
    if (!entry) return;
    close();
    entry.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (entries.length) setSelected((index) => (index + (event.key === "ArrowDown" ? 1 : entries.length - 1)) % entries.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(entries[selected]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  const section = (title: string, items: Entry[], offset: number) =>
    items.length > 0 && (
      <>
        <div className="menu-section">{title}</div>
        {items.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            data-index={offset + index}
            className={`palette-item ${offset + index === selected ? "active" : ""}`}
            onMouseMove={() => setSelected(offset + index)}
            onClick={() => run(entry)}
          >
            <span className="palette-icon">{entry.icon}</span>
            <span className="palette-label">{entry.label}</span>
            {entry.hint && <span className="palette-hint">{entry.hint}</span>}
          </button>
        ))}
      </>
    );

  return (
    <div className="palette-backdrop" onPointerDown={(event) => event.target === event.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="搜索与命令">
        <label className="palette-search">
          <Search size={16} />
          <input autoFocus value={query} placeholder="搜索会话或命令…" onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} aria-label="搜索会话或命令" />
          <Kbd>Esc</Kbd>
        </label>
        <div className="palette-list" ref={list} role="listbox">
          {section(q ? "会话" : "最近的会话", recent, 0)}
          {section("命令", commands, recent.length)}
          {entries.length === 0 && <div className="menu-empty">没有匹配的结果</div>}
        </div>
      </div>
    </div>
  );
}

export function Palette() {
  const open = useStore((s) => s.palette);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setState({ palette: !getState().palette });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return open ? <PaletteDialog /> : null;
}
