// Settings pages for what Codex loads into sessions: memory (W21 memory panel), plugins and
// marketplaces, skills and extra skill roots, connectors (ChatGPT apps + MCP servers), hooks.

import type { HookEventName } from "@protocol/v2/HookEventName";
import type { HookMetadata } from "@protocol/v2/HookMetadata";
import type { HookSource } from "@protocol/v2/HookSource";
import type { HookTrustStatus } from "@protocol/v2/HookTrustStatus";
import type { McpServerConnectionStatus } from "@protocol/v2/McpServerConnectionStatus";
import type { PluginDetail } from "@protocol/v2/PluginDetail";
import type { PluginListResponse } from "@protocol/v2/PluginListResponse";
import type { PluginSearchResult } from "@protocol/v2/PluginSearchResult";
import type { PluginSummary } from "@protocol/v2/PluginSummary";
import type { SkillsListResponse } from "@protocol/v2/SkillsListResponse";
import { ArrowLeft, ExternalLink, Plug, Puzzle, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import {
  addMarketplace,
  errorMessage,
  installPlugin,
  listConnectors,
  listHooks,
  listInstalledPlugins,
  listSkills,
  loginMcpServer,
  memoriesEnabled,
  memoryFiles,
  memorySettings,
  pluginDirectory,
  readMemoryStatus,
  readPlugin,
  readTextFile,
  refreshMcp,
  reloadMcpServers,
  removeMarketplace,
  resetMemory,
  searchPlugins,
  setConnectorEnabled,
  setHookEnabled,
  setMemoriesEnabled,
  setMemorySettings,
  setPluginEnabled,
  setSkillEnabled,
  setSkillRoots,
  trustHooks,
  uninstallPlugin,
  upgradeMarketplaces,
  type MemoryStatus,
} from "../lib/codex";
import { basename, externalUrl, joinPath } from "../lib/format";
import { getState, hooksNeedingReview, toast, useStore, writePref } from "../lib/store";
import { Markdown } from "./content";
import { Confirm, Row, Section } from "./Settings";
import { Button, Skeleton, Spinner, StatusDot, Toggle, type DotKind } from "./ui";

const failed = (title: string) => (error: unknown) => toast("error", title, errorMessage(error));

// ---------------------------------------------------------------------------
// Memory (U9): switches, v2 readiness, reset (confirmed), and the files in CODEX_HOME/memories.

interface MemoryFile {
  path: string;
  name: string;
}

const PREVIEW_BYTES = 64 * 1024;
// MEMORY.md (the consolidated memory) first, then by name.
const byName = (a: { fileName: string }, b: { fileName: string }) =>
  Number(b.fileName === "MEMORY.md") - Number(a.fileName === "MEMORY.md") || a.fileName.localeCompare(b.fileName);

async function listMemoryFiles(): Promise<MemoryFile[]> {
  const home = getState().server.info?.codexHome;
  if (!home) return [];
  const root = joinPath(home, "memories");
  const top = await memoryFiles();
  const markdown = (entry: { fileName: string; isFile: boolean }) => entry.isFile && /\.md$/i.test(entry.fileName);
  const files = top.filter(markdown).sort(byName).map((entry) => ({ path: joinPath(root, entry.fileName), name: entry.fileName }));
  for (const dir of top.filter((entry) => entry.isDirectory).sort(byName)) {
    const children = (await memoryFiles(dir.fileName)).filter(markdown).sort(byName);
    files.push(...children.map((entry) => ({ path: joinPath(joinPath(root, dir.fileName), entry.fileName), name: `${dir.fileName}/${entry.fileName}` })));
  }
  return files;
}

function MemoryPanel({ files }: { files: MemoryFile[] }) {
  const [pick, setPick] = useState(files[0]?.path ?? null);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!pick) return;
    setText(null);
    let live = true;
    readTextFile(pick)
      .then((content) => live && setText(content))
      .catch((error) => live && setText(`无法读取：${errorMessage(error)}`));
    return () => {
      live = false;
    };
  }, [pick]);
  // MEMORY.md runs to hundreds of KB; the preview shows the head of it.
  const long = text !== null && text.length > PREVIEW_BYTES;
  return (
    <div className="memory-panel">
      <div className="memory-list" aria-label="记忆文件">
        {files.map((file, index) => (
          <button
            key={file.path}
            type="button"
            aria-current={file.path === pick}
            className="memory-item"
            style={{ "--i": Math.min(index, 20) } as CSSProperties}
            onClick={() => setPick(file.path)}
          >
            <span>{basename(file.name)}</span>
            {file.name.includes("/") && <small>{file.name.slice(0, file.name.lastIndexOf("/"))}</small>}
          </button>
        ))}
      </div>
      <div key={pick} className="memory-detail">
        {text === null ? (
          <Skeleton lines={4} />
        ) : (
          <>
            {long && <p className="settings-note">文件较大，这里只显示前 64 KB。</p>}
            <Markdown text={long ? text.slice(0, PREVIEW_BYTES) : text} />
          </>
        )}
      </div>
    </div>
  );
}

export function MemoryTab() {
  // memoriesEnabled() / memorySettings() read these.
  useStore((s) => s.features);
  useStore((s) => s.config);
  const codexHome = useStore((s) => s.server.info?.codexHome);
  const enabled = memoriesEnabled();
  const { use, generate } = memorySettings();
  const [status, setStatus] = useState<MemoryStatus | null | undefined>(undefined);
  const [files, setFiles] = useState<MemoryFile[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const load = () => {
    readMemoryStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
    listMemoryFiles()
      .then(setFiles)
      .catch(() => setFiles([]));
  };
  useEffect(load, []);
  return (
    <>
      <Section id="setting-memory-memories" title="记忆" description="Codex 会从过去的会话里整理出值得记住的内容，在新会话里参考。">
        <Row id="setting-memory-enabled" label="启用记忆" description="关闭后既不生成，也不使用记忆。">
          <Toggle checked={enabled} label="启用记忆" onChange={(on) => void setMemoriesEnabled(on).catch(failed("切换记忆失败"))} />
        </Row>
        {enabled && (
          <>
            <Row id="setting-memory-use" label="在新会话中使用记忆" description="把整理好的记忆放进新会话的上下文。">
              <Toggle checked={use} label="在新会话中使用记忆" onChange={(next) => void setMemorySettings({ use: next }).catch(failed("保存失败"))} />
            </Row>
            <Row id="setting-memory-generate" label="从会话中生成记忆" description="会话结束后把值得记住的内容整理进记忆；也可以在输入框的「+」菜单里为单个会话关闭。">
              <Toggle checked={generate} label="从会话中生成记忆" onChange={(next) => void setMemorySettings({ generate: next }).catch(failed("保存失败"))} />
            </Row>
          </>
        )}
        {status && (
          <Row
            id="setting-memory-status"
            label="新版记忆"
            description={status.v2Ready ? `已就绪，已整理 ${status.v2ConsolidatedThreads} 个会话。` : `已整理 ${status.v2ConsolidatedThreads} / 20 个会话，满 20 个并生成摘要后启用。`}
          />
        )}
        {status && (
          <Row id="setting-memory-reset" label="清空记忆" description="删除所有已保存的记忆，无法恢复。">
            <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}>
              清空
            </Button>
          </Row>
        )}
      </Section>
      <Section id="setting-memory-files" title="记忆文件" description={codexHome ? joinPath(codexHome, "memories") : undefined}>
        {files === null ? <Skeleton lines={3} /> : files.length === 0 ? <p className="settings-note">还没有记忆文件。</p> : <MemoryPanel files={files} />}
      </Section>
      {confirm && (
        <Confirm
          title="清空所有记忆？"
          description="已保存的记忆会全部删除，无法恢复；之后的会话会重新开始积累。"
          confirm="清空"
          danger
          onClose={() => setConfirm(false)}
          onConfirm={() =>
            resetMemory()
              .then(() => {
                toast("success", "记忆已清空");
                load();
              })
              .catch(failed("清空记忆失败"))
          }
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Plugins (U7) and marketplaces (U27). The local directory is listed; remote catalogs
// (15 MB in full) are only searched.

type PluginRef = { pluginName: string; marketplacePath?: string | null; remoteMarketplaceName?: string | null };

function PluginTile({ plugin }: { plugin: PluginSummary }) {
  const color = plugin.interface?.brandColor;
  const name = plugin.interface?.displayName ?? plugin.name;
  // Remote logos are not loaded (CSP img-src is local only); the brand color carries the initial.
  return color && /^#[0-9a-f]{3,8}$/i.test(color) ? (
    <span className="plugin-tile" style={{ background: color }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  ) : (
    <Puzzle size={18} />
  );
}

const pluginName = (plugin: PluginSummary) => plugin.interface?.displayName ?? plugin.name;

const HOOK_EVENTS: Record<HookEventName, string> = {
  preToolUse: "工具调用前",
  permissionRequest: "权限请求",
  postToolUse: "工具调用后",
  preCompact: "压缩前",
  postCompact: "压缩后",
  sessionStart: "会话开始",
  sessionEnd: "会话结束",
  userPromptSubmit: "提交消息",
  subagentStart: "子代理启动",
  subagentStop: "子代理结束",
  stop: "停止",
  interrupt: "中断",
};

function PluginPage({ target, onBack }: { target: PluginRef; onBack(): void }) {
  const installed = useStore((s) => s.plugins);
  const [detail, setDetail] = useState<PluginDetail | "error" | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    readPlugin(target)
      .then(setDetail)
      .catch((error) => {
        setDetail("error");
        toast("error", "读取插件失败", errorMessage(error));
      });
  }, [target]);
  const back = (
    <Button variant="ghost" size="sm" className="settings-back" icon={<ArrowLeft size={16} />} onClick={onBack}>
      插件
    </Button>
  );
  if (detail === null)
    return (
      <>
        {back}
        <Skeleton lines={4} />
      </>
    );
  if (detail === "error")
    return (
      <>
        {back}
        <p className="settings-note">无法读取这个插件。</p>
      </>
    );
  const { summary } = detail;
  const mine = installed?.find((plugin) => plugin.id === summary.id);
  const isInstalled = mine?.installed ?? summary.installed;
  const ui = summary.interface;
  const name = pluginName(summary);
  const installable = summary.availability === "AVAILABLE" && summary.installPolicy !== "NOT_AVAILABLE";
  const links: [string, string][] = [];
  for (const [label, raw] of [
    ["网站", ui?.websiteUrl],
    ["隐私政策", ui?.privacyPolicyUrl],
    ["服务条款", ui?.termsOfServiceUrl],
  ] as const) {
    const url = raw ? externalUrl(raw) : null;
    if (url) links.push([label, url]);
  }
  return (
    <>
      {back}
      <div className="plugin-head">
        <span className="settings-row-leading">
          <PluginTile plugin={summary} />
        </span>
        <div className="plugin-head-text">
          <h3 className="plugin-head-title">{name}</h3>
          <div className="settings-row-desc">{[ui?.developerName, detail.marketplaceName, summary.localVersion ?? summary.version].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="settings-row-control">
          {isInstalled ? (
            <>
              <Toggle checked={mine?.enabled ?? summary.enabled} label={`启用 ${name}`} onChange={(on) => void setPluginEnabled(summary.id, on).catch(failed("切换插件失败"))} />
              <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}>
                卸载
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !installable}
              onClick={() => {
                setBusy(true);
                installPlugin(target)
                  .then(({ appsNeedingAuth }) =>
                    appsNeedingAuth.length
                      ? toast("info", `已安装「${name}」`, `这些连接器需要登录：${appsNeedingAuth.map((app) => app.name).join("、")}`)
                      : toast("success", `已安装「${name}」`),
                  )
                  .catch(failed("安装失败"))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "正在安装…" : "安装"}
            </Button>
          )}
        </div>
      </div>
      {(ui?.longDescription ?? detail.description ?? ui?.shortDescription) && <p className="settings-row-desc plugin-desc">{ui?.longDescription ?? detail.description ?? ui?.shortDescription}</p>}
      {(detail.hooks.length > 0 || detail.mcpServers.length > 0) && <p className="settings-note plugin-desc">包含 Hooks 或 MCP 服务器，它们会在会话里自行运行，不会每次询问。</p>}
      {detail.skills.length > 0 && (
        <Section title="技能">
          {detail.skills.map((skill) => (
            <Row key={skill.name} label={skill.interface?.displayName ?? skill.name} description={skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description} />
          ))}
        </Section>
      )}
      {detail.hooks.length > 0 && (
        <Section title="Hooks">
          {detail.hooks.map((hook) => (
            <Row key={hook.key} label={HOOK_EVENTS[hook.eventName] ?? hook.eventName} description={<span className="about-value">{hook.key}</span>} />
          ))}
        </Section>
      )}
      {detail.apps.length > 0 && (
        <Section title="连接器">
          {detail.apps.map((app) => {
            const url = app.installUrl ? externalUrl(app.installUrl) : null;
            return (
              <Row key={app.id} leading={<Plug size={18} />} label={app.name} description={app.description ?? undefined}>
                {url && (
                  <a className="btn btn-secondary btn-sm" href={url} target="_blank" rel="noopener noreferrer">
                    连接
                  </a>
                )}
              </Row>
            );
          })}
        </Section>
      )}
      {detail.mcpServers.length > 0 && (
        <Section title="MCP 服务器">
          <div className="tag-list">
            {detail.mcpServers.map((server) => (
              <span key={server} className="tag">
                {server}
              </span>
            ))}
          </div>
        </Section>
      )}
      {links.length > 0 && (
        <Section title="链接">
          {links.map(([label, url]) => (
            <Row key={label} label={label} description={url}>
              <a className="btn btn-ghost btn-sm btn-icon" href={url} target="_blank" rel="noopener noreferrer" aria-label={`打开${label}`} data-tip={`打开${label}`}>
                <ExternalLink size={16} />
              </a>
            </Row>
          ))}
        </Section>
      )}
      {confirm && (
        <Confirm
          title={`卸载「${name}」？`}
          description="插件带来的技能、Hooks、连接器和 MCP 服务器会一起移除。"
          confirm="卸载"
          danger
          onClose={() => setConfirm(false)}
          onConfirm={() =>
            uninstallPlugin(summary.id)
              .then(() => {
                toast("success", `已卸载「${name}」`);
                onBack();
              })
              .catch(failed("卸载失败"))
          }
        />
      )}
    </>
  );
}

export function PluginsTab() {
  const installed = useStore((s) => s.plugins);
  const [directory, setDirectory] = useState<PluginListResponse | null>(null);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<PluginSearchResult[] | null>(null);
  const [open, setOpen] = useState<PluginRef | null>(null);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState<"add" | "upgrade" | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const loadDirectory = () =>
    pluginDirectory()
      .then(setDirectory)
      .catch((error) => {
        setDirectory({ marketplaces: [], marketplaceLoadErrors: [], featuredPluginIds: [] });
        toast("error", "读取插件目录失败", errorMessage(error));
      });
  useEffect(() => {
    void listInstalledPlugins();
    void loadDirectory();
  }, []);
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setRemote(null);
      return;
    }
    const timer = setTimeout(() => {
      searchPlugins(term)
        .then((result) => setRemote(result.data))
        .catch(() => setRemote([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  if (open)
    return (
      <PluginPage
        target={open}
        onBack={() => {
          setOpen(null);
          void loadDirectory();
        }}
      />
    );
  const pathOf = (marketplaceName: string) => directory?.marketplaces.find((market) => market.name === marketplaceName)?.path ?? null;
  const refOf = (plugin: PluginSummary, marketplaceName: string, marketplacePath = pathOf(marketplaceName)): PluginRef =>
    marketplacePath ? { pluginName: plugin.name, marketplacePath } : { pluginName: plugin.name, remoteMarketplaceName: marketplaceName };
  const term = query.trim().toLowerCase();
  const matches = (plugin: PluginSummary) => !term || [plugin.name, plugin.interface?.displayName, plugin.interface?.shortDescription, ...plugin.keywords].some((text) => text?.toLowerCase().includes(term));
  const local = directory?.marketplaces.flatMap((market) => market.plugins.filter(matches).map((plugin) => ({ plugin, marketplaceName: market.name, marketplacePath: market.path }))) ?? null;
  const localIds = new Set(local?.map((entry) => entry.plugin.id));
  const found = remote?.filter((result) => !localIds.has(result.plugin.id)) ?? [];
  const markets = directory?.marketplaces.filter((market) => market.path) ?? [];
  const row = (plugin: PluginSummary, ref: PluginRef, extra?: string) => (
    <Row
      key={`${plugin.id}:${ref.marketplacePath ?? ref.remoteMarketplaceName}`}
      leading={<PluginTile plugin={plugin} />}
      label={
        <>
          {pluginName(plugin)}
          {plugin.installed && <span className="badge">已安装</span>}
        </>
      }
      description={[plugin.interface?.shortDescription, extra].filter(Boolean).join(" · ") || undefined}
      onOpen={() => setOpen(ref)}
    />
  );
  return (
    <>
      <Section id="setting-plugins-installed" title="已安装" description="插件可以给 Codex 带来技能、Hooks、连接器和 MCP 服务器。">
        {installed === null ? (
          <Skeleton lines={3} />
        ) : installed.length === 0 ? (
          <p className="settings-note">还没有安装插件。</p>
        ) : (
          installed.map((plugin) => (
            <Row
              key={plugin.id}
              leading={<PluginTile plugin={plugin} />}
              label={pluginName(plugin)}
              description={[plugin.interface?.shortDescription, plugin.marketplaceName].filter(Boolean).join(" · ")}
              onOpen={() => setOpen(refOf(plugin, plugin.marketplaceName))}
            >
              <Toggle checked={plugin.enabled} label={`启用 ${pluginName(plugin)}`} onChange={(on) => void setPluginEnabled(plugin.id, on).catch(failed("切换插件失败"))} />
            </Row>
          ))
        )}
      </Section>
      <Section
        id="setting-plugins-directory"
        title="插件目录"
        description="已添加的插件市场里的插件；输入两个字以上时也搜索远程目录。"
        action={<input className="input plugin-search" type="search" placeholder="搜索插件" aria-label="搜索插件" value={query} onChange={(event) => setQuery(event.target.value)} />}
      >
        {local === null ? (
          <Skeleton lines={3} />
        ) : local.length === 0 && found.length === 0 ? (
          <p className="settings-note">{term ? "没有匹配的插件。" : "插件目录是空的。"}</p>
        ) : (
          <>
            {local.map(({ plugin, marketplaceName, marketplacePath }) => row(plugin, refOf(plugin, marketplaceName, marketplacePath), marketplaceName))}
            {found.map(({ plugin, marketplaceName, marketplacePath }) => row(plugin, refOf(plugin, marketplaceName, marketplacePath), marketplaceName))}
          </>
        )}
        {remote === null && term.length >= 2 && (
          <p className="settings-note">
            <Spinner size={12} /> 正在搜索远程目录…
          </p>
        )}
      </Section>
      <Section
        id="setting-plugins-marketplaces"
        title="插件市场"
        description="插件市场是一个 Git 仓库或本地目录，里面列出可以安装的插件。"
        action={
          <Button
            variant="secondary"
            size="sm"
            disabled={busy !== null || markets.length === 0}
            onClick={() => {
              setBusy("upgrade");
              upgradeMarketplaces()
                .then(({ upgradedRoots, errors }) => {
                  if (errors.length) toast("error", "部分市场更新失败", errors.map((error) => `${error.marketplaceName}：${error.message}`).join("\n"));
                  else toast("success", upgradedRoots.length ? `已更新 ${upgradedRoots.length} 个市场` : "所有市场都是最新的");
                  void loadDirectory();
                })
                .catch(failed("更新市场失败"))
                .finally(() => setBusy(null));
            }}
          >
            {busy === "upgrade" ? "正在更新…" : "全部更新"}
          </Button>
        }
      >
        {markets.map((market) => (
          <Row key={market.name} label={market.interface?.displayName ?? market.name} description={<span className="about-value">{market.path}</span>}>
            <Button variant="ghost" size="sm" muted icon={<Trash2 size={16} />} label={`移除 ${market.name}`} onClick={() => setRemoving(market.name)} />
          </Row>
        ))}
        {directory?.marketplaceLoadErrors.map((error) => (
          <div key={error.marketplacePath} className="error-text small">
            {error.marketplacePath}：{error.message}
          </div>
        ))}
        <form
          className="path-bar"
          onSubmit={(event) => {
            event.preventDefault();
            const value = source.trim();
            if (!value) return;
            setBusy("add");
            addMarketplace(value)
              .then(({ marketplaceName, alreadyAdded }) => {
                toast(alreadyAdded ? "info" : "success", alreadyAdded ? `「${marketplaceName}」已经添加过了` : `已添加「${marketplaceName}」`);
                setSource("");
                void loadDirectory();
              })
              .catch(failed("添加市场失败"))
              .finally(() => setBusy(null));
          }}
        >
          <input className="input mono" placeholder="Git 地址或本地目录" aria-label="插件市场来源" value={source} onChange={(event) => setSource(event.target.value)} />
          <Button variant="secondary" type="submit" disabled={busy !== null || !source.trim()}>
            {busy === "add" ? "正在添加…" : "添加市场"}
          </Button>
        </form>
      </Section>
      {removing && (
        <Confirm
          title={`移除「${removing}」？`}
          description="这个市场里的插件不会再出现在目录里；已安装的插件不受影响。"
          confirm="移除"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={() =>
            removeMarketplace(removing)
              .then(() => loadDirectory())
              .catch(failed("移除市场失败"))
          }
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Skills and extra skill roots (U29: skills/extraRoots/set is runtime-only, so the list is kept
// in this browser and handed over again on every connect, see SettingsDialog).

const SKILL_ROOTS_KEY = "codex-ui:skill-roots";

export function savedSkillRoots(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(SKILL_ROOTS_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((path): path is string => typeof path === "string") : [];
  } catch {
    return [];
  }
}

const SCOPE_LABELS: Record<string, string> = { user: "个人", repo: "仓库", system: "内置", admin: "管理员" };

export function SkillsTab() {
  const cwd = useStore((s) => s.prefs.cwd);
  const rev = useStore((s) => s.skillsRev);
  const [entries, setEntries] = useState<SkillsListResponse["data"] | null>(null);
  const [roots, setRoots] = useState(savedSkillRoots);
  const [draft, setDraft] = useState("");
  const load = (force = false) =>
    listSkills(cwd, force)
      .then(setEntries)
      .catch((error) => {
        setEntries([]);
        toast("error", "读取技能失败", errorMessage(error));
      });
  useEffect(() => void load(), [cwd, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveRoots = (next: string[]) => {
    setSkillRoots(next)
      .then(() => {
        writePref(SKILL_ROOTS_KEY, JSON.stringify(next));
        setRoots(next);
      })
      .catch(failed("设置技能目录失败"));
  };
  const skills = entries?.flatMap((entry) => entry.skills) ?? [];
  const errors = entries?.flatMap((entry) => entry.errors) ?? [];
  return (
    <>
      <Section
        id="setting-skills-list"
        title="技能"
        description="技能是放在 SKILL.md 里的可复用说明，Codex 会在合适的时候自动调用。"
        action={<Button variant="ghost" size="xs" muted icon={<RefreshCw size={16} />} label="重新扫描" onClick={() => void load(true)} />}
      >
        {entries === null && <Skeleton lines={3} />}
        {entries && skills.length === 0 && <p className="settings-note">没有发现技能。</p>}
        {skills.map((skill) => (
          <Row
            key={skill.path}
            label={
              <>
                {skill.interface?.displayName ?? skill.name}
                <span className="badge">{SCOPE_LABELS[skill.scope] ?? skill.scope}</span>
              </>
            }
            description={skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description}
          >
            <Toggle
              checked={skill.enabled}
              label={`启用 ${skill.name}`}
              onChange={(enabled) => {
                setSkillEnabled(skill.path, enabled)
                  .then(() =>
                    setEntries((current) => current?.map((entry) => ({ ...entry, skills: entry.skills.map((s) => (s.path === skill.path ? { ...s, enabled } : s)) })) ?? null),
                  )
                  .catch(failed("更新技能失败"));
              }}
            />
          </Row>
        ))}
        {errors.map((error) => (
          <div key={error.path} className="error-text small">
            {error.path}：{error.message}
          </div>
        ))}
      </Section>
      <Section id="setting-skills-roots" title="额外技能目录" description="Codex 也会在这些目录里查找技能。目录保存在这台电脑上，每次连接时交给 Codex。">
        {roots.map((root) => (
          <Row key={root} label={basename(root)} description={<span className="about-value">{root}</span>}>
            <Button variant="ghost" size="sm" muted icon={<Trash2 size={16} />} label={`移除 ${root}`} onClick={() => saveRoots(roots.filter((path) => path !== root))} />
          </Row>
        ))}
        <form
          className="path-bar"
          onSubmit={(event) => {
            event.preventDefault();
            const path = draft.trim();
            if (!path || roots.includes(path)) return;
            saveRoots([...roots, path]);
            setDraft("");
          }}
        >
          <input className="input mono" placeholder="目录的绝对路径" aria-label="技能目录" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <Button variant="secondary" type="submit" disabled={!draft.trim()}>
            添加
          </Button>
        </form>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Connectors (U8): ChatGPT apps and MCP servers on one page.

const MCP_STATUS: Record<McpServerConnectionStatus, [string, DotKind]> = {
  connected: ["已连接", "ready"],
  starting: ["启动中", "idle"],
  notStarted: ["未启动", "idle"],
  authenticationRequired: ["需要登录", "blocked"],
  failed: ["失败", "error"],
  cancelled: ["已取消", "idle"],
  disabled: ["已停用", "idle"],
};

export function ConnectorsTab() {
  const connectors = useStore((s) => s.connectors);
  const servers = useStore((s) => s.mcp);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void listConnectors(getState().activeId);
    if (getState().mcp === null) void refreshMcp();
  }, []);
  return (
    <>
      <Section id="setting-connectors-apps" title="应用" description="ChatGPT 账户里连接的应用，Codex 可以在会话中使用它们的工具。连接或断开请到 ChatGPT 的设置。">
        {connectors === null ? (
          <Skeleton lines={3} />
        ) : connectors.length === 0 ? (
          <p className="settings-note">还没有连接应用。</p>
        ) : (
          connectors.map((connector) => (
            <Row
              key={connector.id}
              leading={<Plug size={18} />}
              label={
                <>
                  {connector.name}
                  {connector.enabled && !connector.callable && <span className="badge">暂不可用</span>}
                </>
              }
              description={connector.description ?? undefined}
            >
              <Toggle checked={connector.enabled} label={`启用 ${connector.name}`} onChange={(on) => void setConnectorEnabled(connector.id, on).catch(failed("切换应用失败"))} />
            </Row>
          ))
        )}
      </Section>
      <Section
        id="setting-connectors-mcp"
        title="MCP 服务器"
        action={
          <Button
            variant="ghost"
            size="xs"
            muted
            icon={busy ? <Spinner size={12} /> : <RefreshCw size={16} />}
            label="重新加载配置"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              reloadMcpServers()
                .then(() => refreshMcp())
                .catch(failed("重新加载失败"))
                .finally(() => setBusy(false));
            }}
          />
        }
      >
        {servers === null && <Skeleton lines={3} />}
        {servers?.length === 0 && (
          <p className="settings-note">
            还没有配置 MCP 服务器。在 config.toml 中添加 <code className="inline-code">[mcp_servers.名称]</code> 后点击上方的按钮重新加载。
          </p>
        )}
        {servers?.map((server) => {
          const [label, dot] = server.runtimeStatus ? MCP_STATUS[server.runtimeStatus] : (["", "idle"] as const);
          const tools = Object.keys(server.tools);
          return (
            <Row
              key={server.name}
              label={
                <>
                  {server.name}
                  {label && (
                    <span className="badge">
                      <StatusDot kind={dot} /> {label}
                    </span>
                  )}
                </>
              }
              description={
                <>
                  {[server.serverInfo?.name && `${server.serverInfo.name} ${server.serverInfo.version ?? ""}`.trim(), `${tools.length} 个工具`, server.httpOrigin].filter(Boolean).join(" · ")}
                  {server.toolsError && <div className="error-text small">{server.toolsError}</div>}
                  {tools.length > 0 && (
                    <div className="tag-list">
                      {tools.slice(0, 24).map((tool) => (
                        <span key={tool} className="tag">
                          {tool}
                        </span>
                      ))}
                      {tools.length > 24 && <span className="tag">+{tools.length - 24}</span>}
                    </div>
                  )}
                </>
              }
            >
              {server.authStatus === "notLoggedIn" && (
                <Button size="sm" variant="secondary" onClick={() => void loginMcpServer(server.name).catch(failed("登录失败"))}>
                  登录
                </Button>
              )}
            </Row>
          );
        })}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Hooks (U1): every hook with its trust state; new or changed hooks run only once trusted.

const HOOK_TRUST: Record<HookTrustStatus, string> = { managed: "由管理员管理", trusted: "已信任", untrusted: "未信任", modified: "内容有变化" };

const HOOK_SOURCES: Record<HookSource, string> = {
  system: "系统",
  user: "用户配置",
  project: "项目",
  mdm: "设备管理",
  sessionFlags: "会话参数",
  plugin: "插件",
  cloudRequirements: "云端要求",
  cloudManagedConfig: "云端托管配置",
  legacyManagedConfigFile: "托管配置",
  legacyManagedConfigMdm: "托管配置（设备管理）",
  unknown: "未知来源",
};

function hookAction(hook: HookMetadata): string {
  switch (hook.handlerType) {
    case "command":
      return hook.async ? `${hook.command}（异步）` : hook.command;
    case "mcpTool":
      return `MCP ${hook.server} · ${hook.tool}`;
    case "prompt":
      return "提示";
    case "agent":
      return "子代理";
  }
}

export function HooksTab() {
  const hooks = useStore((s) => s.hooks);
  useEffect(() => void listHooks(), []);
  const review = hooks ? hooksNeedingReview(getState()) : [];
  const list = hooks ? [...hooks.list].sort((a, b) => Number(a.displayOrder) - Number(b.displayOrder)) : null;
  return (
    <Section
      id="setting-hooks-list"
      title="Hooks"
      description="Hooks 会在会话的特定时刻运行命令、MCP 工具或提示。新的或内容有变化的 hook 要先信任才会运行。"
      action={
        review.length > 0 ? (
          <Button variant="primary" size="sm" onClick={() => void trustHooks(review).catch(failed("信任失败"))}>
            全部信任（{review.length}）
          </Button>
        ) : undefined
      }
    >
      {list === null && <Skeleton lines={3} />}
      {list?.length === 0 && <p className="settings-note">没有配置 hook。</p>}
      {list?.map((hook) => {
        const pending = hook.trustStatus === "untrusted" || hook.trustStatus === "modified";
        return (
          <Row
            key={hook.key}
            id={`setting-hooks-${hook.key}`}
            label={
              <>
                {HOOK_EVENTS[hook.eventName] ?? hook.eventName}
                {hook.matcher && ` · ${hook.matcher}`}
                <span className={`badge ${pending ? "badge-warning" : ""}`}>{HOOK_TRUST[hook.trustStatus]}</span>
              </>
            }
            description={
              <>
                <span className="about-value">{hookAction(hook)}</span>
                <br />
                {[HOOK_SOURCES[hook.source] ?? hook.source, hook.pluginId, hook.sourcePath].filter(Boolean).join(" · ")}
              </>
            }
          >
            {pending && !hook.isManaged && (
              <Button variant="secondary" size="sm" onClick={() => void trustHooks([hook]).catch(failed("信任失败"))}>
                信任
              </Button>
            )}
            {!hook.isManaged && <Toggle checked={hook.enabled} label={`启用 ${hook.key}`} onChange={(on) => void setHookEnabled(hook.key, on).catch(failed("切换 hook 失败"))} />}
          </Row>
        );
      })}
      {hooks?.warnings.map((warning) => (
        <p key={warning} className="settings-note">
          {warning}
        </p>
      ))}
      {hooks?.errors.map((error) => (
        <div key={error.path} className="error-text small">
          {error.path}：{error.message}
        </div>
      ))}
    </Section>
  );
}
