// The 插件 page: the Codex app's /plugins (plugins-skills-tabs, team-plugins cards, plugin-detail-view,
// plugin-install-modal) drawn with codex-ui's Claude parts. App-server RPCs only, so there is no
// ChatGPT home feed, 团队 tab or plugin request, and remote plugins are turned on and off on ChatGPT.

import type { AppSummary } from "@protocol/v2/AppSummary";
import type { PluginDetail } from "@protocol/v2/PluginDetail";
import type { PluginListResponse } from "@protocol/v2/PluginListResponse";
import type { PluginSearchResult } from "@protocol/v2/PluginSearchResult";
import type { PluginSummary } from "@protocol/v2/PluginSummary";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  addMarketplace,
  errorMessage,
  fail,
  installPlugin,
  listConnectors,
  listInstalledPlugins,
  mcpServerToml,
  newChat,
  openPlugins,
  pluginCatalog,
  pluginMention,
  readImage,
  readPlugin,
  reconcilePlugins,
  searchPlugins,
  setMcpServerEnabled,
  setPluginEnabled,
  uninstallPlugin,
  type PluginDirectoryTab,
} from "../lib/codex";
import { externalUrl } from "../lib/format";
import { matchesPlugin, originBadge, personalSections, pluginStatus, publicSections, categorySections, unavailable, updateMessage, type PluginEntry, type PluginSection, type PluginStatus } from "../lib/plugins";
import { actionToast, getState, toast, useStore, type PluginRef } from "../lib/store";
import { setComposerMention } from "./Composer";
import { useDarkTheme } from "./ConnectorIcon";
import { Markdown } from "./content";
import { quietMenu, useLiftSlot } from "./Main";
import { Row, Section, openSettings } from "./Settings";
import { HOOK_EVENTS, ShareDialog } from "./SettingsCustomize";
import { Button, Dialog, Icon, MenuItem, MenuSep, Popover, Segmented, Skeleton, Spinner, Toggle } from "./ui";

/** Cards per section on 公开 before its › opens the whole category (plugins-skills-tabs). */
const PREVIEW = 6;
/** Cards a long list adds per step while it scrolls. */
const PAGE = 60;
/** Installed plugins the icon row shows before 另有 N 个. */
const SHELF = 8;
const TABS: { value: PluginDirectoryTab; label: string }[] = [
  { value: "public", label: "公开" },
  { value: "workspace", label: "工作空间" },
  { value: "personal", label: "个人" },
];
const SCOPES = { public: "global", workspace: "workspace", personal: "personal" } as const;
const STATUS_LABEL: Record<Exclude<PluginStatus, "install" | "enable" | "try">, string> = {
  admin: "管理员已禁用",
  plan: "升级订阅后安装",
  unavailable: "不可用",
  disabled: "插件已禁用",
};

const nameOf = (plugin: PluginSummary) => plugin.interface?.displayName ?? plugin.name;
const refOf = ({ plugin, marketplaceName, marketplacePath }: PluginEntry): PluginRef =>
  marketplacePath ? { pluginName: plugin.name, marketplacePath } : { pluginName: plugin.name, remoteMarketplaceName: marketplaceName };
const nextFrames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** 立即试用: a new session whose composer holds the plugin's mention, and a starter prompt when one was picked. */
async function tryPlugin(plugin: PluginSummary, prompt = ""): Promise<void> {
  newChat();
  await nextFrames();
  setComposerMention(pluginMention(plugin), prompt);
}

/** What the cards and the detail page do; the page holds the install flow and its dialogs. */
interface Actions {
  busy: Record<string, "install" | "uninstall">;
  open(entry: PluginEntry): void;
  install(entry: PluginEntry, prompt?: string): void;
  uninstall(plugin: PluginSummary): void;
  setEnabled(plugin: PluginSummary, enabled: boolean): void;
  share(plugin: PluginSummary): void;
}

/** The catalog's summary with the installed list's state, which an install or a switch updates first. */
function useLive(plugin: PluginSummary): PluginSummary {
  const mine = useStore((s) => s.plugins?.find((installed) => installed.id === plugin.id));
  return mine ? { ...plugin, installed: mine.installed, enabled: mine.enabled } : plugin;
}

/** 分享 belongs to the account's own plugins: a local folder plugin/share/save uploads, or one shared already. */
function useShareable(plugin: PluginSummary): boolean {
  const chatgpt = useStore((s) => s.account?.account?.type === "chatgpt");
  return chatgpt && plugin.installed && (plugin.source.type === "local" || !!plugin.shareContext);
}

// ---------------------------------------------------------------------------
// Logos: the local file (read through the app-server) or the catalog's URL, else the brand initial.

const localLogos = new Map<string, Promise<string>>();

function PluginLogo({ plugin, size = 36 }: { plugin: PluginSummary; size?: number }) {
  const dark = useDarkTheme();
  const ui = plugin.interface;
  const local = (dark ? (ui?.logoDark ?? ui?.logo) : (ui?.logo ?? ui?.logoDark)) ?? ui?.composerIcon ?? null;
  const remoteRaw = (dark ? (ui?.logoUrlDark ?? ui?.logoUrl) : (ui?.logoUrl ?? ui?.logoUrlDark)) ?? ui?.composerIconUrl ?? null;
  const remote = remoteRaw ? externalUrl(remoteRaw) : null;
  const [src, setSrc] = useState<string | null>(local ? null : remote);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (!local) return setSrc(remote);
    let live = true;
    let pending = localLogos.get(local);
    if (!pending) {
      pending = readImage(local);
      localLogos.set(local, pending);
      pending.catch(() => localLogos.delete(local));
    }
    pending.then((url) => live && setSrc(url)).catch(() => live && setSrc(remote));
    return () => {
      live = false;
    };
  }, [local, remote]);
  const color = ui?.brandColor && /^#[0-9a-f]{3,8}$/i.test(ui.brandColor) ? ui.brandColor : null;
  return (
    <span className="plugins-logo" style={{ width: size, height: size }} aria-hidden="true">
      {src && !failed ? (
        <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : color ? (
        <span className="plugin-tile" style={{ background: color, fontSize: Math.round(size * 0.42) }}>
          {nameOf(plugin).slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <Icon name="Plugin" size={Math.round(size / 2)} />
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Cards (team-plugins Vt): logo, name with the origin badge, the description, the action at the end.

function CardAction({ entry, plugin, actions }: { entry: PluginEntry; plugin: PluginSummary; actions: Actions }) {
  const [menu, setMenu] = useState(false);
  const shareable = useShareable(plugin);
  const name = nameOf(plugin);
  const busy = actions.busy[plugin.id];
  const status = pluginStatus(plugin);
  if (busy) return <Spinner size={14} label={busy === "install" ? "正在安装" : "正在卸载"} />;
  if (status === "admin")
    return (
      <span className="plugins-card-state" data-tip="你的管理员已关闭访问权限">
        <Icon name="Lock" size={16} />
      </span>
    );
  if (status === "plan" || status === "unavailable")
    return (
      <span className="plugins-card-state" data-tip={status === "plan" ? STATUS_LABEL.plan : "无法使用此插件"}>
        <Icon name="Prohibit" size={16} />
      </span>
    );
  if (status === "install") return <Button variant="ghost" size="sm" icon={<Icon name="Add" size={16} />} label={`安装 ${name}`} tip="安装插件" onClick={() => actions.install(entry)} />;
  const close = (run: () => void) => () => {
    setMenu(false);
    run();
  };
  return (
    <Popover
      open={menu}
      onClose={() => setMenu(false)}
      placement="bottom-end"
      anchor={<Button variant="ghost" size="sm" icon={<Icon name="DotsHorizontal" size={16} />} label="更多操作" active={menu} onClick={() => setMenu(!menu)} />}
    >
      {status === "try" && <MenuItem icon={<Icon name="ChatAdd" />} label="立即试用" onClick={close(() => void tryPlugin(plugin))} />}
      {status === "enable" && <MenuItem icon={<Icon name="Check" />} label="启用" onClick={close(() => actions.setEnabled(plugin, true))} />}
      <MenuItem icon={<Icon name="Settings" />} label="管理" onClick={close(() => actions.open(entry))} />
      {status === "try" && plugin.source.type !== "remote" && <MenuItem icon={<Icon name="Prohibit" />} label="禁用" onClick={close(() => actions.setEnabled(plugin, false))} />}
      {shareable && <MenuItem icon={<Icon name="Link" />} label="分享" onClick={close(() => actions.share(plugin))} />}
      <MenuSep />
      <MenuItem icon={<Icon name="Trash" />} label="卸载" danger disabled={plugin.installPolicy === "INSTALLED_BY_DEFAULT"} onClick={close(() => actions.uninstall(plugin))} />
    </Popover>
  );
}

function PluginCard({ entry, actions, developer = false }: { entry: PluginEntry; actions: Actions; developer?: boolean }) {
  const plugin = useLive(entry.plugin);
  const name = nameOf(plugin);
  const badge = originBadge(entry);
  const ui = plugin.interface;
  const description = [developer ? ui?.developerName : null, ui?.shortDescription].filter(Boolean).join(" • ");
  return (
    <div className="plugins-card" data-dim={unavailable(plugin) || (plugin.installed && !plugin.enabled) || undefined}>
      <button type="button" className="plugins-card-hit" aria-label={name} onClick={() => actions.open(entry)} />
      <PluginLogo plugin={plugin} />
      <div className="plugins-card-text">
        <div className="plugins-card-title">
          <span className="truncate">{name}</span>
          {badge && <span className="badge">{badge}</span>}
        </div>
        {description && <div className="plugins-card-desc">{description}</div>}
      </div>
      <div className="plugins-card-action">
        <CardAction entry={entry} plugin={plugin} actions={actions} />
      </div>
    </div>
  );
}

/** Cards, PAGE at a time as the list scrolls (plugin-listings-pagination): a category can hold thousands. */
function Grid({ entries, actions, developer }: { entries: PluginEntry[]; actions: Actions; developer?: boolean }) {
  const [count, setCount] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    // A new observer per page reports at once, so a sentinel still in view keeps loading.
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setCount((value) => value + PAGE), { root: node.closest(".plugins-scroll"), rootMargin: "400px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [count, entries]);
  return (
    <>
      <div className="plugins-grid">
        {entries.slice(0, count).map((entry) => (
          <PluginCard key={`${entry.plugin.id}:${entry.marketplaceName}`} entry={entry} actions={actions} developer={developer} />
        ))}
      </div>
      {count < entries.length && <div ref={sentinel} aria-hidden="true" />}
    </>
  );
}

function SectionBlock({ title, detail, onMore, children }: { title: ReactNode; detail?: string; onMore?: () => void; children: ReactNode }) {
  return (
    <section className="plugins-section">
      <h3 className="plugins-section-title">
        {onMore ? (
          <button type="button" className="plugins-section-link" onClick={onMore}>
            {title}
            <Icon name="CaretRight" size={14} />
          </button>
        ) : (
          <span className="plugins-section-name">{title}</span>
        )}
        {detail && <span className="plugins-section-detail">{detail}</span>}
      </h3>
      {children}
    </section>
  );
}

function LoadingGrid() {
  return (
    <div className="plugins-grid" aria-busy="true">
      <span className="sr-only">正在加载插件…</span>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="plugins-card plugins-card-skeleton">
          <span className="plugins-logo" />
          <div className="plugins-card-text">
            <Skeleton lines={2} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="plugins-empty">
      <p className="plugins-empty-title">{title}</p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The page

type Catalog = PluginListResponse | "error" | undefined;

export function PluginsView() {
  const route = useStore((s) => s.pluginsRoute);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const chatgpt = useStore((s) => s.account?.account?.type === "chatgpt");
  const installed = useStore((s) => s.plugins);
  const slot = useLiftSlot();
  const [tab, setTab] = useState<PluginDirectoryTab>("public");
  const [catalogs, setCatalogs] = useState<Record<PluginDirectoryTab, Catalog>>({ public: undefined, workspace: undefined, personal: undefined });
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<PluginEntry[] | null | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState<Actions["busy"]>({});
  const [confirmInstall, setConfirmInstall] = useState<{ entry: PluginEntry; prompt?: string } | null>(null);
  const [connect, setConnect] = useState<{ entry: PluginEntry; apps: AppSummary[] } | null>(null);
  const [sharing, setSharing] = useState<PluginSummary | null>(null);
  const [generation, setGeneration] = useState(0);
  const detail = route?.detail ?? null;
  const [detailName, setDetailName] = useState<string | null>(null);
  useEffect(() => setDetailName(null), [detail]);

  const load = (which: PluginDirectoryTab, refetch = false) =>
    pluginCatalog(which, refetch)
      .then((list) => setCatalogs((current) => ({ ...current, [which]: list })))
      .catch(() => setCatalogs((current) => ({ ...current, [which]: "error" })));
  const reloadAll = (refetch = false) => {
    void listInstalledPlugins();
    return Promise.all([load("public", refetch), load("personal", refetch), ...(chatgpt ? [load("workspace", refetch)] : [])]);
  };
  useEffect(() => {
    void reloadAll();
  }, [chatgpt, generation]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.title = "插件 - Codex";
  }, []);

  const workspace = catalogs.workspace;
  const hasWorkspace = chatgpt && !!workspace && workspace !== "error" && workspace.marketplaces.some((market) => market.plugins.length > 0);
  useEffect(() => {
    if (tab === "workspace" && !hasWorkspace && workspace !== undefined) setTab("public");
  }, [tab, hasWorkspace, workspace]);

  const sectionsOf = (which: PluginDirectoryTab): PluginSection[] | null => {
    const list = catalogs[which];
    if (!list || list === "error") return null;
    if (which === "public") return publicSections(list);
    if (which === "personal") return personalSections(list);
    return categorySections(list.marketplaces.flatMap((market) => market.plugins.map((plugin) => ({ plugin, marketplaceName: market.name, marketplacePath: market.path }))));
  };
  const sections = sectionsOf(tab);

  // plugin/search with the tab's scope (200ms, as the app debounces); without it, the tab's own list filtered.
  const term = query.trim();
  useEffect(() => {
    if (!term) return setFound(undefined);
    setFound(null);
    let live = true;
    const local = () => {
      const seen = new Set<string>();
      return (sectionsOf(tab) ?? []).flatMap((section) => section.entries).filter((entry) => matchesPlugin(entry.plugin, term) && !seen.has(entry.plugin.id) && !!seen.add(entry.plugin.id));
    };
    const timer = setTimeout(() => {
      searchPlugins(term, SCOPES[tab])
        .then((response) => live && setFound(response ? response.data.map((result: PluginSearchResult) => ({ plugin: result.plugin, marketplaceName: result.marketplaceName, marketplacePath: result.marketplacePath })) : local()))
        .catch(() => live && setFound(local()));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term, tab, catalogs]); // eslint-disable-line react-hooks/exhaustive-deps

  const after = () => setGeneration((value) => value + 1);
  const setBusyFor = (id: string, state: "install" | "uninstall" | null) =>
    setBusy((current) => {
      const next = { ...current };
      if (state) next[id] = state;
      else delete next[id];
      return next;
    });
  const runInstall = async (entry: PluginEntry, prompt?: string) => {
    const { plugin } = entry;
    const name = nameOf(plugin);
    setConfirmInstall(null);
    setBusyFor(plugin.id, "install");
    try {
      const { authPolicy, appsNeedingAuth } = await installPlugin(refOf(entry), plugin.id);
      if (appsNeedingAuth.length && authPolicy === "ON_INSTALL") setConnect({ entry, apps: appsNeedingAuth });
      else if (prompt !== undefined) void tryPlugin(plugin, prompt);
      else actionToast(`${name} 插件已安装`, { label: "立即试用", run: () => void tryPlugin(plugin) });
    } catch (error) {
      toast("warning", "插件安装失败", errorMessage(error));
    } finally {
      setBusyFor(plugin.id, null);
      after();
    }
  };
  const actions: Actions = {
    busy,
    open: (entry) => {
      setQuery("");
      openPlugins(refOf(entry));
    },
    install: (entry, prompt) => (entry.plugin.mustShowInstallationInterstitial === false ? void runInstall(entry, prompt) : setConfirmInstall({ entry, prompt })),
    uninstall: (plugin) => {
      setBusyFor(plugin.id, "uninstall");
      uninstallPlugin(plugin.id)
        .then(() => toast("neutral", `${nameOf(plugin)} 插件已卸载`))
        .catch((error) => toast("warning", "插件卸载失败", errorMessage(error)))
        .finally(() => {
          setBusyFor(plugin.id, null);
          after();
        });
    },
    setEnabled: (plugin, enabled) =>
      void setPluginEnabled(plugin.id, enabled)
        .then(() => toast("neutral", `${nameOf(plugin)} 插件已${enabled ? "启用" : "禁用"}`))
        .catch(fail("插件更新失败"))
        .finally(after),
    share: setSharing,
  };

  const home = () => {
    setCategory(null);
    setQuery("");
    openPlugins();
  };
  const openSection = category ? sections?.find((section) => section.id === category) : null;
  const crumb = detail ? (detailName ?? detail.pluginName) : category ? (openSection?.title ?? null) : null;
  const bar = (
    <header className="chat-header" data-tip-group="" data-density="compact" data-collapsed={(!sidebarOpen && !slot) || undefined}>
      <h1 className="draft-title cloud-title plugins-crumbs">
        {crumb !== null ? (
          <>
            <button type="button" className="plugins-crumb" onClick={home}>
              插件
            </button>
            <Icon name="CaretRight" size={12} className="plugins-crumb-sep" />
            <span className="cloud-title-text">{crumb}</span>
          </>
        ) : (
          <span className="cloud-title-text">插件</span>
        )}
      </h1>
      <span className="spacer" />
      <div className="header-actions" data-tip-group="">
        <Button
          variant="ghost"
          icon={refreshing ? <Spinner size={14} /> : <Icon name="ArrowClockwise" />}
          label="刷新"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            reloadAll(true).finally(() => {
              setRefreshing(false);
              setGeneration((value) => value + 1);
            });
          }}
        />
        <Button variant="ghost" icon={<Icon name="Settings" />} label="管理" onClick={() => openSettings("plugins")} />
        <Popover
          open={addOpen}
          onClose={() => setAddOpen(false)}
          placement="bottom-end"
          anchor={
            <Button variant="secondary" size="sm" icon={<Icon name="Add" size={16} />} active={addOpen} onClick={() => setAddOpen(!addOpen)}>
              添加
            </Button>
          }
        >
          <MenuItem
            icon={<Icon name="Globe" />}
            label="添加插件市场"
            onClick={() => {
              setAddOpen(false);
              setAdding(true);
            }}
          />
          <MenuItem
            icon={<Icon name="Connectors" />}
            label="添加自定义 MCP 服务器"
            onClick={() => {
              setAddOpen(false);
              openSettings("connectors");
            }}
          />
        </Popover>
      </div>
    </header>
  );

  const installedEntries: PluginEntry[] = (installed ?? []).map((plugin) => ({ plugin, marketplaceName: plugin.marketplaceName, marketplacePath: plugin.marketplacePath }));
  const catalog = catalogs[tab];
  let body: ReactNode;
  if (detail) body = <PluginDetailView target={detail} actions={actions} generation={generation} onName={setDetailName} />;
  else
    body = (
      <>
        <div className="plugins-intro">
          <h2 className="plugins-title">{openSection?.title ?? "插件"}</h2>
          {!category && <p className="plugins-subtitle">连接插件，让 Codex 在你的各类工具中协同工作</p>}
        </div>
        <div className="plugins-search">
          <Icon name="Search" size={16} />
          <input type="search" className="plugins-search-input" placeholder="搜索插件" aria-label="搜索插件" value={query} onChange={(event) => setQuery(event.target.value)} />
          {found === null && <Spinner size={12} />}
        </div>
        {!category && !term && installedEntries.length > 0 && (
          <div className="plugins-shelf" aria-label="已安装">
            <span className="plugins-shelf-label">已安装</span>
            <div className="plugins-shelf-icons">
              {installedEntries.slice(0, SHELF).map((entry) => (
                <button key={entry.plugin.id} type="button" className="plugins-shelf-icon" aria-label={nameOf(entry.plugin)} data-tip={nameOf(entry.plugin)} onClick={() => actions.open(entry)}>
                  <PluginLogo plugin={entry.plugin} size={44} />
                </button>
              ))}
              {installedEntries.length > SHELF && (
                <button type="button" className="plugins-shelf-more" onClick={() => openSettings("plugins", "setting-plugins-installed")}>
                  另有 {installedEntries.length - SHELF} 个
                </button>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => openSettings("plugins", "setting-plugins-installed")}>
              管理
            </Button>
          </div>
        )}
        {!category && (
          <div className="plugins-tabs">
            <Segmented<PluginDirectoryTab> value={tab} options={TABS.filter((option) => option.value !== "workspace" || hasWorkspace)} label="插件目录" onChange={setTab} />
          </div>
        )}
        {term ? (
          found === undefined || found === null ? (
            <LoadingGrid />
          ) : found.length === 0 ? (
            <Empty title="未找到插件" />
          ) : (
            <Grid entries={found} actions={actions} developer />
          )
        ) : catalog === undefined ? (
          <LoadingGrid />
        ) : catalog === "error" || !sections ? (
          <Empty title="插件加载失败">
            <Button variant="secondary" size="sm" onClick={() => void load(tab, true)}>
              重试
            </Button>
          </Empty>
        ) : openSection ? (
          <Grid entries={openSection.entries} actions={actions} />
        ) : (
          <>
            {sections.length === 0 && <Empty title="未找到插件" />}
            {sections.map((section) => {
              const more = tab === "public" && section.entries.length > PREVIEW;
              return (
                <SectionBlock key={section.id} title={section.title} detail={section.detail} onMore={more ? () => setCategory(section.id) : undefined}>
                  {section.entries.length ? <Grid entries={more ? section.entries.slice(0, PREVIEW) : section.entries} actions={actions} /> : <p className="plugins-note">此市场中没有插件。</p>}
                </SectionBlock>
              );
            })}
            {tab === "personal" &&
              catalog.marketplaceLoadErrors.map((error) => (
                <p key={error.marketplacePath} className="error-text small">
                  {error.marketplacePath}：{error.message}
                </p>
              ))}
          </>
        )}
      </>
    );

  return (
    <div className="main-col" onContextMenu={quietMenu}>
      {slot ? createPortal(bar, slot) : bar}
      <div className="plugins-scroll">
        <div className="plugins-page">{body}</div>
      </div>
      {confirmInstall && <InstallDialog {...confirmInstall} onClose={() => setConfirmInstall(null)} onInstall={() => void runInstall(confirmInstall.entry, confirmInstall.prompt)} />}
      {connect && (
        <ConnectAppsDialog
          {...connect}
          onClose={() => setConnect(null)}
          onDetails={() => {
            setConnect(null);
            actions.open(connect.entry);
          }}
        />
      )}
      {adding && (
        <AddMarketplaceDialog
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            setTab("personal");
            after();
          }}
        />
      )}
      {sharing && (
        <ShareDialog
          name={nameOf(sharing)}
          path={sharing.source.type === "local" ? sharing.source.path : null}
          share={sharing.shareContext}
          onClose={() => {
            setSharing(null);
            after();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail (plugin-detail-view): hero, starter prompts, description, what it includes, information.

function PluginDetailView({ target, actions, generation, onName }: { target: PluginRef; actions: Actions; generation: number; onName(name: string): void }) {
  const [detail, setDetail] = useState<PluginDetail | "error" | null>(null);
  useEffect(() => {
    let live = true;
    readPlugin(target)
      .then((value) => {
        if (!live) return;
        setDetail(value);
        onName(nameOf(value.summary));
      })
      .catch(() => live && setDetail((current) => (current && current !== "error" ? current : "error")));
    return () => {
      live = false;
    };
  }, [target, generation]); // eslint-disable-line react-hooks/exhaustive-deps
  if (detail === null)
    return (
      <div className="plugins-detail" aria-busy="true">
        <div className="plugins-hero">
          <span className="plugins-logo" style={{ width: 48, height: 48 }} />
          <div className="plugins-hero-text">
            <Skeleton lines={2} />
          </div>
        </div>
        <span className="sr-only">正在加载插件详情…</span>
      </div>
    );
  if (detail === "error")
    return (
      <Empty title="无法加载插件">
        <p className="plugins-note">无法从插件市场详情页加载此插件。</p>
      </Empty>
    );
  return <DetailBody detail={detail} actions={actions} />;
}

function DetailBody({ detail, actions }: { detail: PluginDetail; actions: Actions }) {
  const [menu, setMenu] = useState(false);
  const [checking, setChecking] = useState(false);
  const [more, setMore] = useState(false);
  const connectors = useStore((s) => s.connectors);
  useStore((s) => s.config); // the MCP switches read it
  const apps = detail.apps.length;
  useEffect(() => {
    if (apps) void listConnectors();
  }, [apps]);
  const plugin = useLive(detail.summary);
  const shareable = useShareable(plugin);
  const ui = plugin.interface;
  const name = nameOf(plugin);
  const entry: PluginEntry = { plugin, marketplaceName: detail.marketplaceName, marketplacePath: detail.marketplacePath };
  const status = pluginStatus(plugin);
  const busy = actions.busy[plugin.id];
  const badge = originBadge(entry);
  const description = ui?.longDescription ?? detail.description ?? null;
  // ponytail: a length cut for 显示更多; measure the rendered height if long one-paragraph texts matter.
  const long = (description?.length ?? 0) > 480;
  const prompts = (ui?.defaultPrompt ?? []).slice(0, 3);
  const pluginId = plugin.installed ? plugin.id : null;
  const checkUpdates = () => {
    setMenu(false);
    setChecking(true);
    const before = plugin.localVersion ?? plugin.version;
    reconcilePlugins()
      .then((response) => {
        const now = getState().plugins?.find((item) => item.id === plugin.id);
        const message = updateMessage(response, plugin, before, now?.localVersion ?? now?.version ?? null);
        toast(message ? "neutral" : "danger", message ?? "无法检查更新。请重试。");
      })
      .catch(() => toast("warning", "无法检查更新。请重试。"))
      .finally(() => setChecking(false));
  };

  const primary = busy ? (
    <Button variant="primary" disabled>
      <Spinner size={12} inherit /> {busy === "install" ? "正在安装" : "正在卸载"}
    </Button>
  ) : status === "install" ? (
    <Button variant="primary" onClick={() => actions.install(entry)}>
      安装插件
    </Button>
  ) : status === "try" ? (
    <Button variant="primary" onClick={() => void tryPlugin(plugin)}>
      立即试用
    </Button>
  ) : status === "enable" ? (
    <Button variant="primary" onClick={() => actions.setEnabled(plugin, true)}>
      启用
    </Button>
  ) : (
    <Button variant="secondary" disabled tip={status === "admin" ? "你的管理员已关闭访问权限" : "无法使用此插件"}>
      {status === "admin" && <Icon name="Lock" size={14} />}
      {STATUS_LABEL[status]}
    </Button>
  );

  const info: [string, ReactNode][] = [
    ["功能", ui?.capabilities.length ? ui.capabilities.join("、") : null],
    ["开发者", ui?.developerName],
    ["类别", ui?.category],
    ["版本", plugin.localVersion ?? plugin.version],
    ["网站", link(ui?.websiteUrl)],
    ["隐私政策", link(ui?.privacyPolicyUrl)],
    ["服务条款", link(ui?.termsOfServiceUrl)],
  ];

  return (
    <div className="plugins-detail">
      <div className="plugins-hero">
        <PluginLogo plugin={plugin} size={48} />
        <div className="plugins-hero-text">
          <h2 className="plugins-hero-title">
            <span className="truncate">{name}</span>
            {badge && <span className="badge">{badge}</span>}
          </h2>
          <p className="plugins-hero-sub">{[ui?.developerName ? `由 ${ui.developerName} 提供` : null, ui?.shortDescription].filter(Boolean).join(" • ")}</p>
        </div>
        <div className="plugins-hero-actions">
          {(plugin.installed || shareable) && (
            <Popover
              open={menu}
              onClose={() => setMenu(false)}
              placement="bottom-end"
              anchor={<Button variant="ghost" icon={<Icon name="DotsHorizontal" />} label="更多操作" active={menu} onClick={() => setMenu(!menu)} />}
            >
              {plugin.installed && plugin.source.type === "remote" && <MenuItem icon={<Icon name="ArrowClockwise" />} label="检查更新" disabled={checking} onClick={checkUpdates} />}
              {status === "try" && plugin.source.type !== "remote" && (
                <MenuItem
                  icon={<Icon name="Prohibit" />}
                  label="禁用"
                  onClick={() => {
                    setMenu(false);
                    actions.setEnabled(plugin, false);
                  }}
                />
              )}
              {shareable && (
                <MenuItem
                  icon={<Icon name="Link" />}
                  label="分享"
                  onClick={() => {
                    setMenu(false);
                    actions.share(plugin);
                  }}
                />
              )}
              {plugin.installed && (
                <>
                  <MenuSep />
                  <MenuItem
                    icon={<Icon name="Trash" />}
                    label="卸载"
                    hint={detail.apps.length ? "将解除与所有账户的关联" : undefined}
                    danger
                    disabled={plugin.installPolicy === "INSTALLED_BY_DEFAULT"}
                    onClick={() => {
                      setMenu(false);
                      actions.uninstall(plugin);
                    }}
                  />
                </>
              )}
            </Popover>
          )}
          {primary}
        </div>
      </div>

      {prompts.length > 0 && (status === "install" || status === "try") && (
        <div className="plugins-prompts">
          {prompts.map((prompt) => (
            <button key={prompt} type="button" className="plugins-prompt" disabled={!!busy} onClick={() => (plugin.installed ? void tryPlugin(plugin, prompt) : actions.install(entry, prompt))}>
              <Icon name="ChatAdd" size={16} />
              <span>{prompt}</span>
            </button>
          ))}
        </div>
      )}

      {description && (
        <div className="plugins-description">
          <div className="plugins-description-body" data-clamped={(long && !more) || undefined}>
            <Markdown text={description} />
          </div>
          {long && (
            <button type="button" className="plugins-more" onClick={() => setMore(!more)}>
              {more ? "收起" : "显示更多"}
            </button>
          )}
        </div>
      )}

      {detail.apps.length > 0 && (
        <Section title="应用">
          {detail.apps.map((app) => {
            const connector = connectors?.find((item) => item.id === app.id);
            const url = app.installUrl ? externalUrl(app.installUrl) : null;
            return (
              <Row key={app.id} leading={<Icon name="Connectors" size={18} />} label={app.name} description={app.description ?? undefined}>
                {connector?.callable ? (
                  <span className="plugins-note">已连接</span>
                ) : (
                  url && (
                    <a className="btn btn-secondary btn-sm" href={url} target="_blank" rel="noopener noreferrer">
                      连接
                    </a>
                  )
                )}
              </Row>
            );
          })}
        </Section>
      )}
      {detail.mcpServers.length > 0 && (
        <Section title="MCP 服务器">
          {detail.mcpServers.map((server) => (
            <Row key={server} leading={<Icon name="Connectors" size={18} />} label={server}>
              <Button variant="ghost" size="sm" icon={<Icon name="Settings" size={16} />} label="打开 MCP 设置" onClick={() => openSettings("connectors")} />
              {pluginId && (
                <Toggle
                  checked={mcpServerToml(server, pluginId)?.enabled !== false}
                  label="切换 MCP 服务器的启用状态"
                  onChange={(on) => void setMcpServerEnabled(server, pluginId, on).catch(fail(on ? "无法启用 MCP 服务器" : "无法禁用 MCP 服务器"))}
                />
              )}
            </Row>
          ))}
        </Section>
      )}
      {detail.skills.length > 0 && (
        <Section title="技能">
          {detail.skills.map((skill) => (
            <Row key={skill.name} label={skill.interface?.displayName ?? skill.name} description={skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description} />
          ))}
        </Section>
      )}
      {!!detail.scheduledTasks?.length && (
        <Section title="定时任务">
          {detail.scheduledTasks.map((task) => (
            <Row key={task.key} label={task.name} description={task.prompt} />
          ))}
        </Section>
      )}
      {detail.hooks.length > 0 && (
        <Section
          title="钩子"
          description="在任务生命周期内运行确定性脚本"
          action={
            <Button variant="secondary" size="sm" onClick={() => openSettings("hooks")}>
              在设置中管理
            </Button>
          }
        >
          {detail.hooks.map((hook) => (
            <Row key={hook.key} label={HOOK_EVENTS[hook.eventName] ?? hook.eventName} description={<span className="about-value">{hook.key}</span>} />
          ))}
        </Section>
      )}
      <Section title="信息">
        {info.map(([label, value]) => (
          <Row key={label} label={label}>
            <span className="plugins-info-value">{value || "不可用"}</span>
          </Row>
        ))}
      </Section>
    </div>
  );
}

function link(raw: string | null | undefined): ReactNode {
  const url = raw ? externalUrl(raw) : null;
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {new URL(url).host}
    </a>
  ) : null;
}

// ---------------------------------------------------------------------------
// Dialogs

/** The install interstitial (plugin-install-modal `details`): who made it, about, what it includes. */
function InstallDialog({ entry, onClose, onInstall }: { entry: PluginEntry; prompt?: string; onClose(): void; onInstall(): void }) {
  const [detail, setDetail] = useState<PluginDetail | null>(null);
  useEffect(() => {
    readPlugin(refOf(entry))
      .then(setDetail)
      .catch(() => {});
  }, [entry]);
  const { plugin } = entry;
  const ui = plugin.interface;
  const name = nameOf(plugin);
  const includes: [string, string[]][] = detail
    ? [
        ["应用", detail.apps.map((app) => app.name)],
        ["技能", detail.skills.map((skill) => skill.interface?.displayName ?? skill.name)],
        ["MCP 服务器", detail.mcpServers],
      ]
    : [];
  return (
    <Dialog
      title={`安装 ${name}`}
      description={ui?.developerName ? `由 ${ui.developerName} 开发` : undefined}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onInstall}>
          安装 {name}
        </Button>
      }
    >
      <div className="plugins-install">
        {(ui?.longDescription ?? ui?.shortDescription) && (
          <section>
            <h4 className="plugins-install-head">关于</h4>
            <Markdown text={ui?.longDescription ?? ui?.shortDescription ?? ""} />
          </section>
        )}
        <section>
          <h4 className="plugins-install-head">包含内容</h4>
          {detail === null ? (
            <Skeleton lines={2} />
          ) : (
            <ul className="plugins-install-list">
              {includes
                .filter(([, items]) => items.length)
                .map(([label, items]) => (
                  <li key={label}>
                    <span className="plugins-install-label">{label}</span>
                    {items.join("、")}
                  </li>
                ))}
            </ul>
          )}
        </section>
        {!!ui?.capabilities.length && (
          <section>
            <h4 className="plugins-install-head">功能</h4>
            <p className="plugins-note">{ui.capabilities.join("、")}</p>
          </section>
        )}
      </div>
    </Dialog>
  );
}

/**
 * 将应用连接到 X (plugin-install-modal `needsApps`): each app's sign-in opens in the browser, and
 * coming back to the window re-reads app/installed to see which became callable.
 */
function ConnectAppsDialog({ entry, apps, onClose, onDetails }: { entry: PluginEntry; apps: AppSummary[]; onClose(): void; onDetails(): void }) {
  const connectors = useStore((s) => s.connectors);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  useEffect(() => {
    void listConnectors(null, true);
    const refresh = () => document.visibilityState === "visible" && void listConnectors(null, true);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  const name = nameOf(entry.plugin);
  return (
    <Dialog
      title={`将应用连接到 ${name}`}
      description="从你已在使用的应用中获得相关性更强的帮助。你也可以稍后再设置。"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onDetails}>
            查看详情
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              void tryPlugin(entry.plugin);
            }}
          >
            立即试用 {name}
          </Button>
        </>
      }
    >
      <div className="settings-rows">
        {apps.map((app) => {
          const connected = !!connectors?.find((item) => item.id === app.id)?.callable;
          const url = app.installUrl ? externalUrl(app.installUrl) : null;
          return (
            <Row key={app.id} leading={<Icon name="Connectors" size={18} />} label={app.name} description={app.description ?? undefined}>
              {connected ? (
                <span className="plugins-note">已连接</span>
              ) : url ? (
                <a className="btn btn-secondary btn-sm" href={url} target="_blank" rel="noopener noreferrer" onClick={() => setOpened((current) => new Set(current).add(app.id))}>
                  {opened.has(app.id) ? "已打开链接" : "连接"}
                </a>
              ) : (
                <span className="plugins-note">应用不可用</span>
              )}
            </Row>
          );
        })}
      </div>
    </Dialog>
  );
}

/** 添加插件市场 (add-marketplace-dialog): a GitHub repo, Git URL or local folder, with its ref and sparse paths. */
function AddMarketplaceDialog({ onClose, onAdded }: { onClose(): void; onAdded(): void }) {
  const [source, setSource] = useState("");
  const [ref, setRef] = useState("");
  const [paths, setPaths] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = () => {
    const value = source.trim();
    if (!value) return toast("warning", "请输入市场来源");
    setBusy(true);
    addMarketplace(
      value,
      ref.trim() || null,
      paths
        .split(/[\n,]/)
        .map((path) => path.trim())
        .filter(Boolean),
    )
      .then(({ marketplaceName, alreadyAdded }) => {
        toast("neutral", alreadyAdded ? `${marketplaceName} 已添加` : `已添加 ${marketplaceName} 市场`);
        onAdded();
      })
      .catch((error) => toast("warning", "添加插件市场失败", errorMessage(error)))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog
      title="添加插件市场"
      description="从 GitHub 仓库、Git URL 或本地文件夹添加。"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={busy || !source.trim()} onClick={submit}>
            {busy ? "正在添加…" : "添加市场"}
          </Button>
        </>
      }
    >
      <form
        className="plugins-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="plugins-field">
          <span>来源</span>
          <input className="input mono" data-autofocus placeholder="openai/plugins 或 git@github.com:org/repo.git" value={source} onChange={(event) => setSource(event.target.value)} />
        </label>
        <label className="plugins-field">
          <span>Git 引用</span>
          <input className="input mono" placeholder="主分支" value={ref} onChange={(event) => setRef(event.target.value)} />
        </label>
        <label className="plugins-field">
          <span>稀疏路径</span>
          <input className="input mono" placeholder="plugins/codex" value={paths} onChange={(event) => setPaths(event.target.value)} />
        </label>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
