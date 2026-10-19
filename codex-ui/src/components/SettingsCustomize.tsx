// Settings pages for what Codex loads into sessions: memory (W21 memory panel), plugins and
// marketplaces, skills and extra skill roots, connectors (ChatGPT apps, the app directory, MCP
// servers), hooks.

import type { AppInfo } from "@protocol/v2/AppInfo";
import type { HookEventName } from "@protocol/v2/HookEventName";
import type { HookMetadata } from "@protocol/v2/HookMetadata";
import type { HookSource } from "@protocol/v2/HookSource";
import type { HookTrustStatus } from "@protocol/v2/HookTrustStatus";
import type { McpServerConnectionStatus } from "@protocol/v2/McpServerConnectionStatus";
import type { PluginDetail } from "@protocol/v2/PluginDetail";
import type { PluginListResponse } from "@protocol/v2/PluginListResponse";
import type { PluginSearchResult } from "@protocol/v2/PluginSearchResult";
import type { PluginShareContext } from "@protocol/v2/PluginShareContext";
import type { PluginShareDiscoverability } from "@protocol/v2/PluginShareDiscoverability";
import type { PluginShareListItem } from "@protocol/v2/PluginShareListItem";
import type { PluginSharePrincipalRole } from "@protocol/v2/PluginSharePrincipalRole";
import type { PluginSummary } from "@protocol/v2/PluginSummary";
import type { SkillsListResponse } from "@protocol/v2/SkillsListResponse";
import { ArrowLeft, Building2, ChevronDown, CircleCheck, EllipsisVertical, ExternalLink, Link, Lock, Plug, Puzzle, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  addMarketplace,
  browseConnectors,
  checkoutPluginShare,
  deletePluginShare,
  errorMessage,
  installPlugin,
  listConnectors,
  listHooks,
  listInstalledPlugins,
  listPluginShares,
  listSkills,
  loginMcpServer,
  memoriesEnabled,
  memoryDirectory,
  memoryFiles,
  memorySettings,
  pluginDirectory,
  readMemoryStatus,
  readPlugin,
  readTextFile,
  reconcilePlugins,
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
  setShareAccess,
  setSkillEnabled,
  setSkillRoots,
  sharePlugin,
  trustHooks,
  uninstallPlugin,
  upgradeMarketplaces,
  writeConfig,
  type MemoryStatus,
} from "../lib/codex";
import { basename, externalUrl, joinPath } from "../lib/format";
import { updateMessage } from "../lib/plugins";
import { getState, hooksNeedingReview, toast, useStore, writePref } from "../lib/store";
import { Markdown } from "./content";
import { Confirm, Row, Section } from "./Settings";
import { Button, Dialog, MenuItem, MenuSep, Popover, Skeleton, Spinner, StatusDot, Toggle, type DotKind } from "./ui";

const failed = (title: string) => (error: unknown) => toast("danger", title, errorMessage(error));

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
  const root = joinPath(home, memoryDirectory());
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
            <Row id="setting-memory-generate" label="从会话中生成记忆" description="会话结束后把值得记住的内容整理进记忆；也可以在输入框的“+”菜单中为单个会话关闭。">
              <Toggle checked={generate} label="从会话中生成记忆" onChange={(next) => void setMemorySettings({ generate: next }).catch(failed("保存失败"))} />
            </Row>
          </>
        )}
        {status && (
          <Row
            id="setting-memory-status"
            label="新版记忆"
            description={
              memoryDirectory() === "memories_v2"
                ? `正在使用，已整理 ${status.v2ConsolidatedThreads} 个会话。`
                : status.v2Ready
                  ? `已就绪，已整理 ${status.v2ConsolidatedThreads} 个会话；启用后 Codex 改用 memories_v2 目录。`
                  : `已整理 ${status.v2ConsolidatedThreads} / 20 个会话；满 20 个并生成摘要后可以启用。Codex 不会自动切换。`
            }
          >
            {status.v2Ready && memoryDirectory() !== "memories_v2" && (
              <Button variant="secondary" size="sm" onClick={() => void writeConfig([{ keyPath: "memories.version", value: "v2", mergeStrategy: "replace" }]).catch(failed("保存失败"))}>
                启用新版
              </Button>
            )}
          </Row>
        )}
        {status && (
          <Row id="setting-memory-reset" label="清空记忆" description="删除所有已保存的记忆，无法恢复。">
            <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}>
              清空
            </Button>
          </Row>
        )}
      </Section>
      <Section id="setting-memory-files" title="记忆文件" description={codexHome ? joinPath(codexHome, memoryDirectory()) : undefined}>
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
                toast("neutral", "记忆已清空");
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
const versionOf = (plugin?: PluginSummary | null) => plugin?.localVersion ?? plugin?.version ?? null;

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

// Sharing (c0ad2fd1b en → Gt, drawn as the classic share modal c5e7d44b0 k): people with access,
// general access and the share link. The protocol has no member directory, so people are listed
// but never invited; Codex's three discoverability levels stand in for General access.

const ACCESS: Record<PluginShareDiscoverability, { label: string; icon: ReactNode }> = {
  // c5e7d44b0 A: Lock “Only people invited” and Organization “Everyone at {organizationName}”;
  // UNLISTED (workspace link access) has no counterpart there.
  PRIVATE: { label: "仅限受邀用户", icon: <Lock size={16} /> },
  UNLISTED: { label: "工作区中拥有链接的人", icon: <Link size={16} /> },
  LISTED: { label: "工作区中的所有人", icon: <Building2 size={16} /> },
};

// c0ad2fd1b Bt “Can view” / “Can edit”, c90d7fd86 owner “Owner”.
const ROLES: Record<PluginSharePrincipalRole, string> = { owner: "所有者", editor: "可编辑", reader: "可查看" };

interface Sharing {
  name: string;
  /** The local plugin folder plugin/share/save uploads; null for a share that is not on this computer. */
  path: string | null;
  share: PluginShareContext | null;
}

/** A member row (c5e7d44b0 T): avatar initial, name with “(you)”, the role as plain text (c31c19704 d). */
function Person({ name, role, you = false }: { name: string; role: string; you?: boolean }) {
  return (
    <div className="share-person">
      <span className="share-avatar" aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="share-person-name">
        {name}
        {you && <span className="share-muted">（您）</span>}
      </span>
      <span className="share-muted">{role}</span>
    </div>
  );
}

function ShareDialog({ name, path, share: initial, onClose }: Sharing & { onClose(): void }) {
  const me = useStore((s) => (s.account?.account?.type === "chatgpt" ? s.account.account.email : null));
  const [share, setShare] = useState(initial);
  // Before sharing, the access plugin/share/save will create; it takes PRIVATE or UNLISTED.
  const [pick, setPick] = useState<Exclude<PluginShareDiscoverability, "LISTED">>("PRIVATE");
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [trapdoor, setTrapdoor] = useState<PluginShareDiscoverability | null>(null);
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  const access = share ? share.discoverability : pick;
  // updateTargets replaces the people as well: without the list, access cannot change safely.
  const known = !share || share.sharePrincipals !== null;
  const others = share?.sharePrincipals?.filter((p) => p.role !== "owner" && p.principalType !== "workspace") ?? [];
  const choices: PluginShareDiscoverability[] =
    share && (share.canPublishToWorkspace === true || share.discoverability === "LISTED") ? ["PRIVATE", "UNLISTED", "LISTED"] : ["PRIVATE", "UNLISTED"];
  const create = () => {
    if (!path) return;
    setBusy(true);
    sharePlugin(path, pick)
      .then(({ remotePluginId, shareUrl, canPublishToWorkspace }) => {
        setShare({ remotePluginId, remoteVersion: null, discoverability: pick, shareUrl: shareUrl || null, creatorAccountUserId: null, creatorName: null, sharePrincipals: [], canPublishToWorkspace });
        toast("neutral", "插件已分享");
      })
      .catch(failed("分享失败"))
      .finally(() => setBusy(false));
  };
  const apply = (next: PluginShareDiscoverability) => {
    if (!share) return Promise.resolve();
    setBusy(true);
    return setShareAccess(share, next)
      .then(({ discoverability, principals }) => setShare({ ...share, discoverability, sharePrincipals: principals }))
      .catch(failed("无法更改访问权限"))
      .finally(() => setBusy(false));
  };
  const change = (next: PluginShareDiscoverability) => {
    if (!share) {
      if (next !== "LISTED") setPick(next);
      return;
    }
    // c5e7d44b0 A: leaving organization-wide access asks first when it cannot be given back.
    if (share.discoverability === "LISTED" && share.canPublishToWorkspace !== true) setTrapdoor(next);
    else void apply(next);
  };
  const copy = () => {
    if (share?.shareUrl) navigator.clipboard.writeText(share.shareUrl).then(() => setCopied(true), failed("复制失败"));
  };
  const note = !share ? "分享时会把插件文件夹上传到您的 ChatGPT 工作区。" : access === "PRIVATE" && others.length === 0 ? "只有您能打开这个链接。" : null;
  return (
    <>
      <Dialog
        title={`分享“${name}”`}
        onClose={onClose}
        footer={
          share ? (
            <>
              <Button variant="ghost" className="share-stop" disabled={busy} onClick={() => setStopping(true)}>
                停止分享
              </Button>
              {share.shareUrl && (
                <Button variant="secondary" icon={copied ? <CircleCheck size={16} /> : <Link size={16} />} tip="只有拥有访问权限的人才能打开此链接" onClick={copy}>
                  {copied ? "已复制" : "复制链接"}
                </Button>
              )}
            </>
          ) : (
            <Button variant="primary" disabled={busy || !path} onClick={create}>
              {busy ? "正在分享…" : "分享"}
            </Button>
          )
        }
      >
        <div className="share-body">
          <section className="share-group">
            <h3 className="share-heading">有权访问的人</h3>
            <div className="share-people">
              <Person name={me ?? "您"} you={!!me} role={ROLES.owner} />
              {others.map((p) => (
                <Person key={`${p.principalType}:${p.principalId}`} name={p.name} role={ROLES[p.role]} />
              ))}
            </div>
          </section>
          <section className="share-group">
            <h3 className="share-heading">常规访问</h3>
            {access && known ? (
              <div className="share-access">
                <span className="share-access-icon">{ACCESS[access].icon}</span>
                <Popover
                  open={menu}
                  onClose={() => setMenu(false)}
                  anchor={
                    <Button
                      variant="ghost"
                      className="menu-select"
                      disabled={busy}
                      // Once shared there is no primary button: focus starts on the first control.
                      data-autofocus={share ? true : undefined}
                      aria-label={`常规访问：${ACCESS[access].label}`}
                      onClick={() => setMenu(!menu)}
                    >
                      <span className="menu-select-value">{ACCESS[access].label}</span>
                      <ChevronDown size={16} className="caret" />
                    </Button>
                  }
                >
                  {choices.map((value) => (
                    <MenuItem
                      key={value}
                      icon={ACCESS[value].icon}
                      label={ACCESS[value].label}
                      checked={value === access}
                      onClick={() => {
                        setMenu(false);
                        if (value !== access) change(value);
                      }}
                    />
                  ))}
                </Popover>
              </div>
            ) : (
              // c0ad2fd1b en groupReadFailed: “Couldn’t load group access for this plugin.”
              <p className="settings-note">无法读取这个插件的访问设置。</p>
            )}
          </section>
          {note && <p className="settings-note">{note}</p>}
        </div>
        <span className="sr-only" aria-live="polite">
          {copied ? "链接已复制" : ""}
        </span>
      </Dialog>
      {trapdoor && (
        // c0ad2fd1b Xt “Make plugin private?”; the UNLISTED wording is ours.
        <Confirm
          title={trapdoor === "PRIVATE" ? "将插件设为私密？" : "只允许拥有链接的人访问？"}
          description={`${trapdoor === "PRIVATE" ? "如果将此插件设为私密" : "这样更改后"}，您将无法再与整个工作区分享它。`}
          confirm={trapdoor === "PRIVATE" ? "设为私密" : "更改"}
          onClose={() => setTrapdoor(null)}
          onConfirm={() => apply(trapdoor)}
        />
      )}
      {stopping && share && (
        <Confirm
          title={`停止分享“${name}”？`}
          description="工作区里的共享副本会被删除，链接随之失效；您电脑上的插件不受影响。"
          confirm="停止分享"
          danger
          onClose={() => setStopping(false)}
          onConfirm={() =>
            deletePluginShare(share.remotePluginId)
              .then(() => {
                toast("neutral", `已停止分享“${name}”`);
                onClose();
              })
              .catch(failed("停止分享失败"))
          }
        />
      )}
    </>
  );
}

function PluginPage({ target, onBack }: { target: PluginRef; onBack(): void }) {
  const installed = useStore((s) => s.plugins);
  const chatgpt = useStore((s) => s.account?.account?.type === "chatgpt");
  const [detail, setDetail] = useState<PluginDetail | "error" | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [menu, setMenu] = useState(false);
  const [checking, setChecking] = useState(false);
  const [sharing, setSharing] = useState(false);
  const load = () =>
    readPlugin(target)
      .then(setDetail)
      .catch((error) => {
        setDetail("error");
        toast("danger", "读取插件失败", errorMessage(error));
      });
  useEffect(() => void load(), [target]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // ce5c807c8 S (c5d9db780 n): only the account's own plugins get 分享; for Codex that is a plugin
  // in a local folder (plugin/share/save uploads it) or one shared already.
  const shareable = isInstalled && chatgpt && (summary.source.type === "local" || !!summary.shareContext);
  // c334c9fcc X offers 检查更新 for plugins that are not local; plugin/reconcile only syncs the
  // account's remote installs, so the menu shows it for those.
  const checkUpdates = () => {
    setMenu(false);
    setChecking(true);
    const before = versionOf(mine ?? summary);
    reconcilePlugins()
      .then((response) => {
        const message = updateMessage(response, summary, before, versionOf(getState().plugins?.find((plugin) => plugin.id === summary.id)));
        // c334c9fcc Y withholds the error text.
        toast(message ? "neutral" : "danger", message ?? "无法检查更新，请重试。");
        void load();
      })
      .catch(() => toast("danger", "无法检查更新，请重试。"))
      .finally(() => setChecking(false));
  };
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
              {/* c24c8737b wo: Share, the ⋮ menu (vo), then the switch. */}
              {shareable && (
                <Button variant="secondary" size="sm" onClick={() => setSharing(true)}>
                  分享
                </Button>
              )}
              <Popover
                open={menu}
                onClose={() => setMenu(false)}
                placement="bottom-end"
                anchor={<Button variant="ghost" size="sm" icon={<EllipsisVertical size={16} />} label={`“${name}”的更多选项`} onClick={() => setMenu(!menu)} />}
              >
                {summary.source.type === "remote" && (
                  <>
                    <MenuItem icon={<RotateCw size={16} />} label="检查更新" disabled={checking} onClick={checkUpdates} />
                    <MenuSep />
                  </>
                )}
                <MenuItem
                  icon={<Trash2 size={16} />}
                  label="卸载"
                  danger
                  onClick={() => {
                    setMenu(false);
                    setConfirm(true);
                  }}
                />
              </Popover>
              <Toggle checked={mine?.enabled ?? summary.enabled} label={`启用 ${name}`} onChange={(on) => void setPluginEnabled(summary.id, on).catch(failed("切换插件失败"))} />
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
                      ? toast("neutral", `已安装“${name}”`, `这些连接器需要登录：${appsNeedingAuth.map((app) => app.name).join("、")}`)
                      : toast("neutral", `已安装“${name}”`),
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
          title={`卸载“${name}”？`}
          description="插件带来的技能、Hooks、连接器和 MCP 服务器会一起移除。"
          confirm="卸载"
          danger
          onClose={() => setConfirm(false)}
          onConfirm={() =>
            uninstallPlugin(summary.id)
              .then(() => {
                toast("neutral", `已卸载“${name}”`);
                onBack();
              })
              .catch(failed("卸载失败"))
          }
        />
      )}
      {sharing && (
        <ShareDialog
          name={name}
          path={summary.source.type === "local" ? summary.source.path : null}
          share={summary.shareContext}
          onClose={() => {
            setSharing(false);
            void load();
          }}
        />
      )}
    </>
  );
}

export function PluginsTab() {
  const installed = useStore((s) => s.plugins);
  const chatgpt = useStore((s) => s.account?.account?.type === "chatgpt");
  const [directory, setDirectory] = useState<PluginListResponse | null>(null);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<PluginSearchResult[] | null>(null);
  const [open, setOpen] = useState<PluginRef | null>(null);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState<"add" | "upgrade" | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  // undefined while loading; null when this account or server cannot share (the section hides).
  const [shares, setShares] = useState<PluginShareListItem[] | null | undefined>(undefined);
  const [sharing, setSharing] = useState<Sharing | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const loadDirectory = () =>
    pluginDirectory()
      .then(setDirectory)
      .catch((error) => {
        setDirectory({ marketplaces: [], marketplaceLoadErrors: [], featuredPluginIds: [] });
        toast("danger", "读取插件目录失败", errorMessage(error));
      });
  const loadShares = () =>
    listPluginShares()
      .then(setShares)
      .catch(() => setShares(null));
  useEffect(() => {
    void listInstalledPlugins();
    void loadDirectory();
  }, []);
  useEffect(() => {
    if (chatgpt) void loadShares();
    else setShares(null);
  }, [chatgpt]);
  const checkout = (name: string, share: PluginShareContext) => {
    setFetching(share.remotePluginId);
    checkoutPluginShare(share.remotePluginId)
      .then(({ pluginPath }) => {
        toast("neutral", `已取回“${name}”`, pluginPath);
        void loadShares();
        void loadDirectory();
      })
      .catch(failed("取回失败"))
      .finally(() => setFetching(null));
  };
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
          if (chatgpt) void loadShares();
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
      {chatgpt && shares !== null && (
        <Section id="setting-plugins-shared" title="已分享" description="您分享到 ChatGPT 工作区的插件。">
          {shares === undefined ? (
            <Skeleton lines={2} />
          ) : shares.length === 0 ? (
            <p className="settings-note">还没有分享插件。</p>
          ) : (
            shares.map(({ plugin, localPluginPath }) => {
              const share = plugin.shareContext;
              if (!share) return null;
              const name = pluginName(plugin);
              return (
                <Row
                  key={share.remotePluginId}
                  leading={<PluginTile plugin={plugin} />}
                  label={name}
                  description={
                    <>
                      {share.discoverability && `${ACCESS[share.discoverability].label} · `}
                      {localPluginPath ? <span className="about-value">{localPluginPath}</span> : "不在这台电脑上"}
                    </>
                  }
                  onOpen={() => setSharing({ name, path: localPluginPath, share })}
                >
                  {!localPluginPath && (
                    <Button variant="secondary" size="sm" disabled={fetching !== null} onClick={() => checkout(name, share)}>
                      {fetching === share.remotePluginId ? "正在取回…" : "取回到本地"}
                    </Button>
                  )}
                </Row>
              );
            })
          )}
        </Section>
      )}
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
                  if (errors.length) toast("danger", "部分市场更新失败", errors.map((error) => `${error.marketplaceName}：${error.message}`).join("\n"));
                  else toast("neutral", upgradedRoots.length ? `已更新 ${upgradedRoots.length} 个市场` : "所有市场都是最新的");
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
                toast("neutral", alreadyAdded ? `“${marketplaceName}”已经添加过了` : `已添加“${marketplaceName}”`);
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
          title={`移除“${removing}”？`}
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
      {sharing && (
        <ShareDialog
          {...sharing}
          onClose={() => {
            setSharing(null);
            void loadShares();
          }}
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
        toast("danger", "读取技能失败", errorMessage(error));
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
// Connectors (U8): ChatGPT apps, the app directory (app/list) and MCP servers on one page.

const MCP_STATUS: Record<McpServerConnectionStatus, [string, DotKind]> = {
  connected: ["已连接", "ready"],
  starting: ["启动中", "idle"],
  notStarted: ["未启动", "idle"],
  authenticationRequired: ["需要登录", "blocked"],
  failed: ["失败", "error"],
  cancelled: ["已取消", "idle"],
  disabled: ["已停用", "idle"],
};

/** The connector directory (app/list, a page at a time) minus what is installed; 连接 opens the app's connect page. */
function BrowseConnectors() {
  const installed = useStore((s) => s.connectors);
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = (after: string | null) => {
    setBusy(true);
    browseConnectors(after)
      .then((page) => {
        setApps((current) => [...(after ? (current ?? []) : []), ...(page?.data ?? [])]);
        setCursor(page?.nextCursor ?? null);
      })
      .catch((error) => {
        setApps((current) => current ?? []);
        failed("读取连接器目录失败")(error);
      })
      .finally(() => setBusy(false));
  };
  useEffect(() => load(null), []);
  const ids = new Set(installed?.map((connector) => connector.id));
  const list = apps?.filter((app) => !ids.has(app.id)) ?? null;
  return (
    <Section id="setting-connectors-browse" title="浏览连接器" description="ChatGPT 中可以连接的应用。连接后，Codex 就能在会话中使用它们的工具。">
      {list === null ? (
        <Skeleton lines={3} />
      ) : list.length === 0 ? (
        <p className="settings-note">没有可连接的应用。</p>
      ) : (
        list.map((app) => {
          const url = !app.isAccessible && app.installUrl ? externalUrl(app.installUrl) : null;
          return (
            <Row key={app.id} leading={<Plug size={18} />} label={app.name} description={app.description ?? undefined}>
              {url && (
                <a className="btn btn-secondary btn-sm" href={url} target="_blank" rel="noopener noreferrer">
                  连接
                </a>
              )}
            </Row>
          );
        })
      )}
      {cursor && (
        <div>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => load(cursor)}>
            {busy ? "正在加载…" : "加载更多"}
          </Button>
        </div>
      )}
    </Section>
  );
}

export function ConnectorsTab() {
  const connectors = useStore((s) => s.connectors);
  const servers = useStore((s) => s.mcp);
  const chatgpt = useStore((s) => s.account?.account?.type === "chatgpt");
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
      {chatgpt && <BrowseConnectors />}
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
      description="Hooks 会在会话的特定时刻运行命令、MCP 工具、提示或子代理。新的或内容有变化的 hook 要先信任才会运行。"
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
