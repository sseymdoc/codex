// The command palette (Ctrl K「搜索或新建会话」) with its search (Ctrl Shift K) and actions (Tab)
// entrypoint, the keyboard shortcuts panel (Ctrl /) and the app-wide shortcuts. Claude Desktop
// 2.42304.0.0 ion-dist c2771e1f6 Dm (palette), ce8be540f / c01b6d4ec (rows, footer), shared-19 OK
// (shell), shared-1 jL (command registry), c518a31cc Te (shortcuts panel).
// New search view (c2771e1f6 B2 / wd, ce8be540f dn): recents before actions, row menus,
// filters and Tab to compose. Code is the only content kind, so there are no type tabs.

import type { Thread } from "@protocol/v2/Thread";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  effectiveSettings,
  errorMessage,
  fastAvailable,
  isArchivedThread,
  newChat,
  openThread,
  refreshConfig,
  refreshPermissionProfiles,
  searchThreadContent,
  searchThreads,
  sendMessage,
  supports,
  unarchiveThread,
} from "../lib/codex";
import { turnFiles } from "../lib/diff";
import { threadTitle } from "../lib/format";
import { hitRanges, matchActions, timeBucket } from "../lib/palette";
import { closeActivePane, layoutOf, toggleActiveExpanded, togglePane, viewKey } from "../lib/panes";
import { shortcutText } from "../lib/shortcut";
import { getState, setState, toast, useStore, type SettingsTab } from "../lib/store";
import { openSettings } from "./Settings";
import { archiveSession, closeSidebarOnMobile, deleteSession, familyRoots, foldAllFamilies, foldFamilies, SessionMenuItems, sidebarOrder, toggleSidebar } from "./Sidebar";
import { Button, Dialog, Icon, Kbd, MenuItem, Popover, Spinner } from "./ui";

const DESKTOP = typeof window !== "undefined" && !!window.codexDesktop;

// ---------------------------------------------------------------------------
// Which overlay the `palette` flag shows.

type Mode = "command" | "search" | "shortcuts";
type Kind = "command" | "search" | "actions";
let mode: Mode = "command";
/** The open palette's own mode switch, so Ctrl Shift K keeps it open (shared-20 gy). */
let switchKind: ((kind: Kind) => void) | null = null;

export function openPalette(next: Mode) {
  const { palette } = getState();
  // shared-15 toggleCommandPalette: Ctrl K closes the palette whichever mode it is in.
  if (palette && next === "command" && mode !== "shortcuts") return closePalette();
  if (palette && next === "shortcuts" && mode === "shortcuts") return closePalette();
  if (palette && next === "search" && switchKind) return switchKind("search");
  mode = next;
  if (!palette) return setState({ palette: true });
  // The other overlay re-mounts with an empty query.
  setState({ palette: false });
  requestAnimationFrame(() => setState({ palette: true }));
}

const closePalette = () => setState({ palette: false });

// ---------------------------------------------------------------------------
// Shortcuts: one table drives the key handler, menu hints and the shortcuts panel. Keys follow
// the host: Electron takes the desktop column (Ctrl N, Ctrl ,), a browser the web one.

type Group = "通用" | "窗格" | "输入框";

interface Binding {
  id: string;
  group: Group;
  label: string;
  /** Combos in jL notation ("ctrl+shift+]", a space between the steps of a sequence); more than one reads 或. */
  keys: string[];
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

export function step(offset: number) {
  const ids = sidebarOrder();
  if (!ids.length) return;
  const at = ids.indexOf(getState().activeId ?? "");
  const next = at === -1 ? (offset > 0 ? 0 : ids.length - 1) : (at + offset + ids.length) % ids.length;
  void openThread(ids[next]);
}

export function toggleDiff() {
  const { activeId, threads } = getState();
  const thread = activeId ? threads[activeId] : undefined;
  if (!thread?.turns.some((turn) => turnFiles(turn, thread.meta.cwd).length)) return;
  togglePane("diff");
}

/** new_code_session_from_current: the new session page with this session's folder, model and permissions. */
function newFromCurrent() {
  const { activeId, threads, prefs } = getState();
  const thread = activeId ? threads[activeId] : undefined;
  if (!thread) return;
  const picks = effectiveSettings(thread);
  const cwd = thread.settings?.cwd ?? thread.meta.cwd;
  setState((s) => ({
    prefs: {
      ...s.prefs,
      cwd,
      projectId: thread.meta.projectId,
      model: picks.model,
      effort: picks.effort,
      permission: picks.permission,
      permissionProfile: picks.permissionProfile,
      planMode: picks.planMode,
      serviceTier: picks.serviceTier,
      reviewer: picks.reviewer,
    },
  }));
  newChat();
  if (cwd !== prefs.cwd) {
    void refreshConfig();
    void refreshPermissionProfiles(cwd);
  }
}

/** file_upload: the composer's file picker (shared-21 clicks the composer's file input the same way). */
function attachFiles() {
  document.querySelector<HTMLInputElement>('.composer input[type="file"]')?.click();
}

// c518a31cc Te(): General, Panes, Composer; the desktop shell adds the session keys (S2 &&).
// ccd_palette_session_actions and ccd_prompt_jump are off, so their keys are not listed.
function bindings(): Binding[] {
  return [
    { id: "command", group: "通用", label: "搜索或开始会话", keys: ["ctrl+k"], test: chord("k"), run: () => openPalette("command") },
    { id: "search", group: "通用", label: "搜索", keys: ["ctrl+shift+k"], test: chord("k", true), run: () => openPalette("search") },
    { id: "sidebar", group: "通用", label: "显示/隐藏侧边栏", keys: ["ctrl+b"], test: chord("b"), run: toggleSidebar },
    { id: "shortcuts", group: "通用", label: "键盘快捷键", keys: ["ctrl+/"], test: chord("/"), run: () => openPalette("shortcuts") },
    DESKTOP
      ? { id: "settings", group: "通用", label: "设置", keys: ["ctrl+,"], test: chord(","), run: () => openSettings("general") }
      : { id: "settings", group: "通用", label: "设置", keys: ["ctrl+shift+,"], test: chord(",", true), run: () => openSettings("general") },
    DESKTOP
      ? { id: "new", group: "通用", label: "新建会话", keys: ["ctrl+n"], test: chord("n"), run: newChat }
      : { id: "new", group: "通用", label: "新建会话", keys: ["ctrl+shift+o"], test: chord("o", true), run: newChat },
    ...(DESKTOP
      ? ([
          { id: "fromCurrent", group: "通用", label: "使用当前设置新建会话", keys: ["ctrl+shift+n"], test: chord("n", true), run: newFromCurrent },
          {
            id: "next",
            group: "通用",
            label: "下一个会话",
            keys: ["ctrl+shift+]", "ctrl+tab"],
            test: (e) => chord("]", true)(e) || (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === "Tab"),
            run: () => step(1),
          },
          {
            id: "previous",
            group: "通用",
            label: "上一个会话",
            keys: ["ctrl+shift+[", "ctrl+shift+tab"],
            test: (e) => chord("[", true)(e) || (e.ctrlKey && e.shiftKey && !e.altKey && e.key === "Tab"),
            run: () => step(-1),
          },
          {
            id: "jump",
            group: "通用",
            label: "跳转到会话",
            keys: ["ctrl+1…9"],
            test: (e) => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key),
          },
          {
            id: "archive",
            group: "通用",
            label: "归档会话",
            keys: ["ctrl+shift+backspace"],
            test: (e) => (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key === "Backspace",
            run: () => {
              const id = getState().activeId;
              if (id) archiveSession(id);
            },
          },
        ] satisfies Binding[])
      : []),
    // Listed only from here on unless a test is given: the transcript, composer and panes own these keys.
    { id: "view", group: "通用", label: "对话记录视图", keys: ["ctrl+o"] },
    { id: "stop", group: "通用", label: "停止 Codex 的回复", keys: ["esc"] },
    { id: "rewind", group: "通用", label: "将会话回退到较早的消息", keys: ["esc esc"] },
    { id: "diff", group: "窗格", label: "切换更改", keys: ["ctrl+shift+d"], test: chord("d", true), run: toggleDiff },
    // c518a31cc Te: kill switches (c8190f70d / c8e302838 / cc28ac22a return !flag), so listed by default.
    { id: "diffFileList", group: "窗格", label: "在更改或文件中切换文件列表", keys: ["ctrl+shift+y"] },
    { id: "nextChange", group: "窗格", label: "更改列表中的下一处更改", keys: ["alt+f5", "f7"] },
    { id: "prevChange", group: "窗格", label: "更改中的上一处更改", keys: ["shift+alt+f5", "shift+f7"] },
    { id: "goToFile", group: "窗格", label: "在更改或文件中转到文件", keys: ["ctrl+p"] },
    { id: "files", group: "窗格", label: "显示/隐藏文件", keys: ["ctrl+shift+f"] },
    ...(DESKTOP ? [{ id: "browser", group: "窗格", label: "显示/隐藏浏览器", keys: ["ctrl+shift+b"], test: chord("b", true), run: () => togglePane("browser") }] satisfies Binding[] : []),
    { id: "attachSelection", group: "窗格", label: "将所选内容作为上下文附加", keys: ["ctrl+shift+l"] },
    { id: "terminal", group: "窗格", label: "切换终端", keys: ["ctrl+`"] },
    { id: "closePane", group: "窗格", label: "关闭窗格", keys: ["ctrl+\\"] },
    { id: "expandPane", group: "窗格", label: "展开或折叠窗格", keys: ["ctrl+shift+\\"] },
    { id: "mode", group: "输入框", label: "打开模式菜单", keys: [DESKTOP ? "ctrl+shift+m" : "ctrl+alt+m"] },
    { id: "model", group: "输入框", label: "打开模型菜单", keys: ["ctrl+shift+i"] },
    { id: "effort", group: "输入框", label: "打开强度选择器", keys: ["ctrl+shift+e"] },
    ...(getState().models.some((model) => fastAvailable(model.id))
      ? ([{ id: "fast", group: "输入框", label: "切换快速模式", keys: ["ctrl+alt+f"] }] satisfies Binding[])
      : []),
    { id: "pick", group: "输入框", label: "选择菜单项", keys: ["1…9"] },
    { id: "attach", group: "输入框", label: "添加文件或照片", keys: ["ctrl+u"] },
    { id: "queue", group: "输入框", label: "加入队列稍后发送（Codex 工作时）", keys: ["ctrl+enter"] },
  ];
}

/** The key hint for a binding on this host in the text variant, e.g. 「Ctrl+N」 in Electron. */
export function shortcutLabel(id: string): string | undefined {
  const keys = bindings().find((binding) => binding.id === id)?.keys[0];
  return keys && shortcutText(keys);
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

type CommandGroup = "chat" | "session" | "settings" | "general";

interface Entry {
  id: string;
  icon: ReactNode;
  label: string;
  /** Searched with the label (jL searchHints). */
  hints?: string[];
  /** The actions mode heading it sits under (jL group). */
  group?: CommandGroup;
  /** The row's shortcut in jL notation, shown while it is not selected. */
  keys?: string;
  /** Session rows: the recency word and a content match. */
  when?: string | null;
  snippet?: string | null;
  threadId?: string;
  run(): void;
}

interface Section {
  id: string;
  title?: string;
  items: Entry[];
}

type Hit = { thread: Thread; snippet: string | null };

// shared-1 uN in jL group order; nothing here falls in the other groups.
const GROUPS: [CommandGroup, string][] = [
  ["chat", "对话"],
  ["session", "会话"],
  ["settings", "设置"],
  ["general", "常规"],
];

// c2771e1f6 gs(): a row per Settings rail section, no keys. An unnamed group reads「设置 → 页」, a
// named one「设置 → 组 → 页」, all under the gear; Customize reads「自定义 → 页」under a wrench.
const SETTINGS_LINKS: [SettingsTab, string, boolean?][] = [
  ["general", "设置 → 常规"],
  ["account", "设置 → 使用情况"],
  ["capabilities", "设置 → 功能"],
  ["memory", "设置 → 记忆"],
  ["codex", "设置 → Codex"],
  ["import", "设置 → 导入"],
  ["labs", "设置 → 实验性功能"],
  ...(DESKTOP ? ([["system", "设置 → 此电脑 → 系统"]] satisfies [SettingsTab, string][]) : []),
  ["skills", "自定义 → Skills", true],
  ["connectors", "自定义 → 连接器", true],
  ["plugins", "自定义 → 插件", true],
  ["hooks", "自定义 → 钩子", true],
];

/** What the palette lists (xs()): jL entries the Code session view registers, Codex's own, then settings. */
function commands(): Entry[] {
  const { activeId, threads } = getState();
  const thread = activeId ? threads[activeId] : undefined;
  const { open, expanded } = layoutOf(viewKey());
  const fail = (title: string) => (error: unknown) => toast("warning", title, errorMessage(error));
  const session: Entry[] = [];
  if (thread) {
    const id = thread.meta.id;
    session.push(
      isArchivedThread(id)
        ? { id: "unarchive", group: "session", icon: <Icon name="Archive" size={20} />, label: "取消归档会话", hints: ["恢复"], run: () => void unarchiveThread(id).catch(fail("取消归档会话失败")) }
        : { id: "archive", group: "session", icon: <Icon name="Archive" size={20} />, label: "归档会话", hints: ["隐藏"], run: () => archiveSession(id) },
      { id: "delete", group: "session", icon: <Icon name="Trash" size={20} />, label: "删除会话", hints: ["移除", "回收站"], run: () => deleteSession(id) },
      {
        id: "fromCurrent",
        group: "session",
        icon: <Icon name="ChatAdd" size={20} />,
        label: "使用当前设置新建会话",
        hints: ["相同设置", "沿用", "复制"],
        keys: DESKTOP ? "ctrl+shift+n" : undefined,
        run: newFromCurrent,
      },
    );
  }
  // shared-1 hide_ / show_nested_sessions for the open session's family, then the all-families pair.
  const { roots, folded } = familyRoots();
  if (activeId && roots.includes(activeId)) {
    const hidden = folded.includes(activeId);
    session.push({
      id: "nested",
      group: "session",
      icon: <Icon name={hidden ? "Expand" : "Collapse"} size={20} />,
      label: hidden ? "显示嵌套会话" : "隐藏嵌套会话",
      hints: hidden ? ["展开"] : ["折叠", "折叠会话"],
      run: () => foldFamilies([activeId], !hidden),
    });
  }
  if (folded.length < roots.length)
    session.push({ id: "hideNested", group: "session", icon: <Icon name="Collapse" size={20} />, label: "隐藏所有嵌套会话", hints: ["折叠", "折叠会话"], run: () => foldAllFamilies(true) });
  if (folded.length) session.push({ id: "showNested", group: "session", icon: <Icon name="Expand" size={20} />, label: "显示所有嵌套会话", hints: ["展开"], run: () => foldAllFamilies(false) });
  // c11959232 Pf: the pane toggles say what they will do; Close pane while one is open.
  if (supports("process/spawn"))
    session.push({
      id: "terminal",
      group: "session",
      icon: <Icon name="CommandLinePrompt" size={20} />,
      label: open.includes("terminal") ? "隐藏终端" : "显示终端",
      hints: ["shell", "控制台"],
      keys: "ctrl+`",
      run: () => togglePane("terminal"),
    });
  if (thread?.turns.some((turn) => turnFiles(turn, thread.meta.cwd).length))
    session.push({ id: "diff", group: "session", icon: <Icon name="ChangesPlusMinus" size={20} />, label: open.includes("diff") ? "隐藏更改" : "显示更改", hints: ["diff"], keys: "ctrl+shift+d", run: toggleDiff });
  if (open.length) session.push({ id: "closePane", group: "session", icon: <Icon name="X" size={20} />, label: "关闭窗格", hints: ["面板"], keys: "ctrl+\\", run: closeActivePane });
  // c11959232 expand_side_pane / collapse_side_pane (shared-1 bF, kB Ctrl+Shift+\): whichever applies while a pane is open.
  if (open.length)
    session.push(
      expanded
        ? { id: "collapsePane", group: "session", icon: <Icon name="Collapse" size={20} />, label: "折叠窗格", hints: ["面板"], keys: "ctrl+shift+\\", run: toggleActiveExpanded }
        : { id: "expandPane", group: "session", icon: <Icon name="Expand" size={20} />, label: "展开窗格", hints: ["面板"], keys: "ctrl+shift+\\", run: toggleActiveExpanded },
    );
  return [
    { id: "attach", group: "chat", icon: <Icon name="Attachment" size={20} />, label: "添加文件或照片", hints: ["上传"], keys: "ctrl+u", run: attachFiles },
    ...session,
    // Codex's own: review/start, and a folder for new sessions.
    { id: "review", group: "session", icon: <Icon name="Evals" size={20} />, label: "审查代码更改", run: () => setState((s) => ({ dialog: { type: "review", threadId: s.activeId } })) },
    ...SETTINGS_LINKS.map(([tab, label, customize]): Entry => ({
      id: `settings:${tab}`,
      group: "settings",
      icon: <Icon name={customize ? "Tool" : "Settings"} size={20} />,
      label,
      run: () => openSettings(tab),
    })),
    { id: "sidebar", group: "general", icon: <Icon name="Sidebar" size={20} />, label: "显示/隐藏侧边栏", run: toggleSidebar },
    { id: "shortcuts", group: "general", icon: <Icon name="Keyboard" size={20} />, label: "键盘快捷键", keys: "ctrl+/", run: () => openPalette("shortcuts") },
    { id: "folder", group: "general", icon: <Icon name="Folder" size={20} />, label: "打开文件夹…", run: () => setState({ dialog: { type: "folder" } }) },
  ];
}

function sessionEntry({ thread, snippet }: Hit): Entry {
  return {
    id: thread.id,
    threadId: thread.id,
    icon: <Icon name="Code" size="md" />,
    label: threadTitle(thread),
    when: timeBucket((thread.recencyAt ?? thread.updatedAt) * 1000),
    snippet,
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
  return sendMessage(null, [{ type: "text", text: trimmed, text_elements: [] }]).catch((error) => toast("warning", "启动会话失败", errorMessage(error)));
}

/** The matched parts of `text` in semibold primary (c1ea8a271, variant "bold"). */
function Marked({ text, q }: { text: string; q: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of hitRanges(text, q)) {
    parts.push(
      text.slice(at, start),
      <b key={start} className="palette-hit">
        {text.slice(start, end)}
      </b>,
    );
    at = end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

const PLACEHOLDER: Record<Kind, string> = { command: "搜索", search: "搜索", actions: "搜索操作" };
const LISTBOX: Record<Kind, string> = { command: "搜索结果", search: "搜索结果", actions: "操作" };

function PaletteDialog() {
  const threads = useStore((s) => s.threads);
  const ids = useStore((s) => s.list.ids);
  // commands() reads these.
  useStore((s) => s.panes);
  useStore((s) => s.activeId);
  const [kind, setKind] = useState<Kind>(mode === "search" ? "search" : "command");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ q: string; archived: boolean; hits: Hit[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [compose, setCompose] = useState(false);
  const [archived, setArchived] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState({ index: 0, byPointer: false });
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const filterButton = useRef<HTMLButtonElement>(null);

  const q = query.trim().toLowerCase();
  const searchOn = !compose && kind !== "actions";

  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);

  useLayoutEffect(() => {
    switchKind = (next) => { setKind(next); setCompose(false); input.current?.focus(); };
    return () => {
      switchKind = null;
    };
  }, []);

  // Titles and content are searched on the server, so sessions beyond the loaded list show up too.
  useEffect(() => {
    if (!searchOn) return setSearching(false);
    let live = true;
    setSearching(true);
    setSearchError(false);
    const timer = setTimeout(() => {
      (q ? searchThreadContent(q, archived) : searchThreads("", archived).then((threads) => threads.map((thread) => ({ thread, snippet: null }))))
        .then((hits) => live && setFound({ q, archived, hits }))
        .catch(() => { if (live) { setFound(null); setSearchError(true); } })
        .finally(() => live && setSearching(false));
    }, q ? 200 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, searchOn, archived, retry]);

  const recents = ids
    .flatMap((id) => (threads[id] && isArchivedThread(id) === archived ? [threads[id].meta] : []))
    .sort((a, b) => (b.recencyAt ?? b.updatedAt) - (a.recencyAt ?? a.updatedAt));
  const hits: Hit[] = !searchOn
    ? []
    : found?.q === q && found.archived === archived
        ? found.hits.filter(({ thread }) => isArchivedThread(thread.id) === archived)
        : recents.filter((thread) => threadTitle(thread).toLowerCase().includes(q)).map((thread) => ({ thread, snippet: null }));
  const send: Entry = { id: "send", group: "chat", icon: <Icon name="ChatAdd" size={20} />, label: "新建会话", run: () => void startSession(compose ? query : "") };
  const all = [send, ...commands()];
  const results = (count: number): Section => ({ id: "results", title: "搜索结果", items: hits.slice(0, count).map(sessionEntry) });

  // c2771e1f6 wd(): recent sessions first; creation actions at the bottom.
  let sections: Section[];
  if (compose) {
    sections = [{ id: "compose", items: [send] }];
  } else if (kind === "actions") {
    const shown = q ? matchActions(all, q) : all;
    sections = GROUPS.map(([group, title]) => ({ id: group, title, items: shown.filter((entry) => entry.group === group) }));
  } else if (q) {
    const matched = matchActions(all, q);
    sections = [results(25), { id: "actions", title: "操作", items: matched }];
  } else {
    sections = [{ id: "recents", title: archived ? "已归档" : "最近使用", items: hits.slice(0, 8).map(sessionEntry) }, { id: "actions", title: "操作", items: [send] }];
  }
  const entries = sections.flatMap((section) => section.items);
  const index = Math.min(selected.index, Math.max(0, entries.length - 1));
  const active = entries[index];
  useEffect(() => { if (menuId && active?.threadId !== menuId) setMenuId(null); }, [active?.threadId, menuId]);

  useEffect(() => { setSelected({ index: 0, byPointer: false }); setMenuId(null); }, [query, kind, archived, compose]);
  // Only keyboard moves scroll the list (c2771e1f6 hp 5264).
  useEffect(() => {
    if (!selected.byPointer) list.current?.querySelector(`[data-index="${selected.index}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const switchTo = (next: Kind) => {
    setKind(next);
    setCompose(false);
    setFound(null);
    setSearchError(false);
    input.current?.focus();
  };

  const run = (entry: Entry | undefined) => {
    if (!entry) return;
    closePalette();
    entry.run();
  };
  const openRowMenu = () => {
    if (!active?.threadId) return;
    menuButton.current?.focus();
    setMenuId(active.threadId);
  };

  // c2771e1f6 hp() on the dialog, the field's own keys (Tab, Backspace) on the field.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (!(event.target instanceof Node) || !panel.current?.contains(event.target) || menuId || filtersOpen) return;
    const inField = event.target === input.current;
    const last = Math.max(0, entries.length - 1);
    const move = (to: number) => setSelected({ index: to, byPointer: false });
    if (event.key === "Enter" && event.altKey && active?.threadId) {
      event.preventDefault();
      openRowMenu();
    } else if (event.key === "/" && inField && query === "" && !compose) {
      event.preventDefault();
      filterButton.current?.focus();
      setFiltersOpen(true);
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !compose) {
      event.preventDefault();
      if (entries.length) move(event.key === "ArrowDown" ? (index < last ? index + 1 : 0) : index > 0 ? index - 1 : last);
    } else if ((event.key === "Home" || event.key === "End") && query === "" && !compose) {
      event.preventDefault();
      move(event.key === "Home" ? 0 : last);
    } else if (event.key === "Enter" && !event.shiftKey && inField) {
      // Shift+Enter is left to the field: a new line.
      event.preventDefault();
      run(compose ? send : active);
    } else if (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && inField && kind !== "actions") {
      event.preventDefault();
      setCompose(!compose);
    } else if ((event.key === "Backspace" || event.key === "Delete") && inField && query === "" && kind === "actions") {
      event.preventDefault();
      setKind("command");
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
    } else if (event.key === "Tab") {
      const items = [...panel.current!.querySelectorAll<HTMLElement>('textarea, button:not([disabled])')].filter((item) => !item.closest("[inert]") && item.getClientRects().length);
      const first = items[0], lastItem = items.at(-1);
      if (event.shiftKey && event.target === first) { event.preventDefault(); lastItem?.focus(); }
      else if (!event.shiftKey && event.target === lastItem) { event.preventDefault(); first?.focus(); }
    }
  };

  const row = (entry: Entry, at: number) => {
    const isSelected = at === index;
    const quoted = entry === send && compose && query.trim() !== "";
    const aside = q ? entry.when ?? (entry.keys ? <Kbd>{entry.keys}</Kbd> : null) : null;
    return (
      <div
        key={entry.id}
        id={`palette-${entry.id}`}
        data-index={at}
        role="option"
        aria-selected={isSelected}
        className="palette-item"
        onMouseMove={() => !menuId && at !== index && setSelected({ index: at, byPointer: true })}
        onClick={() => run(entry)}
      >
        <span className="palette-main">
          {entry.icon}
          {quoted ? (
            <span className="palette-label">
              {entry.label}
              <span className="palette-quote">
                <span>“</span>
                {query}
                <span>”</span>
              </span>
            </span>
          ) : (
            <span className="palette-text">
              <span className="palette-label">
                <Marked text={entry.label} q={q} />
              </span>
              {entry.snippet && (
                <span className="palette-snippet">
                  <Marked text={entry.snippet} q={q} />
                </span>
              )}
            </span>
          )}
        </span>
        <span className="palette-aside">
          {isSelected && entry.threadId && (
            <span onClick={(event) => event.stopPropagation()}>
              <Popover open={menuId === entry.threadId} onClose={() => { setMenuId(null); input.current?.focus(); }} placement="bottom-end"
                anchor={<Button ref={menuButton} variant="ghost" size="xs" icon={<Icon name="DotsHorizontal" size={16} />} label="会话操作" tip="" onClick={openRowMenu} />}>
                <SessionMenuItems threadId={entry.threadId} close={closePalette} />
              </Popover>
            </span>
          )}
          {isSelected ? (
            <>
              <span className={quoted ? "palette-enter brand" : "palette-enter"}>
                <Icon name="ArrowReturn" size="sm" />
              </span>
              {aside && <span className="palette-aside-touch">{aside}</span>}
            </>
          ) : (
            aside
          )}
        </span>
      </div>
    );
  };

  const count = entries.length - (entries.includes(send) ? 1 : 0);
  const footOpen = compose || query.trim() === "";
  let offset = 0;
  return (
    <>
      <div className="dialog-backdrop palette-backdrop" onPointerDown={(event) => event.target === event.currentTarget && closePalette()}>
        <div ref={panel} className="palette" role="dialog" aria-modal="true" aria-label="搜索" data-compose={compose || undefined} data-foot-collapsed={!footOpen || undefined} onKeyDown={onKeyDown}>
          <div className="palette-search">
            {kind === "actions" && (
              <span className="palette-mode-chip">
                <span className="palette-mode" role="img" aria-label="操作模式">
                  <Icon name="Keyboard" size="md" />
                </span>
                <Button variant="ghost" size="xs" icon={<Icon name="X" size={16} />} label="清除筛选" tip="" onClick={() => switchTo("command")} />
              </span>
            )}
            <textarea
              ref={input}
              rows={compose ? 3 : 1}
              value={query}
              placeholder={compose ? "开始新会话…" : PLACEHOLDER[kind]}
              aria-label={compose ? "开始新会话" : PLACEHOLDER[kind]}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls="palette-list"
              aria-activedescendant={active ? `palette-${active.id}` : undefined}
              onChange={(event) => setQuery(compose ? event.target.value : event.target.value.replace(/\s*\r?\n\s*/g, " "))}
            />
            <span className="palette-busy">
              {searching && (
                <span className="palette-spinner" role="status" aria-label="正在深入搜索…">
                  <Spinner size={16} />
                </span>
              )}
            </span>
            <Button variant="ghost" icon={<Icon name="X" size={20} />} label="关闭" tip="" onClick={closePalette} />
          </div>
          {(archived || kind === "actions") && <div className="palette-filters"><Button variant="ghost" size="xs" icon={<Icon name="X" size={12} />} onClick={() => { setArchived(false); switchTo("command"); }}>{kind === "actions" ? "操作" : "已归档"}</Button></div>}
          <div className="palette-list scroll-fade-y" id="palette-list" ref={list} role="listbox" aria-label={LISTBOX[kind]} aria-busy={searchOn && searching}>
            {searchOn && searchError && <div className="palette-empty" role="status">搜索失败<Button variant="ghost" size="xs" onClick={() => setRetry(retry + 1)}>重试</Button></div>}
            {!entries.length && !searchError && <div className="palette-empty" role="status">{searching ? "正在搜索…" : "未找到结果"}</div>}
            {searchOn && q && !supports("thread/search") && <div className="palette-search-note">此后端仅支持搜索会话标题。</div>}
            {sections.map((section) => {
              const start = offset;
              offset += section.items.length;
              if (!section.items.length) return null;
              return (
                <div key={section.id} role={section.title ? "group" : undefined} aria-label={section.title}>
                  {section.title && (
                    <div className="palette-group-title">
                      {section.title}
                    </div>
                  )}
                  {section.items.map((entry, at) => row(entry, start + at))}
                </div>
              );
            })}
          </div>
          <div className="palette-foot" data-open={footOpen || undefined} aria-hidden={!footOpen} inert={!footOpen}>
            <div>
              <div className="palette-foot-row">
                <button type="button" onClick={closePalette}>关闭<Kbd>esc</Kbd></button>
                {!compose && <Popover open={filtersOpen} onClose={() => { setFiltersOpen(false); input.current?.focus(); }} anchor={<button ref={filterButton} type="button" onClick={() => setFiltersOpen(!filtersOpen)}>筛选条件<Kbd>/</Kbd></button>}>
                  <MenuItem label="未归档会话" checked={!archived && kind !== "actions"} onClick={() => { setArchived(false); switchTo("command"); setFiltersOpen(false); }} />
                  <MenuItem label="已归档会话" checked={archived && kind !== "actions"} onClick={() => { setArchived(true); switchTo("command"); setFiltersOpen(false); }} />
                  <MenuItem label="操作" checked={kind === "actions"} onClick={() => { switchTo("actions"); setFiltersOpen(false); }} />
                </Popover>}
                {!compose && active?.threadId && <button type="button" onClick={openRowMenu}>操作<Kbd>alt+enter</Kbd></button>}
                {kind !== "actions" && <button type="button" className="palette-compose-toggle" onClick={() => { setCompose(!compose); input.current?.focus(); }}>{compose ? "搜索" : "撰写"}<Kbd>tab</Kbd></button>}
              </div>
            </div>
          </div>
          <span className="sr-only" role="status">
            {q && searchOn && !searching ? (searchError ? "搜索失败" : count ? `有 ${count} 条结果` : "未找到结果") : ""}
          </span>
        </div>
      </div>
      {/* The title row still drags the window under the scrim (CDS window drag strip). */}
      <div className="dialog-drag-strip" aria-hidden="true" />
    </>
  );
}

/** The keyboard shortcuts panel (c518a31cc Te), grouped like the Code tab's. */
function ShortcutsDialog() {
  const table = bindings();
  const groups = [...new Set(table.map((binding) => binding.group))];
  return (
    <Dialog title="键盘快捷键" onClose={closePalette} size="md">
      <div className="shortcuts" role="region" aria-label="键盘快捷键" tabIndex={0} data-autofocus>
        {groups.map((group) => (
          <div key={group}>
            <h3 className="shortcuts-title">{group}</h3>
            {table
              .filter((binding) => binding.group === group)
              .map((binding) => (
                <div key={binding.id} className="shortcuts-row">
                  <span>{binding.label}</span>
                  <span className="shortcuts-keys">
                    {binding.keys.map((keys, index) => (
                      <Fragment key={keys}>
                        {index > 0 && (
                          <span className="shortcuts-or" aria-hidden="true">
                            或
                          </span>
                        )}
                        <Kbd>{keys}</Kbd>
                      </Fragment>
                    ))}
                  </span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

export function Palette() {
  const open = useStore((s) => s.palette);
  if (!open) return null;
  return mode === "shortcuts" ? <ShortcutsDialog /> : <PaletteDialog />;
}
