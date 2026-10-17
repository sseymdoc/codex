// Left rail: brand, new chat, thread search, server-synced sections (drag threads
// between them), date-grouped thread history and the account footer.

import type { ThreadSection } from "@protocol/v2/ThreadSection";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Command,
  FolderMinus,
  FolderPlus,
  GitFork,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Search,
  Settings,
  SquarePen,
  Trash2,
} from "lucide-react";
import { memo, useEffect, useState, type DragEvent } from "react";
import {
  activeTurn,
  archiveThread,
  deleteSection,
  errorMessage,
  forkThread,
  moveToSection,
  newChat,
  openThread,
  refreshThreads,
  requestThreadId,
  setListFilter,
  unarchiveThread,
} from "../lib/codex";
import { basename, dateBucket, threadTitle, timeAgo } from "../lib/format";
import { setState, toast, useStore, type ThreadState } from "../lib/store";
import { MenuItem, MenuSection, Popover, Segmented, Spinner, StatusDot } from "./ui";

const DRAG_TYPE = "application/x-codex-thread";
const COLLAPSED_KEY = "codex-ui:collapsed-sections";

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

const ThreadRow = memo(function ThreadRow({
  thread,
  active,
  waiting,
  archived,
  sections,
}: {
  thread: ThreadState;
  active: boolean;
  waiting: boolean;
  archived: boolean;
  sections: ThreadSection[];
}) {
  const [menu, setMenu] = useState(false);
  const { meta } = thread;
  const running = !!activeTurn(thread) || (meta.status.type === "active" && !waiting);
  const act = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };
  return (
    <div
      className={`thread-row ${active ? "active" : ""} ${menu ? "menu-open" : ""}`}
      draggable={!archived}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, meta.id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <button
        type="button"
        className="thread-main"
        onClick={() => {
          void openThread(meta.id);
          closeSidebarOnMobile();
        }}
        title={`${threadTitle(meta)}\n${basename(meta.cwd)} · ${timeAgo(meta.recencyAt ?? meta.updatedAt)}`}
      >
        <span className="thread-title">{threadTitle(meta)}</span>
      </button>
      <span className="thread-state" title={waiting ? "等待你的确认" : running ? "运行中" : thread.unread ? "有新回复" : undefined}>
        {waiting ? <StatusDot kind="clay" /> : running ? <StatusDot kind="running" /> : thread.unread ? <StatusDot kind="unread" /> : null}
      </span>
      <Popover
        open={menu}
        onClose={() => setMenu(false)}
        placement="bottom-end"
        className="menu"
        anchor={
          <button type="button" className="icon-btn icon-btn-sm thread-more" aria-label="更多操作" onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={15} />
          </button>
        }
      >
        <MenuItem icon={<Pencil size={14} />} label="重命名" onClick={act(() => setState({ dialog: { type: "rename", threadId: meta.id } }))} />
        {!archived && <MenuItem icon={<GitFork size={14} />} label="创建副本" onClick={act(() => forkThread(meta.id).catch(fail("创建副本失败")))} />}
        {!archived && (
          <>
            <MenuSection title="移到分组" />
            {sections.map((section) => (
              <MenuItem
                key={section.id}
                icon={<SectionSwatch color={section.appearance?.color} />}
                label={section.name}
                checked={meta.section?.id === section.id}
                onClick={act(() => moveToSection(meta.id, section.id).catch(fail("移动失败")))}
              />
            ))}
            {meta.section && <MenuItem icon={<FolderMinus size={14} />} label="移出分组" onClick={act(() => moveToSection(meta.id, null).catch(fail("移动失败")))} />}
            <MenuItem
              icon={<FolderPlus size={14} />}
              label="新建分组…"
              onClick={act(() => setState({ dialog: { type: "section", sectionId: null, threadId: meta.id } }))}
            />
            <div className="menu-sep" />
          </>
        )}
        <MenuItem
          icon={archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          label={archived ? "取消归档" : "归档"}
          onClick={act(() => (archived ? unarchiveThread(meta.id) : archiveThread(meta.id)).catch(fail(archived ? "取消归档失败" : "归档失败")))}
        />
        <MenuItem icon={<Trash2 size={14} />} label="删除" danger onClick={act(() => setState({ dialog: { type: "delete", threadId: meta.id } }))} />
      </Popover>
    </div>
  );
});

function SectionHeader({ section, count, closed, onToggle }: { section: ThreadSection; count: number; closed: boolean; onToggle(): void }) {
  const [menu, setMenu] = useState(false);
  return (
    <div className={`section-head ${menu ? "menu-open" : ""}`}>
      <button type="button" className="section-toggle" aria-expanded={!closed} onClick={onToggle}>
        <ChevronRight size={12} className={`chev ${closed ? "" : "open"}`} />
        <SectionSwatch color={section.appearance?.color} />
        <span className="section-name">{section.name}</span>
        <span className="section-count tabular">{count}</span>
      </button>
      <Popover
        open={menu}
        onClose={() => setMenu(false)}
        placement="bottom-end"
        className="menu"
        anchor={
          <button type="button" className="icon-btn icon-btn-sm section-more" aria-label="分组操作" onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={14} />
          </button>
        }
      >
        <MenuItem
          icon={<Pencil size={14} />}
          label="编辑分组"
          onClick={() => {
            setMenu(false);
            setState({ dialog: { type: "section", sectionId: section.id } });
          }}
        />
        <MenuItem
          icon={<Trash2 size={14} />}
          label="删除分组"
          hint="其中的会话会回到列表"
          danger
          onClick={() => {
            setMenu(false);
            deleteSection(section.id).catch(fail("删除分组失败"));
          }}
        />
      </Popover>
    </div>
  );
}

function AccountFooter() {
  const account = useStore((s) => s.account?.account ?? null);
  const needsAuth = useStore((s) => s.account?.requiresOpenaiAuth ?? true);
  const label =
    account?.type === "chatgpt"
      ? (account.email ?? "ChatGPT 账户")
      : account?.type === "apiKey"
        ? "API Key"
        : account?.type === "amazonBedrock"
          ? "Amazon Bedrock"
          : needsAuth
            ? "未登录"
            : "自定义模型提供方";
  const plan = account?.type === "chatgpt" ? account.planType : null;
  return (
    <div className="sidebar-foot">
      <button type="button" className="account-chip" onClick={() => setState({ settings: "account" })}>
        <span className="avatar">{label.slice(0, 1).toUpperCase()}</span>
        <span className="account-text">
          <span className="account-name">{label}</span>
          {plan && <span className="account-plan">{plan}</span>}
        </span>
      </button>
      <button type="button" className="icon-btn" aria-label="设置" title="设置" onClick={() => setState({ settings: "general" })}>
        <Settings size={16} />
      </button>
    </div>
  );
}

function dateGroups(rows: ThreadState[]): { title: string; rows: ThreadState[] }[] {
  const groups: { title: string; rows: ThreadState[] }[] = [];
  for (const thread of rows) {
    const title = dateBucket(thread.meta.recencyAt ?? thread.meta.updatedAt);
    const group = groups.at(-1);
    if (group?.title === title) group.rows.push(thread);
    else groups.push({ title, rows: [thread] });
  }
  return groups;
}

export function Sidebar() {
  const list = useStore((s) => s.list);
  const threads = useStore((s) => s.threads);
  const sections = useStore((s) => s.sections);
  const activeId = useStore((s) => s.activeId);
  const requests = useStore((s) => s.requests);
  const [search, setSearch] = useState(list.search);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // Section id under the dragged thread; "" is the ungrouped list.
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => {
    if (search === list.search) return;
    const timer = setTimeout(() => setListFilter({ search }), 250);
    return () => clearTimeout(timer);
  }, [search, list.search]);

  const waiting = new Set(requests.map(requestThreadId));
  // Search results and the archive are flat lists; sections only shape the live history.
  const grouped = !list.archived && !list.search;
  const bySection = new Map<string, ThreadState[]>();
  const loose: ThreadState[] = [];
  for (const id of list.ids) {
    const thread = threads[id];
    if (!thread) continue;
    const sectionId = thread.meta.section?.id;
    if (grouped && sectionId && sections.some((section) => section.id === sectionId)) bySection.set(sectionId, [...(bySection.get(sectionId) ?? []), thread]);
    else loose.push(thread);
  }

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // Private mode: the fold state just does not persist.
      }
      return next;
    });

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

  const row = (thread: ThreadState) => (
    <ThreadRow
      key={thread.meta.id}
      thread={thread}
      active={thread.meta.id === activeId}
      waiting={waiting.has(thread.meta.id)}
      archived={list.archived}
      sections={sections}
    />
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={22} height={22} />
          <span className="brand-name">Codex</span>
        </div>
        <button type="button" className="icon-btn" aria-label="搜索与命令" title="搜索与命令 (Ctrl K)" onClick={() => setState({ palette: true })}>
          <Command size={15} />
        </button>
        <button type="button" className="icon-btn" aria-label="收起侧栏" title="收起侧栏" onClick={() => setState({ sidebarOpen: false })}>
          <PanelLeftClose size={16} />
        </button>
      </div>

      <button
        type="button"
        className="new-chat"
        onClick={() => {
          newChat();
          closeSidebarOnMobile();
        }}
      >
        <SquarePen size={15} />
        <span>新建会话</span>
      </button>

      <label className="search-box">
        <Search size={14} />
        <input value={search} placeholder="搜索会话" onChange={(event) => setSearch(event.target.value)} aria-label="搜索会话" />
      </label>

      <div className="sidebar-filter">
        <Segmented
          value={list.archived ? "archived" : "active"}
          options={[
            { value: "active", label: "会话" },
            { value: "archived", label: "已归档" },
          ]}
          onChange={(value) => setListFilter({ archived: value === "archived" })}
        />
        {!list.archived && (
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label="新建分组"
            title="新建分组"
            onClick={() => setState({ dialog: { type: "section", sectionId: null } })}
          >
            <FolderPlus size={15} />
          </button>
        )}
      </div>

      <nav className="thread-list scroll-fade" aria-label="会话历史">
        {grouped &&
          sections.map((section) => {
            const rows = bySection.get(section.id) ?? [];
            const closed = collapsed.includes(section.id);
            return (
              <section key={section.id} className="thread-group section-group" {...dropZone(section.id)}>
                <SectionHeader section={section} count={rows.length} closed={closed} onToggle={() => toggle(section.id)} />
                {!closed && rows.map(row)}
                {!closed && rows.length === 0 && <div className="section-empty">把会话拖到这里</div>}
              </section>
            );
          })}
        <div className="loose-threads" {...dropZone("")}>
          {dateGroups(loose).map((group) => (
            <section key={group.title} className="thread-group">
              <div className="thread-group-title">{group.title}</div>
              {group.rows.map(row)}
            </section>
          ))}
        </div>
        {list.loading && (
          <div className="thread-empty">
            <Spinner size={13} />
          </div>
        )}
        {!list.loading && list.ids.length === 0 && (
          <div className="thread-empty">{list.search ? "没有匹配的会话" : list.archived ? "没有已归档的会话" : "还没有会话"}</div>
        )}
        {list.cursor && !list.loading && (
          <button type="button" className="chip-btn load-more" onClick={() => void refreshThreads(true)}>
            加载更多
          </button>
        )}
      </nav>

      <AccountFooter />
    </aside>
  );
}
