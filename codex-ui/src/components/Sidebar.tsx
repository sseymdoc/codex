// Left rail: brand, new chat, thread search, grouped thread history, account footer.

import {
  Archive,
  ArchiveRestore,
  GitFork,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Search,
  Settings,
  SquarePen,
  Trash2,
} from "lucide-react";
import { memo, useEffect, useState } from "react";
import {
  activeTurn,
  archiveThread,
  errorMessage,
  forkThread,
  newChat,
  openThread,
  refreshThreads,
  requestThreadId,
  setListFilter,
  unarchiveThread,
} from "../lib/codex";
import { basename, dateBucket, threadTitle, timeAgo } from "../lib/format";
import { setState, toast, useStore, type ThreadState } from "../lib/store";
import { MenuItem, Popover, QuietDots, Segmented, Spinner, StatusDot } from "./ui";

export function closeSidebarOnMobile() {
  if (matchMedia("(max-width: 860px)").matches) setState({ sidebarOpen: false });
}

const ThreadRow = memo(function ThreadRow({
  thread,
  active,
  waiting,
  archived,
}: {
  thread: ThreadState;
  active: boolean;
  waiting: boolean;
  archived: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const { meta } = thread;
  const running = !!activeTurn(thread) || (meta.status.type === "active" && !waiting);
  const fail = (title: string) => (error: unknown) => toast("error", title, errorMessage(error));
  return (
    <div className={`thread-row ${active ? "active" : ""} ${menu ? "menu-open" : ""}`}>
      <button
        type="button"
        className="thread-main"
        onClick={() => {
          void openThread(meta.id);
          closeSidebarOnMobile();
        }}
        title={threadTitle(meta)}
      >
        <span className="thread-title">{threadTitle(meta)}</span>
        <span className="thread-sub">
          {basename(meta.cwd)} · {timeAgo(meta.recencyAt ?? meta.updatedAt)}
        </span>
      </button>
      <span className="thread-state">
        {waiting ? <StatusDot kind="clay" /> : running ? <QuietDots /> : null}
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
        <MenuItem
          icon={<Pencil size={14} />}
          label="重命名"
          onClick={() => {
            setMenu(false);
            setState({ dialog: { type: "rename", threadId: meta.id } });
          }}
        />
        {!archived && (
          <MenuItem
            icon={<GitFork size={14} />}
            label="创建副本"
            onClick={() => {
              setMenu(false);
              forkThread(meta.id).catch(fail("创建副本失败"));
            }}
          />
        )}
        <MenuItem
          icon={archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          label={archived ? "取消归档" : "归档"}
          onClick={() => {
            setMenu(false);
            (archived ? unarchiveThread(meta.id) : archiveThread(meta.id)).catch(fail(archived ? "取消归档失败" : "归档失败"));
          }}
        />
        <MenuItem
          icon={<Trash2 size={14} />}
          label="删除"
          danger
          onClick={() => {
            setMenu(false);
            setState({ dialog: { type: "delete", threadId: meta.id } });
          }}
        />
      </Popover>
    </div>
  );
});

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

export function Sidebar() {
  const list = useStore((s) => s.list);
  const threads = useStore((s) => s.threads);
  const activeId = useStore((s) => s.activeId);
  const requests = useStore((s) => s.requests);
  const [search, setSearch] = useState(list.search);

  useEffect(() => {
    if (search === list.search) return;
    const timer = setTimeout(() => setListFilter({ search }), 250);
    return () => clearTimeout(timer);
  }, [search, list.search]);

  const waiting = new Set(requests.map(requestThreadId));
  const groups: { title: string; rows: ThreadState[] }[] = [];
  for (const id of list.ids) {
    const thread = threads[id];
    if (!thread) continue;
    const title = dateBucket(thread.meta.recencyAt ?? thread.meta.updatedAt);
    const group = groups.at(-1);
    if (group?.title === title) group.rows.push(thread);
    else groups.push({ title, rows: [thread] });
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={22} height={22} />
          <span className="brand-name">Codex</span>
        </div>
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
      </div>

      <nav className="thread-list scroll-fade" aria-label="会话历史">
        {groups.map((group) => (
          <section key={group.title} className="thread-group">
            <div className="thread-group-title">{group.title}</div>
            {group.rows.map((thread) => (
              <ThreadRow
                key={thread.meta.id}
                thread={thread}
                active={thread.meta.id === activeId}
                waiting={waiting.has(thread.meta.id)}
                archived={list.archived}
              />
            ))}
          </section>
        ))}
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
