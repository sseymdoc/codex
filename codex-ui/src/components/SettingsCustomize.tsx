// Memory (a settings page, W21 memory panel), and the 自定义 page's 我的插件 with the marketplaces,
// 我的 Skills with the extra skill roots, and hooks. Connectors are in SettingsConnectors.

import type { HookEventName } from "@protocol/v2/HookEventName";
import type { HookMetadata } from "@protocol/v2/HookMetadata";
import type { HookSource } from "@protocol/v2/HookSource";
import type { HookTrustStatus } from "@protocol/v2/HookTrustStatus";
import type { PluginListResponse } from "@protocol/v2/PluginListResponse";
import type { PluginShareContext } from "@protocol/v2/PluginShareContext";
import type { PluginShareDiscoverability } from "@protocol/v2/PluginShareDiscoverability";
import type { PluginShareListItem } from "@protocol/v2/PluginShareListItem";
import type { PluginSharePrincipalRole } from "@protocol/v2/PluginSharePrincipalRole";
import type { PluginSummary } from "@protocol/v2/PluginSummary";
import type { SkillMetadata } from "@protocol/v2/SkillMetadata";
import type { SkillsListResponse } from "@protocol/v2/SkillsListResponse";
import { useEffect, useState, type CSSProperties } from "react";
import {
  checkoutPluginShare,
  deletePluginShare,
  errorMessage,
  fail,
  listHooks,
  listInstalledPlugins,
  listPluginShares,
  memoriesEnabled,
  memoryDirectory,
  memoryFiles,
  memorySettings,
  openCustomize,
  pluginDirectory,
  readMemoryStatus,
  readTextFile,
  removeMarketplace,
  uninstallPlugin,
  resetMemory,
  setHookEnabled,
  setMemoriesEnabled,
  setMemorySettings,
  setPluginEnabled,
  setShareAccess,
  setSkillEnabled,
  setSkillRoots,
  sharePlugin,
  trustHooks,
  upgradeMarketplaces,
  uploadPluginVersion,
  writeConfig,
  type MemoryStatus,
} from "../lib/codex";
import { basename, joinPath } from "../lib/format";
import { marketplaceActions } from "../lib/customize";
import { getState, hooksNeedingReview, readJson, toast, useStore, writePref } from "../lib/store";
import { Markdown } from "./content";
import { Confirm, Row, Section } from "./Settings";
import { Button, Dialog, Icon, MenuItem, Popover, Skeleton, Toggle, type IconName } from "./ui";

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
      .catch((error) => live && setText(`读取失败：${errorMessage(error)}`));
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
            {long && <p className="settings-note">文件较大，此处仅显示前 64 KB。</p>}
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
          <Toggle checked={enabled} label="启用记忆" onChange={(on) => void setMemoriesEnabled(on).catch(fail("无法更新记忆设置。请重试。"))} />
        </Row>
        {enabled && (
          <>
            <Row id="setting-memory-use" label="在会话中使用记忆" description="把整理好的记忆放进新会话的上下文。">
              <Toggle checked={use} label="在会话中使用记忆" onChange={(next) => void setMemorySettings({ use: next }).catch(fail("无法更新记忆设置。请重试。"))} />
            </Row>
            <Row id="setting-memory-generate" label="从会话生成记忆" description="会话结束后把值得记住的内容整理进记忆；也可以在输入框的“+”菜单中为单个会话关闭。">
              <Toggle checked={generate} label="从会话生成记忆" onChange={(next) => void setMemorySettings({ generate: next }).catch(fail("无法更新记忆设置。请重试。"))} />
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
              <Button variant="secondary" size="sm" onClick={() => void writeConfig([{ keyPath: "memories.version", value: "v2", mergeStrategy: "replace" }]).catch(fail("无法更新记忆设置。请重试。"))}>
                启用新版
              </Button>
            )}
          </Row>
        )}
        {status && (
          <Row id="setting-memory-reset" label="清除记忆" description="删除所有已保存的记忆，无法恢复。">
            <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}>
              清除
            </Button>
          </Row>
        )}
      </Section>
      <Section id="setting-memory-files" title="记忆文件" description={codexHome ? joinPath(codexHome, memoryDirectory()) : undefined}>
        {files === null ? <Skeleton lines={3} /> : files.length === 0 ? <p className="settings-note">暂无记忆文件。</p> : <MemoryPanel files={files} />}
      </Section>
      {confirm && (
        <Confirm
          title="清除记忆？"
          description="已保存的记忆会全部删除，无法恢复；之后的会话会重新开始积累。"
          confirm="清除"
          danger
          onClose={() => setConfirm(false)}
          onConfirm={() =>
            resetMemory()
              .then(() => {
                toast("neutral", "已清除记忆");
                load();
              })
              .catch(fail("清除记忆失败。您可以重试。"))
          }
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Plugins (U7) and marketplaces (U27): 自定义 › 插件 › 我的 (the Codex app's plugins-settings 插件 and 市场
// tabs). 发现, search and each plugin's page are in Plugins.tsx.

function PluginTile({ plugin }: { plugin: PluginSummary }) {
  const color = plugin.interface?.brandColor;
  const name = plugin.interface?.displayName ?? plugin.name;
  // Remote logos are not loaded (CSP img-src is local only); the brand color carries the initial.
  return color && /^#[0-9a-f]{3,8}$/i.test(color) ? (
    <span className="plugin-tile" style={{ background: color }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  ) : (
    <Icon name="Plugin" size={18} />
  );
}

const pluginName = (plugin: PluginSummary) => plugin.interface?.displayName ?? plugin.name;

export const HOOK_EVENTS: Record<HookEventName, string> = {
  preToolUse: "工具使用前",
  permissionRequest: "权限请求",
  postToolUse: "工具使用后",
  preModelRequest: "模型请求前",
  postModelRequest: "模型请求后",
  preCompact: "压缩前",
  postCompact: "压缩后",
  sessionStart: "会话开始",
  sessionEnd: "会话结束",
  userPromptSubmit: "提示词提交",
  subagentStart: "子智能体开始",
  subagentStop: "子智能体停止",
  stop: "停止",
  interrupt: "中断",
};

// Sharing (c0ad2fd1b en → Gt, drawn as the classic share modal c5e7d44b0 k): people with access,
// general access and the share link. The protocol has no member directory, so people are listed
// but never invited; Codex's three discoverability levels stand in for General access.

const ACCESS: Record<PluginShareDiscoverability, { label: string; icon: IconName }> = {
  // c5e7d44b0 A: Lock “Only people invited” and Organization “Everyone at {organizationName}”;
  // UNLISTED (workspace link access) has no counterpart there.
  PRIVATE: { label: "仅限受邀人员", icon: "Lock" },
  UNLISTED: { label: "工作区中任何拥有链接的人", icon: "Link" },
  LISTED: { label: "工作区中的所有人", icon: "Organization" },
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

export function ShareDialog({ name, path, share: initial, onClose }: Sharing & { onClose(): void }) {
  const me = useStore((s) => (s.account?.account?.type === "chatgpt" ? s.account.account.email : null));
  const [share, setShare] = useState(initial);
  // Before sharing, the access plugin/share/save will create; it takes PRIVATE or UNLISTED.
  const [pick, setPick] = useState<Exclude<PluginShareDiscoverability, "LISTED">>("PRIVATE");
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
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
        toast("neutral", "插件已共享");
      })
      .catch(fail("分享失败"))
      .finally(() => setBusy(false));
  };
  const apply = (next: PluginShareDiscoverability) => {
    if (!share) return Promise.resolve();
    setBusy(true);
    return setShareAccess(share, next)
      .then(({ discoverability, principals }) => setShare({ ...share, discoverability, sharePrincipals: principals }))
      .catch(fail("无法更改访问权限"))
      .finally(() => setBusy(false));
  };
  // Codex only: save with remotePluginId pushes the local folder as the share's next version. The
  // real app updates only through the org-library publish (c63fee29b Ge isUpdate), which waits on
  // server-sent copy and is off with the server switches off.
  const upload = () => {
    if (!path || !share) return;
    setUploading(true);
    uploadPluginVersion(path, share.remotePluginId)
      .then(() => toast("neutral", `已上传“${name}”的新版本`))
      .catch(fail("上传失败"))
      .finally(() => setUploading(false));
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
    if (share?.shareUrl) navigator.clipboard.writeText(share.shareUrl).then(() => setCopied(true), fail("复制失败"));
  };
  const note = !share ? "分享时会把插件文件夹上传到您的 ChatGPT 工作区。" : access === "PRIVATE" && others.length === 0 ? "只有您可以打开此链接。" : null;
  return (
    <>
      <Dialog
        title={`分享“${name}”`}
        onClose={onClose}
        footer={
          share ? (
            <>
              <Button variant="ghost" className="share-stop" disabled={busy || uploading} onClick={() => setStopping(true)}>
                停止共享
              </Button>
              {path && (
                <Button variant="secondary" disabled={busy || uploading} tip="将此电脑上的插件文件夹上传为此共享的新版本" onClick={upload}>
                  {uploading ? "正在上传…" : "上传新版本"}
                </Button>
              )}
              {share.shareUrl && (
                <Button variant="secondary" icon={<Icon name={copied ? "CheckCircle" : "Link"} size={16} />} tip="只有拥有访问权限的人才能打开该链接" onClick={copy}>
                  {copied ? "已复制" : "复制链接"}
                </Button>
              )}
            </>
          ) : (
            <Button variant="primary" disabled={busy || !path} onClick={create}>
              {busy ? "正在共享…" : "分享"}
            </Button>
          )
        }
      >
        <div className="share-body">
          <section className="share-group">
            <h3 className="share-heading">有访问权限的人员</h3>
            <div className="share-people">
              <Person name={me ?? "您"} you={!!me} role={ROLES.owner} />
              {others.map((p) => (
                <Person key={`${p.principalType}:${p.principalId}`} name={p.name} role={ROLES[p.role]} />
              ))}
            </div>
          </section>
          <section className="share-group">
            <h3 className="share-heading">常规访问权限</h3>
            {access && known ? (
              <div className="share-access">
                <span className="share-access-icon">
                  <Icon name={ACCESS[access].icon} size="md" />
                </span>
                <Popover
                  open={menu}
                  onClose={() => setMenu(false)}
                  anchor={
                    <Button
                      variant="ghost"
                      className="menu-select"
                      disabled={busy || uploading}
                      // Once shared there is no primary button: focus starts on the first control.
                      data-autofocus={share ? true : undefined}
                      aria-label={`常规访问权限：${ACCESS[access].label}`}
                      onClick={() => setMenu(!menu)}
                    >
                      <span className="menu-select-value">{ACCESS[access].label}</span>
                      <Icon name="CaretDown" size={16} className="caret" />
                    </Button>
                  }
                >
                  {choices.map((value) => (
                    <MenuItem
                      key={value}
                      icon={<Icon name={ACCESS[value].icon} />}
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
              <p className="settings-note">无法加载此插件的访问权限。</p>
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
          title={trapdoor === "PRIVATE" ? "将插件设为私有？" : "只允许拥有链接的人访问？"}
          description={`${trapdoor === "PRIVATE" ? "如果将此插件设为私有" : "这样更改后"}，您将无法再将其共享给整个工作区。`}
          confirm={trapdoor === "PRIVATE" ? "设为私密" : "更改"}
          onClose={() => setTrapdoor(null)}
          onConfirm={() => apply(trapdoor)}
        />
      )}
      {stopping && share && (
        <Confirm
          title={`要停止共享“${name}”吗？`}
          description="工作区里的共享副本会被删除，链接随之失效；您电脑上的插件不受影响。"
          confirm="停止共享"
          danger
          onClose={() => setStopping(false)}
          onConfirm={() =>
            deletePluginShare(share.remotePluginId)
              .then(() => {
                toast("neutral", `已停止共享“${name}”`);
                onClose();
              })
              .catch(fail("停止共享失败"))
          }
        />
      )}
    </>
  );
}

export function PluginsTab({ generation, onChanged }: { generation: number; onChanged(): void }) {
  const installed = useStore((s) => s.plugins);
  const chatgpt = useStore((s) => s.account?.account?.type === "chatgpt");
  const config = useStore((s) => s.config) as Record<string, unknown> | null;
  const [directory, setDirectory] = useState<PluginListResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
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
        toast("warning", "读取插件目录失败", errorMessage(error));
      });
  const loadShares = () =>
    listPluginShares()
      .then(setShares)
      .catch(() => setShares(null));
  useEffect(() => {
    void listInstalledPlugins();
    void loadDirectory();
  }, [generation]); // eslint-disable-line react-hooks/exhaustive-deps
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
      .catch(fail("取回失败"))
      .finally(() => setFetching(null));
  };
  const upgrade = (name?: string) => {
    setBusy(name ?? "*");
    upgradeMarketplaces(name)
      .then(({ upgradedRoots, errors }) => {
        if (errors.length) toast("warning", "部分市场更新失败", errors.map((error) => `${error.marketplaceName}：${error.message}`).join("\n"));
        else if (name) toast("neutral", `${name} 市场已升级`);
        else toast("neutral", upgradedRoots.length ? `已更新 ${upgradedRoots.length} 个市场` : "所有市场均已是最新版本");
        void loadDirectory();
        onChanged();
      })
      .catch(fail("更新市场失败。"))
      .finally(() => setBusy(null));
  };
  const markets = directory?.marketplaces.filter((market) => market.path) ?? [];
  const marketConfig = (name: string) => (config?.marketplaces as Record<string, { source_type?: string; source?: string }> | undefined)?.[name];
  // 移除市场 (the Codex app's removeDialog): its installed plugins go too, they cannot come back without it.
  const doomed = removing ? (installed ?? []).filter((plugin) => plugin.marketplaceName === removing) : [];
  return (
    <>
      <Section id="setting-plugins-installed" title="已安装" description="插件可以给 Codex 带来 Skills、钩子、连接器和 MCP 服务器。">
        {installed === null ? (
          <Skeleton lines={3} />
        ) : installed.length === 0 ? (
          <p className="settings-note">尚未安装任何插件。</p>
        ) : (
          installed.map((plugin) => (
            <Row
              key={plugin.id}
              leading={<PluginTile plugin={plugin} />}
              label={pluginName(plugin)}
              description={[plugin.interface?.shortDescription, plugin.marketplaceName].filter(Boolean).join(" · ")}
              onOpen={() => openCustomize("plugins", { detail: plugin.marketplacePath ? { pluginName: plugin.name, marketplacePath: plugin.marketplacePath } : { pluginName: plugin.name, remoteMarketplaceName: plugin.marketplaceName } })}
            >
              <Toggle checked={plugin.enabled} label={`启用 ${pluginName(plugin)}`} onChange={(on) => void setPluginEnabled(plugin.id, on).catch(fail("无法更新插件状态。"))} />
            </Row>
          ))
        )}
      </Section>
      {chatgpt && shares !== null && (
        <Section id="setting-plugins-shared" title="已共享" description="您共享到 ChatGPT 工作区的插件。">
          {shares === undefined ? (
            <Skeleton lines={2} />
          ) : shares.length === 0 ? (
            <p className="settings-note">尚未共享任何插件。</p>
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
        id="setting-plugins-marketplaces"
        title="插件市场"
        description="插件市场是一个 Git 仓库或本地目录，里面列出可以安装的插件。"
        action={
          <Button variant="secondary" size="sm" disabled={busy !== null || markets.length === 0} onClick={() => upgrade()}>
            {busy === "*" ? "正在更新…" : "全部更新"}
          </Button>
        }
      >
        {directory === null && <Skeleton lines={2} />}
        {markets.map((market) => {
          const can = marketplaceActions(market.name, marketConfig(market.name), getState().configOrigins[`marketplaces.${market.name}.source_type`]?.name.type);
          const name = market.interface?.displayName ?? market.name;
          return (
            <Row
              key={market.name}
              label={name}
              description={
                <>
                  {market.plugins.length} 个插件 · <span className="about-value">{market.path}</span>
                </>
              }
            >
              <Button variant="secondary" size="sm" disabled={busy !== null || !!can.upgrade} tip={can.upgrade ?? undefined} onClick={() => upgrade(market.name)}>
                {busy === market.name ? "正在升级…" : "升级"}
              </Button>
              <Button variant="ghost" size="sm" muted icon={<Icon name="Trash" size={16} />} label={`移除 ${name}`} tip={can.remove ?? "移除市场"} disabled={!!can.remove} onClick={() => setRemoving(market.name)} />
            </Row>
          );
        })}
        {directory?.marketplaceLoadErrors.map((error) => (
          <div key={error.marketplacePath} className="error-text small">
            {error.marketplacePath}：{error.message}
          </div>
        ))}
      </Section>
      {removing && (
        <Confirm
          title={`是否移除“${removing}”？`}
          description={
            doomed.length ? (
              <>
                以下插件将被卸载，只有重新添加此市场后才能再次安装。
                <ul className="customize-doomed">
                  {doomed.map((plugin) => (
                    <li key={plugin.id}>{pluginName(plugin)}</li>
                  ))}
                </ul>
              </>
            ) : (
              "此操作将从您的列表中移除该市场。"
            )
          }
          confirm={doomed.length ? "卸载并移除" : "移除"}
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              // The marketplace first: when the backend refuses, no plugin is lost. plugin/uninstall goes by id alone.
              await removeMarketplace(removing);
              for (const plugin of doomed) await uninstallPlugin(plugin.id);
              toast("neutral", `已移除 ${removing} 市场`);
            } catch (error) {
              toast("warning", "移除市场失败。", errorMessage(error));
            }
            void loadDirectory();
            onChanged();
          }}
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
  const list = readJson(SKILL_ROOTS_KEY);
  return Array.isArray(list) ? list.filter((path): path is string => typeof path === "string") : [];
}

/** 我的 Skills by where they come from (the ChatGPT app groups by root): yours, the repo's, plugins', built in, managed. */
const SKILL_GROUPS: [string, (skill: SkillMetadata) => boolean][] = [
  ["个人", (skill) => !skill.pluginId && skill.scope === "user"],
  ["仓库", (skill) => !skill.pluginId && skill.scope === "repo"],
  ["插件", (skill) => !!skill.pluginId],
  ["内置", (skill) => !skill.pluginId && skill.scope === "system"],
  ["管理员", (skill) => !skill.pluginId && skill.scope === "admin"],
];

/** 自定义 › Skills › 我的: the scanned skills (a row opens its page) and the extra skill roots. */
export function SkillsTab({ entries, query, onChanged, onOpen }: { entries: SkillsListResponse["data"] | null; query: string; onChanged(): void; onOpen(skill: SkillMetadata): void }) {
  const plugins = useStore((s) => s.plugins);
  const [roots, setRoots] = useState(savedSkillRoots);
  const [draft, setDraft] = useState("");
  const saveRoots = (next: string[]) => {
    setSkillRoots(next)
      .then(() => {
        writePref(SKILL_ROOTS_KEY, JSON.stringify(next));
        setRoots(next);
      })
      .catch(fail("设置 Skills 目录失败"));
  };
  const skills = (entries?.flatMap((entry) => entry.skills) ?? []).filter(
    (skill) => !query || [skill.name, skill.interface?.displayName, skill.description, skill.shortDescription].some((text) => text?.toLowerCase().includes(query)),
  );
  const errors = entries?.flatMap((entry) => entry.errors) ?? [];
  const pluginLabel = (id: string) => {
    const plugin = plugins?.find((entry) => entry.id === id);
    return plugin?.interface?.displayName ?? plugin?.name ?? id.split("@")[0];
  };
  const groups = SKILL_GROUPS.map(([title, test]) => [title, skills.filter(test)] as const).filter(([, list]) => list.length);
  return (
    <>
      {(entries === null || groups.length === 0) && (
        <Section id="setting-skills-list" title="Skills" description="Skills 是放在 SKILL.md 里的可复用说明，Codex 会在合适的时候自动调用。">
          {entries === null ? <Skeleton lines={3} /> : <p className="settings-note">{query ? "没有符合筛选条件的 Skills" : "未找到 Skills。"}</p>}
        </Section>
      )}
      {groups.map(([title, list], index) => (
        <Section key={title} id={index === 0 ? "setting-skills-list" : undefined} title={title} description={index === 0 ? "Skills 是放在 SKILL.md 里的可复用说明，Codex 会在合适的时候自动调用。" : undefined}>
          {list.map((skill) => (
            <Row
              key={skill.path}
              label={
                <>
                  {skill.interface?.displayName ?? skill.name}
                  {skill.pluginId && <span className="badge">{pluginLabel(skill.pluginId)}</span>}
                  {!skill.enabled && <span className="badge">已禁用</span>}
                </>
              }
              description={skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description}
              onOpen={() => onOpen(skill)}
            >
              <Toggle
                checked={skill.enabled}
                label={`启用 ${skill.name}`}
                onChange={(enabled) => {
                  setSkillEnabled(skill, enabled)
                    .then(onChanged)
                    .catch(fail("无法更新 Skill"));
                }}
              />
            </Row>
          ))}
        </Section>
      ))}
      {errors.map((error) => (
        <div key={error.path} className="error-text small">
          {error.path}：{error.message}
        </div>
      ))}
      <Section id="setting-skills-roots" title="额外 Skills 目录" description="Codex 也会在这些目录里查找 Skills。目录保存在这台电脑上，每次连接时交给 Codex。">
        {roots.map((root) => (
          <Row key={root} label={basename(root)} description={<span className="about-value">{root}</span>}>
            <Button variant="ghost" size="sm" muted icon={<Icon name="Trash" size={16} />} label={`移除 ${root}`} onClick={() => saveRoots(roots.filter((path) => path !== root))} />
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
          <input className="input mono" placeholder="目录的绝对路径" aria-label="Skills 目录" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <Button variant="secondary" type="submit" disabled={!draft.trim()}>
            添加
          </Button>
        </form>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Hooks (U1): every hook with its trust state; new or changed hooks run only once trusted.

const HOOK_TRUST: Record<HookTrustStatus, string> = { managed: "已托管", trusted: "已信任", untrusted: "未信任", modified: "已更改" };

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
      return hook.async ? `${hook.command}（在后台运行）` : hook.command;
    case "mcpTool":
      return `MCP ${hook.server} · ${hook.tool}`;
    case "prompt":
      return "提示词";
    case "agent":
      return "智能体提示词";
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
      title="钩子"
      description="钩子会在会话的特定时刻运行命令、MCP 工具、提示词或子智能体。新的或已更改的钩子要先信任才会运行。"
      action={
        review.length > 0 ? (
          <Button variant="primary" size="sm" onClick={() => void trustHooks(review).catch(fail("信任失败"))}>
            全部信任（{review.length}）
          </Button>
        ) : undefined
      }
    >
      {list === null && <Skeleton lines={3} />}
      {list?.length === 0 && <p className="settings-note">未配置钩子。</p>}
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
              <Button variant="secondary" size="sm" onClick={() => void trustHooks([hook]).catch(fail("信任失败"))}>
                信任
              </Button>
            )}
            {!hook.isManaged && <Toggle checked={hook.enabled} label={`启用 ${hook.key}`} onChange={(on) => void setHookEnabled(hook.key, on).catch(fail("切换钩子失败"))} />}
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
