// The command palette (Ctrl K「搜索或新建会话」), the search palette (Ctrl Shift K), the
// keyboard shortcuts panel (Ctrl /) and the app-wide shortcuts. Claude Desktop 2.42304.0.0
// ion-dist c2771e1f6 (palette), c09d7445a (row actions card), shared-1 / shared-19 /
// c518a31cc (shortcut registry and panel); W20 palette-card-*.

import type { Thread } from "@protocol/v2/Thread";
import {
  Archive,
  ArchiveRestore,
  Brain,
  FlaskConical,
  FolderOpen,
  GitFork,
  Info,
  Keyboard,
  Mail,
  MailOpen,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Pencil,
  Plug,
  Puzzle,
  ScanSearch,
  Search,
  Server,
  Settings,
  Sparkles,
  SquarePen,
  SunMoon,
  Trash2,
  User,
  Webhook,
  X,
} from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import {
  archiveThread,
  errorMessage,
  forkThread,
  markRead,
  markUnread,
  newChat,
  openThread,
  searchThreadContent,
  sendMessage,
  setListFilter,
  unarchiveThread,
} from "../lib/codex";
import { turnFiles } from "../lib/diff";
import { basename, threadTitle, timeAgo } from "../lib/format";
import { getState, isUnread, setState, toast, useStore, type SettingsTab } from "../lib/store";
import { openSettings, saveTheme } from "./Settings";
import { closeSidebarOnMobile, sidebarOrder, toggleSidebar } from "./Sidebar";
import { Button, Dialog, Kbd, Spinner } from "./ui";

const DESKTOP = typeof window !== "undefined" && !!window.codexDesktop;

// ---------------------------------------------------------------------------
// Which overlay the `palette` flag shows.

type Mode = "command" | "search" | "shortcuts";
let mode: Mode = "command";

export function openPalette(next: Mode) {
  const { palette } = getState();
  const same = mode === next;
  mode = next;
  if (!palette) return setState({ palette: true });
  // Pressing the same key again closes it; another mode re-mounts with an empty query.
  setState({ palette: false });
  if (!same) requestAnimationFrame(() => setState({ palette: true }));
}

const closePalette = () => setState({ palette: false });

// ---------------------------------------------------------------------------
// Shortcuts: one table drives the key handler, menu hints and the shortcuts panel. Keys follow
// the host: Electron takes the desktop column (Ctrl N, Ctrl ,), a browser the web one.

type Group = "通用" | "面板" | "输入" | "窗口";

interface Binding {
  id: string;
  group: Group;
  label: string;
  keys: string;
  /** Absent: listed only (another part of the app handles the key). */
  test?(event: globalThis.KeyboardEvent): boolean;
  run?(): void;
}

const CODES: Record<string, string> = { ",": "Comma", "/": "Slash", "[": "BracketLeft", "]": "BracketRight" };

function chord(key: string, shift = false) {
  return (event: globalThis.KeyboardEvent) =>
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    event.shiftKey === shift &&
    (CODES[key] ? event.code === CODES[key] : event.key.toLowerCase() === key.toLowerCase());
}

function step(offset: number) {
  const ids = sidebarOrder();
  if (!ids.length) return;
  const at = ids.indexOf(getState().activeId ?? "");
  const next = at === -1 ? (offset > 0 ? 0 : ids.length - 1) : (at + offset + ids.length) % ids.length;
  void openThread(ids[next]);
}

function toggleDiff() {
  const { activeId, panel, threads } = getState();
  const thread = activeId ? threads[activeId] : undefined;
  if (!thread?.turns.some((turn) => turnFiles(turn, thread.meta.cwd).length)) return;
  setState({ panel: panel === "diff" ? null : "diff" });
}

// c518a31cc Te(): General, Panes, Composer; the desktop shell adds the session keys (S &&).
function bindings(): Binding[] {
  return [
    { id: "command", group: "通用", label: "搜索或新建会话", keys: "Ctrl + K", test: chord("k"), run: () => openPalette("command") },
    { id: "search", group: "通用", label: "搜索", keys: "Ctrl + Shift + K", test: chord("k", true), run: () => openPalette("search") },
    { id: "sidebar", group: "通用", label: "显示或隐藏侧栏", keys: "Ctrl + B", test: chord("b"), run: toggleSidebar },
    { id: "shortcuts", group: "通用", label: "键盘快捷键", keys: "Ctrl + /", test: chord("/"), run: () => openPalette("shortcuts") },
    DESKTOP
      ? { id: "settings", group: "通用", label: "设置", keys: "Ctrl + ,", test: chord(","), run: () => openSettings("general") }
      : { id: "settings", group: "通用", label: "设置", keys: "Ctrl + Shift + ,", test: chord(",", true), run: () => openSettings("general") },
    DESKTOP
      ? { id: "new", group: "通用", label: "新建会话", keys: "Ctrl + N", test: chord("n"), run: newChat }
      : { id: "new", group: "通用", label: "新建会话", keys: "Ctrl + Shift + O", test: chord("o", true), run: newChat },
    ...(DESKTOP
      ? ([
          {
            id: "next",
            group: "通用",
            label: "下一个会话",
            keys: "Ctrl + Shift + ] 或 Ctrl + Tab",
            test: (e) => chord("]", true)(e) || (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === "Tab"),
            run: () => step(1),
          },
          {
            id: "previous",
            group: "通用",
            label: "上一个会话",
            keys: "Ctrl + Shift + [ 或 Ctrl + Shift + Tab",
            test: (e) => chord("[", true)(e) || (e.ctrlKey && e.shiftKey && !e.altKey && e.key === "Tab"),
            run: () => step(-1),
          },
          {
            id: "jump",
            group: "通用",
            label: "跳到会话",
            keys: "Ctrl + 1…9",
            test: (e) => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key),
          },
          {
            id: "archive",
            group: "通用",
            label: "归档会话",
            keys: "Ctrl + Shift + Backspace",
            test: (e) => (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key === "Backspace",
            run: () => {
              const id = getState().activeId;
              if (id) archiveThread(id).catch((error) => toast("error", "归档失败", errorMessage(error)));
            },
          },
        ] satisfies Binding[])
      : []),
    // Listed only from here on unless a test is given: the transcript, composer and panes own these keys.
    { id: "stop", group: "通用", label: "停止 Codex 的回复", keys: "Esc" },
    { id: "rewind", group: "通用", label: "回退到更早的消息", keys: "Esc Esc" },
    { id: "view", group: "通用", label: "对话视图", keys: "Ctrl + O" },
    { id: "diff", group: "面板", label: "显示或隐藏改动", keys: "Ctrl + Shift + D", test: chord("d", true), run: toggleDiff },
    { id: "terminal", group: "面板", label: "显示或隐藏终端", keys: "Ctrl + `" },
    { id: "mode", group: "输入", label: "打开模式菜单", keys: DESKTOP ? "Ctrl + Shift + M" : "Ctrl + Alt + M" },
    { id: "model", group: "输入", label: "打开模型菜单", keys: "Ctrl + Shift + I" },
    { id: "effort", group: "输入", label: "打开努力程度选择", keys: "Ctrl + Shift + E" },
    { id: "fast", group: "输入", label: "快速模式", keys: "Ctrl + Alt + F" },
    { id: "pick", group: "输入", label: "选择菜单项", keys: "1…9" },
    { id: "attach", group: "输入", label: "添加文件或图片", keys: "Ctrl + U" },
    { id: "history", group: "输入", label: "浏览输入历史（输入框为空时）", keys: "↑ / ↓" },
    { id: "queue", group: "输入", label: "稍后加入队列（Codex 工作时）", keys: "Ctrl + Enter" },
    ...(DESKTOP
      ? ([
          { id: "find", group: "窗口", label: "在会话中查找", keys: "Ctrl + F" },
          { id: "zoom", group: "窗口", label: "放大或缩小", keys: "Ctrl + = / Ctrl + -" },
          { id: "zoomReset", group: "窗口", label: "实际大小", keys: "Ctrl + 0" },
        ] satisfies Binding[])
      : []),
  ];
}

/** The key hint for a binding on this host, e.g. 「Ctrl + N」 in Electron. */
export function shortcutLabel(id: string): string | undefined {
  return bindings().find((binding) => binding.id === id)?.keys;
}

/** App-wide keys; mounted once by the workspace. */
export function useShortcuts() {
  useEffect(() => {
    const table = bindings();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const binding = table.find((b) => b.test?.(event));
      if (!binding) return;
      // While an overlay is up only the overlay keys apply.
      const { palette, settings, dialog } = getState();
      if ((palette || settings || dialog) && !["command", "search", "shortcuts"].includes(binding.id)) return;
      event.preventDefault();
      if (binding.id === "jump") {
        const id = sidebarOrder()[Number(event.key) - 1];
        if (id) void openThread(id);
        return;
      }
      binding.run?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

// ---------------------------------------------------------------------------
// The palette

interface Entry {
  id: string;
  icon: ReactNode;
  label: ReactNode;
  hint?: string;
  snippet?: string | null;
  kbd?: string;
  /** Set on session rows: they open the row actions card. */
  thread?: string;
  run(): void;
}

interface Section {
  id: string;
  title?: string;
  notice?: string;
  items: Entry[];
}

// c2771e1f6 deep links: 「Settings → {section}」/「Customize → {section}」, by Settings' rail (G).
const SETTINGS_LINKS: [SettingsTab, string, ReactNode, string?][] = [
  ["general", "设置 → 通用", <Settings size={16} />],
  ["account", "设置 → 账户与用量", <User size={16} />],
  ["memory", "设置 → 记忆", <Brain size={16} />],
  ["labs", "设置 → 实验功能", <FlaskConical size={16} />],
  ["plugins", "自定义 → 插件", <Puzzle size={16} />],
  ["skills", "自定义 → 技能", <Sparkles size={16} />],
  ["connectors", "自定义 → 连接器", <Plug size={16} />],
  ["connectors", "自定义 → MCP 服务器", <Server size={16} />, "setting-connectors-mcp"],
  ["hooks", "自定义 → Hooks", <Webhook size={16} />],
  ["about", "设置 → 关于", <Info size={16} />],
];

function commands(): Entry[] {
  const { list } = getState();
  return [
    { id: "review", icon: <ScanSearch size={16} />, label: "审查代码改动", run: () => setState((s) => ({ dialog: { type: "review", threadId: s.activeId } })) },
    { id: "folder", icon: <FolderOpen size={16} />, label: "选择项目文件夹…", run: () => setState({ dialog: { type: "folder" } }) },
    { id: "details", icon: <PanelRight size={16} />, label: "显示或隐藏会话详情", run: () => setState((s) => ({ panel: s.panel === "details" ? null : "details" })) },
    { id: "sidebar", icon: <PanelLeft size={16} />, label: "显示或隐藏侧栏", kbd: shortcutLabel("sidebar"), run: toggleSidebar },
    {
      id: "archive",
      icon: list.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />,
      label: list.archived ? "返回最近会话" : "显示已归档的会话",
      run: () => setListFilter({ archived: !list.archived }),
    },
    {
      id: "theme",
      icon: <SunMoon size={16} />,
      label: "切换浅色 / 深色",
      run: () => saveTheme(document.documentElement.classList.contains("dark") ? "light" : "dark"),
    },
    { id: "shortcuts", icon: <Keyboard size={16} />, label: "键盘快捷键", kbd: shortcutLabel("shortcuts"), run: () => openPalette("shortcuts") },
    ...SETTINGS_LINKS.map(([tab, label, icon, anchor]) => ({
      id: `settings:${anchor ?? tab}`,
      icon,
      label,
      kbd: tab === "general" ? shortcutLabel("settings") : undefined,
      run: () => openSettings(tab, anchor),
    })),
  ];
}

function sessionEntry(thread: Thread, snippet?: string | null): Entry {
  return {
    id: thread.id,
    icon: <MessageSquare size={16} />,
    label: threadTitle(thread),
    hint: `${basename(thread.cwd)} · ${timeAgo(thread.recencyAt ?? thread.updatedAt)}`,
    snippet,
    thread: thread.id,
    run: () => {
      void openThread(thread.id);
      closeSidebarOnMobile();
    },
  };
}

/** Starts a session from the typed text; without text it opens the new session page. */
export function startSession(text: string): Promise<void> | void {
  newChat();
  const trimmed = text.trim();
  if (!trimmed) return;
  return sendMessage(null, [{ type: "text", text: trimmed, text_elements: [] }]).catch((error) => toast("error", "新建会话失败", errorMessage(error)));
}

function PaletteDialog({ kind }: { kind: "command" | "search" }) {
  const threads = useStore((s) => s.threads);
  const ids = useStore((s) => s.list.ids);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ thread: Thread; snippet: string | null }[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(0);
  const [card, setCard] = useState<{ entry: Entry; top: number } | null>(null);
  const [receded, setReceded] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const q = query.trim().toLowerCase();
  // c2771e1f6: a long or multi-line query turns the palette into a compose view.
  const compose = kind === "command" && (query.includes("\n") || query.length > 50);
  const matches = (text: string) => text.toLowerCase().includes(q);

  // Titles and content are searched on the server, so sessions beyond the loaded list show up too.
  useEffect(() => {
    if (!q || compose) {
      setFound(null);
      setSearching(false);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      setSearching(true);
      searchThreadContent(q)
        .then((data) => live && setFound(data))
        .catch(() => live && setFound(null))
        .finally(() => live && setSearching(false));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, compose]);

  const sessions: Entry[] = q
    ? (found?.map(({ thread, snippet }) => sessionEntry(thread, snippet)) ??
      ids
        .filter((id) => threads[id] && (matches(threadTitle(threads[id].meta)) || matches(threads[id].meta.cwd)))
        .map((id) => sessionEntry(threads[id].meta)))
    : ids
        .filter((id) => threads[id])
        .slice(0, 8)
        .map((id) => sessionEntry(threads[id].meta));
  const send: Entry = {
    id: "send",
    icon: <SquarePen size={16} />,
    label: q ? `新建会话：${query.trim().replace(/\s+/g, " ")}` : "新建会话",
    kbd: "Ctrl + 1",
    run: () => void startSession(query),
  };
  const titlesOnly = found !== null && found.length > 0 && found.every((hit) => hit.snippet === null);
  const sections: Section[] = compose
    ? [{ id: "send", items: [send] }]
    : kind === "search"
      ? [{ id: "sessions", title: q ? "会话" : "最近", notice: titlesOnly ? "只搜索了显示的标题" : undefined, items: sessions.slice(0, 20) }]
      : [
          { id: "send", items: [send] },
          { id: "sessions", title: q ? "会话" : "最近", notice: titlesOnly ? "只搜索了显示的标题" : undefined, items: sessions.slice(0, 20) },
          { id: "commands", title: "命令", items: commands().filter((command) => !q || matches(String(command.label))) },
        ];
  const entries = sections.flatMap((section) => section.items);
  const active = entries[Math.min(selected, entries.length - 1)];

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  useLayoutEffect(() => {
    if (!card) input.current?.focus();
  }, [card]);

  const run = (entry: Entry | undefined) => {
    if (!entry) return;
    closePalette();
    entry.run();
  };

  /** W20 palette-card-in: the card sits on the row, overlapping the panel's end by 44px, 4px up. */
  const openCard = (entry: Entry | undefined) => {
    if (!entry?.thread || !wrap.current) return;
    const row = list.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(entry.id)}"]`);
    const top = row ? row.getBoundingClientRect().top - wrap.current.getBoundingClientRect().top - 4 : 0;
    setCard({ entry, top });
    setReceded(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (entries.length) setSelected((index) => (index + (event.key === "ArrowDown" ? 1 : entries.length - 1)) % entries.length);
    } else if (event.key === "Enter" && event.altKey) {
      event.preventDefault();
      openCard(active);
    } else if (event.key === "Enter" && (!event.shiftKey || !compose)) {
      event.preventDefault();
      run(compose ? send : active);
    } else if ((event.ctrlKey || event.metaKey) && event.key === "1") {
      event.preventDefault();
      event.stopPropagation();
      run(send);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
    }
  };

  const section = (s: Section, offset: number) =>
    s.items.length > 0 && (
      <div key={s.id} className="palette-group" role="group" aria-label={s.title}>
        {s.title && <div className="palette-group-title">{s.title}</div>}
        {s.notice && (
          <div className="palette-notice" role="status">
            {s.notice}
          </div>
        )}
        {s.items.map((entry, index) => {
          const at = offset + index;
          return (
            <div
              key={entry.id}
              id={`palette-${entry.id}`}
              data-index={at}
              data-id={entry.id}
              role="option"
              aria-selected={at === selected}
              className={`palette-item ${at === selected ? "active" : ""}`}
              onMouseMove={() => setSelected(at)}
              onClick={() => run(entry)}
            >
              <span className="palette-icon">{entry.icon}</span>
              <span className="palette-text">
                <span className="palette-label">{entry.label}</span>
                {entry.snippet && <span className="palette-snippet">{entry.snippet}</span>}
              </span>
              {entry.hint && <span className="palette-hint">{entry.hint}</span>}
              {entry.kbd && <Kbd>{entry.kbd}</Kbd>}
              {entry.thread && (
                <span className="palette-row-act">
                  <Button
                    variant="ghost"
                    size="xs"
                    muted
                    icon={<MoreHorizontal size={16} />}
                    label="操作"
                    kbd="Alt+Enter"
                    onClick={(event) => {
                      event.stopPropagation();
                      openCard(entry);
                    }}
                  />
                </span>
              )}
            </div>
          );
        })}
      </div>
    );

  let offset = 0;
  return (
    <>
      <div className="dialog-backdrop palette-backdrop" onPointerDown={(event) => event.target === event.currentTarget && closePalette()}>
        <div className="palette-wrap" ref={wrap} data-card={card ? "" : undefined} data-receded={receded || undefined}>
          <div className="palette" role="dialog" aria-modal="true" aria-label={kind === "search" ? "搜索" : "搜索或新建会话"}>
            <label className="palette-search">
              <Search size={18} />
              <textarea
                ref={input}
                autoFocus
                rows={1}
                value={query}
                placeholder={compose ? "输入消息…" : kind === "search" ? "搜索" : "搜索或新建会话"}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                aria-label={kind === "search" ? "搜索会话" : "搜索或新建会话"}
                aria-controls="palette-list"
                aria-activedescendant={active ? `palette-${active.id}` : undefined}
              />
              <span className="palette-busy">{searching && <Spinner size={14} />}</span>
              <Button variant="ghost" size="xs" muted icon={<X size={16} />} label="关闭" onClick={closePalette} />
            </label>
            <div className="palette-list scroll-fade-y" id="palette-list" ref={list} role="listbox">
              {sections.map((s) => {
                const node = section(s, offset);
                offset += s.items.length;
                return <Fragment key={s.id}>{node}</Fragment>;
              })}
              {entries.length === 0 && <div className="menu-empty">没有找到结果</div>}
            </div>
            <span className="sr-only" role="status">
              {q ? `${sessions.length} 个结果` : ""}
            </span>
            <div className="palette-veil" aria-hidden="true" />
          </div>
          {card && <RowCard key={card.entry.id} entry={card.entry} top={card.top} onClose={() => setCard(null)} />}
        </div>
      </div>
      {/* The title row still drags the window under the scrim (CDS window drag strip). */}
      <div className="dialog-drag-strip" aria-hidden="true" />
    </>
  );
}

/** The row actions card (c09d7445a): numbered actions for one session. */
function RowCard({ entry, top, onClose }: { entry: Entry; top: number; onClose(): void }) {
  const thread = useStore((s) => (entry.thread ? s.threads[entry.thread] : undefined));
  const [selected, setSelected] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => panel.current?.focus(), []);
  if (!thread) return null;
  const { meta } = thread;
  const archived = getState().list.archived;
  const unread = isUnread(thread);
  const fail = (title: string) => (error: unknown) => toast("error", title, errorMessage(error));
  const actions: { label: string; icon: ReactNode; danger?: boolean; run(): void }[] = [
    { label: "打开", icon: <MessageSquare size={16} />, run: entry.run },
    { label: "重命名", icon: <Pencil size={16} />, run: () => setState({ dialog: { type: "rename", threadId: meta.id } }) },
    ...(archived ? [] : [{ label: "派生会话", icon: <GitFork size={16} />, run: () => void forkThread(meta.id).catch(fail("派生会话失败")) }]),
    ...(thread.readState
      ? [{ label: unread ? "标为已读" : "标为未读", icon: unread ? <MailOpen size={16} /> : <Mail size={16} />, run: () => void (unread ? markRead(meta.id) : markUnread(meta.id)).catch(fail("更新未读状态失败")) }]
      : []),
    {
      label: archived ? "取消归档" : "归档",
      icon: archived ? <ArchiveRestore size={16} /> : <Archive size={16} />,
      run: () => void (archived ? unarchiveThread(meta.id) : archiveThread(meta.id)).catch(fail(archived ? "取消归档失败" : "归档失败")),
    },
    { label: "删除", icon: <Trash2 size={16} />, danger: true, run: () => setState({ dialog: { type: "delete", threadId: meta.id } }) },
  ];
  const run = (index: number) => {
    const action = actions[index];
    if (!action) return;
    closePalette();
    action.run();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "ArrowLeft" || (event.key === "Enter" && event.altKey)) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((index) => (index + (event.key === "ArrowDown" ? 1 : actions.length - 1)) % actions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(selected);
    } else if (/^[1-9]$/.test(event.key) && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      run(Number(event.key) - 1);
    }
  };
  return (
    <div ref={panel} className="palette-card" role="menu" tabIndex={-1} style={{ "--card-top": `${top}px` } as CSSProperties} onKeyDown={onKeyDown}>
      <div className="palette-card-head">
        <div className="palette-card-title">{threadTitle(meta)}</div>
        <div className="palette-card-meta">会话 · {timeAgo(meta.recencyAt ?? meta.updatedAt)}</div>
      </div>
      {actions.map((action, index) => (
        <button
          key={action.label}
          type="button"
          role="menuitem"
          className={`menu-item ${action.danger ? "danger" : ""}`}
          data-highlighted={index === selected || undefined}
          onMouseMove={() => setSelected(index)}
          onClick={() => run(index)}
        >
          <span className="menu-icon">{action.icon}</span>
          <span className="menu-text">
            <span className="menu-label">{action.label}</span>
          </span>
          <span className="kbd">{index + 1}</span>
        </button>
      ))}
    </div>
  );
}

/** The keyboard shortcuts panel (c518a31cc), grouped like the Code tab's. */
function ShortcutsDialog() {
  const table = bindings();
  const groups = [...new Set(table.map((binding) => binding.group))];
  return (
    <Dialog title="键盘快捷键" onClose={closePalette} size="md">
      <div className="shortcuts">
        {groups.map((group) => (
          <section key={group} className="shortcuts-group">
            <h3 className="shortcuts-title">{group}</h3>
            {table
              .filter((binding) => binding.group === group)
              .map((binding) => (
                <div key={binding.id} className="shortcuts-row">
                  <span>{binding.label}</span>
                  <Kbd>{binding.keys}</Kbd>
                </div>
              ))}
          </section>
        ))}
      </div>
    </Dialog>
  );
}

export function Palette() {
  const open = useStore((s) => s.palette);
  if (!open) return null;
  return mode === "shortcuts" ? <ShortcutsDialog /> : <PaletteDialog kind={mode} />;
}
