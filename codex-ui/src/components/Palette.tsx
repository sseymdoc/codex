// Search (Ctrl K): sessions by title, searched on the server, and app commands.

import {
  Archive,
  FlaskConical,
  FolderOpen,
  Gauge,
  MessageSquare,
  PanelLeft,
  PanelRight,
  ScanSearch,
  Search,
  Settings,
  SquarePen,
  SunMoon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { newChat, openThread, searchThreads, setListFilter } from "../lib/codex";
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
  { id: "new", icon: <SquarePen size={16} />, label: "新建会话", hint: "Ctrl + Shift + O", run: newChat },
  { id: "review", icon: <ScanSearch size={16} />, label: "审查代码改动", run: () => setState((s) => ({ dialog: { type: "review", threadId: s.activeId } })) },
  { id: "folder", icon: <FolderOpen size={16} />, label: "选择项目文件夹…", run: () => setState({ dialog: { type: "folder" } }) },
  { id: "details", icon: <PanelRight size={16} />, label: "显示或隐藏会话详情", run: () => setState((s) => ({ panel: s.panel === "details" ? null : "details" })) },
  { id: "sidebar", icon: <PanelLeft size={16} />, label: "显示或隐藏侧栏", hint: "Ctrl + B", run: () => setState((s) => ({ sidebarOpen: !s.sidebarOpen })) },
  { id: "archive", icon: <Archive size={16} />, label: "查看已归档的会话", run: () => setListFilter({ archived: true }) },
  {
    id: "theme",
    icon: <SunMoon size={16} />,
    label: "切换浅色 / 深色",
    run: () => saveTheme(document.documentElement.classList.contains("dark") ? "light" : "dark"),
  },
  { id: "usage", icon: <Gauge size={16} />, label: "账户与用量", run: () => setState({ settings: "account" }) },
  { id: "labs", icon: <FlaskConical size={16} />, label: "实验功能", run: () => setState({ settings: "labs" }) },
  { id: "settings", icon: <Settings size={16} />, label: "打开设置", hint: "Ctrl + ,", run: () => setState({ settings: "general" }) },
];

function PaletteDialog() {
  const threads = useStore((s) => s.threads);
  const ids = useStore((s) => s.list.ids);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<string[] | null>(null);
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const close = () => setState({ palette: false });

  const q = query.trim().toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(q);

  // Titles are searched on the server, so sessions beyond the loaded list show up too.
  useEffect(() => {
    if (!q) {
      setFound(null);
      return;
    }
    const timer = setTimeout(() => {
      searchThreads(q)
        .then((data) => setFound(data.map((thread) => thread.id)))
        .catch(() => setFound(null));
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  const sessionIds = q ? (found ?? ids.filter((id) => threads[id] && (matches(threadTitle(threads[id].meta)) || matches(threads[id].meta.cwd)))) : ids.slice(0, 8);
  const recent: Entry[] = sessionIds
    .map((id) => threads[id])
    .filter(Boolean)
    .slice(0, 20)
    .map((thread) => ({
      id: thread.meta.id,
      icon: <MessageSquare size={16} />,
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
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
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
    <div className="dialog-backdrop" onPointerDown={(event) => event.target === event.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="搜索">
        <label className="palette-search">
          <Search size={18} />
          <input autoFocus value={query} placeholder="搜索会话或命令" onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} aria-label="搜索会话或命令" />
          <Kbd>Esc</Kbd>
        </label>
        <div className="palette-list scroll-fade-y" ref={list} role="listbox">
          {section(q ? "会话" : "最近", recent, 0)}
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
