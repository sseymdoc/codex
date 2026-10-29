// The 自定义 page: Claude's /customize (c63a78ed4 customize-page, shared-20 BJ: a 自定义 heading over the
// section tabs, Zi, with each section's toolbar beside them) holding the ChatGPT app's 插件 area. One
// sidebar row (插件) opens it. Sections keep their own state and draw the frame with CustomizeFrame;
// a section on one of its own pages (a plugin, a category, a connector) passes a trail and the heading
// and tabs give way to the breadcrumb (Claude's customize-crumb-bar).

import type { SkillMetadata } from "@protocol/v2/SkillMetadata";
import type { SkillsListResponse } from "@protocol/v2/SkillsListResponse";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  errorMessage,
  fail,
  installRecommendedSkill,
  listHooks,
  listRecommendedSkills,
  listSkills,
  openCustomize,
  patchCustomize,
  readTextFile,
  syncRecommendedSkills,
  uninstallSkill,
} from "../lib/codex";
import { removableSkillDir, type RecommendedSkill } from "../lib/customize";
import { revealFile } from "../lib/files";
import { hooksNeedingReview, pluginsOff, toast, useStore, type CustomizeSection } from "../lib/store";
import { trySkill } from "./Composer";
import { Markdown } from "./content";
import { quietMenu, useLiftSlot } from "./Main";
import { PluginsSection } from "./Plugins";
import { Confirm } from "./Settings";
import { ConnectorsTab } from "./SettingsConnectors";
import { HooksTab, SkillsTab } from "./SettingsCustomize";
import { Button, Dialog, Icon, MenuItem, Popover, Segmented, Skeleton, Spinner } from "./ui";

/** Claude's sections (shared-20 PkV) with the ChatGPT app's 插件 first, as the sidebar row opens it. */
const SECTIONS: { id: CustomizeSection; label: string }[] = [
  { id: "plugins", label: "插件" },
  { id: "skills", label: "Skills" },
  { id: "connectors", label: "连接器" },
  { id: "hooks", label: "钩子" },
];

const labelOf = (section: CustomizeSection) => SECTIONS.find((entry) => entry.id === section)!.label;

export function CustomizeView() {
  const route = useStore((s) => s.customizeRoute);
  const off = useStore(pluginsOff);
  // With the plugins feature off every way into 插件 lands on Skills instead.
  const section = route?.section === "plugins" && off ? "skills" : (route?.section ?? "plugins");
  // The 钩子 tab counts hooks waiting for trust.
  useEffect(() => void listHooks(), []);
  useEffect(() => {
    document.title = `${labelOf(section)} - Codex`;
  }, [section]);
  if (section === "plugins") return <PluginsSection />;
  if (section === "skills") return <SkillsSection />;
  if (section === "connectors") return <ConnectorsTab />;
  return (
    <CustomizeFrame section="hooks">
      <HooksTab />
    </CustomizeFrame>
  );
}

/** A section's 我的 / 发现: the route's when it shows this section, else the section's own default. */
export function useSectionView(section: CustomizeSection): ["mine" | "discover", (view: "mine" | "discover") => void] {
  const route = useStore((s) => s.customizeRoute);
  const view = route?.section === section ? route.view : section === "plugins" ? "discover" : "mine";
  const set = (next: "mine" | "discover") => (route?.section === section ? patchCustomize({ view: next, detail: null, connector: null }) : openCustomize(section, { view: next }));
  return [view, set];
}

/** 我的 / 发现 as Claude's segmented control (D7t8nvHp8w Yours / Discover). */
export function ViewSwitch({ section, label }: { section: CustomizeSection; label: string }) {
  const [view, setView] = useSectionView(section);
  return (
    <Segmented<"mine" | "discover">
      label={label}
      value={view}
      onChange={setView}
      options={[
        { value: "mine", label: "我的" },
        { value: "discover", label: "发现" },
      ]}
    />
  );
}

export function CustomizeFrame({ section, toolbar, trail = [], onHome, children }: { section: CustomizeSection; toolbar?: ReactNode; trail?: string[]; onHome?: () => void; children: ReactNode }) {
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const off = useStore(pluginsOff);
  const review = useStore((s) => hooksNeedingReview(s).length);
  const slot = useLiftSlot();
  const home = onHome ?? (() => openCustomize(section));
  const sub = trail.length > 0;
  const bar = (
    <header className="chat-header" data-tip-group="" data-density="compact" data-collapsed={(!sidebarOpen && !slot) || undefined}>
      <h1 className="draft-title cloud-title plugins-crumbs" data-testid="customize-crumb-bar">
        {sub ? (
          <>
            <button type="button" className="plugins-crumb" onClick={home}>
              自定义
            </button>
            <Icon name="CaretRight" size={12} className="plugins-crumb-sep" />
            <button type="button" className="plugins-crumb" onClick={home}>
              {labelOf(section)}
            </button>
            {trail.map((part, index) => (
              <Fragment key={index}>
                <Icon name="CaretRight" size={12} className="plugins-crumb-sep" />
                <span className="cloud-title-text">{part}</span>
              </Fragment>
            ))}
          </>
        ) : (
          <>
            <span className="plugins-crumb-root">自定义</span>
            <Icon name="CaretRight" size={12} className="plugins-crumb-sep" />
            <span className="cloud-title-text">{labelOf(section)}</span>
          </>
        )}
      </h1>
    </header>
  );
  return (
    <div className="main-col" data-testid="customize-page" onContextMenu={quietMenu}>
      {slot ? createPortal(bar, slot) : bar}
      <div className="plugins-scroll">
        <div className="plugins-page">
          {!sub && (
            <div className="customize-head">
              <h2 className="plugins-title">自定义</h2>
              <div className="customize-bar">
                <nav aria-label="自定义" className="customize-nav">
                  <div role="tablist" aria-label="自定义版块" className="customize-tabs">
                    {SECTIONS.filter((entry) => entry.id !== "plugins" || !off).map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        role="tab"
                        id={`customize-section-tab-${entry.id}`}
                        aria-selected={entry.id === section}
                        className="customize-tab"
                        onClick={() => entry.id !== section && openCustomize(entry.id)}
                      >
                        {entry.label}
                        {entry.id === "hooks" && review > 0 && (
                          <span className="badge badge-warning" aria-label={`${review} 个钩子待信任`}>
                            {review}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </nav>
                {toolbar && <div className="customize-toolbar">{toolbar}</div>}
              </div>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

/** An “添加 ▾” menu (Claude's cd08e92dc it: the primary 添加 with a caret over its items). */
export function AddMenu({ label, id, children }: { label: string; id?: string; children(close: () => void): ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      anchor={
        <Button id={id} variant="primary" size="sm" className="connectors-add" icon={<Icon name="Add" size="sm" />} aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
          添加
          <Icon name="CaretDown" size="sm" />
        </Button>
      }
    >
      {children(() => setOpen(false))}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Skills: 我的 (the scanned skills, extra roots) and 发现 (the ChatGPT app's recommended skills).

function SkillsSection() {
  const cwd = useStore((s) => s.prefs.cwd);
  const rev = useStore((s) => s.skillsRev);
  const [view] = useSectionView("skills");
  const [entries, setEntries] = useState<SkillsListResponse["data"] | null>(null);
  const [open, setOpen] = useState<SkillMetadata | null>(null);
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState(0);
  const load = (force = false) =>
    listSkills(cwd, force)
      .then(setEntries)
      .catch((error) => {
        setEntries([]);
        toast("warning", "读取 Skills 失败", errorMessage(error));
      });
  useEffect(() => void load(), [cwd, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const skills = entries?.flatMap((entry) => entry.skills) ?? [];
  // 创建 Skill (the ChatGPT app's createSkill): a new session holding the built-in skill-creator.
  const creator = skills.find((skill) => skill.name === "skill-creator" && skill.scope === "system");
  const toolbar = (
    <>
      <ViewSwitch section="skills" label="Skills" />
      <label className="settings-search connectors-search">
        <Icon name="Search" size="sm" />
        <input type="search" value={query} placeholder="搜索" aria-label="搜索 Skills" onChange={(event) => setQuery(event.target.value)} />
      </label>
      {view === "mine" ? (
        <Button variant="ghost" icon={<Icon name="ArrowClockwise" />} label="重新扫描" tip="重新扫描" onClick={() => void load(true)} />
      ) : (
        <Button variant="ghost" icon={<Icon name="ArrowClockwise" />} label="刷新" tip="刷新" onClick={() => setRefresh((value) => value + 1)} />
      )}
      {creator && (
        <AddMenu label="添加 Skill">
          {(close) => (
            <MenuItem
              icon={<Icon name="Edit" />}
              label="创建 Skill"
              onClick={() => {
                close();
                void trySkill(creator, "帮我创建一个 Skill");
              }}
            />
          )}
        </AddMenu>
      )}
    </>
  );
  const term = query.trim().toLowerCase();
  return (
    <CustomizeFrame section="skills" toolbar={toolbar}>
      {view === "mine" ? (
        <SkillsTab entries={entries} query={term} onChanged={() => void load()} onOpen={setOpen} />
      ) : (
        <RecommendedSkills query={term} refresh={refresh} />
      )}
      {open && <SkillDialog skill={open} onClose={() => setOpen(null)} />}
    </CustomizeFrame>
  );
}

/** SKILL.md without its front matter, which the dialog shows as the name and description. */
const skillBody = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

/** The ChatGPT app's skill-contents-modal with skill-card's actions. */
function SkillDialog({ skill, onClose }: { skill: SkillMetadata; onClose(): void }) {
  const home = useStore((s) => s.server.info?.codexHome);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const load = () => {
    setFailed(null);
    readTextFile(skill.path)
      .then(setText)
      .catch((error) => setFailed(errorMessage(error)));
  };
  useEffect(load, [skill.path]); // eslint-disable-line react-hooks/exhaustive-deps
  const dir = removableSkillDir(skill.path, home);
  const name = skill.interface?.displayName ?? skill.name;
  return (
    <>
      <Dialog
        title={name}
        description={skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description}
        size="lg"
        onClose={onClose}
        footer={
          <>
            {dir && (
              <Button variant="ghost" icon={<Icon name="Trash" size={16} />} onClick={() => setRemoving(true)}>
                卸载
              </Button>
            )}
            <span className="spacer" />
            <Button variant="secondary" icon={<Icon name="Folder" size={16} />} onClick={() => void revealFile(skill.path).then((ok) => ok || toast("warning", "无法在所在文件夹中显示此文件。"))}>
              在资源管理器中显示
            </Button>
            <Button
              variant="secondary"
              icon={<Icon name="Copy" size={16} />}
              disabled={text === null}
              onClick={() => void navigator.clipboard.writeText(text ?? "").then(() => toast("neutral", "已复制 Markdown"), fail("复制失败"))}
            >
              复制 Markdown
            </Button>
            <Button
              variant="primary"
              disabled={!skill.enabled}
              tip={skill.enabled ? undefined : "先启用此 Skill"}
              onClick={() => {
                onClose();
                void trySkill(skill);
              }}
            >
              立即试用
            </Button>
          </>
        }
      >
        <p className="settings-note">
          <span className="about-value">{skill.path}</span>
        </p>
        {failed ? (
          <div className="connectors-error" role="status">
            <p>无法加载 Skill 内容。</p>
            <Button variant="secondary" onClick={load}>
              重试
            </Button>
          </div>
        ) : text === null ? (
          <Skeleton lines={4} />
        ) : (
          <div className="customize-skill-body">
            <Markdown text={skillBody(text)} />
          </div>
        )}
      </Dialog>
      {removing && dir && (
        <Confirm
          title={`卸载 ${name}？`}
          description={`将删除文件夹 ${dir}。`}
          confirm="卸载"
          danger
          onClose={() => setRemoving(false)}
          onConfirm={() =>
            uninstallSkill(dir)
              .then(() => {
                toast("neutral", `${name} Skill 已卸载`);
                onClose();
              })
              .catch(fail("无法卸载 Skill"))
          }
        />
      )}
    </>
  );
}

// The vendored checkout is brought up to date once per page load; 刷新 does it again.
let synced: Promise<void> | null = null;

function RecommendedSkills({ query, refresh }: { query: string; refresh: number }) {
  const [list, setList] = useState<{ skills: RecommendedSkill[]; installed: Set<string> } | "error" | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = (sync: boolean) => {
    setList(null);
    if (sync || !synced) {
      const run = (synced = syncRecommendedSkills());
      run.catch(() => {
        if (synced === run) synced = null;
      });
    }
    synced!
      .then(listRecommendedSkills)
      .then(setList)
      .catch((error) => {
        setProblem(errorMessage(error));
        setList("error");
      });
  };
  // Coming back to 发现 reuses the last sync; only 刷新 while it is shown fetches again.
  const mounted = useRef(false);
  useEffect(() => {
    load(mounted.current);
    mounted.current = true;
  }, [refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  if (list === null)
    return (
      <div className="plugins-empty" aria-busy="true">
        <Spinner size={16} label="正在加载推荐 Skills" />
      </div>
    );
  if (list === "error")
    return (
      <div className="plugins-empty">
        <p className="plugins-empty-title">无法加载推荐 Skills</p>
        <p className="plugins-note">{problem}</p>
        <Button variant="secondary" size="sm" onClick={() => load(true)}>
          重试
        </Button>
      </div>
    );
  const shown = list.skills.filter((skill) => !query || skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query));
  if (!shown.length)
    return (
      <div className="plugins-empty">
        <p className="plugins-empty-title">找不到 Skills</p>
      </div>
    );
  return (
    <section className="plugins-section">
      <h3 className="plugins-section-title">
        <span className="plugins-section-name">推荐</span>
      </h3>
      <div className="plugins-grid">
        {shown.map((skill) => {
          const installed = list.installed.has(skill.id);
          return (
            <div key={skill.id} className="plugins-card">
              <span className="plugins-logo" style={{ width: 36, height: 36 }} aria-hidden="true">
                <Icon name="Scroll" size={18} />
              </span>
              <div className="plugins-card-text">
                <div className="plugins-card-title">
                  <span className="truncate">{skill.name}</span>
                </div>
                {skill.description && <div className="plugins-card-desc">{skill.description}</div>}
              </div>
              <div className="plugins-card-action">
                {installed ? (
                  <span className="plugins-note">已安装</span>
                ) : busy === skill.id ? (
                  <Spinner size={14} label="正在安装" />
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Icon name="Add" size={16} />}
                    label={`安装 ${skill.name}`}
                    tip="安装 Skill"
                    disabled={busy !== null}
                    onClick={() => {
                      setBusy(skill.id);
                      installRecommendedSkill(skill)
                        .then(() => {
                          toast("neutral", `${skill.name} Skill 已安装`);
                          setList((current) => (current && current !== "error" ? { ...current, installed: new Set(current.installed).add(skill.id) } : current));
                        })
                        .catch(fail("无法安装 Skill"))
                        .finally(() => setBusy(null));
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
