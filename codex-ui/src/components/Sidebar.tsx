// The dframe sidebar (claude.ai audit W2, W13), Code tab only: title row, search, nav
// rows, server-synced sections, the session list with fork families, and the user menu.

import type { ServerRequest } from "@protocol/ServerRequest";
import type { ThreadSection } from "@protocol/v2/ThreadSection";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Ellipsis,
  FlaskConical,
  FolderMinus,
  FolderPlus,
  Gauge,
  GitBranch,
  GitFork,
  Info,
  LogOut,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Plus,
  ScanSearch,
  Search,
  Settings,
  SlidersHorizontal,
  SunMoon,
  Trash2,
} from "lucide-react";
import { memo, useEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import {
  activeTurn,
  archiveThread,
  deleteSection,
  errorMessage,
  forkThread,
  logout,
  moveToSection,
  newChat,
  openThread,
  refreshThreads,
  requestThreadId,
  setListFilter,
  unarchiveThread,
} from "../lib/codex";
import { threadTitle } from "../lib/format";
import { familyOrder, type SessionSort } from "../lib/session";
import { setState, toast, useStore, writePref, type ThreadState } from "../lib/store";
import { requestSummary } from "./Approvals";
import { currentTheme, saveTheme } from "./Settings";
import { Button, MenuItem, MenuSection, MenuSep, Popover, Spinner, StatusDot, Submenu } from "./ui";

const DRAG_TYPE = "application/x-codex-thread";
const COLLAPSED_KEY = "codex-ui:collapsed-sections";
const WIDTH_KEY = "codex-ui:sidebar-width";
const MIN_WIDTH = 232;
const MAX_WIDTH = 420;

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

export function closeSidebarOnMobile() {
  if (matchMedia("(max-width: 860px)").matches) setState({ sidebarOpen: false });
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
  return 288;
}

/** Feature branches get the second line; main / master would only repeat on every row. */
function ownBranch(thread: ThreadState): string | null {
  const branch = thread.meta.gitInfo?.branch;
  return branch && !/^(main|master|trunk|develop)$/.test(branch) ? branch : null;
}

const CodeRow = memo(function CodeRow({
  thread,
  active,
  blocked,
  nested,
  parentTitle,
  archived,
  sections,
}: {
  thread: ThreadState;
  active: boolean;
  blocked: ServerRequest | null;
  nested: boolean;
  parentTitle: string | null;
  archived: boolean;
  sections: ThreadSection[];
}) {
  const [menu, setMenu] = useState(false);
  const { meta } = thread;
  const running = !!activeTurn(thread) || meta.status.type === "active";
  const branch = ownBranch(thread);
  const dot = blocked ? "blocked" : running ? "running" : thread.unread ? "unread" : "idle";
  const act = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };
  return (
    <div
      className="code-row-wrap"
      draggable={!archived}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, meta.id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <button
        type="button"
        className="code-row"
        data-selected={active || undefined}
        data-described={blocked || branch ? "" : undefined}
        aria-current={active ? "page" : undefined}
        style={nested ? undefined : ({ "--indent": "0px" } as CSSProperties)}
        onClick={() => {
          void openThread(meta.id);
          closeSidebarOnMobile();
        }}
      >
        <span className="code-title">
          {threadTitle(meta)}
          {nested && parentTitle && <span className="sr-only">，派生自「{parentTitle}」</span>}
        </span>
        <StatusDot kind={dot} />
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
          anchor={
            <Button variant="ghost" size="xs" icon={<MoreHorizontal size={16} />} label="更多操作" aria-expanded={menu} onClick={() => setMenu(!menu)} />
          }
        >
          <MenuItem icon={<Pencil size={16} />} label="重命名" onClick={act(() => setState({ dialog: { type: "rename", threadId: meta.id } }))} />
          {!archived && <MenuItem icon={<GitFork size={16} />} label="创建分支会话" onClick={act(() => forkThread(meta.id).catch(fail("创建分支失败")))} />}
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
    <div className="group-label">
      <button type="button" className="group-toggle" aria-expanded={!closed} onClick={onToggle}>
        <SectionSwatch color={section.appearance?.color} />
        <span className="group-name">{section.name}</span>
        <span className="tabular">{count || ""}</span>
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

/** "最近" with its view menu: sort order, the archive and new sections. */
function RecentsLabel({ closed, onToggle }: { closed: boolean; onToggle(): void }) {
  const list = useStore((s) => s.list);
  const [menu, setMenu] = useState(false);
  const pick = (patch: Parameters<typeof setListFilter>[0]) => {
    setMenu(false);
    if (patch.sort) writePref("codex-ui:sort", patch.sort);
    setListFilter(patch);
  };
  return (
    <div className="group-label">
      <button type="button" className="group-toggle" aria-expanded={!closed} onClick={onToggle}>
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
          {!list.archived && <MenuSep />}
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

/** Footer: the user button (avatar · name · plan) opens the account menu. */
function UserMenu() {
  const account = useStore((s) => s.account?.account ?? null);
  const needsAuth = useStore((s) => s.account?.requiresOpenaiAuth ?? true);
  const [open, setOpen] = useState(false);
  const name =
    account?.type === "chatgpt"
      ? (account.email?.split("@")[0] ?? "ChatGPT")
      : account?.type === "apiKey"
        ? "API Key"
        : account?.type === "amazonBedrock"
          ? "Amazon Bedrock"
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
      {account?.type === "chatgpt" && account.email && <div className="menu-note">{account.email}</div>}
      <MenuItem icon={<Settings size={16} />} label="设置" kbd="Ctrl + ," onClick={go(() => setState({ settings: "general" }))} />
      <MenuItem icon={<Gauge size={16} />} label="账户与用量" onClick={go(() => setState({ settings: "account" }))} />
      <Submenu icon={<SunMoon size={16} />} label="外观" className="menu-model">
        {(
          [
            ["light", "浅色"],
            ["dark", "深色"],
            ["system", "跟随系统"],
          ] as const
        ).map(([value, label]) => (
          <MenuItem key={value} label={label} checked={currentTheme() === value} onClick={go(() => saveTheme(value))} />
        ))}
      </Submenu>
      <MenuItem icon={<FlaskConical size={16} />} label="实验功能" onClick={go(() => setState({ settings: "labs" }))} />
      <MenuItem icon={<Info size={16} />} label="关于 Codex UI" onClick={go(() => setState({ settings: "about" }))} />
      {account && (
        <>
          <MenuSep />
          <MenuItem icon={<LogOut size={16} />} label="退出登录" onClick={go(() => void logout().catch(fail("退出失败")))} />
        </>
      )}
    </Popover>
  );
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
    setWidth(288);
    writePref(WIDTH_KEY, "288");
  };
  return { width, start, reset };
}

export function SidebarToggle({ size = "xs" }: { size?: "xs" | "sm" }) {
  const open = useStore((s) => s.sidebarOpen);
  return (
    <Button
      variant="ghost"
      size={size}
      icon={<PanelLeft size={16} />}
      label={open ? "收起侧栏" : "展开侧栏"}
      kbd="Ctrl+B"
      onClick={() => setState({ sidebarOpen: !open })}
    />
  );
}

export function Sidebar() {
  const list = useStore((s) => s.list);
  const threads = useStore((s) => s.threads);
  const sections = useStore((s) => s.sections);
  const activeId = useStore((s) => s.activeId);
  const requests = useStore((s) => s.requests);
  const aside = useRef<HTMLElement>(null);
  const { width, start, reset } = useResize(aside);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // Section id under the dragged session; "" is the recents list.
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
    } catch {
      // Private mode: the fold state just does not persist.
    }
  }, [collapsed]);

  const blockedBy = new Map<string, ServerRequest>();
  for (const request of requests) {
    const id = requestThreadId(request);
    if (id && !blockedBy.has(id)) blockedBy.set(id, request);
  }

  // The archive is a flat list; sections only shape the live history.
  const grouped = !list.archived;
  // A fork without a section of its own stays with its family root's section.
  const sectionOf = (thread: ThreadState | undefined): string | undefined => {
    for (let depth = 0; thread && depth < 32; depth++) {
      const id = thread.meta.section?.id;
      if (id && sections.some((section) => section.id === id)) return id;
      thread = thread.meta.forkedFromId ? threads[thread.meta.forkedFromId] : undefined;
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

  const toggle = (id: string) => setCollapsed((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  const dropZone = (target: string) => ({
    "data-drop": dropTarget === target || undefined,
    onDragOver: (event: DragEvent) => {
      if (!grouped || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
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

  /** Rows in family order: forks nest one level under their root with a guide line. */
  const rows = (group: ThreadState[]) => {
    const entries = familyOrder(
      group.map((thread) => ({
        id: thread.meta.id,
        title: threadTitle(thread.meta),
        recency: thread.meta.recencyAt ?? thread.meta.updatedAt,
        created: thread.meta.createdAt,
        parent: thread.meta.forkedFromId,
        thread,
      })),
      list.sort,
    );
    const row = (thread: ThreadState, nested: boolean) => (
      <CodeRow
        key={thread.meta.id}
        thread={thread}
        active={thread.meta.id === activeId}
        blocked={blockedBy.get(thread.meta.id) ?? null}
        nested={nested}
        parentTitle={nested && thread.meta.forkedFromId && threads[thread.meta.forkedFromId] ? threadTitle(threads[thread.meta.forkedFromId].meta) : null}
        archived={list.archived}
        sections={sections}
      />
    );
    const out: ReactNode[] = [];
    for (let i = 0; i < entries.length; i++) {
      out.push(row(entries[i].row.thread, false));
      if (entries[i].place !== "head") continue;
      const family: ThreadState[] = [];
      while (entries[i + 1]?.place === "nested") family.push(entries[++i].row.thread);
      out.push(
        <div key={`family:${entries[i - family.length].row.id}`} className="family">
          {family.map((thread) => row(thread, true))}
        </div>,
      );
    }
    return out;
  };

  const recentsClosed = collapsed.includes("recents");

  return (
    <aside className="sidebar" ref={aside} style={{ "--sidebar-w": `${width}px` } as CSSProperties} aria-label="侧栏">
      <div className="sidebar-titlebar">
        <span className="reveal">
          <SidebarToggle />
        </span>
        <span className="wordmark">Codex</span>
      </div>

      <div className="sidebar-body">
        <button type="button" className="sidebar-search" onClick={() => setState({ palette: true })}>
          <Search size={16} />
          <span>搜索</span>
          <kbd className="kbd">Ctrl K</kbd>
        </button>

        <nav className="nav-rows" aria-label="导航">
          <button
            type="button"
            className="nav-row nav-row-new"
            data-selected={activeId === null || undefined}
            onClick={() => {
              newChat();
              closeSidebarOnMobile();
            }}
          >
            <span className="nav-lead">
              <span className="new-circle">
                <Plus size={16} strokeWidth={2.6} />
              </span>
            </span>
            <span className="nav-label">新建会话</span>
            <kbd className="kbd">Ctrl + Shift + O</kbd>
          </button>
          <button type="button" className="nav-row" onClick={() => setState((s) => ({ dialog: { type: "review", threadId: s.activeId } }))}>
            <span className="nav-lead">
              <ScanSearch />
            </span>
            <span className="nav-label">审查代码</span>
          </button>
          <button type="button" className="nav-row" onClick={() => setState({ settings: "skills" })}>
            <span className="nav-lead">
              <SlidersHorizontal />
            </span>
            <span className="nav-label">自定义</span>
          </button>
          <button type="button" className="nav-row" onClick={() => setListFilter({ archived: !list.archived })} aria-pressed={list.archived}>
            <span className="nav-lead">{list.archived ? <ArchiveRestore /> : <Archive />}</span>
            <span className="nav-label">{list.archived ? "返回最近会话" : "已归档"}</span>
          </button>
        </nav>

        <div className="session-list scroll-fade-y" aria-label="会话">
          {grouped &&
            sections.map((section) => {
              const group = bySection.get(section.id) ?? [];
              const closed = collapsed.includes(section.id);
              return (
                <section key={section.id} className="list-group" {...dropZone(section.id)}>
                  <SectionLabel section={section} count={group.length} closed={closed} onToggle={() => toggle(section.id)} />
                  {!closed && <div className="code-list">{rows(group)}</div>}
                  {!closed && group.length === 0 && <div className="group-empty">把会话拖到这里</div>}
                </section>
              );
            })}
          <section className="list-group" {...dropZone("")}>
            <RecentsLabel closed={recentsClosed} onToggle={() => toggle("recents")} />
            {!recentsClosed && <div className="code-list">{rows(loose)}</div>}
          </section>
          {list.loading && (
            <div className="list-empty">
              <Spinner size={13} />
            </div>
          )}
          {!list.loading && list.ids.length === 0 && (
            <div className="list-empty">{list.archived ? "没有已归档的会话" : "还没有会话"}</div>
          )}
          {list.cursor && !list.loading && (
            <Button variant="ghost" size="sm" ink2 className="list-more" onClick={() => void refreshThreads(true)}>
              加载更多
            </Button>
          )}
        </div>
      </div>

      <div className="sidebar-foot">
        <UserMenu />
        <span className="spacer" />
        <Button variant="ghost" icon={<Settings size={20} />} label="设置" onClick={() => setState({ settings: "general" })} />
      </div>
      <div className="sidebar-resize" role="separator" aria-orientation="vertical" aria-label="调整侧栏宽度" onPointerDown={start} onDoubleClick={reset}>
        <i />
      </div>
    </aside>
  );
}

