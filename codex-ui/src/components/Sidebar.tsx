// The dframe sidebar, Code tab only (claude.ai audit W2, W13; Claude Desktop 2.42304.0.0
// ion-dist shared-21 / shared-styles where the audit measured the Chat tab): title row,
// search, nav rows, server-synced sections, the session list with families and the user
// menu. Four modes: docked, peek (collapsed, hover to float), drawer (narrow) and the phone
// sheet (browser, < 40rem).

import type { ServerRequest } from "@protocol/ServerRequest";
import type { ThreadSection } from "@protocol/v2/ThreadSection";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  CircleHelp,
  Ellipsis,
  FolderInput,
  FolderMinus,
  FolderPlus,
  Gauge,
  GitBranch,
  GitFork,
  Keyboard,
  LogOut,
  Mail,
  MailOpen,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Plus,
  ScrollText,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  activeTurn,
  archiveThread,
  deleteSection,
  errorMessage,
  forkThread,
  logout,
  markRead,
  markUnread,
  moveToSection,
  newChat,
  openThread,
  refreshThreads,
  requestThreadId,
  setListFilter,
  setThreadProject,
  unarchiveThread,
} from "../lib/codex";
import { threadTitle } from "../lib/format";
import { familyOrder, type ListEntry, type SessionSort } from "../lib/session";
import { getState, isUnread, readPref, setState, toast, useStore, writePref, type AppState, type ThreadState } from "../lib/store";
import { requestSummary } from "./Approvals";
import { openPalette, shortcutLabel } from "./Palette";
import { openSettings } from "./Settings";
import { Button, MenuItem, MenuSection, MenuSep, Popover, Spinner, StatusDot, Submenu } from "./ui";

const DRAG_TYPE = "application/x-codex-thread";
const COLLAPSED_KEY = "codex-ui:collapsed-sections";
const WIDTH_KEY = "codex-ui:sidebar-width";
const OPEN_KEY = "codex-ui:sidebar";
const MIN_WIDTH = 232;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 288;
const DESKTOP = typeof window !== "undefined" && !!window.codexDesktop;
const HELP_URL = "https://developers.openai.com/codex";
const CHANGELOG_URL = "https://github.com/openai/codex/releases";

/** Section colors are Cove slots, stored by name so other clients can map them too. */
export const SECTION_COLORS = ["blue", "orange", "green", "yellow", "pink", "forest", "purple", "red"];

export function sectionColor(color: string | null | undefined): string | undefined {
  const index = SECTION_COLORS.indexOf(color ?? "");
  if (index >= 0) return `var(--cds-chart-${index + 1})`;
  return color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : undefined;
}

export function SectionSwatch({ color }: { color: string | null | undefined }) {
  return <span className="section-swatch" style={{ background: sectionColor(color) }} aria-hidden="true" />;
}

const fail = (title: string) => (error: unknown) => toast("error", title, errorMessage(error));

function readCollapsed(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function readWidth(): number {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    if (value) return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
  } catch {
    // Private mode: start at the default width.
  }
  return DEFAULT_WIDTH;
}

// The store starts from the same key (store.ts); narrow screens override it below.
const openPref = () => readPref(OPEN_KEY, ["open", "collapsed"], "open") === "open";

// ---------------------------------------------------------------------------
// Mode: narrow viewports force the sidebar closed (shared-52 Zu(): max(700, width + 329)px),
// collapsed on a wide one it floats out on hover (the peek).

const narrowQuery = (width: number) => `(max-width: ${Math.max(700, Math.ceil(width) + 329)}px)`;

// A narrow window starts with the drawer shut rather than sliding it away after the first paint.
let narrowNow = typeof window !== "undefined" && matchMedia(narrowQuery(readWidth())).matches;
if (narrowNow) setState({ sidebarOpen: false });
let peekOpen = false;
let peekTimer = 0;
const peekListeners = new Set<() => void>();

function setPeek(open: boolean) {
  clearTimeout(peekTimer);
  if (peekOpen === open) return;
  peekOpen = open;
  for (const listener of peekListeners) listener();
}

function usePeek(): boolean {
  return useSyncExternalStore(
    (listener) => {
      peekListeners.add(listener);
      return () => peekListeners.delete(listener);
    },
    () => peekOpen,
  );
}

/** Hover in opens the peek at once; leaving closes it after a short grace (the peek bridge). */
const peekHover = {
  onPointerEnter(event: PointerEvent) {
    if (event.pointerType === "touch" || narrowNow || getState().sidebarOpen) return;
    setPeek(true);
  },
  onPointerLeave() {
    clearTimeout(peekTimer);
    peekTimer = window.setTimeout(() => setPeek(false), 160);
  },
};

export function toggleSidebar() {
  const open = !getState().sidebarOpen;
  setPeek(false);
  setState({ sidebarOpen: open });
  if (!narrowNow) writePref(OPEN_KEY, open ? "open" : "collapsed");
}

/** After choosing a session: close the drawer or the peek. */
export function closeSidebarOnMobile() {
  setPeek(false);
  if (narrowNow) setState({ sidebarOpen: false });
}

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

// ---------------------------------------------------------------------------
// Layout: sections, then the recents list, each in family order (shared-21 rz() / az()).

type Kind = "fork" | "spawn";

interface Row {
  thread: ThreadState;
  place: ListEntry<unknown>["place"];
  parentTitle: string | null;
  kind: Kind | null;
}

/** A sub-agent hangs under the thread that spawned it, a fork under its source. */
function parentOf(thread: ThreadState): string | null {
  return thread.meta.parentThreadId ?? thread.meta.forkedFromId ?? null;
}

function layout({ list, threads, sections }: Pick<AppState, "list" | "threads" | "sections">): { sections: { section: ThreadSection; rows: Row[] }[]; recents: Row[] } {
  // The archive is a flat list; sections only shape the live history.
  const grouped = !list.archived;
  // A family member without a section of its own stays with its root's section.
  const sectionOf = (thread: ThreadState | undefined): string | undefined => {
    for (let depth = 0; thread && depth < 32; depth++) {
      const id = thread.meta.section?.id;
      if (id && sections.some((section) => section.id === id)) return id;
      const parent = parentOf(thread);
      thread = parent ? threads[parent] : undefined;
    }
    return undefined;
  };
  const bySection = new Map<string, ThreadState[]>();
  const loose: ThreadState[] = [];
  for (const id of list.ids) {
    const thread = threads[id];
    if (!thread) continue;
    const sectionId = grouped ? sectionOf(thread) : undefined;
    if (sectionId) bySection.set(sectionId, [...(bySection.get(sectionId) ?? []), thread]);
    else loose.push(thread);
  }
  const order = (group: ThreadState[]): Row[] =>
    familyOrder(
      group.map((thread) => ({
        id: thread.meta.id,
        title: threadTitle(thread.meta),
        recency: thread.meta.recencyAt ?? thread.meta.updatedAt,
        created: thread.meta.createdAt,
        parent: parentOf(thread),
        thread,
      })),
      list.sort,
    ).map(({ row, place }) => {
      const parent = place === "nested" ? parentOf(row.thread) : null;
      return {
        thread: row.thread,
        place,
        parentTitle: parent && threads[parent] ? threadTitle(threads[parent].meta) : null,
        kind: place === "nested" ? (row.thread.meta.parentThreadId ? "spawn" : "fork") : null,
      };
    });
  return {
    sections: grouped ? sections.map((section) => ({ section, rows: order(bySection.get(section.id) ?? []) })) : [],
    recents: order(loose),
  };
}

/** Session ids top to bottom as the sidebar shows them (next / previous / jump shortcuts). */
export function sidebarOrder(): string[] {
  const collapsed = readCollapsed();
  const { sections, recents } = layout(getState());
  return [
    ...sections.filter(({ section }) => !collapsed.includes(section.id)).flatMap(({ rows }) => rows),
    ...(collapsed.includes("recents") ? [] : recents),
  ].map((row) => row.thread.meta.id);
}

/** Feature branches get the second line; main / master would only repeat on every row. */
function ownBranch(thread: ThreadState): string | null {
  const branch = thread.meta.gitInfo?.branch;
  return branch && !/^(main|master|trunk|develop)$/.test(branch) ? branch : null;
}

function open(id: string) {
  void openThread(id);
  closeSidebarOnMobile();
}

const CodeRow = memo(function CodeRow({
  row,
  active,
  blocked,
  archived,
  sections,
}: {
  row: Row;
  active: boolean;
  blocked: ServerRequest | null;
  archived: boolean;
  sections: ThreadSection[];
}) {
  const [menu, setMenu] = useState(false);
  const projects = useStore((s) => s.projects);
  const { thread, kind, parentTitle } = row;
  const { meta } = thread;
  const running = !!activeTurn(thread) || meta.status.type === "active";
  const unread = isUnread(thread);
  const branch = ownBranch(thread);
  // Idle rows carry no dot (shared-styles .status-dot has no idle colour).
  const dot = blocked ? "blocked" : running ? "running" : unread ? "unread" : null;
  const act = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };
  return (
    <div
      className="code-row-wrap"
      data-row=""
      draggable={!archived}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, meta.id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <button
        type="button"
        className="code-row"
        data-roving-item=""
        data-selected={active || undefined}
        data-described={blocked || branch ? "" : undefined}
        aria-current={active ? "page" : undefined}
        onClick={() => open(meta.id)}
      >
        <span className="code-title">
          {threadTitle(meta)}
          {kind && parentTitle && (
            <span className="sr-only">{kind === "spawn" ? `，由 Codex 从「${parentTitle}」启动` : `，派生自「${parentTitle}」`}</span>
          )}
        </span>
        {dot && <StatusDot kind={dot} />}
        {blocked ? (
          <span className="code-meta">
            <span className="warn">已屏蔽</span>
            <bdi>{requestSummary(blocked)}</bdi>
          </span>
        ) : (
          branch && (
            <span className="code-meta">
              <GitBranch size={12} />
              <bdi>{branch}</bdi>
            </span>
          )
        )}
      </button>
      <div className="code-row-act">
        <Popover
          open={menu}
          onClose={() => setMenu(false)}
          placement="bottom-end"
          className="menu-wide"
          anchor={<Button variant="ghost" size="xs" icon={<MoreHorizontal size={16} />} label="更多操作" aria-expanded={menu} onClick={() => setMenu(!menu)} />}
        >
          <MenuItem icon={<Pencil size={16} />} label="重命名" onClick={act(() => setState({ dialog: { type: "rename", threadId: meta.id } }))} />
          {!archived && <MenuItem icon={<GitFork size={16} />} label="派生会话" onClick={act(() => forkThread(meta.id).catch(fail("派生会话失败")))} />}
          {!archived && (
            <Submenu icon={<FolderPlus size={16} />} label="移到分组" value={meta.section?.name}>
              <div className="menu-scroll">
                {sections.map((section) => (
                  <MenuItem
                    key={section.id}
                    icon={<SectionSwatch color={section.appearance?.color} />}
                    label={section.name}
                    checked={meta.section?.id === section.id}
                    onClick={act(() => moveToSection(meta.id, section.id).catch(fail("移动失败")))}
                  />
                ))}
              </div>
              {sections.length > 0 && <MenuSep />}
              {meta.section && <MenuItem icon={<FolderMinus size={16} />} label="移出分组" onClick={act(() => moveToSection(meta.id, null).catch(fail("移动失败")))} />}
              <MenuItem icon={<Plus size={16} />} label="新建分组…" onClick={act(() => setState({ dialog: { type: "section", sectionId: null, threadId: meta.id } }))} />
            </Submenu>
          )}
          {!archived && projects.length > 0 && (
            <Submenu icon={<FolderInput size={16} />} label="移到项目" value={projects.find((p) => p.id === meta.projectId)?.name}>
              <div className="menu-scroll">
                {projects.map((project) => (
                  <MenuItem
                    key={project.id}
                    label={project.name}
                    checked={meta.projectId === project.id}
                    onClick={act(() => setThreadProject(meta.id, project.id).catch(fail("移动失败")))}
                  />
                ))}
              </div>
              {meta.projectId && (
                <>
                  <MenuSep />
                  <MenuItem label="移出项目" onClick={act(() => setThreadProject(meta.id, null).catch(fail("移动失败")))} />
                </>
              )}
            </Submenu>
          )}
          {thread.readState && (
            <MenuItem
              icon={unread ? <MailOpen size={16} /> : <Mail size={16} />}
              label={unread ? "标为已读" : "标为未读"}
              onClick={act(() => (unread ? markRead(meta.id) : markUnread(meta.id)).catch(fail("更新未读状态失败")))}
            />
          )}
          <MenuSep />
          <MenuItem
            icon={archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
            label={archived ? "取消归档" : "归档"}
            onClick={act(() => (archived ? unarchiveThread(meta.id) : archiveThread(meta.id)).catch(fail(archived ? "取消归档失败" : "归档失败")))}
          />
          <MenuItem icon={<Trash2 size={16} />} label="删除" danger onClick={act(() => setState({ dialog: { type: "delete", threadId: meta.id } }))} />
        </Popover>
      </div>
    </div>
  );
});

function SectionLabel({ section, count, closed, onToggle }: { section: ThreadSection; count: number; closed: boolean; onToggle(): void }) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="group-label" data-sidebar-group-label="">
      <button type="button" className="group-toggle" data-group-toggle="" aria-expanded={!closed} onClick={onToggle}>
        <SectionSwatch color={section.appearance?.color} />
        <span className="group-name">{section.name}</span>
        {count > 0 && <span className="group-count tabular">{count}</span>}
        <ChevronDown size={12} className="group-caret" />
      </button>
      <span className="group-actions">
        <Popover
          open={menu}
          onClose={() => setMenu(false)}
          placement="bottom-end"
          anchor={<Button variant="ghost" size="xs" muted icon={<Ellipsis size={16} />} label="分组操作" aria-expanded={menu} onClick={() => setMenu(!menu)} />}
        >
          <MenuItem
            icon={<Pencil size={16} />}
            label="编辑分组"
            onClick={() => {
              setMenu(false);
              setState({ dialog: { type: "section", sectionId: section.id } });
            }}
          />
          <MenuItem
            icon={<Trash2 size={16} />}
            label="删除分组"
            hint="其中的会话会回到「最近」"
            danger
            onClick={() => {
              setMenu(false);
              deleteSection(section.id).catch(fail("删除分组失败"));
            }}
          />
        </Popover>
      </span>
    </div>
  );
}

const SORTS: [SessionSort, string][] = [
  ["recency", "最近活动"],
  ["alpha", "名称"],
  ["created", "创建时间"],
];

/** 「最近」 with its view menu: sort order, the archive and new sections. */
function RecentsLabel({ closed, onToggle }: { closed: boolean; onToggle(): void }) {
  const list = useStore((s) => s.list);
  const [menu, setMenu] = useState(false);
  const pick = (patch: Parameters<typeof setListFilter>[0]) => {
    setMenu(false);
    if (patch.sort) writePref("codex-ui:sort", patch.sort);
    setListFilter(patch);
  };
  return (
    <div className="group-label" data-sidebar-group-label="">
      <button type="button" className="group-toggle" data-group-toggle="" aria-expanded={!closed} onClick={onToggle}>
        <span className="group-name">{list.archived ? "已归档" : "最近"}</span>
        <ChevronDown size={12} className="group-caret" />
      </button>
      <span className="group-actions">
        <Popover
          open={menu}
          onClose={() => setMenu(false)}
          placement="bottom-end"
          anchor={<Button variant="ghost" size="xs" muted icon={<SlidersHorizontal size={14} />} label="排序与筛选" aria-expanded={menu} onClick={() => setMenu(!menu)} />}
        >
          <MenuSection title="排序方式" />
          {SORTS.map(([value, label]) => (
            <MenuItem key={value} label={label} checked={list.sort === value} onClick={() => pick({ sort: value })} />
          ))}
          <MenuSep />
          <MenuItem icon={<Archive size={16} />} label="显示已归档" checked={list.archived} toggle onClick={() => pick({ archived: !list.archived })} />
          {!list.archived && (
            <MenuItem
              icon={<FolderPlus size={16} />}
              label="新建分组…"
              onClick={() => {
                setMenu(false);
                setState({ dialog: { type: "section", sectionId: null } });
              }}
            />
          )}
        </Popover>
      </span>
    </div>
  );
}

function openExternal(url: string) {
  window.open(url, "_blank", "noopener");
}

/** Footer: the user button (avatar · name · plan) spans the row and opens the account menu (cd75f6c8c). */
function UserMenu() {
  const account = useStore((s) => s.account?.account ?? null);
  // null until account/read answers: show an empty button rather than 「未登录」.
  const needsAuth = useStore((s) => (s.account ? s.account.requiresOpenaiAuth : null));
  const [open, setOpen] = useState(false);
  const name =
    account?.type === "chatgpt"
      ? (account.email?.split("@")[0] ?? "ChatGPT")
      : account?.type === "apiKey"
        ? "API Key"
        : account?.type === "amazonBedrock"
          ? "Amazon Bedrock"
          : needsAuth === null
            ? ""
            : needsAuth
              ? "未登录"
              : "本地模型";
  const plan = account?.type === "chatgpt" ? account.planType : null;
  const go = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="top-start"
      className="menu-wide"
      anchor={
        <Button variant="ghost" className="user-btn" aria-expanded={open} aria-label="账户菜单" onClick={() => setOpen(!open)}>
          <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
          <span className="user-name">{name}</span>
          {plan && <span className="user-plan">· {plan}</span>}
          <ChevronDown size={12} className="caret" />
        </Button>
      }
    >
      {account?.type === "chatgpt" && account.email && <MenuSection title={account.email} />}
      <MenuItem icon={<Settings size={16} />} label="设置" kbd={shortcutLabel("settings")} onClick={go(() => openSettings("general"))} />
      <MenuItem icon={<Gauge size={16} />} label="用量" onClick={go(() => openSettings("account", "setting-account-limits"))} />
      <MenuItem icon={<CircleHelp size={16} />} label="获取帮助" onClick={go(() => openExternal(HELP_URL))} />
      {DESKTOP && <MenuItem icon={<ScrollText size={16} />} label="查看更新日志" onClick={go(() => openExternal(CHANGELOG_URL))} />}
      <MenuItem icon={<Keyboard size={16} />} label="键盘快捷键" kbd={shortcutLabel("shortcuts")} onClick={go(() => openPalette("shortcuts"))} />
      {account && (
        <>
          <MenuSep />
          <MenuItem icon={<LogOut size={16} />} label="退出登录" onClick={go(() => void logout().catch(fail("退出失败")))} />
        </>
      )}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Roving focus (shared-18 xD / bD): each [data-tab-section] is one Tab stop and the rest of the
// sidebar one more, ↑ ↓ Home End walk the rows (wrapping), ← → step between a row and its actions.

const ROVING = "[data-roving-item], [data-group-toggle]";
const ROW = "[data-row], [data-sidebar-group-label]";

function rovingItems(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(ROVING)].filter((el) => el.offsetParent !== null && !el.matches(":disabled") && !el.closest("[inert]"));
}

/** The roving item for whatever has focus: itself, or the main item of its row. */
function rovingOwner(el: Element | null): HTMLElement | null {
  return el?.closest<HTMLElement>(ROVING) ?? el?.closest(ROW)?.querySelector<HTMLElement>(ROVING) ?? null;
}

function rowParts(el: Element): HTMLElement[] {
  const row = el.closest(ROW);
  return row ? [...row.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.offsetParent !== null && !b.disabled) : [];
}

function syncTabStops(root: HTMLElement, stops: WeakSet<HTMLElement>) {
  const focused = rovingOwner(root.ownerDocument.activeElement);
  const groups = new Map<Element | null, HTMLElement[]>();
  for (const item of rovingItems(root)) {
    const key = item.closest("[data-tab-section]");
    groups.set(key, [...(groups.get(key) ?? []), item]);
    for (const part of rowParts(item)) if (part !== item) part.tabIndex = -1;
  }
  for (const items of groups.values()) {
    const stop = items.find((item) => item === focused) ?? items.find((item) => stops.has(item)) ?? items[0];
    for (const item of items) {
      item.tabIndex = item === stop ? 0 : -1;
      if (item === stop) stops.add(item);
      else stops.delete(item);
    }
  }
}

function useRovingFocus(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const stops = new WeakSet<HTMLElement>();
    const onTab = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Tab") syncTabStops(el, stops);
    };
    const onFocus = () => {
      if (el.contains(document.activeElement)) syncTabStops(el, stops);
    };
    document.addEventListener("keydown", onTab, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onTab, true);
      document.removeEventListener("focusin", onFocus);
    };
  }, [root]);
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !event.currentTarget.contains(active)) return;
    let target: HTMLElement | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const parts = rowParts(active);
      const at = parts.indexOf(active);
      if (parts.length < 2 || at < 0) return;
      target = parts[Math.max(0, Math.min(parts.length - 1, at + (event.key === "ArrowRight" ? 1 : -1)))];
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      const owner = rovingOwner(active);
      const items = rovingItems(event.currentTarget);
      if (!owner || !items.length) return;
      const at = items.indexOf(owner);
      const down = event.key === "ArrowDown";
      const next =
        event.key === "Home" ? 0
        : event.key === "End" ? items.length - 1
        : at === -1 ? (down ? 0 : items.length - 1)
        : (at + (down ? 1 : -1) + items.length) % items.length;
      target = items[next];
    }
    if (!target || target === active) return;
    event.preventDefault();
    target.focus();
    target.scrollIntoView({ block: "nearest" });
  };
}

/** Drag the right edge between 232 and 420px; the width is remembered. */
function useResize(aside: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(readWidth);
  const start = (event: PointerEvent<HTMLDivElement>) => {
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    handle.dataset.dragging = "";
    const app = aside.current?.closest<HTMLElement>(".app");
    if (app) app.dataset.resizing = "";
    const from = event.clientX - width;
    let next = width;
    const move = (e: globalThis.PointerEvent) => {
      next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX - from));
      setWidth(next);
    };
    const up = () => {
      delete handle.dataset.dragging;
      if (app) delete app.dataset.resizing;
      writePref(WIDTH_KEY, String(Math.round(next)));
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };
  const reset = () => {
    setWidth(DEFAULT_WIDTH);
    writePref(WIDTH_KEY, String(DEFAULT_WIDTH));
  };
  return { width, start, reset };
}

/**
 * The sidebar switch. place="chrome" is the Windows chrome bar's (always shown, Hide / Show
 * sidebar with Ctrl+B, hover peeks when collapsed); "title" sits in the sidebar's own title
 * row; "trigger" is the browser's collapsed-state button at the top left.
 */
export function SidebarToggle({ place = "chrome", size = "sm" }: { place?: "chrome" | "title" | "trigger"; size?: "xs" | "sm" }) {
  const open = useStore((s) => s.sidebarOpen);
  const peek = usePeek();
  const label = place === "title" ? "收起侧栏" : open ? "隐藏侧栏" : "显示侧栏";
  return (
    <span className="sidebar-toggle" {...(place === "title" ? {} : peekHover)}>
      <Button
        variant="ghost"
        size={place === "title" ? "xs" : size}
        className={place === "title" ? "chrome-btn" : undefined}
        icon={<PanelLeft size={16} />}
        label={label}
        kbd={place === "title" ? undefined : "Ctrl+B"}
        // Collapsed, the switch also owns the peek (shared-22 LN(): aria-expanded while peekable).
        aria-expanded={place !== "title" && !open ? peek : undefined}
        onClick={toggleSidebar}
      />
    </span>
  );
}

/** Placeholder rows while the first page of sessions loads (shared-21 kV(), df-placeholder-fade). */
function SkeletonRows() {
  const widths = [0.68, 0.54, 0.44, 0.68, 0.54];
  return (
    <div className="df-placeholder-rows" aria-hidden="true">
      {widths.map((width, index) => (
        <div key={index} className="placeholder-row">
          <i className="placeholder-dot" />
          <i className="placeholder-bar" style={{ width: `${Math.round(width * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

export function Sidebar() {
  const list = useStore((s) => s.list);
  const threads = useStore((s) => s.threads);
  const sections = useStore((s) => s.sections);
  const activeId = useStore((s) => s.activeId);
  const requests = useStore((s) => s.requests);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const peek = usePeek();
  const aside = useRef<HTMLElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const onRovingKey = useRovingFocus(body);
  const { width, start, reset } = useResize(aside);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [expanding, setExpanding] = useState<string | null>(null);
  // Section id under the dragged session; "" is the recents list.
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const narrow = useMedia(narrowQuery(width));
  const phone = useMedia("(width < 40rem)") && !DESKTOP;
  const wco = document.documentElement.hasAttribute("data-wco");
  const mode = narrow ? "drawer" : sidebarOpen ? "docked" : "peek";

  // Narrow screens close the sidebar into a drawer; leaving them brings back the remembered choice.
  useEffect(() => {
    narrowNow = narrow;
    setPeek(false);
    setState({ sidebarOpen: narrow ? false : openPref() });
  }, [narrow]);

  // The chrome bar's peek band and the header's clearance read these (dframe-root inline style).
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--df-sidebar-width", `${width}px`);
    root.setProperty("--df-trigger-right", mode !== "docked" && !wco ? "36px" : "0px");
  }, [width, mode, wco]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
    } catch {
      // Private mode: the fold state just does not persist.
    }
  }, [collapsed]);

  // The list runs to the sidebar's edge; rows give back 8px only when no scrollbar takes it.
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const sync = () => el.style.setProperty("--df-sb", `${el.offsetWidth - el.clientWidth}px`);
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    sync();
    return () => observer.disconnect();
  }, []);

  // Esc closes the peek and hands focus back to the switch.
  useEffect(() => {
    if (!peek) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPeek(false);
      document.querySelector<HTMLElement>(".sidebar-toggle button")?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [peek]);

  const blockedBy = new Map<string, ServerRequest>();
  for (const request of requests) {
    const id = requestThreadId(request);
    if (id && !blockedBy.has(id)) blockedBy.set(id, request);
  }
  const { sections: grouped, recents } = layout({ list, threads, sections });

  const toggle = (id: string) => {
    if (collapsed.includes(id)) setExpanding(id);
    setCollapsed((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  };

  const dropZone = (target: string) => ({
    "data-drop": dropTarget === target || undefined,
    onDragOver: (event: DragEvent) => {
      if (list.archived || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(target);
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDropTarget(null);
      const id = event.dataTransfer.getData(DRAG_TYPE);
      if (id && (threads[id]?.meta.section?.id ?? "") !== target) moveToSection(id, target || null).catch(fail("移动失败"));
    },
  });

  /** Rows in family order: members sit one level in under their root, with a guide line. */
  const rows = (group: Row[]) => {
    const row = (entry: Row) => (
      <CodeRow
        key={entry.thread.meta.id}
        row={entry}
        active={entry.thread.meta.id === activeId}
        blocked={blockedBy.get(entry.thread.meta.id) ?? null}
        archived={list.archived}
        sections={sections}
      />
    );
    const out: ReactNode[] = [];
    for (let i = 0; i < group.length; i++) {
      out.push(row(group[i]));
      if (group[i].place !== "head") continue;
      const family: Row[] = [];
      while (group[i + 1]?.place === "nested") family.push(group[++i]);
      out.push(
        <div key={`family:${group[i - family.length].thread.meta.id}`} className="family">
          {family.map(row)}
        </div>,
      );
    }
    return out;
  };

  const groupBody = (id: string, content: ReactNode) => (
    <div className="group-rows" data-expanding={expanding === id || undefined} onAnimationEnd={() => setExpanding(null)}>
      <div className="code-list">{content}</div>
    </div>
  );

  const recentsClosed = collapsed.includes("recents");
  const firstLoad = list.loading && list.ids.length === 0;

  return (
    <>
      {mode !== "docked" && !wco && !(mode === "drawer" && sidebarOpen) && (
        <div className="sidebar-trigger" data-phone={phone || undefined}>
          <SidebarToggle place="trigger" />
        </div>
      )}
      <aside
        className="sidebar"
        ref={aside}
        data-density="compact"
        data-mode={mode}
        data-open={(mode === "docked" || (mode === "drawer" ? sidebarOpen : peek)) || undefined}
        data-phone={phone || undefined}
        style={{ "--sidebar-w": `${width}px` } as CSSProperties}
        aria-label="侧栏"
        aria-hidden={mode !== "docked" && !(mode === "drawer" ? sidebarOpen : peek) ? true : undefined}
        {...(mode === "peek" ? peekHover : {})}
      >
        <div className="sidebar-titlebar">
          <span className="reveal">
            <SidebarToggle place="title" />
          </span>
          <span className="wordmark">Codex</span>
        </div>

        <div className="sidebar-body" ref={body} onKeyDown={onRovingKey}>
          <button
            type="button"
            className="sidebar-search hit-row"
            data-row=""
            data-roving-item=""
            data-tab-section=""
            onClick={() => openPalette("command")}
          >
            <span className="nav-lead">
              <Search />
            </span>
            <span className="nav-label">搜索</span>
            <kbd className="kbd">Ctrl K</kbd>
          </button>

          <div className="sidebar-scroll scroll-fade-y" ref={scroll}>
            <div>
              <nav className="nav-rows" aria-label="导航">
                <button
                  type="button"
                  className="nav-row nav-row-new hit-row"
                  data-row=""
                  data-roving-item=""
                  data-selected={activeId === null || undefined}
                  onClick={() => {
                    newChat();
                    closeSidebarOnMobile();
                  }}
                >
                  <span className="nav-lead">
                    <span className="new-circle">
                      <Plus strokeWidth={2.6} />
                    </span>
                  </span>
                  <span className="nav-label">新建会话</span>
                  <kbd className="kbd">{shortcutLabel("new")}</kbd>
                </button>
                <button type="button" className="nav-row hit-row" data-row="" data-roving-item="" onClick={() => openSettings("skills")}>
                  <span className="nav-lead">
                    <SlidersHorizontal />
                  </span>
                  <span className="nav-label">自定义</span>
                </button>
              </nav>

              <div className="session-list" aria-label="会话">
                {grouped.map(({ section, rows: group }) => {
                  const closed = collapsed.includes(section.id);
                  return (
                    <section key={section.id} className="list-group" {...dropZone(section.id)}>
                      <SectionLabel section={section} count={group.length} closed={closed} onToggle={() => toggle(section.id)} />
                      {!closed && group.length > 0 && groupBody(section.id, rows(group))}
                      {!closed && group.length === 0 && <div className="group-empty">把会话拖到这里</div>}
                    </section>
                  );
                })}
                <section className="list-group" {...dropZone("")}>
                  <RecentsLabel closed={recentsClosed} onToggle={() => toggle("recents")} />
                  {!recentsClosed && firstLoad && <SkeletonRows />}
                  {!recentsClosed && !firstLoad && groupBody("recents", rows(recents))}
                </section>
                {list.error && !list.loading && list.ids.length === 0 && (
                  <div className="list-error">
                    <p>侧栏加载失败。</p>
                    <Button variant="secondary" size="sm" data-roving-item="" onClick={() => void refreshThreads()}>
                      重试
                    </Button>
                  </div>
                )}
                {!list.loading && !list.error && list.ids.length === 0 && (
                  <div className="list-empty">{list.archived ? "没有已归档的会话" : "还没有会话"}</div>
                )}
                {list.loading && list.ids.length > 0 && (
                  <div className="list-empty">
                    <Spinner size={13} />
                  </div>
                )}
                {list.cursor && !list.loading && (
                  <Button variant="ghost" size="sm" ink2 className="list-more" data-roving-item="" onClick={() => void refreshThreads(true)}>
                    加载更多
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="sidebar-foot">
          <UserMenu />
        </div>
        {mode === "docked" && (
          <div className="sidebar-resize" role="separator" aria-orientation="vertical" aria-label="调整侧栏宽度" onPointerDown={start} onDoubleClick={reset}>
            <i />
          </div>
        )}
      </aside>
      {mode === "drawer" && !phone && (
        <div className="sidebar-scrim" data-open={sidebarOpen || undefined} onClick={() => setState({ sidebarOpen: false })} />
      )}
    </>
  );
}
