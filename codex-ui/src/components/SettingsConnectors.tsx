// Connectors (Claude's customize → 连接器, c40525e86 mo): 我的 is one table of the ChatGPT apps (网页版) and
// MCP servers (桌面端) with a search, a status filter and an add menu; 发现 is the ChatGPT app directory.
// A row opens the connector's page (c08e79e85 Tn): its local config and Claude's tool permissions
// (c4ac4d9d6), written to config.toml (`apps.<id>.tools`, `mcp_servers.<name>`).

import type { AppInfo } from "@protocol/v2/AppInfo";
import type { AppToolSummary } from "@protocol/v2/AppToolSummary";
import type { McpServerStatus } from "@protocol/v2/McpServerStatus";
import type { Tool } from "@protocol/Tool";
import { useEffect, useId, useState, type ReactNode } from "react";
import {
  addMcpServer,
  browseConnectors,
  configuredMcpServers,
  errorMessage,
  fail,
  listConnectors,
  loginMcpServer,
  mcpServerToml,
  readConnectorTools,
  refreshMcp,
  reloadMcpServers,
  removeMcpServer,
  setAppToolPermission,
  setConnectorEnabled,
  setMcpServerEnabled,
  setMcpToolPermission,
  type McpServerToml,
  type ToolApproval,
  type ToolPermission,
} from "../lib/codex";
import { externalUrl } from "../lib/format";
import { getState, toast, useStore, type Connector } from "../lib/store";
import { ConnectorIcon } from "./ConnectorIcon";
import { Confirm, openSettings } from "./Settings";
import { Button, Dialog, Icon, MenuItem, MenuSection, Popover, Segmented, Skeleton, Spinner, type IconName } from "./ui";

// ---------------------------------------------------------------------------
// The list: apps and servers as one kind of row.

/** ccea1f474 Oo: a check, a spinner, a dash, 连接, or a warning with 重新连接. */
type Status = "connected" | "connecting" | "unavailable" | "connect" | "reconnect";
type Filter = "all" | "connected" | "notConnected";

interface Server {
  name: string;
  pluginId: string | null;
  status: McpServerStatus | null;
  toml: McpServerToml | undefined;
}

interface Item {
  key: string;
  name: string;
  description: string | null;
  light: string | null;
  dark: string | null;
  /** 网页版 (a ChatGPT app) or 桌面端 (an MCP server Codex runs). */
  web: boolean;
  badge: string | null;
  plugin: string | null;
  status: Status;
  app?: Connector;
  server?: Server;
}

const CONNECTED: Status[] = ["connected", "connecting", "unavailable"];
/** Codex's own server for the ChatGPT apps: they are listed as apps. */
const APPS_SERVER = "codex_apps";

function serverStatus(status: McpServerStatus | null, toml: McpServerToml | undefined): Status {
  if (toml?.enabled === false || status?.runtimeStatus === "disabled") return "connect";
  if (!status) return "reconnect";
  if (status.authStatus === "notLoggedIn" || status.runtimeStatus === "authenticationRequired") return "connect";
  if (status.runtimeStatus === "starting") return "connecting";
  if (status.toolsError || status.runtimeStatus === "failed") return "reconnect";
  return "connected";
}

/** Issues first, then connected, then the rest; by name within each. */
const RANK: Record<Status, number> = { reconnect: 0, connected: 1, connecting: 1, unavailable: 1, connect: 2 };

/** The rows, or null while the apps or the MCP inventory are loading. Servers only in config.toml (left out
 * of the inventory once disabled) are added from there. */
function useItems(): Item[] | null {
  const connectors = useStore((s) => s.connectors);
  const servers = useStore((s) => s.mcp);
  const plugins = useStore((s) => s.plugins);
  useStore((s) => s.config);
  if (!connectors || !servers) return null;
  const pluginName = (id: string) => {
    const plugin = plugins?.find((entry) => entry.id === id);
    return plugin?.interface?.displayName ?? plugin?.name ?? id.split("@")[0];
  };
  const apps = connectors.map(
    (app): Item => ({
      key: `app:${app.id}`,
      name: app.name,
      description: app.description,
      light: app.iconUrl,
      dark: app.iconUrlDark,
      web: true,
      badge: null,
      plugin: null,
      status: !app.enabled ? "connect" : app.callable ? "connected" : "unavailable",
      app,
    }),
  );
  const listed = servers.filter((server) => server.name !== APPS_SERVER);
  const configOnly = Object.keys(configuredMcpServers()).filter((name) => !listed.some((server) => server.name === name && !server.pluginId));
  const all: Server[] = [
    ...listed.map((status) => ({ name: status.name, pluginId: status.pluginId, status, toml: mcpServerToml(status.name, status.pluginId) })),
    ...configOnly.map((name) => ({ name, pluginId: null, status: null, toml: mcpServerToml(name, null) })),
  ];
  const mcp = all.map(
    (server): Item => ({
      key: `mcp:${server.pluginId ?? ""}:${server.name}`,
      name: server.name,
      description: null,
      light: null,
      dark: null,
      web: false,
      // ccea1f474 id: 插件 for a plugin's server, 自定义 for one added by URL, 本地开发 for a command.
      badge: server.pluginId ? "插件" : server.toml?.url || server.status?.httpOrigin ? "自定义" : "本地开发",
      plugin: server.pluginId ? pluginName(server.pluginId) : null,
      status: serverStatus(server.status, server.toml),
      server,
    }),
  );
  return [...apps, ...mcp].sort((a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** 连接: switch the app or server back on, or sign in to a server that needs it. */
function connect(item: Item): Promise<unknown> {
  if (item.app) return setConnectorEnabled(item.app.id, true).then(() => listConnectors(getState().activeId));
  const server = item.server!;
  if (item.status === "connect" && (server.toml?.enabled === false || server.status?.runtimeStatus === "disabled")) return setMcpServerEnabled(server.name, server.pluginId, true);
  return loginMcpServer(server.name);
}

function disconnect(item: Item): Promise<unknown> {
  if (item.app) return setConnectorEnabled(item.app.id, false).then(() => listConnectors(getState().activeId));
  return setMcpServerEnabled(item.server!.name, item.server!.pluginId, false);
}

function useAction(): [boolean, (action: () => Promise<unknown>, title: string) => void] {
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<unknown>, title: string) => {
    setBusy(true);
    action()
      .catch(fail(title))
      .finally(() => setBusy(false));
  };
  return [busy, run];
}

function StatusCell({ item }: { item: Item }) {
  const [busy, run] = useAction();
  if (item.status === "connected")
    return (
      <span className="connectors-status">
        <Icon name="Check" size="sm" />
        <span className="sr-only">已连接</span>
      </span>
    );
  if (item.status === "connecting")
    return (
      <span className="connectors-status">
        <Spinner size={16} label="正在连接" />
      </span>
    );
  if (item.status === "unavailable")
    return (
      <span className="connectors-status">
        <span aria-hidden="true">—</span>
        <span className="sr-only">不可用</span>
      </span>
    );
  const again = item.status === "reconnect";
  return (
    <span className="connectors-status">
      {again && (
        <span className="connectors-warning" data-tip={item.server?.status?.toolsError ?? "连接问题"}>
          <Icon name="Warning" size="sm" />
          <span className="sr-only">连接问题</span>
        </span>
      )}
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(again ? reloadMcpServers : () => connect(item), again ? "无法重新连接" : "无法连接")}>
        {again ? "重新连接" : "连接"}
      </Button>
    </span>
  );
}

/** ccea1f474 tile: 24px, the logo at 16 (shared-7 rk). */
function Tile({ item, large = false }: { item: Item; large?: boolean }) {
  return (
    <span className={`connector-tile${large ? " connector-tile-lg" : ""}`}>
      <ConnectorIcon light={item.light} dark={item.dark} size={large ? 32 : 16} />
    </span>
  );
}

function Badges({ item }: { item: Item }) {
  return item.badge ? <span className="badge">{item.badge}</span> : null;
}

/** c51c45b79: name / 类型 / 状态; a row opens the connector (Enter or Space too). */
function ConnectorTable({ items, onOpen }: { items: Item[]; onOpen(key: string): void }) {
  return (
    <table className="connectors-table">
      <thead>
        <tr>
          <th scope="col">连接器</th>
          <th scope="col" className="connectors-col">
            类型
          </th>
          <th scope="col" className="connectors-col">
            状态
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr
            key={item.key}
            tabIndex={0}
            aria-label={`查看 ${item.name}`}
            onClick={(event) => {
              if (!(event.target as HTMLElement).closest("button, a")) onOpen(item.key);
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
              event.preventDefault();
              onOpen(item.key);
            }}
          >
            <td>
              <div className="connectors-name">
                <Tile item={item} />
                <div className="connectors-name-text">
                  <span className="connectors-name-label">{item.name}</span>
                  {item.plugin && <span className="connectors-name-sub">由 {item.plugin} 插件提供</span>}
                </div>
              </div>
            </td>
            <td>
              <span className="connectors-type">
                {item.web ? "网页版" : "桌面端"}
                <Badges item={item} />
              </span>
            </td>
            <td>
              <StatusCell item={item} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange(value: string): void; placeholder: string }) {
  return (
    <label className="settings-search connectors-search">
      <Icon name="Search" size="sm" />
      <input type="search" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(event) => onChange(event.target.value)} />
      {value && (
        <button type="button" className="connectors-search-clear" aria-label="清除搜索" onClick={() => onChange("")}>
          <Icon name="X" size="sm" />
        </button>
      )}
    </label>
  );
}

const FILTERS: [Filter, string][] = [
  ["all", "所有连接器"],
  ["connected", "已连接"],
  ["notConnected", "未连接"],
];

/** c3c3eda79 dt: an icon trigger, accent while a filter is on, over a 显示 radio group. */
function FilterMenu({ value, onChange }: { value: Filter; onChange(value: Filter): void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      anchor={
        <Button
          variant="ghost"
          className={value === "all" ? undefined : "connectors-filter-on"}
          icon={<Icon name="Filter" />}
          label={value === "all" ? "筛选" : "筛选，已启用 1 项"}
          tip="筛选"
          onClick={() => setOpen(!open)}
        />
      }
    >
      <MenuSection title="显示" />
      {FILTERS.map(([key, label]) => (
        <MenuItem
          key={key}
          label={label}
          checked={value === key}
          onClick={() => {
            onChange(key);
            setOpen(false);
          }}
        />
      ))}
    </Popover>
  );
}

/** cd08e92dc Be: the primary 添加 with a caret over its one item. */
function AddMenu({ onAdd }: { onAdd(): void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      anchor={
        <Button id="setting-connectors-add" variant="primary" className="connectors-add" icon={<Icon name="Add" size="sm" />} aria-label="添加连接器" onClick={() => setOpen(!open)}>
          添加
          <Icon name="CaretDown" size="sm" />
        </Button>
      }
    >
      <MenuItem
        label="添加自定义连接器"
        onClick={() => {
          setOpen(false);
          onAdd();
        }}
      />
    </Popover>
  );
}

/** An MCP server the page opens on once it has loaded (the session rail's 连接器 rows). */
let wanted: string | null = null;

/** Opens 设置 › 连接器 on an MCP server's own page. */
export function openConnector(name: string): void {
  wanted = name;
  window.dispatchEvent(new Event("codex:open-connector"));
  openSettings("connectors");
}

export function ConnectorsTab() {
  const chatgpt = useStore((s) => s.account?.account?.type === "chatgpt");
  const items = useItems();
  const [tab, setTab] = useState<"yours" | "discover">("yours");
  const [query, setQuery] = useState("");
  const [find, setFind] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [asked, setAsked] = useState(wanted);
  const [adding, setAdding] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const load = () => {
    setLoadFailed(false);
    void listConnectors(getState().activeId);
    if (getState().mcp === null) void refreshMcp().then(() => setLoadFailed(getState().mcp === null));
  };
  useEffect(load, []);
  useEffect(() => {
    const ask = () => setAsked(wanted);
    window.addEventListener("codex:open-connector", ask);
    return () => {
      window.removeEventListener("codex:open-connector", ask);
      wanted = null;
    };
  }, []);
  const found = asked !== null ? items?.find((entry) => entry.key.startsWith("mcp:") && entry.name === asked) : undefined;
  if (found) {
    wanted = null;
    setAsked(null);
    setOpen(found.key);
  }
  const item = open ? items?.find((entry) => entry.key === open) : undefined;
  if (item) return <ConnectorPage item={item} onBack={() => setOpen(null)} />;

  const term = query.trim().toLowerCase();
  const shown = items?.filter(
    (entry) =>
      (filter === "all" || CONNECTED.includes(entry.status) === (filter === "connected")) &&
      (!term || entry.name.toLowerCase().includes(term)),
  );
  const discover = tab === "discover" && chatgpt;
  let body: ReactNode;
  if (discover) body = <Discover query={find.trim().toLowerCase()} />;
  else if (!items || !shown) body = loadFailed ? <LoadError onRetry={load} /> : <Skeleton lines={4} />;
  else if (items.length === 0)
    body = (
      <div className="connectors-first-run">
        <div className="connectors-first-run-text">
          <h3>添加您的第一批连接器</h3>
          <p>连接器让 Codex 能够使用您团队的工具和数据。</p>
        </div>
        <Button variant="primary" onClick={() => (chatgpt ? setTab("discover") : setAdding(true))}>
          {chatgpt ? "发现连接器" : "添加自定义连接器"}
        </Button>
      </div>
    );
  else if (shown.length === 0) body = <p className="connectors-none">{term ? "没有与您的搜索匹配的连接器" : filter === "connected" ? "未连接任何内容。" : "没有可连接的内容。"}</p>;
  else body = <ConnectorTable items={shown} onOpen={setOpen} />;

  return (
    <>
      <div className="connectors-head">
        <div className="connectors-head-start">
          <h2 className="connectors-title">连接器</h2>
          {chatgpt && (
            <span id="setting-connectors-tabs">
              <Segmented<"yours" | "discover">
                label="连接器"
                value={tab}
                onChange={setTab}
                options={[
                  { value: "yours", label: "我的" },
                  { value: "discover", label: "发现" },
                ]}
              />
            </span>
          )}
        </div>
        <div className="connectors-head-end">
          {discover ? (
            <SearchField value={find} onChange={setFind} placeholder="搜索连接器" />
          ) : (
            <>
              <SearchField value={query} onChange={setQuery} placeholder="搜索" />
              <FilterMenu value={filter} onChange={setFilter} />
              <AddMenu onAdd={() => setAdding(true)} />
            </>
          )}
        </div>
      </div>
      {body}
      {adding && (
        <AddConnectorDialog
          onClose={() => setAdding(false)}
          onAdded={(name) => {
            setAdding(false);
            setTab("yours");
            setOpen(`mcp::${name}`);
          }}
        />
      )}
    </>
  );
}

function LoadError({ onRetry }: { onRetry(): void }) {
  return (
    <div className="connectors-error" role="status">
      <p>无法加载连接器</p>
      <Button variant="secondary" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 发现: the ChatGPT app directory (app/list), a page at a time, as Fa's ruled rows.

function Discover({ query }: { query: string }) {
  const installed = useStore((s) => s.connectors);
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The page after which loading failed (null = the first). The error itself stays out of sight, as in the
  // TUI ("Failed to load apps."): behind a proxy chatgpt.com can answer with a whole Cloudflare challenge page.
  const [failedAt, setFailedAt] = useState<string | null | undefined>(undefined);
  const load = (after: string | null) => {
    setBusy(true);
    setFailedAt(undefined);
    browseConnectors(after)
      .then((page) => {
        setApps((current) => [...(after ? (current ?? []) : []), ...(page?.data ?? [])]);
        setCursor(page?.nextCursor ?? null);
      })
      .catch(() => setFailedAt(after))
      .finally(() => setBusy(false));
  };
  useEffect(() => load(null), []);
  const ids = new Set(installed?.map((connector) => connector.id));
  const list = apps?.filter((app) => !ids.has(app.id) && (!query || app.name.toLowerCase().includes(query) || app.description?.toLowerCase().includes(query))) ?? null;
  return (
    <>
      {list === null ? (
        failedAt === undefined && <Skeleton lines={4} />
      ) : list.length === 0 ? (
        <p className="connectors-none">{query ? "没有与您的搜索匹配的连接器" : "没有可连接的内容。"}</p>
      ) : (
        <ul className="connectors-directory">
          {list.map((app) => {
            const url = app.installUrl ? externalUrl(app.installUrl) : null;
            const meta = [app.branding?.developer ?? app.appMetadata?.developer, app.branding?.category ?? app.appMetadata?.categories?.[0]].filter(Boolean).join(" · ");
            return (
              <li key={app.id}>
                <a className="connectors-directory-row" href={url ?? undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!url || undefined}>
                  <span className="connector-tile connector-tile-md">
                    <ConnectorIcon light={app.logoUrl} dark={app.logoUrlDark} size={18} />
                  </span>
                  <span className="connectors-directory-text">
                    <span className="connectors-directory-name">{app.name}</span>
                    {app.description && <span className="connectors-directory-desc">{app.description}</span>}
                    {meta && <span className="connectors-directory-meta">{meta}</span>}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {failedAt !== undefined ? (
        <div className="connectors-error" role="status">
          <p>无法加载连接器目录。</p>
          <Button variant="secondary" onClick={() => load(failedAt)}>
            重试
          </Button>
        </div>
      ) : (
        cursor && (
          <div className="connectors-more">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => load(cursor)}>
              {busy ? "正在加载…" : "加载更多"}
            </Button>
          </div>
        )
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The connector's page (c08e79e85 Tn).

function ServerUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="connector-url"
      aria-label="复制服务器 URL"
      onClick={() =>
        navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }, fail("复制失败"))
      }
    >
      <span className="connector-url-text">{url}</span>
      <Icon name={copied ? "Check" : "Copy"} size={14} />
    </button>
  );
}

/** An argument as a shell would need it: quoted when it has spaces or quotes, backslashes kept (Windows paths). */
const quoteArg = (arg: string) => (/[\s"']/.test(arg) || !arg ? `"${arg.replace(/"/g, '\\"')}"` : arg);

/** c2e7fd468 _: the command, its arguments and the environment variables, values hidden. */
function LocalConfig({ toml }: { toml: McpServerToml }) {
  const env = Object.keys(toml.env ?? {});
  const forwarded = (toml.env_vars ?? []).map((entry) => (typeof entry === "string" ? entry : entry.name));
  const block = (title: string, children: ReactNode) => (
    <details open className="connector-config">
      <summary>{title}</summary>
      <code className="connector-config-code">{children}</code>
    </details>
  );
  return (
    <div className="connector-configs">
      {toml.command && block("命令", toml.command)}
      {!!toml.args?.length && block("参数", toml.args.map(quoteArg).join(" "))}
      {(env.length > 0 || forwarded.length > 0) &&
        block(
          "环境变量",
          <>
            {env.map((key) => (
              <span key={key} className="connector-config-line">
                <span className="connector-config-key">{key}</span>=••••••••
              </span>
            ))}
            {forwarded.map((key) => (
              <span key={`forwarded:${key}`} className="connector-config-line">
                <span className="connector-config-key">{key}</span>
              </span>
            ))}
          </>,
        )}
    </div>
  );
}

function ConnectorPage({ item, onBack }: { item: Item; onBack(): void }) {
  const [busy, run] = useAction();
  const [menu, setMenu] = useState(false);
  const [removing, setRemoving] = useState(false);
  const server = item.server;
  const url = server?.toml?.url ?? server?.status?.httpOrigin ?? null;
  const removable = !!server && !server.pluginId && !!configuredMcpServers()[server.name];
  const connected = item.status !== "connect";
  const back = (
    <Button variant="ghost" size="sm" className="settings-back" icon={<Icon name="ArrowLeft" size={16} />} onClick={onBack}>
      连接器
    </Button>
  );
  const more = removable && (
    <Popover
      open={menu}
      onClose={() => setMenu(false)}
      placement="bottom-end"
      anchor={<Button variant="ghost" icon={<Icon name="DotsHorizontal" />} label={`${item.name} 的更多选项`} onClick={() => setMenu(!menu)} />}
    >
      <MenuItem
        icon={<Icon name="Trash" />}
        label="移除"
        danger
        onClick={() => {
          setMenu(false);
          setRemoving(true);
        }}
      />
    </Popover>
  );
  const confirm = removing && server && (
    <Confirm
      title={`移除 ${item.name}？`}
      description="它的设置会从 config.toml 中删除。"
      confirm="移除"
      danger
      onConfirm={() => removeMcpServer(server.name).then(onBack)}
      onClose={() => setRemoving(false)}
    />
  );
  if (!connected) {
    // Not connected: Claude's centred page, the logo at 56 over the reason and 连接.
    const off = item.app ? !item.app.enabled : server?.toml?.enabled === false || server?.status?.runtimeStatus === "disabled";
    return (
      <>
        {back}
        <div className="connector-page connector-page-off">
          {more && <div className="connector-page-menu">{more}</div>}
          <Tile item={item} large />
          {url && <ServerUrl url={url} />}
          <div className="connector-off-text">
            <h2 className="connector-title">{item.name}</h2>
            <p>{off ? `您已断开 ${item.name} 的连接。在您重新连接之前，Codex 无法访问它。` : `您尚未连接到 ${item.name}。`}</p>
          </div>
          <Button variant="primary" disabled={busy} onClick={() => run(() => connect(item), "无法连接")}>
            连接
          </Button>
          {server?.toml?.command && (
            <div className="connector-off-config">
              <LocalConfig toml={server.toml} />
            </div>
          )}
        </div>
        {confirm}
      </>
    );
  }
  return (
    <>
      {back}
      <div className="connector-page">
        <div className="connector-head">
          <div className="connector-head-title">
            <Tile item={item} />
            <h2 className="connector-title">{item.name}</h2>
            <Badges item={item} />
          </div>
          <div className="connector-head-actions">
            {item.status === "reconnect" && (
              <Button variant="primary" disabled={busy} onClick={() => run(reloadMcpServers, "无法重新连接")}>
                重新连接
              </Button>
            )}
            <Button variant="secondary" disabled={busy} onClick={() => run(() => disconnect(item), "无法断开连接")}>
              断开连接
            </Button>
            {more}
          </div>
        </div>
        {item.plugin && <p className="connector-desc">由 {item.plugin} 插件提供</p>}
        {item.description && <p className="connector-desc">{item.description}</p>}
        {url && <ServerUrl url={url} />}
        {server?.toml?.command && <LocalConfig toml={server.toml} />}
        {server?.status?.toolsError && (
          <div className="connector-tools-error">
            <Icon name="Warning" size="sm" />
            <p>{server.status.toolsError}</p>
          </div>
        )}
        {item.app ? <AppTools app={item.app} /> : server && <ServerTools server={server} />}
      </div>
      {confirm}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tool permissions (c4ac4d9d6 Be / Ve / q / Je).

type Group = "readOnly" | "write" | "other";

interface ToolRow {
  name: string;
  label: string;
  group: Group;
  permission: ToolPermission;
}

const GROUPS: [Group, string][] = [
  ["readOnly", "只读工具"],
  ["write", "写入/删除工具"],
  ["other", "其他工具"],
];

const PERMISSIONS: [ToolPermission, string, IconName][] = [
  ["allow", "始终允许", "CheckCircle"],
  ["ask", "需要批准", "Hand"],
  ["blocked", "已屏蔽", "Prohibit"],
];

interface Hints {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
}

/** What Codex does with a tool at `mode` (core mcp_tool_call requires_mcp_tool_approval_for_mode). */
function asks(mode: ToolApproval, hints: Hints): boolean {
  if (mode === "approve") return false;
  if (mode === "prompt") return true;
  if (mode === "writes") return !hints.readOnlyHint;
  if (hints.destructiveHint) return true;
  if (hints.readOnlyHint) return false;
  return (hints.destructiveHint ?? true) || (hints.openWorldHint ?? true);
}

function AppTools({ app }: { app: Connector }) {
  const config = useStore((s) => s.config) as Record<string, unknown> | null;
  const [tools, setTools] = useState<AppToolSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    readConnectorTools(app.id)
      .then(setTools)
      .catch((reason) => setError(errorMessage(reason)));
  useEffect(() => {
    void load();
  }, [app.id]);
  if (error) return <ToolsError message={error} />;
  if (!tools) return <ToolsLoading />;
  const settings = (config?.apps as Record<string, { default_tools_approval_mode?: ToolApproval; tools?: Record<string, { approval_mode?: ToolApproval } | undefined> } | undefined> | undefined)?.[app.id];
  const rows = tools.map((tool): ToolRow => {
    const mode = settings?.tools?.[tool.name]?.approval_mode ?? settings?.default_tools_approval_mode ?? "auto";
    return {
      name: tool.name,
      label: tool.title ?? tool.name,
      group: tool.isReadOnly ? "readOnly" : "write",
      permission: !tool.isEnabled ? "blocked" : asks(mode, { readOnlyHint: tool.isReadOnly }) ? "ask" : "allow",
    };
  });
  return (
    <ToolPermissions
      rows={rows}
      onChange={(names, permission) =>
        setAppToolPermission(app.id, names, permission)
          .then(load)
          .then(() => listConnectors(getState().activeId))
      }
    />
  );
}

/** Tools seen in the inventory this session: a tool blocked since is filtered out of it, and keeps its
 * title and group from here. */
const seenTools = new Map<string, Map<string, Tool>>();

function ServerTools({ server }: { server: Server }) {
  const toml = server.toml;
  const tools = server.status?.tools ?? {};
  const key = JSON.stringify([server.pluginId, server.name]);
  const seen = seenTools.get(key) ?? new Map<string, Tool>();
  seenTools.set(key, seen);
  for (const tool of Object.values(tools)) if (tool) seen.set(tool.name, tool);
  const disabled = new Set(toml?.disabled_tools ?? []);
  const allowed = toml?.enabled_tools ? new Set(toml.enabled_tools) : null;
  const blocked = (name: string) => disabled.has(name) || (!!allowed && !allowed.has(name));
  // Blocked tools are missing from the inventory: they come back from disabled_tools and the cache.
  const names = [...new Set([...Object.keys(tools), ...disabled, ...[...seen.keys()].filter(blocked)])].sort((a, b) => a.localeCompare(b));
  const rows = names.map((name): ToolRow => {
    const tool = tools[name] ?? seen.get(name);
    const hints = (tool?.annotations ?? {}) as Hints;
    const mode = toml?.tools?.[name]?.approval_mode ?? toml?.default_tools_approval_mode ?? "auto";
    return {
      name,
      label: tool?.title ?? name,
      group: hints.readOnlyHint ? "readOnly" : hints.readOnlyHint === false || hints.destructiveHint ? "write" : "other",
      permission: blocked(name) ? "blocked" : asks(mode, hints) ? "ask" : "allow",
    };
  });
  if (server.status?.toolsError && !rows.length) return null;
  return <ToolPermissions rows={rows} onChange={(names, permission) => setMcpToolPermission(server.name, server.pluginId, names, permission)} />;
}

function ToolsLoading() {
  return (
    <div className="connector-tools-loading">
      <Spinner size={16} />
    </div>
  );
}

function ToolsError({ message }: { message: string }) {
  return (
    <div className="connector-tools-error">
      <Icon name="Warning" size="sm" />
      <p>{message}</p>
    </div>
  );
}

function ToolPermissions({ rows, onChange }: { rows: ToolRow[]; onChange(names: string[], permission: ToolPermission): Promise<unknown> }) {
  const [busy, run] = useAction();
  if (!rows.length) return <p className="connector-no-tools">此连接器没有可用的工具。</p>;
  // Ve: with no read-only or write tools, everything is one 其他工具 group.
  const groups = GROUPS.map(([group, title]) => [title, rows.filter((row) => row.group === group)] as const).filter(([, list]) => list.length);
  const change = (names: string[], permission: ToolPermission) => run(() => onChange(names, permission), "无法更新工具权限");
  return (
    <section className="connector-tools" aria-busy={busy}>
      <div className="connector-tools-head">
        <h3>工具权限</h3>
        <p>选择允许 Codex 使用这些工具的时机。</p>
      </div>
      {groups.map(([title, list]) => (
        <ToolGroup key={title} title={title} rows={list} disabled={busy} onChange={change} />
      ))}
    </section>
  );
}

function ToolGroup({ title, rows, disabled, onChange }: { title: string; rows: ToolRow[]; disabled: boolean; onChange(names: string[], permission: ToolPermission): void }) {
  const [open, setOpen] = useState(true);
  const [menu, setMenu] = useState(false);
  const id = useId();
  const first = rows[0].permission;
  const current = rows.every((row) => row.permission === first) ? first : null;
  const shown = PERMISSIONS.find(([key]) => key === current);
  return (
    <div role="group" aria-labelledby={id} className="connector-tool-group">
      <div className="connector-tool-group-head">
        <button type="button" className="connector-tool-group-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name="CaretDown" size={14} className={open ? undefined : "connector-caret-closed"} />
          <span id={id}>{title}</span>
          <span className="badge">{rows.length}</span>
        </button>
        <Popover
          open={menu}
          onClose={() => setMenu(false)}
          placement="bottom-end"
          anchor={
            <Button variant="secondary" size="sm" disabled={disabled} icon={<Icon name={shown?.[2] ?? "DotsHorizontal"} size="sm" />} aria-label="组的统一权限" onClick={() => setMenu(!menu)}>
              {shown?.[1] ?? "自定义"}
              <Icon name="CaretDown" size="sm" />
            </Button>
          }
        >
          {PERMISSIONS.map(([key, label, icon]) => (
            <MenuItem
              key={key}
              icon={<Icon name={icon} />}
              label={label}
              checked={current === key}
              onClick={() => {
                setMenu(false);
                if (current !== key) onChange(rows.map((row) => row.name), key);
              }}
            />
          ))}
          <MenuItem icon={<Icon name="DotsHorizontal" />} label="自定义" checked={current === null} disabled onClick={() => {}} />
        </Popover>
      </div>
      {open &&
        rows.map((row) => (
          <div key={row.name} className="connector-tool">
            <span className={`connector-tool-name${row.permission === "blocked" ? " connector-tool-blocked" : ""}`}>{row.label}</span>
            <Segmented
              label={row.label}
              value={row.permission}
              disabled={disabled}
              onChange={(permission) => onChange([row.name], permission)}
              options={PERMISSIONS.map(([key, label, icon]) => ({
                value: key,
                label: (
                  <span className="settings-theme-icon" data-tip={label}>
                    <Icon name={icon} />
                    <span className="sr-only">{label}</span>
                  </span>
                ),
              }))}
            />
          </div>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 添加自定义连接器 (ce99eb202): a name and a streamable-HTTP URL into `mcp_servers.<name>`.

/** The names `codex mcp add` accepts (cli mcp_cmd validate_server_name). */
const SERVER_NAME = /^[A-Za-z0-9_\-:@/.]+$/;

function AddConnectorDialog({ onClose, onAdded }: { onClose(): void; onAdded(name: string): void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = name.trim();
  const address = url.trim();
  const urlOk = ["http:", "https:"].includes(URL.parse(address)?.protocol ?? "");
  const nameError = !key ? null : !SERVER_NAME.test(key) ? "名称只能包含字母、数字以及 - _ : @ / ." : configuredMcpServers()[key] ? "已有同名的连接器。" : null;
  const urlError = touched && address && !urlOk ? "URL 格式无效" : null;
  const submit = () => {
    setTouched(true);
    if (!key || nameError || !urlOk) return;
    setBusy(true);
    addMcpServer(key, address)
      .then(() => onAdded(key))
      .catch((error) => {
        setBusy(false);
        toast("warning", "无法添加连接器。您可以重试。", errorMessage(error));
      });
  };
  return (
    <Dialog
      title="添加自定义连接器"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" type="submit" form="add-connector" disabled={!key || !address || !!nameError || busy}>
            添加
          </Button>
        </>
      }
    >
      <form
        id="add-connector"
        className="dialog-stack"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="connector-field">
          <span className="connector-field-label">名称</span>
          <input className="input" data-autofocus value={name} disabled={busy} aria-invalid={!!nameError} onChange={(event) => setName(event.target.value)} />
          <span className={nameError ? "connector-field-error" : "connector-field-help"}>{nameError ?? "在连接器列表中显示。"}</span>
        </label>
        <label className="connector-field">
          <span className="connector-field-label">MCP 服务器 URL</span>
          <input
            className="input"
            value={url}
            placeholder="https://"
            inputMode="url"
            disabled={busy}
            aria-invalid={!!urlError}
            onBlur={() => setTouched(true)}
            onChange={(event) => setUrl(event.target.value)}
          />
          <span className={urlError ? "connector-field-error" : "connector-field-help"}>{urlError ?? "服务器接受 MCP 请求的 HTTPS 地址，例如 https://mcp.example.com/mcp。"}</span>
        </label>
        <p className="dialog-note">请仅使用来自您信任的开发者的连接器。OpenAI 不控制开发者提供哪些工具，也无法验证这些工具是否会按预期运行或是否会发生变更。</p>
      </form>
    </Dialog>
  );
}
