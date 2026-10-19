// The Code composer (Claude Desktop 2.42304.0.0 Code tab, c227f4d5e bQ with layout "chin"). The
// new-session page and a session share one card (cc43287c9 kP): one row of editor beside the send
// key, the actions dropping under the text once it wraps or holds attachments (shared-5 Qu), and
// the chin under the card:
//   [+][voice][mode] ……… [model][effort][context ring]
// - draft (form "home"): the working folder sits above the card in the chips row (cc43287c9 n5);
// - reply: queue bands on top (cf74bc599).
// Busy: Enter steers the running turn, Ctrl+Enter queues. "!" on an empty editor is shell mode.
// Slash commands insert first and run on Enter; @file mentions, images, skills, plugin mentions,
// page-wide drag and drop, per-thread drafts.

import type { Model } from "@protocol/v2/Model";
import type { QueuedSubmission } from "@protocol/v2/QueuedSubmission";
import type { RateLimitReachedType } from "@protocol/v2/RateLimitReachedType";
import type { RateLimitWindow } from "@protocol/v2/RateLimitWindow";
import type { SkillMetadata } from "@protocol/v2/SkillMetadata";
import type { UserInput } from "@protocol/v2/UserInput";
import type { AppInfo } from "@protocol/v2/AppInfo";
import {
  ArrowRight,
  Brain,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  CircleStop,
  CornerDownLeft,
  EllipsisVertical,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Paperclip,
  Pencil,
  Plug,
  Plus,
  Puzzle,
  ShieldCheck,
  Sparkles,
  SquareSlash,
  Trash2,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import initPrompt from "../../../codex-rs/tui/assets/prompt_for_init_command.md?raw";
import {
  activeTurn,
  autoReviewAvailable,
  browseConnectors,
  canSteer,
  chooseProject,
  compactThread,
  createProject,
  effectiveSettings,
  errorMessage,
  fastAvailable,
  forkThread,
  interrupt,
  listConnectors,
  listInstalledPlugins,
  listSkills,
  logout,
  memoriesEnabled,
  memorySettings,
  modelLabel,
  newChat,
  pluginMention,
  presetAllowed,
  presetOf,
  projectFor,
  refreshConfig,
  refreshPermissionProfiles,
  removeQueued,
  renameThread,
  reorderQueue,
  requestMoreUsage,
  runShellCommand,
  searchFiles,
  sendMessage,
  sendQueuedNow,
  setConnectorEnabled,
  setGoal,
  setMemoryMode,
  setOverride,
  supports,
} from "../lib/codex";
import { basename, externalUrl, formatTokens, limitName, relativePath, samePath } from "../lib/format";
import { togglePane } from "../lib/panes";
import { getState, setState, toast, useStore, writePref, type PermissionPreset, type ThreadState } from "../lib/store";
import { startVoice, stopVoice, voiceAvailable, voiceStreams } from "../lib/voice";
import { openSettings } from "./Settings";
import { Button, DropScrim, MenuItem, MenuSection, MenuSep, Popover, Spinner, Submenu, UsageRing, useReducedMotion } from "./ui";

export const EFFORT_LABELS: Record<string, string> = {
  none: "关闭",
  minimal: "最低",
  low: "低",
  medium: "中等",
  high: "高",
  xhigh: "超高",
  max: "最高",
  ultra: "极限",
};

/** Level notes for the effort slider (catalog wording in Chinese; the catalog's own text is the fallback). */
const EFFORT_INFO: Record<string, string> = {
  none: "不做额外推理，直接回答",
  minimal: "只做最少的推理",
  low: "响应快，推理较轻",
  medium: "兼顾速度与深度，适合日常任务",
  high: "推理更深，适合复杂问题",
  xhigh: "更深的推理，适合复杂、细致的工作",
  max: "最深的推理，用于最难的问题，耗时最长",
  ultra: "最深的推理，并会自动拆分委派任务",
};

/** The level with the High usage warning (c8e04f916 badge variant "warning"). */
const WARNING_EFFORT = "max";
/** Codex's top level, shown like Ultracode: pro violet, with the charge bar at the top stop. */
const PRO_EFFORT = "ultra";
/** shared-7 effortWarningTooltip. */
const WARNING_TEXT = "Codex 在“最高”努力程度下会思考更久，用量消耗也比“高”更快。";

/** Image attachments (c0fbbe82d 1306-1330, 1514, 1532): four types, 30 MB each, five at most. */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_IMAGES = 5;
const FIELD_SIZING = CSS.supports("field-sizing", "content");
const APPLE = /Apple/.test(navigator.vendor);
const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
/** Key names (c227f4d5e cM): symbols without "+" on a Mac. */
const SEND_KEY = MAC ? "↩" : "Enter";
const QUEUE_KEY = MAC ? "⌘↩" : "Ctrl+Enter";
const FILE_KEY = MAC ? "⌘U" : "Ctrl+U";
/** A trailing CJK or Latin punctuation run is not part of an @ query (RichComposerWithMentions). */
const TRAILING_PUNCT = /[.,;:!?'"、。，；：！？…]+$/;
/** Esc Esc opens the rewind picker when the second press comes this soon (ms). */
const DOUBLE_ESCAPE_MS = 500;
const RECENT_FOLDERS = 6;
/** Folders taken off the folder pill's 最近使用: path → the session recency they were removed at. */
const REMOVED_FOLDERS_KEY = "codex-ui:recent-folders-removed";

interface Attachment {
  id: number;
  name: string;
  url: string;
}

interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  /** Runs on Enter with whatever follows the command name; a returned string is then sent as the message. */
  run(args: string): unknown;
  needsThread?: boolean;
}

type Mention = Extract<UserInput, { type: "mention" }>;
type Menu = null | "plus" | "model" | "effort" | "mode" | "usage" | "env" | "send";
type Settings = ReturnType<typeof effectiveSettings>;
type OverridePatch = Parameters<typeof setOverride>[1];

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function saveDraft(key: string, text: string) {
  try {
    if (text) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  } catch {
    // Private mode: drafts just do not survive a reload.
  }
}

function inputText(input: UserInput[]): string {
  return input.map((part) => (part.type === "text" ? part.text : "")).join("\n").trim();
}

/** Queue preview (cf74bc599 tS): text, "[图片]" and "@name" in order, one line, "…" when empty. */
function queuePreview(input: UserInput[]): string {
  const parts = input.flatMap((part) =>
    part.type === "text" ? [part.text] : part.type === "image" || part.type === "localImage" ? ["[图片]"] : part.type === "mention" ? [`@${part.name}`] : [],
  );
  return parts.join(" ").replace(/\s+/g, " ").trim() || "…";
}

let ruler: CanvasRenderingContext2D | null = null;

/** Width of the widest line of `text` in the editor's font. */
function textWidth(text: string, style: CSSStyleDeclaration): number {
  ruler ??= document.createElement("canvas").getContext("2d");
  if (!ruler || !text) return 0;
  ruler.font = style.font;
  return Math.max(...text.split("\n").map((line) => ruler!.measureText(line).width));
}

/** Replace the open draft and focus the editor (设定目标, rewinds putting the message back). */
export function setComposerDraft(text: string) {
  window.dispatchEvent(new CustomEvent("composer-draft", { detail: text }));
}

/** Append to the end of the open draft and focus the editor (quote / copy into the composer). */
export function appendComposerText(text: string) {
  window.dispatchEvent(new CustomEvent("composer-append", { detail: text }));
}

// ---------------------------------------------------------------------------
// Modes (shared-8 kL / EL): Manual / Accept edits / Plan / Auto / Bypass permissions mapped onto
// Codex presets, the plan collaboration mode and the auto-review approvals reviewer. Items are
// label + description, no icons, no warning ink (c227f4d5e 14582-14662).

type ModeId = "manual" | "acceptEdits" | "plan" | "auto" | "bypass";

const MODES: { id: ModeId; label: string; hint: string }[] = [
  { id: "manual", label: "手动", hint: "修改前总是先询问" },
  { id: "acceptEdits", label: "接受编辑", hint: "自动接受所有文件编辑" },
  { id: "plan", label: "计划", hint: "先制定计划，再进行修改" },
  { id: "auto", label: "自动", hint: "由 Codex 处理权限决定" },
  { id: "bypass", label: "绕过权限", hint: "接受所有权限" },
];

const MODE_PRESET: Record<Exclude<ModeId, "plan">, PermissionPreset> = {
  manual: "read-only",
  acceptEdits: "auto",
  auto: "auto",
  bypass: "full-access",
};

/** Modes that act without asking (c227f4d5e AI: bypass and auto) get the warning tooltip. */
const DANGER_TIP = "Codex 可以不经询问修改或删除文件";

function modeOf(s: Settings): ModeId | null {
  if (s.planMode) return "plan";
  if (s.permissionProfile) return null;
  if (s.permission === "full-access") return "bypass";
  if (s.reviewer === "auto_review") return "auto";
  if (s.permission === "auto") return "acceptEdits";
  if (s.permission === "read-only") return "manual";
  return null;
}

/** The mode config.toml starts sessions in, for the 默认 badge (c227f4d5e iI). */
function configMode(): ModeId | null {
  const config = getState().config;
  const preset = presetOf(config?.approval_policy, config?.sandbox_mode);
  const reviewer = config?.approvals_reviewer;
  if (preset === "full-access") return "bypass";
  if (preset === "auto") return reviewer === "auto_review" || reviewer === "guardian_subagent" ? "auto" : "acceptEdits";
  return preset === "read-only" ? "manual" : null;
}

// ---------------------------------------------------------------------------
// Queue bands (cf74bc599): one queued message is a band with send now / edit / remove; several
// fold into one band (下一条：…) that opens to rows with a reorder handle and a menu.

function QueueBar({ thread, onEdit }: { thread: ThreadState; onEdit(input: UserInput[]): void }) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<QueuedSubmission | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const { queue } = thread;
  const id = thread.meta.id;
  const empty = queue.length === 0;

  // The leaving band plays epitaxy-band-exit; the timer covers a missing animationend.
  useEffect(() => {
    if (!leaving || !empty) return;
    const timer = setTimeout(() => setLeaving(null), 400);
    return () => clearTimeout(timer);
  }, [leaving, empty]);
  useEffect(() => {
    if (leaving && !empty && !queue.some((q) => q.id === leaving.id)) setLeaving(null);
  }, [leaving, empty, queue]);

  // Keep focus on the band toggle when it changes form.
  const moveFocus = () => requestAnimationFrame(() => toggle.current?.focus());

  // steerHeadOnly: a turn that cannot be steered is stopped instead, and only the head can go now.
  const headOnly = !!activeTurn(thread) && !canSteer(thread);
  const hint = headOnly ? "会停止 Codex 当前的回复。" : "Codex 会在下一步读到这条消息。";
  const fail = (title: string) => (error: unknown) => toast("danger", title, errorMessage(error));
  const sendNow = (q: QueuedSubmission) => {
    if (queue.length === 1) setLeaving(q);
    setSending(q.id);
    sendQueuedNow(id, q.id)
      .catch((error) => {
        setLeaving(null);
        fail("发送失败")(error);
      })
      .finally(() => setSending((current) => (current === q.id ? null : current)));
  };
  const remove = (qid: string) => removeQueued(id, qid).catch(fail("移除失败"));
  const edit = (q: QueuedSubmission) => {
    onEdit(q.input);
    void remove(q.id);
  };
  const move = (from: string, to: number) => {
    const ids = queue.map((q) => q.id).filter((x) => x !== from);
    ids.splice(Math.max(0, Math.min(ids.length, to)), 0, from);
    reorderQueue(id, ids).catch(fail("调整顺序失败"));
  };
  const drop = (target: string) => {
    if (!dragging || dragging === target) return;
    move(
      dragging,
      queue.filter((q) => q.id !== dragging).findIndex((q) => q.id === target),
    );
  };
  const sendButton = (q: QueuedSubmission) =>
    sending === q.id ? (
      <span className="queue-busy" role="status" aria-label="正在发送…">
        <Spinner size={16} />
      </span>
    ) : (
      <Button variant="ghost" muted icon={<CornerDownLeft size={16} />} label="立即发送" aria-describedby={hintId} onClick={() => sendNow(q)} />
    );

  const band = (q: QueuedSubmission, exiting = false) => (
    <div className="queue" data-text-size>
      <div className="queue-band" data-leaving={exiting || undefined} onAnimationEnd={exiting ? () => setLeaving(null) : undefined}>
        <span className="queue-count">1 条消息排队中</span>
        <span className="queue-preview">{queuePreview(q.input)}</span>
        {!exiting && (
          <span className="queue-actions">
            {sendButton(q)}
            <Button variant="ghost" muted icon={<Pencil size={16} />} label="在输入框中编辑" onClick={() => edit(q)} />
            <Button variant="ghost" muted icon={<X size={16} />} label="移出队列" onClick={() => void remove(q.id)} />
            <span id={hintId} hidden>
              {hint}
            </span>
          </span>
        )}
      </div>
    </div>
  );

  if (empty) return leaving ? band(leaving, true) : null;
  if (queue.length === 1) return band(queue[0]);

  if (!open) {
    return (
      <div className="queue" data-text-size>
        <button
          ref={toggle}
          type="button"
          className="queue-band"
          aria-expanded={false}
          onClick={() => {
            setOpen(true);
            moveFocus();
          }}
        >
          <span className="queue-count">{queue.length} 条消息排队中</span>
          <span className="queue-preview">下一条：{queuePreview(queue[0].input)}</span>
          <span className="queue-caret" aria-hidden="true">
            <ChevronDown size={16} />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="queue" data-text-size>
      <div className="queue-box">
        <div className="queue-head">
          <span className="queue-count">{queue.length} 条消息排队中</span>
          <Button
            ref={toggle}
            variant="ghost"
            muted
            icon={<ChevronUp size={16} />}
            label="收起排队消息"
            aria-expanded
            onClick={() => {
              setOpen(false);
              moveFocus();
            }}
          />
        </div>
        <div className="queue-list" role="list" aria-label="排队的消息">
          {queue.map((q, index) => {
            const canSend = !headOnly || index === 0;
            return (
              <div
                key={q.id}
                role="listitem"
                className="queue-row"
                aria-busy={sending === q.id || undefined}
                data-dragging={dragging === q.id || undefined}
                data-drop={(over === q.id && dragging !== q.id) || undefined}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu(q.id);
                }}
                onDragOver={(event) => {
                  if (!dragging) return;
                  event.preventDefault();
                  setOver(q.id);
                }}
                onDragLeave={() => setOver((current) => (current === q.id ? null : current))}
                onDrop={(event) => {
                  if (!dragging) return;
                  event.preventDefault();
                  setOver(null);
                  drop(q.id);
                }}
              >
                <span className="queue-text">{queuePreview(q.input)}</span>
                <span className="queue-row-actions">
                  {sending === q.id && (
                    <span className="queue-busy" role="status" aria-label="正在发送…">
                      <Spinner size={16} />
                    </span>
                  )}
                  {/* cf74bc599: a real handle; ↑ ↓ move it one place from the keyboard. */}
                  <button
                    type="button"
                    className="queue-grip"
                    aria-label="调整排队消息的顺序"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      setDragging(q.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                      event.preventDefault();
                      const to = index + (event.key === "ArrowUp" ? -1 : 1);
                      if (to >= 0 && to < queue.length) move(q.id, to);
                    }}
                  >
                    <GripVertical size={14} />
                  </button>
                  <Popover
                    open={menu === q.id}
                    onClose={() => setMenu(null)}
                    placement="bottom-end"
                    anchor={
                      <Button
                        variant="ghost"
                        size="xs"
                        muted
                        icon={<EllipsisVertical size={16} />}
                        label="排队消息操作"
                        aria-expanded={menu === q.id}
                        onClick={() => setMenu(menu === q.id ? null : q.id)}
                      />
                    }
                  >
                    <MenuItem
                      icon={<Pencil size={16} />}
                      label="在输入框中编辑"
                      onClick={() => {
                        setMenu(null);
                        edit(q);
                      }}
                    />
                    {canSend && (
                      <MenuItem
                        icon={<CornerDownLeft size={16} />}
                        label="立即发送"
                        hint={hint}
                        disabled={sending === q.id}
                        onClick={() => {
                          setMenu(null);
                          sendNow(q);
                        }}
                      />
                    )}
                    <MenuSep />
                    <MenuItem
                      icon={<X size={16} />}
                      label="移出队列"
                      danger
                      onClick={() => {
                        setMenu(null);
                        void remove(q.id);
                      }}
                    />
                  </Popover>
                </span>
              </div>
            );
          })}
        </div>
        <div className="queue-foot">
          <button type="button" className="queue-clear" onClick={() => void Promise.all(queue.map((q) => remove(q.id)))}>
            全部清除
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draft: the working folder (cc43287c9 z6, the folder pill of the chips row): basename or
// 选择文件夹…, 最近使用 (removable), 打开文件夹…; with no recents the pill opens the picker. Codex
// has one place to run (no environment pill) and no branch or worktree API (no branch pill).

function FolderPill({ open, onToggle, onClose }: { open: boolean; onToggle(): void; onClose(): void }) {
  const cwd = useStore((s) => s.prefs.cwd);
  const threads = useStore((s) => s.threads);
  useStore((s) => s.projects);
  const [removed, setRemoved] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(REMOVED_FOLDERS_KEY) ?? "{}") as Record<string, number>;
    } catch {
      return {};
    }
  });
  // Folders of past sessions, newest first; a removed one returns once a newer session starts there.
  const recent = useMemo(() => {
    const latest = new Map<string, number>();
    for (const { meta } of Object.values(threads)) {
      const key = [...latest.keys()].find((path) => samePath(path, meta.cwd)) ?? meta.cwd;
      latest.set(key, Math.max(latest.get(key) ?? 0, meta.recencyAt ?? meta.updatedAt));
    }
    const paths = [...latest.entries()]
      .filter(([path, at]) => at > (removed[path] ?? -1))
      .sort((a, b) => b[1] - a[1])
      .map(([path]) => path)
      .slice(0, RECENT_FOLDERS);
    return { paths: cwd && !paths.some((path) => samePath(path, cwd)) ? [cwd, ...paths] : paths, latest };
  }, [threads, removed, cwd]);
  const project = projectFor(cwd);

  // Config and custom permission profiles both depend on the folder.
  const refresh = () => {
    void refreshConfig();
    void refreshPermissionProfiles();
  };
  const useFolder = (path: string) => {
    onClose();
    setState((s) => ({ prefs: { ...s.prefs, cwd: path, projectId: null } }));
    refresh();
  };
  const pickFolder = () => {
    onClose();
    setState({ dialog: { type: "folder" } });
  };
  const forget = (path: string) => {
    const next = { ...removed, [path]: recent.latest.get(path) ?? Date.now() / 1000 };
    setRemoved(next);
    writePref(REMOVED_FOLDERS_KEY, JSON.stringify(next));
  };
  const makeProject = async () => {
    onClose();
    try {
      const created = await createProject(basename(cwd), [cwd]);
      if (created) chooseProject(created.id);
      else toast("warning", "当前 Codex 版本不支持项目");
    } catch (error) {
      toast("danger", "新建项目失败", errorMessage(error));
    }
  };
  const pill = (
    <button type="button" className="env-pill" data-tip={cwd ? `工作目录\n${cwd}` : "工作目录"} aria-expanded={recent.paths.length ? open : undefined} onClick={recent.paths.length ? onToggle : pickFolder}>
      <Folder size={16} />
      <span className="env-pill-label">{basename(cwd) || "选择文件夹…"}</span>
    </button>
  );
  if (!recent.paths.length) return pill;

  return (
    <Popover open={open} onClose={onClose} placement="top-start" className="menu-wide" anchor={pill}>
      <MenuSection title="最近使用" />
      <div className="menu-scroll">
        {recent.paths.map((path) => (
          <div
            key={path}
            className="folder-item"
            onKeyDown={(event) => {
              if ((event.key === "Delete" || event.key === "Backspace") && recent.latest.has(path)) {
                event.preventDefault();
                forget(path);
              }
            }}
          >
            <MenuItem icon={<Folder size={16} />} label={basename(path)} hint={path} checked={samePath(path, cwd)} onClick={() => useFolder(path)} />
            {recent.latest.has(path) && (
              <button type="button" className="folder-remove" title="从最近使用中移除" aria-label={`从最近使用中移除 ${basename(path)}`} onClick={() => forget(path)}>
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
      <MenuSep />
      <MenuItem icon={<FolderOpen size={16} />} label="打开文件夹…" onClick={pickFolder} />
      {/* Codex projects (project/*) have no other place to be named or removed. */}
      {!project && cwd && supports("project/create") && <MenuItem icon={<FolderPlus size={16} />} label="把这个文件夹设为项目" onClick={() => void makeProject()} />}
      {project && supports("project/update") && (
        <MenuItem
          icon={<Pencil size={16} />}
          label="重命名项目…"
          onClick={() => {
            onClose();
            setState({ dialog: { type: "project", projectId: project.id, action: "rename" } });
          }}
        />
      )}
      {project && supports("project/delete") && (
        <MenuItem
          danger
          icon={<Trash2 size={16} />}
          label="删除项目"
          onClick={() => {
            onClose();
            setState({ dialog: { type: "project", projectId: project.id, action: "delete" } });
          }}
        />
      )}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Effort (c8e04f916 EffortControl + c2d9b9a76 Slider): its own chin button and a 220 popover with
// a stepped slider that commits on release.

function effortName(id: string | undefined): string {
  return id ? (EFFORT_LABELS[id] ?? id) : "默认";
}

function EffortControl({
  model,
  effort,
  open,
  onToggle,
  onClose,
  onPick,
}: {
  model: Model | undefined;
  effort: string | null;
  open: boolean;
  onToggle(): void;
  onClose(): void;
  onPick(effort: string): void;
}) {
  const options = model?.supportedReasoningEfforts ?? [];
  const n = options.length;
  const current = Math.max(0, options.findIndex((o) => o.reasoningEffort === effort));
  const [preview, setPreview] = useState<number | null>(null);
  const [held, setHeld] = useState(false);
  const range = useRef<HTMLInputElement>(null);
  const shown = Math.min(preview ?? current, n - 1);
  const last = useRef(shown);
  const dir = shown > last.current ? "up" : shown < last.current ? "down" : undefined;
  useEffect(() => {
    last.current = shown;
  }, [shown]);
  useEffect(() => {
    if (!open) setPreview(null);
    else requestAnimationFrame(() => range.current?.focus());
  }, [open]);
  if (n === 0) return null;

  const id = (index: number) => options[index]?.reasoningEffort;
  const info = (index: number) => EFFORT_INFO[id(index) ?? ""] ?? options[index]?.description ?? "";
  const label = effortName(id(current));
  const warning = id(current) === WARNING_EFFORT;
  const pro = id(current) === PRO_EFFORT;
  const mark = options.findIndex((o) => o.reasoningEffort === model?.defaultReasoningEffort);
  const atMax = shown === n - 1;
  const charged = atMax && id(n - 1) === PRO_EFFORT;
  const commit = () => {
    setHeld(false);
    const value = Number(range.current?.value ?? current);
    setPreview(null);
    const next = id(value);
    if (next && next !== effort) onPick(next);
  };

  return (
    <Popover
      open={open}
      onClose={onClose}
      placement="top-end"
      className="effort-pop"
      anchor={
        <Button
          variant="ghost"
          size="xs"
          ink2
          className="effort-trigger"
          data-pro={pro || undefined}
          data-touch-size
          disabled={n < 2}
          aria-label={`努力程度：${label}${warning ? "（用量较高）" : ""}`}
          tip={warning ? `努力程度\n${WARNING_TEXT}` : "努力程度"}
          kbd="Ctrl+Shift+E"
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="btn-label">{label}</span>
          {warning && <TriangleAlert size={12} className="warn-glyph" aria-hidden="true" />}
        </Button>
      }
    >
      <div className="effort-head">
        <div className="effort-title">
          <span>努力程度</span>
          <span key={shown} className="effort-name" data-dir={dir} data-pro={id(shown) === PRO_EFFORT || undefined} aria-hidden="true">
            {effortName(id(shown))}
          </span>
        </div>
        {info(shown) && (
          <button type="button" className="effort-help" aria-label="关于努力程度">
            <CircleHelp size={16} />
            <span className="effort-help-card" role="tooltip">
              <span>{effortName(id(shown))}</span>
              <span>{info(shown)}</span>
            </span>
          </button>
        )}
      </div>
      <div className="effort-body">
        <div className="effort-ends" dir="ltr">
          <span>更快</span>
          <span>更聪明</span>
        </div>
        <div className="effort-slider">
          <div className="effort-track" style={{ "--pos": n > 1 ? shown / (n - 1) : 0 } as CSSProperties}>
            <span className="effort-fill" />
            {id(n - 1) === PRO_EFFORT && (
              <span className="effort-charge" data-on={charged || undefined}>
                <ChargeCanvas active={charged} held={held && charged} />
              </span>
            )}
            <span className="effort-stops" aria-hidden="true">
              {options.map((option, index) => (
                <span key={option.reasoningEffort} data-mark={index === mark || undefined} />
              ))}
            </span>
            <input
              ref={range}
              type="range"
              className="effort-range"
              min={0}
              max={n - 1}
              step={1}
              value={shown}
              aria-label="努力程度"
              aria-valuetext={shown === mark ? `${effortName(id(shown))}（推荐）` : effortName(id(shown))}
              onChange={(event) => setPreview(Number(event.target.value))}
              onPointerDown={() => setHeld(true)}
              onPointerUp={commit}
              onPointerCancel={() => {
                setHeld(false);
                setPreview(null);
              }}
              onKeyUp={(event) => {
                if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End" || event.key.startsWith("Page")) commit();
              }}
            />
          </div>
          {mark >= 0 && n > 1 && (
            <div className="effort-mark" data-on={shown === mark || undefined} style={{ "--mark": mark / (n - 1) } as CSSProperties} aria-hidden="true">
              <span>推荐</span>
            </div>
          )}
          {id(shown) === WARNING_EFFORT && (
            <div className="effort-warning">
              <TriangleAlert size={12} aria-hidden="true" />
              <span>{WARNING_TEXT}</span>
            </div>
          )}
        </div>
        {id(shown) !== WARNING_EFFORT && info(shown) && <span className="effort-desc">{info(shown)}</span>}
      </div>
    </Popover>
  );
}

/**
 * W22 Ultracode charge, approximated on a 2D canvas (the original is WebGL2): 3px cells on a 4px
 * pitch; while the handle is held at the top stop a wave leaves it every .3–.75s and spreads by
 * Manhattan distance at 20 → 36 cells/s, reaching 10 → 55 cells and recruiting 30 → 85% of them;
 * a reached cell flashes 1.25·e^(−5t) with an afterglow .65·e^(−kt) (k 3.3 → .77), quantized to
 * five levels. Strength builds over 1.6s of holding. Reduced motion: no waves.
 */
function ChargeCanvas({ active, held }: { active: boolean; held: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const holding = useRef(held);
  const reduced = useReducedMotion();
  holding.current = held && !reduced;
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || !active) return;
    const dpr = window.devicePixelRatio || 1;
    const width = el.clientWidth;
    const height = el.clientHeight;
    el.width = Math.round(width * dpr);
    el.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);
    const cols = Math.floor(width / 4);
    const rows = Math.max(1, Math.floor(height / 4));
    // The handle sits at the right end at the top stop.
    const originCol = Math.max(0, Math.floor((width - 8) / 4));
    const originRow = Math.floor(rows / 2);
    const color = getComputedStyle(el).getPropertyValue("--cds-fill-pro").trim() || "#7161e0";
    const waves: { at: number; strength: number; seed: number }[] = [];
    let since = 0;
    let next = 0;
    let frame = 0;
    const hash = (seed: number, c: number, r: number) => ((Math.imul(c + 1, 73856093) ^ Math.imul(r + 1, 19349663) ^ seed) >>> 0) / 4294967296;
    const tick = (now: number) => {
      if (holding.current) {
        since ||= now;
        if (now >= next) {
          waves.push({ at: now, strength: Math.min(1, (now - since) / 1600), seed: (Math.random() * 4294967296) >>> 0 });
          next = now + 300 + Math.random() * 450;
        }
      } else since = 0;
      while (waves.length && now - waves[0].at > 8000) waves.shift();
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const distance = Math.abs(c - originCol) + Math.abs(r - originRow);
          let level = 0;
          for (const wave of waves) {
            const s = wave.strength;
            if (distance > 10 + 45 * s || hash(wave.seed, c, r) > 0.3 + 0.55 * s) continue;
            const t = (now - wave.at) / 1000 - distance / (20 + 16 * s);
            if (t >= 0) level = Math.max(level, 1.25 * Math.exp(-5 * t) + 0.65 * Math.exp(-(3.3 - 2.53 * s) * t));
          }
          const step = Math.round(Math.min(1, level) * 5) / 5;
          if (step > 0) {
            ctx.globalAlpha = step;
            ctx.fillRect(c * 4, r * 4, 3, 3);
          }
        }
      }
      ctx.globalAlpha = 1;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, el.width, el.height);
    };
  }, [active]);
  return <canvas ref={canvas} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Context ring (c227f4d5e hZ / yZ / bZ in the chin, always shown): a 12px icon-only ring of the
// context window (0 on the new-session page); a session without a token report yet shows the
// busiest plan window instead (Be2 false). The 360 popover (c2d611398 Se): 上下文窗口 with the
// compact row from 50% (Jz), then the plan usage windows; 请求更多 when a workspace ran out.

/** Window names (shared-8 ZV): the short window is the session limit, the 7-day one weekly. */
function windowName(w: RateLimitWindow, primary: boolean): string {
  return w.windowDurationMins === 10080 ? "每周" : primary ? "会话限额" : limitName(w);
}

/** shared-156 EL / TL: minutes, hours and minutes, then the weekday (or date) and time. */
function resetLabel(resetsAt: number | null): string | null {
  if (!resetsAt) return null;
  const minutes = Math.max(0, Math.round((resetsAt * 1000 - Date.now()) / 60000));
  if (minutes < 60) return `${minutes} 分钟后重置`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟后重置`;
  const when = new Date(resetsAt * 1000).toLocaleString(
    "zh-CN",
    minutes >= 10080 ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { weekday: "short", hour: "numeric", minute: "2-digit" },
  );
  return `${when} 重置`;
}

/** Severity band of a percentage (shared-8 IV: 75 warning, 90 critical). */
const level = (pct: number) => (pct >= 90 ? "critical" : pct >= 75 ? "warning" : "normal");

/** Floor to two significant digits (c227f4d5e $z): 123 456 → 120 000. */
function twoDigits(tokens: number): number {
  const whole = Math.floor(tokens);
  const step = 10 ** Math.max(0, String(whole).length - 2);
  return Math.floor(whole / step) * step;
}

/** Workspace seats read "您的使用限额" (shared-156 wL: raven / usage-based seats). */
const WORKSPACE_PLAN = /^(team|business|self_serve_business|enterprise|ent26|edu)/;

/** shared-3 tX: why usage stopped. */
const LIMIT_TEXT: Record<RateLimitReachedType, string> = {
  rate_limit_reached: "已达到用量上限",
  workspace_owner_credits_depleted: "您的组织已用完用量额度",
  workspace_member_credits_depleted: "您的组织已用完用量额度",
  workspace_owner_usage_limit_reached: "您的组织已用完用量",
  workspace_member_usage_limit_reached: "您的组织已用完用量",
};

/** The owner's way out (TUI backend_banners/actions.rs); members ask the owner instead. */
function ownerLink(type: RateLimitReachedType, accountId: string | null): { label: string; url: string } | null {
  if (!accountId) return null;
  const account = `account_id=${encodeURIComponent(accountId)}`;
  if (type === "workspace_owner_credits_depleted") return { label: "购买额度", url: `https://chatgpt.com/admin/billing?codex_credit_action=add_credits&${account}` };
  if (type === "workspace_owner_usage_limit_reached") return { label: "管理支出限额", url: `https://chatgpt.com/admin/usage-limits/workspace?${account}` };
  return null;
}

function UsageMeter({ thread, open, onToggle, onClose }: { thread: ThreadState | undefined; open: boolean; onToggle(): void; onClose(): void }) {
  const rateLimits = useStore((s) => s.rateLimits);
  const account = useStore((s) => s.account?.account);
  const autoCompact = useStore((s) => s.config?.model_auto_compact_token_limit);
  const [request, setRequest] = useState<"idle" | "busy" | "sent">("idle");
  const snapshot = rateLimits?.rateLimits;
  const windows = [snapshot?.primary, snapshot?.secondary].flatMap((w, index) => (w ? [{ w, primary: index === 0 }] : []));
  const top = windows.reduce<(typeof windows)[number] | null>((a, b) => (!a || b.w.usedPercent > a.w.usedPercent ? b : a), null);
  const usage = thread?.tokenUsage;
  // A session without a token report yet has no context data (c2d611398 noData).
  const noData = !!thread && !usage;
  const used = usage?.last.totalTokens ?? 0;
  const max = usage?.modelContextWindow ?? null;
  // shared-8 qV: a known window gives "used / max (pct%)", otherwise (or when over it) only "used".
  const contextPct = max && used <= max ? Math.round((used / max) * 100) : null;
  const summary = contextPct !== null && max ? `${formatTokens(used)} / ${formatTokens(max)} (${contextPct}%)` : formatTokens(used);
  const planPct = top ? Math.round(top.w.usedPercent) : null;
  const ringPct = noData ? (planPct ?? 0) : (contextPct ?? 0);
  const planLine = top
    ? [top.primary ? `已用会话限额的 ${planPct}%` : `${windowName(top.w, false)}：${planPct}%`, resetLabel(top.w.resetsAt)].filter(Boolean).join(" · ")
    : null;
  const tooltip = noData ? "用量" : `上下文 ${summary}`;
  const ariaParts = [tooltip, ...(planLine ? [planLine] : [])].join("，");
  const running = !!activeTurn(thread);
  const left = autoCompact && usage ? Number(autoCompact) - used : null;
  const compactHint = left === null ? null : left < 30000 ? "即将自动压缩" : `距自动压缩还有 ${formatTokens(twoDigits(left))}`;
  const plan = account?.type === "chatgpt" && account.planType !== "unknown" ? account.planType : null;
  const reached = snapshot?.rateLimitReachedType ?? null;
  const memberAsk = reached === "workspace_member_credits_depleted" ? "credits" : reached === "workspace_member_usage_limit_reached" ? "usage_limit" : null;
  const owner = reached ? ownerLink(reached, rateLimits?.accountId ?? null) : null;
  const ask = () => {
    if (!memberAsk) return;
    setRequest("busy");
    requestMoreUsage(memberAsk)
      .then(() => setRequest("sent"))
      .catch((error) => {
        setRequest("idle");
        toast("danger", "无法发送您的请求。请重试。", errorMessage(error));
      });
  };
  const bar = (pct: number | null, label: string, value?: string) => (
    <div className="usage-bar" role="progressbar" aria-label={label} aria-valuenow={pct ?? undefined} aria-valuetext={pct === null ? value : undefined} aria-valuemin={0} aria-valuemax={100}>
      {pct !== null && <span data-level={level(pct)} style={{ width: `${Math.min(100, pct)}%` }} />}
    </div>
  );
  return (
    <Popover
      open={open}
      onClose={onClose}
      placement="top-end"
      className="usage-pop"
      anchor={
        <Button
          variant="ghost"
          size="xs"
          data-touch-size
          className="usage-trigger"
          icon={<UsageRing value={ringPct} size={12} stroke={2} />}
          label={noData ? ariaParts : `用量：${ariaParts}`}
          tip={planLine ? `${tooltip}\n${planLine}` : tooltip}
          aria-expanded={open}
          onClick={onToggle}
        />
      }
    >
      <h2 className="sr-only">用量</h2>
      {reached && (
        <>
          <div className="usage-line">
            <span className="usage-hint">{LIMIT_TEXT[reached]}</span>
            {memberAsk && (
              <Button size="xs" disabled={request !== "idle"} aria-busy={request === "busy" || undefined} onClick={ask}>
                {request === "sent" ? "已向管理员发送请求" : "请求更多"}
              </Button>
            )}
            {owner && (
              <Button size="xs" onClick={() => window.open(owner.url, "_blank", "noopener")}>
                {owner.label}
              </Button>
            )}
          </div>
          <div className="usage-sep" />
        </>
      )}
      <div className="usage-line">
        <span className="usage-label">上下文窗口</span>
        {!noData && <span className="usage-value">{summary}</span>}
      </div>
      <div className="usage-pad">{noData ? <span className="usage-note">发送消息后即可查看上下文用量。</span> : bar(contextPct, "上下文窗口", summary)}</div>
      {thread && contextPct !== null && contextPct >= 50 && (
        <div className="usage-line">
          <span className="usage-hint">{compactHint}</span>
          <Button
            size="xs"
            disabled={running}
            tip={running ? "Codex 完成本轮后可用" : undefined}
            onClick={() => {
              onClose();
              compactThread(thread.meta.id).catch((error) => toast("danger", "压缩失败", errorMessage(error)));
            }}
          >
            压缩会话
          </Button>
        </div>
      )}
      {windows.length > 0 && (
        <>
          <div className="usage-sep" />
          <div className="usage-line">
            <span className="usage-label">
              {plan && WORKSPACE_PLAN.test(plan) ? "您的使用限额" : "套餐使用限额"}
              {plan ? ` · ${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : ""}
            </span>
            <button
              type="button"
              className="usage-link"
              aria-label="在设置中查看用量"
              onClick={() => {
                onClose();
                openSettings("account", "setting-account-limits");
              }}
            >
              <ArrowRight size={12} />
            </button>
          </div>
          <div className="usage-windows">
            {windows.map(({ w, primary }) => {
              const pct = Math.round(Math.max(0, Math.min(100, w.usedPercent)));
              const name = windowName(w, primary);
              return (
                <div key={w.windowDurationMins ?? name} className="usage-window">
                  <div className="usage-window-head">
                    <span className="usage-window-name">{name}</span>
                    <span className="usage-window-value">
                      {resetLabel(w.resetsAt) && <span>{resetLabel(w.resetsAt)}</span>}
                      <span>{pct}%</span>
                    </span>
                  </div>
                  {bar(pct, name)}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Voice mode (W22, thread/realtime/* over WebRTC via lib/voice.ts; the Dictate slot of the
// chin, a Codex feature): six bars idle, three dots while connecting, three live bars (200–4000
// Hz in three log bands) while active; the orb is a 2D-canvas stand-in for the WebGL blob.

let audio: AudioContext | null = null;
const analysers = new WeakMap<MediaStream, AnalyserNode>();

function analyserFor(stream: MediaStream | null): AnalyserNode | null {
  if (!stream) return null;
  let node = analysers.get(stream);
  if (!node) {
    audio ??= new AudioContext();
    node = audio.createAnalyser();
    node.fftSize = 1024;
    node.smoothingTimeConstant = 0.6;
    audio.createMediaStreamSource(stream).connect(node);
    analysers.set(stream, node);
  }
  return node;
}

/** Mean level (0..1) of [lo, hi) Hz in a byte spectrum. */
function bandLevel(node: AnalyserNode, data: Uint8Array, lo: number, hi: number): number {
  const hz = node.context.sampleRate / node.fftSize;
  const from = Math.max(1, Math.floor(lo / hz));
  const to = Math.max(from + 1, Math.ceil(hi / hz));
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] ?? 0;
  return sum / (to - from) / 255;
}

/** Calls `draw(mic, speaker)` with fresh spectra at about 24 fps while `on`. */
type Spectrum = Uint8Array<ArrayBuffer>;

function useSpectrum(on: boolean, draw: (mic: AnalyserNode | null, speaker: AnalyserNode | null, data: [Spectrum, Spectrum]) => void) {
  const latest = useRef(draw);
  latest.current = draw;
  useEffect(() => {
    if (!on) return;
    let frame = 0;
    let lastAt = 0;
    const data: [Spectrum, Spectrum] = [new Uint8Array(512), new Uint8Array(512)];
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - lastAt < 1000 / 24) return;
      lastAt = now;
      const { mic, remote } = voiceStreams();
      const a = analyserFor(mic);
      const b = analyserFor(remote);
      a?.getByteFrequencyData(data[0]);
      b?.getByteFrequencyData(data[1]);
      latest.current(a, b, data);
    };
    void audio?.resume();
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [on]);
}

const IDLE_BARS = [6, 10, 16, 10, 16, 6];
const LIVE_BANDS: [number, number, number, number][] = [
  // [lo Hz, hi Hz, noise floor, gain]
  [200, 547, 0.06, 1.5],
  [547, 1495, 0.04, 2],
  [1495, 4000, 0.06, 1.5],
];

function VoiceBars({ state }: { state: "idle" | "connecting" | "active" }) {
  const bars = useRef<(SVGRectElement | null)[]>([]);
  useSpectrum(state === "active", (mic, speaker, data) => {
    LIVE_BANDS.forEach(([lo, hi, floor, gain], k) => {
      const value = Math.max(mic ? bandLevel(mic, data[0], lo, hi) : 0, speaker ? bandLevel(speaker, data[1], lo, hi) : 0);
      const h = 6 + 10 * Math.min(1, Math.max(0, (value - floor) * gain));
      bars.current[k]?.setAttribute("height", String(h));
      bars.current[k]?.setAttribute("y", String((21.2 - h) / 2));
    });
  });
  return (
    <svg className="voice-bars" data-state={state} viewBox="0 0 21.2 21.2" width={20} height={20} aria-hidden="true">
      {state === "idle" && IDLE_BARS.map((h, i) => <rect key={i} x={i * 4} y={(21.2 - h) / 2} width={1.2} height={h} rx={0.6} />)}
      {state === "connecting" &&
        [0, 1, 2].map((k) => <circle key={k} data-dot cx={2.6 + 8 * k} cy={10.6} r={2.5} fill="currentColor" style={{ "--k": k } as CSSProperties} />)}
      {state === "active" &&
        [0, 1, 2].map((k) => (
          <rect
            key={k}
            ref={(el) => {
              bars.current[k] = el;
            }}
            x={0.6 + 8 * k}
            y={7.6}
            width={4}
            height={6}
            rx={2}
          />
        ))}
    </svg>
  );
}

const ORB_EDGES = Array.from({ length: 8 }, (_, i) => 85 * (3500 / 85) ** (i / 7));

function VoiceOrb() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const energy = useRef(new Array(7).fill(0));
  const tint = useRef(0);
  useSpectrum(true, (mic, speaker, data) => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const width = (el.width = el.clientWidth / 4);
    const height = (el.height = el.clientHeight / 4);
    let mine = 0;
    let theirs = 0;
    for (let i = 0; i < 7; i++) {
      const a = mic ? bandLevel(mic, data[0], ORB_EDGES[i], ORB_EDGES[i + 1]) : 0;
      const b = speaker ? bandLevel(speaker, data[1], ORB_EDGES[i], ORB_EDGES[i + 1]) : 0;
      mine += a;
      theirs += b;
      energy.current[i] = energy.current[i] * 0.92 + Math.max(a, b) * 0.08 * 4;
    }
    // The agent's voice pulls toward clay, yours toward blue, 3% a frame.
    tint.current += ((theirs > mine ? 1 : 0) - tint.current) * 0.03;
    const t = tint.current;
    const [r, g, b] = [106 + (217 - 106) * t, 155 + (119 - 155) * t, 204 + (87 - 204) * t];
    ctx.clearRect(0, 0, width, height);
    ctx.filter = `blur(${Math.max(2, height / 6)}px)`;
    for (let i = 0; i < 7; i++) {
      const e = Math.min(1, energy.current[i]);
      ctx.fillStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${0.05 + 0.75 * e})`;
      ctx.beginPath();
      ctx.ellipse(width * (0.2 + (0.6 * i) / 6), height * (0.55 - 0.1 * e), (width / 10) * (0.6 + 0.16 * e), (height / 4) * (0.6 + 1.2 * e), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  return <canvas ref={canvas} className="voice-orb" aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// The 「+」 menu's connector and plugin entries (c227f4d5e pj): connectors are switches that keep
// the menu open, under 管理连接器; no connectors makes the whole entry 管理连接器.

const isDark = () => document.documentElement.classList.contains("dark");

/** A switch drawn in a menu row's trailing slot; the row itself is the menuitemcheckbox. */
const MenuSwitch = ({ on }: { on: boolean }) => <span className="toggle" aria-hidden="true" aria-checked={on} />;

/** 浏览连接器: the app/list directory, apps not connected yet; a row opens the app's install page. */
function BrowseConnectors({ threadId }: { threadId: string | null }) {
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  const load = () => {
    if (apps) return;
    browseConnectors(null, threadId)
      .then((page) => setApps(page?.data.filter((app) => !app.isAccessible) ?? []))
      .catch(() => setApps([]));
  };
  return (
    <div onPointerEnter={load} onFocus={load}>
      <Submenu icon={<Plus size={16} />} label="浏览连接器">
        {apps === null && <div className="menu-empty">正在读取…</div>}
        {apps?.length === 0 && <div className="menu-empty">没有可用的连接器</div>}
        <div className="menu-scroll">
          {apps?.map((app) => {
            const logo = isDark() ? (app.logoUrlDark ?? app.logoUrl) : app.logoUrl;
            const url = app.installUrl ? externalUrl(app.installUrl) : null;
            return (
              <MenuItem
                key={app.id}
                icon={logo ? <img className="mention-icon" src={logo} alt="" /> : <Plug size={16} />}
                label={app.name}
                hint={app.description ?? undefined}
                disabled={!url}
                onClick={() => url && window.open(url, "_blank", "noopener")}
              />
            );
          })}
        </div>
      </Submenu>
    </div>
  );
}

function ConnectorsEntry({ threadId, onClose }: { threadId: string | null; onClose(): void }) {
  const connectors = useStore((s) => s.connectors);
  const manage = () => {
    onClose();
    openSettings("connectors", "setting-connectors-apps");
  };
  if (connectors === null) return <MenuItem icon={<Plug size={16} />} label="连接器" disabled onClick={() => {}} />;
  if (connectors.length === 0) return <MenuItem icon={<Plug size={16} />} label="管理连接器" onClick={manage} />;
  return (
    <Submenu icon={<Plug size={16} />} label="连接器">
      <MenuItem icon={<Wrench size={16} />} label="管理连接器" onClick={manage} />
      <BrowseConnectors threadId={threadId} />
      <MenuSep />
      <div className="menu-scroll">
        {connectors.map((connector) => {
          const icon = isDark() ? (connector.iconUrlDark ?? connector.iconUrl) : connector.iconUrl;
          const noTools = connector.enabled && !connector.callable;
          return (
            <MenuItem
              key={connector.id}
              icon={icon ? <img className="mention-icon" src={icon} alt="" /> : <Plug size={16} />}
              label={connector.name}
              hint={noTools ? "此连接器没有可用的工具" : undefined}
              toggle
              checked={connector.enabled}
              value={<MenuSwitch on={connector.enabled} />}
              disabled={noTools}
              onClick={() => setConnectorEnabled(connector.id, !connector.enabled).catch((error) => toast("danger", "切换连接器失败", errorMessage(error)))}
            />
          );
        })}
      </div>
    </Submenu>
  );
}

function PluginsEntry({ onPick, onClose }: { onPick(mention: Mention): void; onClose(): void }) {
  const plugins = useStore((s) => s.plugins);
  const enabled = plugins?.filter((p) => p.installed && p.enabled) ?? [];
  const settings = (anchor: string) => () => {
    onClose();
    openSettings("plugins", anchor);
  };
  if (plugins === null) return <MenuItem icon={<Puzzle size={16} />} label="插件" disabled onClick={() => {}} />;
  if (enabled.length === 0) return <MenuItem icon={<Puzzle size={16} />} label="添加插件" onClick={settings("setting-plugins-directory")} />;
  return (
    <Submenu icon={<Puzzle size={16} />} label="插件">
      <div className="menu-scroll">
        {enabled.map((plugin) => (
          <MenuItem
            key={plugin.id}
            icon={plugin.interface?.composerIconUrl ? <img className="mention-icon" src={plugin.interface.composerIconUrl} alt="" /> : <Puzzle size={16} />}
            label={plugin.interface?.displayName ?? plugin.name}
            hint={plugin.interface?.shortDescription ?? undefined}
            onClick={() => onPick(pluginMention(plugin))}
          />
        ))}
      </div>
      <MenuSep />
      <MenuItem icon={<Wrench size={16} />} label="管理插件" onClick={settings("setting-plugins-installed")} />
      <MenuItem icon={<Plus size={16} />} label="浏览插件" onClick={settings("setting-plugins-directory")} />
    </Submenu>
  );
}

// ---------------------------------------------------------------------------

/** Shell commands run from a composer, per session (no server history of the raw command lines). */
const shellRuns = new Map<string, string[]>();

export function Composer({ threadId, form, autoFocus }: { threadId: string | null; form: "home" | "reply"; autoFocus?: boolean }) {
  const thread = useStore((s) => (threadId ? s.threads[threadId] : undefined));
  const models = useStore((s) => s.models);
  const hiddenModels = useStore((s) => s.hiddenModels);
  const modes = useStore((s) => s.modes);
  const features = useStore((s) => s.features);
  const skillsRev = useStore((s) => s.skillsRev);
  const prefs = useStore((s) => s.prefs);
  const voice = useStore((s) => s.voice);
  const platform = useStore((s) => s.server.info?.platformOs);
  const profiles = useStore((s) => s.permissionProfiles);
  const firstRun = useStore((s) => s.landing !== null && s.landing.length === 0 && s.list.ids.length === 0);
  useStore((s) => s.config);
  useStore((s) => s.requirements);
  useStore((s) => s.allowFullAccess);
  const cwd = useStore((s) => (thread ? (thread.settings?.cwd ?? thread.meta.cwd) : s.prefs.cwd));
  const draftKey = `codex-ui:draft:${threadId ?? "new"}`;
  const [text, setText] = useState(() => readDraft(draftKey));
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [skills, setSkills] = useState<SkillMetadata[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [skillList, setSkillList] = useState<SkillMetadata[] | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [selected, setSelected] = useState(0);
  const [mentionResults, setMentionResults] = useState<{ path: string; name: string; dir: boolean; hits: number[] }[]>([]);
  const [sending, setSending] = useState(false);
  const [shell, setShell] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("");
  const [multiline, setMultiline] = useState(false);
  const [swapped, setSwapped] = useState(false);
  const [history, setHistory] = useState<{ index: number; draft: string } | null>(null);
  const [rewinding, setRewinding] = useState<number | null>(null);
  /** The caret, for the slash and @ menus (null: the end of the text). */
  const [caretAt, setCaretAt] = useState<number | null>(null);
  const lastEscape = useRef(-Infinity);
  const reduced = useReducedMotion();
  const input = useRef<HTMLTextAreaElement>(null);
  const trailingRef = useRef<HTMLSpanElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const compositionEnd = useRef(-Infinity);

  const running = !!activeTurn(thread);
  const effective = effectiveSettings(thread ?? null);
  const model = [...models, ...hiddenModels].find((m) => m.id === effective.model || m.model === effective.model);
  const acceptsImages = !model || model.inputModalities.includes("image");
  const planAvailable = modes.some((mode) => mode.mode === "plan");
  const autoAvailable = autoReviewAvailable();
  const goals = features.some((feature) => feature.name === "goals" && feature.enabled);
  const fastOffered = fastAvailable(effective.model);
  const fastOn = effective.serviceTier === "priority";
  const fastTier = model?.serviceTiers.find((tier) => tier.id === "priority");
  const shellName = platform === "windows" ? "PowerShell" : "bash";
  const hasInput = !!text.trim() || attachments.length > 0 || skills.length > 0 || mentions.length > 0;
  const showStop = running && !hasInput;
  const mode = modeOf(effective);
  const profile = effective.permissionProfile;
  const toggle = (next: Exclude<Menu, null>) => setMenu((current) => (current === next ? null : next));
  const modeAllowed = (id: ModeId) => id === "plan" || presetAllowed(MODE_PRESET[id]);
  // Not offered (or not allowed) modes leave the menu, except the one in effect.
  const modeItems = MODES.filter((m) => m.id === mode || ((m.id === "plan" ? planAvailable : m.id !== "auto" || autoAvailable) && modeAllowed(m.id)));
  // Digits go to enabled items only, 1–9 in order (c227f4d5e lQ).
  const modeDigits = modeItems.filter((m) => modeAllowed(m.id)).slice(0, 9);
  const defaultMode = configMode();
  const mainModels = model && !models.includes(model) ? [model, ...models] : models;
  const memoryOffered = memoriesEnabled();
  const memoryOn = threadId ? (thread?.memory ?? (memorySettings().generate ? "enabled" : "disabled")) === "enabled" : prefs.memory && memorySettings().generate;
  const desktop = "codexDesktop" in window;
  // This session's sent prompts, oldest first: ↑ history and the Esc Esc rewind picker (no
  // server history API, so only what the loaded turns hold).
  const turns = thread?.turns;
  const sent = useMemo(
    () =>
      (turns ?? []).flatMap((turn) =>
        turn.items.flatMap((item) => {
          const prompt = item.type === "userMessage" ? inputText(item.content) : "";
          return prompt ? [{ turnId: turn.id, text: prompt }] : [];
        }),
      ),
    [turns],
  );
  // Shell mode walks this session's shell commands instead (c227f4d5e getBashHistory).
  const recalled = shell ? (shellRuns.get(threadId ?? "") ?? []).map((line) => ({ text: line })) : sent;

  useEffect(() => saveDraft(draftKey, text), [draftKey, text]);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus, threadId]);

  // Send and stop cross-fade only after the first swap (not on mount).
  const stopShown = useRef(showStop);
  useEffect(() => {
    if (stopShown.current !== showStop) setSwapped(true);
    stopShown.current = showStop;
  }, [showStop]);

  /** Focus with the caret after the text (programmatic edits end here). */
  const focusEnd = () => {
    setCaretAt(null);
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  // 设定目标 and rewinds replace the draft; quotes from the transcript append to it.
  useEffect(() => {
    const onDraft = (event: Event) => {
      setText((event as CustomEvent<string>).detail);
      focusEnd();
    };
    const onAppend = (event: Event) => {
      const value = (event as CustomEvent<string>).detail;
      setText((current) => (current && !current.endsWith("\n") ? `${current}\n${value}` : current + value));
      focusEnd();
    };
    window.addEventListener("composer-draft", onDraft);
    window.addEventListener("composer-append", onAppend);
    return () => {
      window.removeEventListener("composer-draft", onDraft);
      window.removeEventListener("composer-append", onAppend);
    };
  }, []);

  // Connectors and plugins load when the 「+」 menu first opens.
  useEffect(() => {
    if (menu !== "plus") return;
    if (getState().connectors === null) void listConnectors(threadId);
    if (getState().plugins === null) void listInstalledPlugins();
  }, [menu, threadId]);

  // skills/changed: the next look at the submenu refetches.
  useEffect(() => setSkillList(null), [skillsRev, cwd]);

  // Auto-grow fallback for browsers without `field-sizing`; CSS max-height caps it.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el || FIELD_SIZING) return;
    el.style.height = "";
    if (text) el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // One row until the text wraps or something is attached; back to one row once the text fits
  // beside the actions with 24px to spare (shared-5 Qu / Wu).
  const chips = attachments.length + skills.length + mentions.length;
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    const measure = () => {
      if (chips > 0) return setMultiline(true);
      const style = getComputedStyle(el);
      const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
      const rows = Math.round((el.scrollHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / line);
      const fits = textWidth(el.value, style) <= el.clientWidth - (trailingRef.current?.offsetWidth ?? 0) - 24;
      setMultiline((was) => rows > 1 || (was && !fits));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, chips]);

  const override = (patch: OverridePatch) => setOverride(threadId, patch);
  const pick = (patch: OverridePatch) => {
    override(patch);
    setMenu(null);
  };
  const pickMode = (id: ModeId) => {
    if (id === "plan") return pick({ planMode: true });
    const reviewer = autoAvailable || effective.reviewer === "auto_review" ? (id === "auto" ? "auto_review" : "user") : undefined;
    pick({ planMode: false, permission: MODE_PRESET[id], ...(reviewer ? { reviewer } : {}) });
  };
  const setFast = (on: boolean) => {
    override({ serviceTier: on ? "priority" : "default" });
    setStatus(on ? "已开启快速模式" : "已关闭快速模式");
  };
  const toggleFast = () => setFast(!fastOn);
  const effortMenu = () => setMenu((model?.supportedReasoningEfforts.length ?? 0) > 1 ? "effort" : "model");

  // Global keys while this composer is on screen (W14 shortcut table, desktop column).
  const keys = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    // Digits 1–9 pick within the open model or mode menu (shared-7 shortcuts).
    if (!mod && !event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key) && (menu === "model" || menu === "mode")) {
      const index = Number(event.key) - 1;
      if (menu === "model" && mainModels[index]) pick({ model: mainModels[index].id });
      else if (menu === "mode" && modeDigits[index]) pickMode(modeDigits[index].id);
      else return;
      event.preventDefault();
      return;
    }
    if (mod && !event.shiftKey && !event.altKey && key === "u") {
      event.preventDefault();
      fileInput.current?.click();
      return;
    }
    const shortcut =
      mod && event.shiftKey && !event.altKey && key === "i"
        ? "model"
        : mod && event.shiftKey && !event.altKey && key === "e"
          ? "effort"
          : mod && event.altKey && !event.shiftKey && event.code === "KeyM"
            ? "mode"
            : desktop && mod && event.shiftKey && !event.altKey && key === "m"
              ? "mode"
              : mod && event.altKey && !event.shiftKey && event.code === "KeyF"
                ? "fast"
                : null;
    if (shortcut) {
      event.preventDefault();
      if (shortcut === "fast") {
        if (fastOffered) toggleFast();
      } else if (shortcut === "effort") {
        // With one level or none the effort chord opens the model menu (c227f4d5e pQ).
        if (menu === "effort" || menu === "model") setMenu(null);
        else effortMenu();
      } else toggle(shortcut);
      return;
    }
    // The second Esc of a pair after the first one left the editor opens the rewind picker.
    if (event.key === "Escape" && !mod && threadId && sent.length && event.timeStamp - lastEscape.current < DOUBLE_ESCAPE_MS && document.activeElement === document.body) {
      event.preventDefault();
      lastEscape.current = -Infinity;
      input.current?.focus();
      setRewinding(0);
      return;
    }
    // Type anywhere: a printable key outside any field lands in the composer.
    if (mod || event.altKey || event.key.length !== 1) return;
    const active = document.activeElement as HTMLElement | null;
    if (active?.closest("input, textarea, select, [contenteditable], [role=dialog], [role=alertdialog], .popover")) return;
    input.current?.focus();
  };
  useEffect(() => {
    if (!autoFocus) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const { dialog, settings, palette, lightbox } = getState();
      if (dialog || settings || palette || lightbox) return;
      keys.current(event);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [autoFocus]);

  // Page-wide drop (W17, dropScope "page"): files dragged anywhere over the window show the
  // scrim and land as attachments.
  const addFilesRef = useRef<(files: Iterable<File>) => void>(() => {});
  useEffect(() => {
    if (!autoFocus) return;
    let depth = 0;
    const files = (event: DragEvent) => !!event.dataTransfer?.types.includes("Files");
    const onEnter = (event: DragEvent) => {
      if (!files(event)) return;
      depth += 1;
      setDragging(true);
    };
    const onOver = (event: DragEvent) => {
      if (!files(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (event: DragEvent) => {
      if (!files(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!files(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      if (event.dataTransfer) addFilesRef.current(event.dataTransfer.files);
    };
    document.addEventListener("dragenter", onEnter);
    document.addEventListener("dragover", onOver);
    document.addEventListener("dragleave", onLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onEnter);
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("dragleave", onLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, [autoFocus]);

  const loadSkills = () => {
    if (skillList) return;
    listSkills(cwd)
      .then((entries) => setSkillList(entries.flatMap((entry) => entry.skills).filter((skill) => skill.enabled)))
      .catch(() => setSkillList([]));
  };

  const fail = (title: string) => (error: unknown) => toast("danger", title, errorMessage(error));

  // App commands (cc183b3ab, descriptions translated) plus Codex's own (/goal, /hooks, /memory,
  // /logout). Picking one inserts it; Enter runs it with what follows (c5cd1b4dc 3255-3263).
  const commands: SlashCommand[] = [
      { name: "new", description: "以空上下文开始新会话", run: newChat },
      {
        name: "model",
        description: "设置此会话的模型",
        run: (args) => {
          const query = args.toLowerCase();
          const found = query && [...models, ...hiddenModels].find((m) => [m.id, m.model, m.displayName].some((name) => name.toLowerCase() === query));
          if (found) override({ model: found.id });
          else setMenu("model");
        },
      },
      {
        name: "effort",
        description: "设置此会话的努力程度",
        run: (args) => {
          const found = args && model?.supportedReasoningEfforts.find((o) => o.reasoningEffort === args.toLowerCase() || EFFORT_LABELS[o.reasoningEffort] === args);
          if (found) override({ effort: found.reasoningEffort });
          else effortMenu();
        },
      },
      ...(fastOffered ? [{ name: "fast", description: "开启或关闭快速模式", run: (args: string) => setFast(args === "on" ? true : args === "off" ? false : !fastOn) }] : []),
      { name: "permissions", description: "更改权限模式", run: () => setMenu("mode") },
      ...(planAvailable
        ? [
            {
              name: "plan",
              description: "切换到计划模式，或查看此会话的计划",
              run: (args: string) => {
                override({ planMode: true });
                // A description is sent as the first message in plan mode.
                return args === "open" ? undefined : args;
              },
            },
          ]
        : []),
      ...(goals
        ? [
            {
              name: "goal",
              description: "设定目标：Codex 会持续推进，直到完成",
              run: (args: string) => {
                if (!args) return writeAt("/goal ", 6);
                setGoal(threadId, args)
                  .then(() => toast("neutral", "已设定目标", args))
                  .catch(fail("设定目标失败"));
              },
            },
          ]
        : []),
      { name: "review", description: "审查当前改动中的缺陷和可清理之处", run: () => setState({ dialog: { type: "review", threadId } }) },
      { name: "init", description: "初始化新的 AGENTS.md 文件，写入代码库说明", run: () => initPrompt },
      { name: "compact", description: "总结目前的会话以释放上下文", needsThread: true, run: () => threadId && compactThread(threadId).catch(fail("压缩失败")) },
      {
        name: "fork",
        description: "将此会话分叉为新会话",
        needsThread: true,
        run: (args) =>
          threadId &&
          forkThread(threadId)
            .then(() => {
              const fork = getState().activeId;
              if (args && fork) return sendMessage(fork, [{ type: "text", text: args, text_elements: [] }]);
            })
            .catch(fail("分支失败")),
      },
      {
        name: "rename",
        description: "重命名此会话",
        needsThread: true,
        run: (args) => threadId && (args ? renameThread(threadId, args).catch(fail("重命名失败")) : setState({ dialog: { type: "rename", threadId } })),
      },
      { name: "rewind", description: "将会话回退到更早的消息", needsThread: true, run: () => sent.length && setRewinding(0) },
      { name: "diff", description: "显示或隐藏此会话的更改", needsThread: true, run: () => togglePane("diff") },
      {
        name: "status",
        description: "显示此会话的版本、模型、环境和账户",
        needsThread: true,
        run: () => {
          const { server, account } = getState();
          const who = account?.account?.type === "chatgpt" ? (account.account.email ?? "ChatGPT") : account?.account?.type === "apiKey" ? "API Key" : null;
          toast("neutral", `Codex ${server.version ?? ""}`.trim(), [modelLabel(effective.model), cwd, who].filter(Boolean).join(" · "));
        },
      },
      { name: "usage", description: "显示套餐用量和速率限制", run: () => setMenu("usage") },
      { name: "mcp", description: "管理 MCP 连接器", run: () => openSettings("mcp") },
      { name: "skills", description: "浏览和管理您的技能", run: () => openSettings("skills") },
      { name: "plugin", aliases: ["plugins"], description: "管理 Codex 插件", run: () => openSettings("plugins") },
      { name: "hooks", description: "管理 Hooks", run: () => openSettings("hooks") },
      { name: "memory", description: "管理记忆", run: () => openSettings("memory") },
      { name: "config", aliases: ["settings"], description: "打开 Codex 设置", run: () => openSettings("general") },
      { name: "logout", description: "退出登录", run: () => void logout().catch(fail("退出失败")) },
  ];
  const findCommand = (name: string) => {
    const lower = name.toLowerCase();
    return commands.find((c) => (c.name === lower || c.aliases?.includes(lower)) && (!c.needsThread || threadId));
  };

  // The slash menu follows the first token while the caret is in it; @ the token before the caret.
  const caret = Math.min(caretAt ?? text.length, text.length);
  const slashQuery = shell ? undefined : /^\/(\S*)$/.exec(text.slice(0, caret))?.[1];
  const slashMatches =
    slashQuery === undefined
      ? []
      : commands.filter((c) => [c.name, ...(c.aliases ?? [])].some((name) => name.startsWith(slashQuery.toLowerCase())) && (!c.needsThread || threadId));
  const mentionQuery = shell ? undefined : /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))?.[1].replace(TRAILING_PUNCT, "");

  useEffect(() => {
    if (mentionQuery === undefined || !cwd) {
      setMentionResults([]);
      return;
    }
    const timer = setTimeout(() => {
      searchFiles(mentionQuery, cwd)
        .then((files) =>
          setMentionResults(
            files
              .filter((f) => !/(^|[\\/])\.git([\\/]|$)/.test(f.path))
              .slice(0, 8)
              .map((f) => {
                // Matched characters of the file name, from the path's match indices.
                const offset = Array.from(f.path).length - Array.from(f.file_name).length;
                return { path: f.path, name: f.file_name, dir: f.match_type === "directory", hits: (f.indices ?? []).filter((i) => i >= offset).map((i) => i - offset) };
              }),
          ),
        )
        .catch(() => setMentionResults([]));
    }, 120);
    return () => clearTimeout(timer);
  }, [mentionQuery, cwd]);

  const popup: "slash" | "mention" | null = slashMatches.length ? "slash" : mentionQuery !== undefined && mentionResults.length ? "mention" : null;
  const popupLength = popup === "slash" ? slashMatches.length : mentionResults.length;
  useEffect(() => setSelected(0), [popup, slashQuery, mentionQuery]);

  async function addFiles(files: Iterable<File>) {
    const list = [...files];
    if (!list.length) return;
    if (shell) {
      toast("neutral", `${shellName} 模式已开启，因此没有添加任何内容。请在空输入框中按 Backspace 返回聊天后再试。`);
      return;
    }
    if (!acceptsImages) {
      toast("warning", "当前模型不支持图片");
      return;
    }
    const images = list.filter((file) => IMAGE_TYPES.includes(file.type));
    if (images.length < list.length) toast("warning", "仅支持 PNG、JPEG、GIF 和 WebP 图片。");
    const small = images.filter((file) => file.size <= MAX_IMAGE_BYTES);
    if (small.length < images.length) toast("warning", "部分图片过大，无法附加。最大为 30 MB。");
    const room = MAX_IMAGES - attachments.length;
    if (small.length > room) toast("warning", `最多只能添加 ${MAX_IMAGES} 张图片。`);
    for (const file of small.slice(0, Math.max(0, room))) {
      const url = await readAsDataUrl(file);
      setAttachments((current) => (current.length >= MAX_IMAGES ? current : [...current, { id: Date.now() + Math.random(), name: file.name || "粘贴的图片", url }]));
    }
  }
  addFilesRef.current = (files) => void addFiles(files);

  /** Put `value` in the editor with the caret at `at`. */
  function writeAt(value: string, at: number) {
    setText(value);
    setCaretAt(at);
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(at, at);
    });
  }

  /** Picking a command writes it in place of the typed token and waits for Enter. */
  function insertCommand(command: SlashCommand) {
    const rest = text.slice(caret).replace(/^\S*/, "").trimStart();
    writeAt(`/${command.name} ${rest}`, command.name.length + 2);
  }

  function insertMention(path: string) {
    const before = text.slice(0, caret).replace(/@([^\s@]*)$/, "");
    const relative = relativePath(path, cwd);
    const mention = `${relative.includes(" ") ? `"${relative}"` : relative} `;
    writeAt(`${before}${mention}${text.slice(caret)}`, before.length + mention.length);
  }

  /** A plugin from the 「+」 menu: the mention rides with the message, `@名称` goes in the text. */
  function addMention(mention: Mention) {
    setMenu(null);
    setMentions((current) => (current.some((m) => m.path === mention.path) ? current : [...current, mention]));
    setText((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}@${mention.name} `);
    focusEnd();
  }

  /** 在输入框中编辑 / ↑ on an empty editor: a queued message comes back (cc43287c9 36132). */
  function takeBack(parts: UserInput[]) {
    const value = inputText(parts);
    if (value) setText((current) => (current ? `${current}\n${value}` : value));
    const images = parts.flatMap((part) => (part.type === "image" && "url" in part ? [{ id: Date.now() + Math.random(), name: "图片", url: part.url }] : []));
    if (images.length) setAttachments((current) => [...current, ...images].slice(0, MAX_IMAGES));
    const back = parts.filter((part): part is Mention => part.type === "mention");
    if (back.length) setMentions((current) => [...current, ...back.filter((m) => !current.some((c) => c.path === m.path))]);
    // cc43287c9 36181: what the composer cannot hold is gone with the withdrawn message.
    if (parts.some((part) => part.type === "localImage" || part.type === "skill" || part.type === "audio" || part.type === "localAudio" || (part.type === "image" && !("url" in part))))
      toast("neutral", "消息已撤回。其附件无法放回输入框。");
    focusEnd();
  }

  async function submit(opts: { queue?: boolean } = {}) {
    let body = text.trim();
    if (sending) return;
    if (shell) {
      if (!body) return;
      setSending(true);
      try {
        await runShellCommand(threadId, body);
        const key = getState().activeId ?? threadId ?? "";
        shellRuns.set(key, [...(shellRuns.get(key) ?? []), body]);
        setText("");
        setHistory(null);
      } catch (error) {
        toast("danger", "命令没有运行", errorMessage(error));
      } finally {
        setSending(false);
        input.current?.focus();
      }
      return;
    }
    const slash = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(body);
    const command = slash && findCommand(slash[1]);
    if (command) {
      setText("");
      setHistory(null);
      const message = command.run(slash?.[2]?.trim() ?? "");
      if (typeof message !== "string" || !message) return;
      body = message;
    }
    if (!body && attachments.length === 0 && skills.length === 0 && mentions.length === 0) return;
    setSending(true);
    try {
      const inputs: UserInput[] = [
        ...attachments.map((a): UserInput => ({ type: "image", url: a.url })),
        ...skills.map((skill): UserInput => ({ type: "skill", name: skill.name, path: skill.path })),
        ...mentions,
      ];
      if (body) inputs.push({ type: "text", text: body, text_elements: [] });
      await sendMessage(threadId, inputs, opts);
      setText("");
      setHistory(null);
      setAttachments([]);
      setSkills([]);
      setMentions([]);
    } catch (error) {
      toast("danger", opts.queue ? "稍后排队失败" : "发送失败", errorMessage(error));
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // CJK IME: Enter confirms a candidate and must never send. WebKit delivers that Enter just
    // after compositionend, so it is ignored for 500ms there.
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && APPLE && event.timeStamp - compositionEnd.current < 500) return;
    // Rewind picker (Esc Esc): 1–9, ↑ ↓ and Enter pick, Esc closes.
    if (rewinding !== null) {
      const digit = /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setRewinding((index) => ((index ?? 0) + (event.key === "ArrowDown" ? 1 : sent.length - 1)) % sent.length);
        return;
      }
      if (event.key === "Enter" || digit >= 0) {
        event.preventDefault();
        rewindTo(digit >= 0 ? digit : rewinding);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setRewinding(null);
        return;
      }
    }
    if (popup) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((index) => (index + (event.key === "ArrowDown" ? 1 : popupLength - 1)) % popupLength);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        if (popup === "slash") insertCommand(slashMatches[selected]);
        else insertMention(mentionResults[selected].path);
        return;
      }
      if (event.key === "Escape") {
        // Esc drops the typed token: the "/…" command or the "@…" query.
        event.preventDefault();
        const before = popup === "slash" ? "" : text.slice(0, caret).replace(/@([^\s@]*)$/, "");
        writeAt(before + (popup === "slash" ? text.slice(caret).trimStart() : text.slice(caret)), before.length);
        return;
      }
    }
    // Shell mode (c227f4d5e Zi): "!" on an empty editor turns it on and is swallowed;
    // Backspace on the empty editor or Esc turns it off.
    if (event.key === "!" && !text && !shell && !attachments.length && !skills.length && !mentions.length) {
      event.preventDefault();
      setShell(true);
      setHistory(null);
      return;
    }
    if (shell && event.key === "Backspace" && !text) {
      event.preventDefault();
      leaveShell();
      return;
    }
    const el = event.currentTarget;
    const plain = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && el.selectionStart === el.selectionEnd;
    // ↑ on an empty editor takes the last queued message back first (c227f4d5e onEmptyArrowUp).
    if (plain && event.key === "ArrowUp" && !text && !shell && threadId && thread?.queue.length) {
      event.preventDefault();
      const last = thread.queue[thread.queue.length - 1];
      takeBack(last.input);
      removeQueued(threadId, last.id).catch(fail("移除失败"));
      return;
    }
    // History (shared-7 jD): ↑ on an empty editor recalls this session's earlier prompts (shell
    // commands in shell mode), newest first, caret at the end; ↓ walks back to the draft.
    if (plain) {
      if (event.key === "ArrowUp" && (history || !text) && !text.slice(0, el.selectionStart).includes("\n") && (history?.index ?? 0) < recalled.length) {
        event.preventDefault();
        recall((history?.index ?? 0) + 1, history ? history.draft : text);
        return;
      }
      if (event.key === "ArrowDown" && history && !text.slice(el.selectionEnd).includes("\n")) {
        event.preventDefault();
        if (history.index > 1) recall(history.index - 1, history.draft);
        else restoreDraft(history.draft);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit({ queue: running && (event.ctrlKey || event.metaKey) });
      return;
    }
    if (event.key === "Escape") {
      if (shell) {
        event.preventDefault();
        leaveShell();
      } else if (history) {
        event.preventDefault();
        restoreDraft(history.draft);
      } else if (running && threadId) {
        event.preventDefault();
        void interrupt(threadId);
      } else if (threadId && sent.length && event.timeStamp - lastEscape.current < DOUBLE_ESCAPE_MS) {
        // W14 回退到更早的消息: a second Esc opens the picker.
        event.preventDefault();
        lastEscape.current = -Infinity;
        setRewinding(0);
      } else {
        // c227f4d5e 11818-11843: an idle Esc leaves the editor.
        lastEscape.current = event.timeStamp;
        el.blur();
      }
    }
  }

  function leaveShell() {
    setShell(false);
    setHistory(null);
    setStatus("聊天模式");
  }

  function recall(index: number, draft: string) {
    setHistory({ index, draft });
    setText(recalled[recalled.length - index].text);
    setStatus(`历史 ${index}/${recalled.length}${draft.trim() ? "，按 ↓ 恢复草稿" : ""}`);
    focusEnd();
  }

  function restoreDraft(draft: string) {
    setHistory(null);
    setText(draft);
    setStatus("");
    focusEnd();
  }

  /** Picker row `index` (newest first) → the confirm dialog, which rewinds and refills the composer. */
  function rewindTo(index: number) {
    const target = sent[sent.length - 1 - index];
    setRewinding(null);
    if (target && threadId) setState({ dialog: { type: "rewind", threadId, turnId: target.turnId, text: target.text } });
  }

  /** W16: with more than one tile, a removal runs as a View Transition (cds-attachment-out). */
  function removeAttachment(id: number) {
    const drop = () => setAttachments((current) => current.filter((a) => a.id !== id));
    if (attachments.length < 2 || reduced || typeof document.startViewTransition !== "function") return drop();
    const root = document.documentElement;
    root.dataset.vt = "attachments";
    document.startViewTransition(() => flushSync(drop)).finished.finally(() => delete root.dataset.vt);
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    if (files.length) {
      event.preventDefault();
      void addFiles(files);
    }
  }

  // Placeholder (cc43287c9 32422-32437, c227f4d5e 8886-8903): a session says how to reach the
  // commands, the new-session page asks for a task (first run: something to build); busy explains
  // Enter / Ctrl+Enter, shortened on a narrow card; shell mode asks for a command.
  const placeholder: ReactNode = shell ? (
    <span>输入 shell 命令</span>
  ) : running ? (
    <>
      <span className="ph-full">
        按 {SEND_KEY} 发送，按 {QUEUE_KEY} 稍后排队
      </span>
      <span className="ph-short">按 {QUEUE_KEY} 排队</span>
    </>
  ) : form === "reply" ? (
    <span>输入 / 使用命令</span>
  ) : (
    <span>{firstRun ? "描述要构建、修改或修复的内容" : "描述任务或提出问题"}</span>
  );

  const sendTip = running ? `发送 · ${SEND_KEY}\n稍后排队 · ${QUEUE_KEY}` : undefined;
  const coarse = matchMedia("(pointer: coarse)").matches;
  const trailing = (
    <span className="composer-trailing" ref={trailingRef}>
      {shell && (
        <span className="shell-pill" data-tip={"作为 shell 命令运行\n不经过沙箱"} aria-hidden="true">
          {shellName}
        </span>
      )}
      {running && hasInput && coarse && (
        <Popover
          open={menu === "send"}
          onClose={() => setMenu(null)}
          placement="top-end"
          anchor={<Button variant="ghost" icon={<ChevronDown size={16} />} label="更多发送选项" aria-expanded={menu === "send"} onClick={() => toggle("send")} />}
        >
          <MenuItem
            icon={<CornerDownLeft size={16} />}
            label="稍后排队"
            onClick={() => {
              setMenu(null);
              void submit({ queue: true });
            }}
          />
          <MenuItem
            icon={<CircleStop size={16} />}
            label="停止"
            onClick={() => {
              setMenu(null);
              if (threadId) void interrupt(threadId);
            }}
          />
        </Popover>
      )}
      <span className="send-slot" data-swapped={swapped || undefined}>
        <Button
          data-on={!showStop || undefined}
          inert={showStop}
          aria-hidden={showStop || undefined}
          aria-busy={sending || undefined}
          variant="ghost"
          icon={sending ? <Spinner size={16} inherit /> : <CornerDownLeft size={16} />}
          label={sending ? "正在发送" : "发送"}
          tip={sendTip}
          kbd={running ? undefined : SEND_KEY}
          disabled={!hasInput || sending}
          onClick={() => void submit()}
        />
        <Button
          data-on={showStop || undefined}
          inert={!showStop}
          aria-hidden={!showStop || undefined}
          variant="ghost"
          icon={<CircleStop size={16} />}
          label="停止"
          kbd="Esc"
          onClick={() => threadId && void interrupt(threadId)}
        />
      </span>
    </span>
  );

  const myVoice = voice.status !== "idle" && voice.threadId === threadId ? voice.status : "idle";
  const modeLabel = mode ? (MODES.find((m) => m.id === mode)?.label ?? "") : (profile ?? "自定义");

  return (
    <fieldset className="composer-wrap" data-form={form}>
      {myVoice === "active" && <VoiceOrb />}
      {form === "home" && (
        <div className="env-row">
          <FolderPill open={menu === "env"} onToggle={() => toggle("env")} onClose={() => setMenu(null)} />
        </div>
      )}
      {form === "reply" && thread && <QueueBar thread={thread} onEdit={takeBack} />}
      <div className="composer" data-shell={shell || undefined} data-multiline={multiline || undefined}>
        {popup === "slash" && (
          <div className="composer-popup" role="listbox" aria-label="命令">
            <div className="menu-section">命令</div>
            {slashMatches.map((command, index) => (
              <button
                key={command.name}
                type="button"
                role="option"
                aria-selected={index === selected}
                className={`popup-item ${index === selected ? "active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setSelected(index)}
                onClick={() => insertCommand(command)}
              >
                <span className="popup-name">/{command.name}</span>
                <span className="popup-desc">{command.description}</span>
              </button>
            ))}
          </div>
        )}
        {popup === "mention" && (
          <div className="composer-popup" data-kind="mention" role="listbox" aria-label="文件">
            {mentionResults.map((file, index) => (
              <button
                key={file.path}
                type="button"
                role="option"
                aria-selected={index === selected}
                className={`popup-item ${index === selected ? "active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setSelected(index)}
                onClick={() => insertMention(file.path)}
              >
                {file.dir ? <Folder size={16} className="popup-icon" /> : <FileText size={16} className="popup-icon" />}
                <span className="popup-name">
                  {Array.from(file.name).map((char, i) => (file.hits.includes(i) ? <b key={i}>{char}</b> : char))}
                </span>
                {relativePath(file.path, cwd) !== file.name && <span className="popup-desc">{relativePath(file.path, cwd)}</span>}
              </button>
            ))}
          </div>
        )}
        {rewinding !== null && (
          <div className="composer-popup" role="listbox" aria-label="回退到更早的消息">
            <div className="menu-section">回退到更早的消息</div>
            {sent
              .slice()
              .reverse()
              .map((message, index) => (
                <button
                  key={`${message.turnId}:${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === rewinding}
                  className={`popup-item ${index === rewinding ? "active" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setRewinding(index)}
                  onClick={() => rewindTo(index)}
                >
                  <span className="popup-key">{index < 9 ? index + 1 : ""}</span>
                  <span className="popup-text">{message.text}</span>
                </button>
              ))}
          </div>
        )}

        {history && (
          <div className="composer-header" aria-hidden="true">
            <span className="tabular">
              历史 {history.index}/{recalled.length}
            </span>
            {history.draft.trim() && (
              <>
                <span>·</span>
                <span>
                  按 <kbd className="kbd">↓</kbd> 恢复草稿
                </span>
              </>
            )}
          </div>
        )}

        {chips > 0 && (
          <div className="attachments">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="attachment" data-tip={attachment.name} style={{ "--vt": `cmp-att-${String(attachment.id).replace(/\D/g, "")}` } as CSSProperties}>
                <img src={attachment.url} alt={attachment.name} className="zoomable" onClick={() => setState({ lightbox: attachment.url })} />
                <button type="button" className="attachment-remove" aria-label={`移除 ${attachment.name}`} data-tip={`移除 ${attachment.name}`} onClick={() => removeAttachment(attachment.id)}>
                  <X size={12} />
                </button>
              </div>
            ))}
            {skills.map((skill) => (
              <Button
                key={skill.path}
                variant="secondary"
                size="xs"
                className="attachment-chip"
                tip="移除技能"
                onClick={() => setSkills((current) => current.filter((s) => s.path !== skill.path))}
              >
                <Sparkles size={14} />
                {skill.interface?.displayName ?? skill.name}
                <X size={12} className="caret" />
              </Button>
            ))}
            {mentions.map((mention) => (
              <Button
                key={mention.path}
                variant="secondary"
                size="xs"
                className="attachment-chip"
                tip="移除"
                onClick={() => setMentions((current) => current.filter((m) => m.path !== mention.path))}
              >
                {mention.path.startsWith("plugin://") ? <Puzzle size={14} /> : <Plug size={14} />}
                {mention.name}
                <X size={12} className="caret" />
              </Button>
            ))}
          </div>
        )}

        <div className="composer-body">
          <div className="composer-editor">
            <textarea
              ref={input}
              className="composer-input"
              value={text}
              rows={1}
              onChange={(event) => {
                setText(event.target.value);
                setCaretAt(event.target.selectionStart);
                setHistory(null);
                setRewinding(null);
              }}
              onSelect={(event) => setCaretAt(event.currentTarget.selectionStart)}
              onBlur={() => setRewinding(null)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onCompositionStart={() => (composing.current = true)}
              onCompositionEnd={(event) => {
                composing.current = false;
                compositionEnd.current = event.timeStamp;
              }}
              aria-label="提示词"
            />
            {!text && placeholder && (
              <span className="composer-placeholder" aria-hidden="true">
                {placeholder}
              </span>
            )}
          </div>
          {trailing}
        </div>

        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      <div className="chin">
        <div className="chin-row" data-size="xs">
          <div className="chin-lead">
            <Popover
              open={menu === "plus"}
              onClose={() => setMenu(null)}
              placement="top-start"
              className="menu-plus"
              anchor={<Button variant="ghost" size="xs" data-touch-size icon={<Plus size={16} />} label="添加" aria-expanded={menu === "plus"} onClick={() => toggle("plus")} />}
            >
              <MenuItem
                icon={<Paperclip size={16} />}
                label="添加图片"
                kbd={FILE_KEY}
                disabled={!acceptsImages || shell}
                onClick={() => {
                  setMenu(null);
                  fileInput.current?.click();
                }}
              />
              <MenuItem
                icon={<SquareSlash size={16} />}
                label="斜杠命令"
                disabled={shell}
                onClick={() => {
                  setMenu(null);
                  // With text in the editor the "/" goes in front of it (c227f4d5e insertSlashCommand).
                  writeAt(text.startsWith("/") ? text : `/${text}`, 1);
                }}
              />
              <ConnectorsEntry threadId={threadId} onClose={() => setMenu(null)} />
              <PluginsEntry onPick={addMention} onClose={() => setMenu(null)} />
              <div onPointerEnter={loadSkills} onFocus={loadSkills}>
                <Submenu icon={<Sparkles size={16} />} label="技能">
                  {skillList === null && <div className="menu-empty">正在读取…</div>}
                  {skillList?.length === 0 && <div className="menu-empty">没有可用的技能</div>}
                  <div className="menu-scroll">
                    {skillList?.map((skill) => (
                      <MenuItem
                        key={skill.path}
                        label={skill.interface?.displayName ?? skill.name}
                        hint={skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description}
                        checked={skills.some((s) => s.path === skill.path)}
                        onClick={() => {
                          setMenu(null);
                          // One skill at a time, as the skill chip is (c227f4d5e 8126-8139).
                          setSkills((current) => (current.some((s) => s.path === skill.path) ? [] : [skill]));
                          input.current?.focus();
                        }}
                      />
                    ))}
                  </div>
                </Submenu>
              </div>
              {memoryOffered && (
                <MenuItem
                  icon={<Brain size={16} />}
                  label="记忆"
                  toggle
                  checked={memoryOn}
                  onClick={() => {
                    setMenu(null);
                    setMemoryMode(threadId, memoryOn ? "disabled" : "enabled").catch(fail("无法更改记忆设置"));
                  }}
                />
              )}
            </Popover>

            {form === "reply" && threadId && voiceAvailable() && (
              <Button
                variant="ghost"
                size="xs"
                data-touch-size
                className="voice-btn"
                icon={<VoiceBars state={myVoice} />}
                label={myVoice === "idle" ? "使用语音模式" : "结束语音模式"}
                aria-pressed={myVoice !== "idle"}
                onClick={() => (myVoice === "idle" ? void startVoice(threadId).catch(() => {}) : void stopVoice())}
              />
            )}

            <Popover
              open={menu === "mode"}
              onClose={() => setMenu(null)}
              placement="top-start"
              className="menu-digits"
              anchor={
                <Button
                  variant="ghost"
                  size="xs"
                  ink2
                  data-touch-size
                  className="mode-trigger"
                  tip={mode === "bypass" || mode === "auto" ? DANGER_TIP : "模式"}
                  kbd={desktop ? "Ctrl+Shift+M" : "Ctrl+Alt+M"}
                  aria-expanded={menu === "mode"}
                  onClick={() => toggle("mode")}
                >
                  <span className="btn-label">{modeLabel}</span>
                </Button>
              }
            >
              <MenuSection title="模式" />
              {modeItems.map((m) => {
                const digit = modeDigits.indexOf(m);
                return (
                  <MenuItem
                    key={m.id}
                    label={
                      <>
                        {m.label}
                        {m.id === defaultMode && <span className="badge badge-2xs model-badge">默认</span>}
                      </>
                    }
                    hint={m.hint}
                    kbd={digit >= 0 ? String(digit + 1) : undefined}
                    checked={mode === m.id}
                    disabled={!modeAllowed(m.id)}
                    onClick={() => pickMode(m.id)}
                  />
                );
              })}
              {profiles.length > 0 && (
                <>
                  <MenuSep />
                  <MenuSection title="权限档" />
                  {profiles.map((p) => (
                    <MenuItem
                      key={p.id}
                      icon={<ShieldCheck size={16} />}
                      label={p.id}
                      hint={p.description ?? undefined}
                      checked={profile === p.id}
                      onClick={() => pick({ planMode: false, permissionProfile: p.id })}
                    />
                  ))}
                </>
              )}
            </Popover>
          </div>

          <div className="chin-trail">
            <Popover
              open={menu === "model"}
              onClose={() => setMenu(null)}
              placement="top-end"
              className="menu-model menu-digits"
              anchor={
                <Button
                  variant="ghost"
                  size="xs"
                  ink2
                  data-touch-size
                  kbd="Ctrl+Shift+I"
                  tip="模型"
                  aria-label={`模型：${modelLabel(effective.model)}${fastOn ? " 快速" : ""}`}
                  aria-expanded={menu === "model"}
                  onClick={() => toggle("model")}
                >
                  <span className="btn-label">
                    {modelLabel(effective.model)}
                    {fastOn && <span className="model-fast"> 快速</span>}
                  </span>
                </Button>
              }
            >
              <div className="menu-scroll">
                {mainModels.map((m, index) => (
                  <MenuItem
                    key={m.id}
                    label={
                      <>
                        {m.displayName}
                        {m.isDefault && <span className="badge badge-2xs model-badge">默认</span>}
                      </>
                    }
                    hint={m.description}
                    kbd={index < 9 && m.id !== model?.id ? String(index + 1) : undefined}
                    checked={m.id === model?.id}
                    onClick={() => pick({ model: m.id })}
                  />
                ))}
                {mainModels.length === 0 && <div className="menu-empty">暂无可用模型</div>}
              </div>
              {hiddenModels.length > 0 && (
                <>
                  <MenuSep />
                  <Submenu label="更多模型">
                    <div className="menu-scroll">
                      {hiddenModels.map((m) => (
                        <MenuItem key={m.id} label={m.displayName} checked={m.id === model?.id} onClick={() => pick({ model: m.id })} />
                      ))}
                    </div>
                  </Submenu>
                </>
              )}
              {fastOffered && (
                <>
                  <MenuSep />
                  <MenuItem label="快速模式" hint={fastTier?.description || undefined} toggle checked={fastOn} value={<MenuSwitch on={fastOn} />} onClick={toggleFast} />
                </>
              )}
            </Popover>

            <EffortControl model={model} effort={effective.effort} open={menu === "effort"} onToggle={() => toggle("effort")} onClose={() => setMenu(null)} onPick={(effort) => override({ effort })} />

            <UsageMeter thread={thread} open={menu === "usage"} onToggle={() => toggle("usage")} onClose={() => setMenu(null)} />
            {fastOffered && <span className="sr-only">{fastOn ? "已开启快速模式" : "已关闭快速模式"}</span>}
          </div>
        </div>
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {shell ? `${shellName} 模式。按 Esc 返回聊天。` : status}
      </span>
      {dragging && <DropScrim label="将文件拖放到此处" />}
    </fieldset>
  );
}
