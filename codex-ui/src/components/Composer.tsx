// The Code composer (Claude Desktop 2.42304.0.0 Code tab; claude.ai audit W3 W4 W5 W12 W14 W17
// W20 W22). Both forms share the card and the chin (c227f4d5e bQ, layout "chin"):
//   [+][voice][mode ▾] ……… [model ▾][effort][usage ring]
// - draft (form "home"): where the session runs sits above the card in the env pill's place
//   (cc43287c9 n5; for Codex the project or working folder), two editor lines over the send key;
// - reply: editor and send on one row, queue bands on top (cf74bc599).
// Busy: Enter steers the running turn, Ctrl+Enter queues. "!" on an empty editor is shell mode.
// Slash commands, @file mentions, images, skills, connector / plugin mentions, page-wide drag
// and drop, per-thread drafts.

import type { Model } from "@protocol/v2/Model";
import type { QueuedSubmission } from "@protocol/v2/QueuedSubmission";
import type { RateLimitWindow } from "@protocol/v2/RateLimitWindow";
import type { SkillMetadata } from "@protocol/v2/SkillMetadata";
import type { UserInput } from "@protocol/v2/UserInput";
import {
  Brain,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  CircleStop,
  Code,
  CornerDownLeft,
  EllipsisVertical,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Hand,
  ImagePlus,
  Pencil,
  Plug,
  Plus,
  Puzzle,
  ScrollText,
  ShieldCheck,
  Sparkles,
  SquareSlash,
  TriangleAlert,
  X,
  Zap,
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
  canSteer,
  chooseProject,
  compactThread,
  connectorMention,
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
  projectFor,
  refreshConfig,
  refreshPermissionProfiles,
  removeQueued,
  reorderQueue,
  runShellCommand,
  searchFiles,
  sendMessage,
  sendQueuedNow,
  setGoal,
  setMemoryMode,
  setOverride,
  supports,
} from "../lib/codex";
import { basename, formatTokens, limitName, relativePath, samePath } from "../lib/format";
import { getState, setState, toast, useStore, type PermissionPreset, type ThreadState } from "../lib/store";
import { startVoice, stopVoice, voiceAvailable, voiceStreams } from "../lib/voice";
import { openSettings } from "./Settings";
import { Button, DropScrim, MenuItem, MenuSection, MenuSep, Popover, Submenu, UsageRing, useReducedMotion } from "./ui";

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
const WARNING_TEXT = "选「最高」时 Codex 会想得更久，用量也比「高」消耗得更快。";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const FIELD_SIZING = CSS.supports("field-sizing", "content");
const APPLE = /Apple/.test(navigator.vendor);
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
/** A trailing CJK or Latin punctuation run is not part of an @ query (RichComposerWithMentions). */
const TRAILING_PUNCT = /[.,;:!?'"、。，；：！？…]+$/;
const HOME_PLACEHOLDERS = ["今天要让 Codex 做什么？", "输入 / 使用命令与技能"];
/** Esc Esc opens the rewind picker when the second press comes this soon (ms). */
const DOUBLE_ESCAPE_MS = 500;
const OTHER_FOLDERS = 6;

interface Attachment {
  id: number;
  name: string;
  url: string;
}

interface SlashCommand {
  name: string;
  description: string;
  run(): void;
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

/** Replace the open draft (starters, 「设定目标」) and focus the editor. */
export function setComposerDraft(text: string) {
  window.dispatchEvent(new CustomEvent("composer-draft", { detail: text }));
}

/** Append to the end of the open draft and focus the editor (quote / copy into the composer). */
export function appendComposerText(text: string) {
  window.dispatchEvent(new CustomEvent("composer-append", { detail: text }));
}

// ---------------------------------------------------------------------------
// Modes (shared-8 kL): Manual / Accept edits / Plan / Auto / Bypass permissions mapped onto
// Codex presets, the plan collaboration mode and the auto-review approvals reviewer.

type ModeId = "manual" | "acceptEdits" | "plan" | "auto" | "bypass";

const MODES: { id: ModeId; label: string; hint: string; icon: ReactNode }[] = [
  { id: "manual", label: "手动", hint: "修改前总是先问你", icon: <Hand size={16} /> },
  { id: "acceptEdits", label: "接受编辑", hint: "自动接受工作区内的文件修改", icon: <Code size={16} /> },
  { id: "plan", label: "计划", hint: "先制定计划，再动手修改", icon: <ScrollText size={16} /> },
  { id: "auto", label: "自动", hint: "由 Codex 自动审查并决定是否批准", icon: <Zap size={16} /> },
  { id: "bypass", label: "完全访问", hint: "不经询问接受所有权限", icon: <TriangleAlert size={16} /> },
];

const MODE_PRESET: Record<Exclude<ModeId, "plan">, PermissionPreset> = {
  manual: "read-only",
  acceptEdits: "auto",
  auto: "auto",
  bypass: "full-access",
};

function modeOf(s: Settings): ModeId | null {
  if (s.planMode) return "plan";
  if (s.permissionProfile) return null;
  if (s.permission === "full-access") return "bypass";
  if (s.reviewer === "auto_review") return "auto";
  if (s.permission === "auto") return "acceptEdits";
  if (s.permission === "read-only") return "manual";
  return null;
}

// ---------------------------------------------------------------------------
// Queue bands (cf74bc599): one queued message is a band with send now / edit / remove; several
// fold into one band (「下一条：…」) that opens to rows with a grip and a menu.

function QueueBar({ thread, onEdit }: { thread: ThreadState; onEdit(text: string): void }) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<QueuedSubmission | null>(null);
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

  // steerHeadOnly: a turn that cannot be steered is stopped instead.
  const hint = activeTurn(thread) && !canSteer(thread) ? "会停止 Codex 当前的回复。" : "Codex 会在下一步读到这条消息。";
  const fail = (title: string) => (error: unknown) => toast("error", title, errorMessage(error));
  const preview = (q: QueuedSubmission) => inputText(q.input) || "（图片）";
  const sendNow = (q: QueuedSubmission) => {
    if (queue.length === 1) setLeaving(q);
    sendQueuedNow(id, q.id).catch((error) => {
      setLeaving(null);
      fail("发送失败")(error);
    });
  };
  const remove = (qid: string) => removeQueued(id, qid).catch(fail("移除失败"));
  const edit = (q: QueuedSubmission) => {
    onEdit(inputText(q.input));
    void remove(q.id);
  };
  const drop = (target: string) => {
    if (!dragging || dragging === target) return;
    const ids = queue.map((q) => q.id).filter((x) => x !== dragging);
    ids.splice(ids.indexOf(target), 0, dragging);
    reorderQueue(id, ids).catch(fail("调整顺序失败"));
  };

  const band = (q: QueuedSubmission, exiting = false) => (
    <div className="queue" data-text-size>
      <div className="queue-band" data-leaving={exiting || undefined} onAnimationEnd={exiting ? () => setLeaving(null) : undefined}>
        <span className="queue-count">1 条消息排队中</span>
        <span className="queue-preview">{preview(q)}</span>
        {!exiting && (
          <span className="queue-actions">
            <Button variant="ghost" muted icon={<CornerDownLeft size={16} />} label="立即发送" aria-describedby={hintId} onClick={() => sendNow(q)} />
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
          <span className="queue-preview">下一条：{preview(queue[0])}</span>
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
          {queue.map((q) => (
            <div
              key={q.id}
              role="listitem"
              className="queue-row"
              data-dragging={dragging === q.id || undefined}
              data-drop={(over === q.id && dragging !== q.id) || undefined}
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
              <span className="queue-text">{preview(q)}</span>
              <span className="queue-row-actions">
                <span
                  className="queue-grip"
                  role="img"
                  aria-label="拖动调整顺序"
                  data-tip="拖动调整顺序"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    setDragging(q.id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                >
                  <GripVertical size={14} />
                </span>
                <Popover
                  open={menu === q.id}
                  onClose={() => setMenu(null)}
                  placement="top-end"
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
                  <MenuItem
                    icon={<CornerDownLeft size={16} />}
                    label="立即发送"
                    hint={hint}
                    onClick={() => {
                      setMenu(null);
                      sendNow(q);
                    }}
                  />
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
          ))}
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
// Draft: where the session runs (the env pill's place): a Codex project or the working folder.

function EnvPill({ open, onToggle, onClose }: { open: boolean; onToggle(): void; onClose(): void }) {
  const cwd = useStore((s) => s.prefs.cwd);
  const projectId = useStore((s) => s.prefs.projectId);
  const projects = useStore((s) => s.projects);
  const threads = useStore((s) => s.threads);
  const recent = useMemo(() => {
    const seen = new Map<string, number>();
    for (const { meta } of Object.values(threads)) seen.set(meta.cwd, Math.max(seen.get(meta.cwd) ?? 0, meta.recencyAt ?? meta.updatedAt));
    return [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([path]) => path)
      .slice(0, OTHER_FOLDERS);
  }, [threads]);
  const project = projects.find((p) => p.id === projectId) ?? projectFor(cwd);
  const label = project?.name ?? (basename(cwd) || "选择文件夹");

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
  const useProject = (id: string) => {
    onClose();
    chooseProject(id);
    refresh();
  };
  const makeProject = async () => {
    onClose();
    try {
      const created = await createProject(basename(cwd), [cwd]);
      if (created) chooseProject(created.id);
      else toast("warning", "当前 Codex 版本不支持项目");
    } catch (error) {
      toast("error", "新建项目失败", errorMessage(error));
    }
  };

  return (
    <Popover
      open={open}
      onClose={onClose}
      placement="bottom-start"
      className="menu-wide"
      anchor={
        <button type="button" className="env-pill" data-tip={`Codex 运行的位置\n${cwd || "尚未选择文件夹"}`} aria-expanded={open} onClick={onToggle}>
          <Folder size={16} />
          <span className="env-pill-label">{label}</span>
        </button>
      }
    >
      {projects.length > 0 && (
        <>
          <MenuSection title="项目" />
          {projects.map((p) => (
            <MenuItem key={p.id} icon={<Folder size={16} />} label={p.name} hint={p.roots[0]?.path} checked={project?.id === p.id} onClick={() => useProject(p.id)} />
          ))}
          <MenuSep />
        </>
      )}
      <MenuSection title="最近的文件夹" />
      {recent.map((path) => (
        <MenuItem key={path} icon={<Folder size={16} />} label={basename(path)} hint={path} checked={!project && samePath(path, cwd)} onClick={() => useFolder(path)} />
      ))}
      {recent.length === 0 && <div className="menu-empty">暂无记录</div>}
      <MenuSep />
      <MenuItem
        icon={<FolderOpen size={16} />}
        label="选择其他文件夹…"
        onClick={() => {
          onClose();
          setState({ dialog: { type: "folder" } });
        }}
      />
      {!project && cwd && supports("project/create") && <MenuItem icon={<FolderPlus size={16} />} label="把这个文件夹设为项目" onClick={() => void makeProject()} />}
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
  placement,
  onToggle,
  onClose,
  onPick,
}: {
  model: Model | undefined;
  effort: string | null;
  open: boolean;
  placement: "bottom-end" | "top-end";
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
      placement={placement}
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
          aria-label={`努力程度：${label}${warning ? " 用量更大" : ""}`}
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
// Usage ring (c5afb3665 usage-ring-composer): the busiest rate-limit window, or the context
// window when the account reports no limits; the popover lists both.

function UsageMeter({ thread, open, onToggle, onClose, placement }: { thread: ThreadState | undefined; open: boolean; onToggle(): void; onClose(): void; placement: "bottom-end" | "top-end" }) {
  const rateLimits = useStore((s) => s.rateLimits);
  const autoCompact = useStore((s) => s.config?.model_auto_compact_token_limit);
  const snapshot = rateLimits?.rateLimits;
  const windows = [snapshot?.primary, snapshot?.secondary].filter((w): w is RateLimitWindow => !!w);
  const top = windows.reduce<RateLimitWindow | null>((a, w) => (!a || w.usedPercent > a.usedPercent ? w : a), null);
  const usage = thread?.tokenUsage;
  const contextWindow = usage?.modelContextWindow ?? null;
  const used = usage?.last.totalTokens ?? 0;
  const context = contextWindow ? Math.min(100, (used / contextWindow) * 100) : null;
  const value = top ? top.usedPercent : context;
  if (value === null) return null;
  const running = !!activeTurn(thread);
  const percent = Math.round(value);
  const motionKey = top ? `${snapshot?.limitId ?? "codex"}:${top.resetsAt ?? top.windowDurationMins ?? 0}` : thread?.meta.id;
  const left = autoCompact ? Number(autoCompact) - used : null;
  const resets = (w: RateLimitWindow) =>
    w.resetsAt ? `${new Date(w.resetsAt * 1000).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 重置` : null;
  return (
    <Popover
      open={open}
      onClose={onClose}
      placement={placement}
      className="usage-pop"
      anchor={
        <Button
          variant="ghost"
          size="xs"
          data-touch-size
          icon={<UsageRing value={value} size={14} stroke={2} motionKey={motionKey} streaming={running} />}
          label={top ? `查看用量限制 · 已用 ${percent}%` : `上下文窗口 · 已用 ${percent}%`}
          aria-expanded={open}
          onClick={onToggle}
        />
      }
    >
      {windows.length > 0 && <p className="usage-title">你的用量限制</p>}
      {windows.map((w) => (
        <div key={w.windowDurationMins ?? 0} className="usage-row">
          <span>{limitName(w)}</span>
          <span className="tabular">{Math.round(w.usedPercent)}%</span>
          <span className="usage-bar" style={{ "--pct": Math.min(100, w.usedPercent) } as CSSProperties}>
            <span />
          </span>
          {resets(w) && <span className="muted">{resets(w)}</span>}
        </div>
      ))}
      {context !== null && contextWindow && (
        <div className="usage-row">
          <span>上下文窗口</span>
          <span className="tabular">
            {formatTokens(used)} / {formatTokens(contextWindow)}
          </span>
          <span className="usage-bar" style={{ "--pct": context } as CSSProperties}>
            <span />
          </span>
          {left !== null && <span className="muted">{left <= contextWindow * 0.05 ? "即将自动压缩" : `距自动压缩还有 ${formatTokens(left)}`}</span>}
        </div>
      )}
      <div className="usage-foot">
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            onClose();
            openSettings("account");
          }}
        >
          在设置中查看用量
        </button>
        {thread && context !== null && (
          <Button
            size="xs"
            disabled={running}
            onClick={() => {
              onClose();
              compactThread(thread.meta.id).catch((error) => toast("error", "压缩失败", errorMessage(error)));
            }}
          >
            压缩
          </Button>
        )}
      </div>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Voice mode (W22, thread/realtime/* over WebRTC via lib/voice.ts): six bars idle, three dots
// while connecting, three live bars (200–4000 Hz in three log bands) while active; the orb is a
// 2D-canvas stand-in for the WebGL blob behind the card.

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
      const level = Math.max(mic ? bandLevel(mic, data[0], lo, hi) : 0, speaker ? bandLevel(speaker, data[1], lo, hi) : 0);
      const h = 6 + 10 * Math.min(1, Math.max(0, (level - floor) * gain));
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

export function Composer({ threadId, form, autoFocus }: { threadId: string | null; form: "home" | "reply"; autoFocus?: boolean }) {
  const thread = useStore((s) => (threadId ? s.threads[threadId] : undefined));
  const models = useStore((s) => s.models);
  const hiddenModels = useStore((s) => s.hiddenModels);
  const modes = useStore((s) => s.modes);
  const features = useStore((s) => s.features);
  const connectors = useStore((s) => s.connectors);
  const plugins = useStore((s) => s.plugins);
  const skillsRev = useStore((s) => s.skillsRev);
  const prefs = useStore((s) => s.prefs);
  const voice = useStore((s) => s.voice);
  const platform = useStore((s) => s.server.info?.platformOs);
  const profiles = useStore((s) => s.permissionProfiles);
  useStore((s) => s.config);
  useStore((s) => s.requirements);
  const cwd = useStore((s) => (thread ? (thread.settings?.cwd ?? thread.meta.cwd) : s.prefs.cwd));
  const draftKey = `codex-ui:draft:${threadId ?? "new"}`;
  const [text, setText] = useState(() => readDraft(draftKey));
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [skills, setSkills] = useState<SkillMetadata[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [skillList, setSkillList] = useState<SkillMetadata[] | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [selected, setSelected] = useState(0);
  const [mentionResults, setMentionResults] = useState<{ path: string; name: string; dir: boolean }[]>([]);
  const [sending, setSending] = useState(false);
  const [shell, setShell] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("");
  const [chinOpen, setChinOpen] = useState(form === "reply");
  const [ph, setPh] = useState({ index: 0, prev: -1 });
  const [swapped, setSwapped] = useState(false);
  const [history, setHistory] = useState<{ index: number; draft: string } | null>(null);
  const [rewinding, setRewinding] = useState<number | null>(null);
  const lastEscape = useRef(-Infinity);
  const reduced = useReducedMotion();
  const input = useRef<HTMLTextAreaElement>(null);
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
  const shellName = platform === "windows" ? "PowerShell" : "bash";
  const hasInput = !!text.trim() || attachments.length > 0 || skills.length > 0 || mentions.length > 0;
  const showStop = running && !hasInput;
  const mode = modeOf(effective);
  const profile = effective.permissionProfile;
  const toggle = (next: Exclude<Menu, null>) => setMenu((current) => (current === next ? null : next));
  const placeEnd = form === "home" ? "bottom-end" : "top-end";
  const placeStart = form === "home" ? "bottom-start" : "top-start";
  const modeItems = MODES.filter((m) => (m.id === "plan" ? planAvailable : m.id === "auto" ? autoAvailable || mode === "auto" : true));
  const mainModels = model && !models.includes(model) ? [model, ...models] : models;
  const memoryOffered = memoriesEnabled();
  const memoryOn = threadId ? (thread?.memory ?? (memorySettings().generate ? "enabled" : "disabled")) === "enabled" : prefs.memory && memorySettings().generate;
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

  useEffect(() => saveDraft(draftKey, text), [draftKey, text]);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus, threadId]);

  // The draft chin unfolds once the page is up (W3: 280ms reveal).
  useEffect(() => {
    if (chinOpen) return;
    const frame = requestAnimationFrame(() => setChinOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [chinOpen]);

  // Draft placeholder: the two lines take turns every 5s.
  const rotating = form === "home" && !running && !shell && !text;
  useEffect(() => {
    if (!rotating) return;
    const timer = setInterval(() => setPh((p) => ({ index: (p.index + 1) % HOME_PLACEHOLDERS.length, prev: p.index })), 5000);
    return () => clearInterval(timer);
  }, [rotating]);

  // Send and stop cross-fade only after the first swap (not on mount).
  const stopShown = useRef(showStop);
  useEffect(() => {
    if (stopShown.current !== showStop) setSwapped(true);
    stopShown.current = showStop;
  }, [showStop]);

  const focusEnd = () =>
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });

  // Starters and 「设定目标」 replace the draft; quotes from the transcript append to it.
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
  const toggleFast = () => {
    override({ serviceTier: fastOn ? "default" : "priority" });
    setStatus(fastOn ? "已关闭快速模式" : "已开启快速模式");
  };

  // Global keys while this composer is on screen (W14 shortcut table, desktop column).
  const keys = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    // Digits 1–9 pick within the open model or mode menu (shared-7 shortcuts).
    if (!mod && !event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key) && (menu === "model" || menu === "mode")) {
      const index = Number(event.key) - 1;
      if (menu === "model" && mainModels[index]) pick({ model: mainModels[index].id });
      else if (menu === "mode" && modeItems[index] && (modeItems[index].id === "plan" || presetAllowed(MODE_PRESET[modeItems[index].id as Exclude<ModeId, "plan">]))) pickMode(modeItems[index].id);
      else return;
      event.preventDefault();
      return;
    }
    if (mod && !event.shiftKey && !event.altKey && key === "u") {
      event.preventDefault();
      fileInput.current?.click();
      return;
    }
    const desktop = "codexDesktop" in window;
    const shortcut =
      mod && event.shiftKey && !event.altKey && key === "i"
        ? "model"
        : mod && event.shiftKey && !event.altKey && key === "e" && (model?.supportedReasoningEfforts.length ?? 0) > 1
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
      } else toggle(shortcut);
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

  // Slash command palette is active while the first token starts with "/".
  const slashQuery = shell ? undefined : /^\/(\S*)$/.exec(text)?.[1];
  const commands = useMemo<SlashCommand[]>(
    () => [
      { name: "new", description: "开始新的会话", run: newChat },
      { name: "model", description: "切换模型", run: () => setMenu("model") },
      { name: "permissions", description: "切换模式与权限", run: () => setMenu("mode") },
      ...(planAvailable
        ? [{ name: "plan", description: "切换计划模式（先规划、后执行）", run: () => setOverride(threadId, { planMode: !effective.planMode }) }]
        : []),
      ...(goals
        ? [
            {
              name: "goal",
              description: "设定目标：Codex 会持续推进，直到完成",
              run: () => {
                setText("/goal ");
                input.current?.focus();
              },
            },
          ]
        : []),
      { name: "review", description: "审查代码改动", run: () => setState({ dialog: { type: "review", threadId } }) },
      { name: "init", description: "为仓库生成 AGENTS.md 贡献指南", run: () => void submit({}, initPrompt) },
      {
        name: "compact",
        description: "压缩上下文以释放空间",
        needsThread: true,
        run: () => threadId && compactThread(threadId).catch((error) => toast("error", "压缩失败", errorMessage(error))),
      },
      {
        name: "fork",
        description: "从当前会话创建分支会话",
        needsThread: true,
        run: () => threadId && forkThread(threadId).catch((error) => toast("error", "分支失败", errorMessage(error))),
      },
      { name: "rename", description: "重命名当前会话", needsThread: true, run: () => threadId && setState({ dialog: { type: "rename", threadId } }) },
      { name: "diff", description: "查看本轮改动", needsThread: true, run: () => setState({ panel: "diff" }) },
      { name: "status", description: "查看会话详情", needsThread: true, run: () => setState({ panel: "details" }) },
      { name: "usage", description: "查看用量统计", run: () => openSettings("account") },
      { name: "mcp", description: "查看 MCP 服务器", run: () => openSettings("mcp") },
      { name: "skills", description: "管理技能", run: () => openSettings("skills") },
      { name: "plugins", description: "管理插件", run: () => openSettings("plugins") },
      { name: "hooks", description: "管理 Hooks", run: () => openSettings("hooks") },
      { name: "memory", description: "管理记忆", run: () => openSettings("memory") },
      { name: "settings", description: "打开设置", run: () => openSettings("general") },
      { name: "logout", description: "退出登录", run: () => void logout().catch((error) => toast("error", "退出失败", errorMessage(error))) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threadId, planAvailable, goals, effective.planMode],
  );
  const slashMatches =
    slashQuery === undefined ? [] : commands.filter((c) => c.name.startsWith(slashQuery.toLowerCase()) && (!c.needsThread || threadId));

  // @mention: the token right before the caret, without trailing punctuation.
  const mentionQuery = useMemo(() => {
    if (shell) return undefined;
    const caret = input.current?.selectionStart ?? text.length;
    return /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))?.[1].replace(TRAILING_PUNCT, "");
  }, [text, shell]);

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
              .map((f) => ({ path: f.path, name: f.file_name, dir: f.match_type === "directory" })),
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
      toast("info", `已处于 ${shellName} 模式，没有添加任何内容`, "在空输入框中按 Backspace 返回对话后再试。");
      return;
    }
    if (!acceptsImages) {
      toast("warning", "当前模型不支持图片");
      return;
    }
    const skipped: string[] = [];
    for (const file of list) {
      if (!IMAGE_TYPES.includes(file.type)) {
        skipped.push(file.name);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast("warning", `${file.name} 超过 20 MB，已忽略`);
        continue;
      }
      const url = await readAsDataUrl(file);
      setAttachments((current) => [...current, { id: Date.now() + Math.random(), name: file.name || "粘贴的图片", url }]);
    }
    if (skipped.length) toast("warning", "Codex 只能附加 PNG、JPEG、GIF 或 WebP 图片", skipped.join("、"));
  }
  addFilesRef.current = (files) => void addFiles(files);

  function runCommand(command: SlashCommand) {
    setText("");
    command.run();
  }

  function insertMention(path: string) {
    const caret = input.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([^\s@]*)$/, "");
    const relative = relativePath(path, cwd);
    setText(`${before}${relative.includes(" ") ? `"${relative}"` : relative} ${text.slice(caret)}`);
    requestAnimationFrame(() => input.current?.focus());
  }

  /** Connector / plugin from the 「+」 menu: the mention rides with the message, `@名称` goes in the text. */
  function addMention(mention: Mention) {
    setMenu(null);
    setMentions((current) => (current.some((m) => m.path === mention.path) ? current : [...current, mention]));
    setText((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}@${mention.name} `);
    focusEnd();
  }

  async function submit(opts: { queue?: boolean } = {}, override?: string) {
    const body = (override ?? text).trim();
    if (sending) return;
    if (!override && shell) {
      if (!body) return;
      setSending(true);
      try {
        await runShellCommand(threadId, body);
        setText("");
        setHistory(null);
      } catch (error) {
        toast("error", "命令没有运行", errorMessage(error));
      } finally {
        setSending(false);
        input.current?.focus();
      }
      return;
    }
    if (!body && attachments.length === 0 && skills.length === 0 && mentions.length === 0) return;
    setSending(true);
    try {
      const objective = goals && !override ? /^\/goal\s+([\s\S]+)$/.exec(body)?.[1].trim() : undefined;
      if (objective) {
        await setGoal(threadId, objective);
        toast("success", "已设定目标", objective);
      } else {
        const inputs: UserInput[] = [
          ...attachments.map((a): UserInput => ({ type: "image", url: a.url })),
          ...skills.map((skill): UserInput => ({ type: "skill", name: skill.name, path: skill.path })),
          ...mentions,
        ];
        if (body) inputs.push({ type: "text", text: body, text_elements: [] });
        await sendMessage(threadId, inputs, opts);
      }
      if (!override) {
        setText("");
        setHistory(null);
        setAttachments([]);
        setSkills([]);
        setMentions([]);
      }
    } catch (error) {
      toast("error", opts.queue ? "加入队列失败" : "发送失败", errorMessage(error));
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
        if (popup === "slash") runCommand(slashMatches[selected]);
        else insertMention(mentionResults[selected].path);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setText(popup === "slash" ? "" : text.replace(/@([^\s@]*)$/, ""));
        return;
      }
    }
    // Shell mode (c227f4d5e Zi): "!" on an empty editor turns it on and is swallowed;
    // Backspace on the empty editor or Esc turns it off.
    if (event.key === "!" && !text && !shell && !attachments.length && !skills.length && !mentions.length) {
      event.preventDefault();
      setShell(true);
      return;
    }
    if (shell && event.key === "Backspace" && !text) {
      event.preventDefault();
      setShell(false);
      return;
    }
    // History (c227f4d5e): ↑ with the caret on the first line recalls this session's earlier
    // prompts, newest first; ↓ on the last line walks back and at the end restores the draft.
    const el = event.currentTarget;
    if (!shell && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && el.selectionStart === el.selectionEnd) {
      if (event.key === "ArrowUp" && !text.slice(0, el.selectionStart).includes("\n") && (history?.index ?? 0) < sent.length) {
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
        setShell(false);
      } else if (history) {
        event.preventDefault();
        restoreDraft(history.draft);
      } else if (running && threadId) {
        event.preventDefault();
        void interrupt(threadId);
      } else if (threadId && sent.length) {
        // W14 「回退到更早的消息」: a second Esc on the idle composer opens the picker.
        if (event.timeStamp - lastEscape.current < DOUBLE_ESCAPE_MS) {
          event.preventDefault();
          lastEscape.current = -Infinity;
          setRewinding(0);
        } else lastEscape.current = event.timeStamp;
      }
    }
  }

  function recall(index: number, draft: string) {
    setHistory({ index, draft });
    setText(sent[sent.length - index].text);
    setStatus(`历史 ${index}/${sent.length}${draft.trim() ? "，按 ↓ 恢复草稿" : ""}`);
    requestAnimationFrame(() => input.current?.setSelectionRange(0, 0));
  }

  function restoreDraft(draft: string) {
    setHistory(null);
    setText(draft);
    setStatus("");
    focusEnd();
  }

  /** Picker row `index` (newest first) → the confirm dialog, which rewinds and refills the composer. */
  function rewindTo(index: number) {
    const pick = sent[sent.length - 1 - index];
    setRewinding(null);
    if (pick && threadId) setState({ dialog: { type: "rewind", threadId, turnId: pick.turnId, text: pick.text } });
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

  // Placeholder: draft lines rotate; busy explains Enter / Ctrl+Enter; shell mode has none.
  const placeholder: ReactNode = shell ? null : running ? (
    <>
      <span className="ph-full">Enter 发送，{MOD}+Enter 加入队列</span>
      <span className="ph-short">{MOD}+Enter 加入队列</span>
    </>
  ) : form === "reply" ? (
    <span>回复 Codex</span>
  ) : (
    HOME_PLACEHOLDERS.map((line, index) =>
      index === ph.index || (!reduced && index === ph.prev) ? (
        <span key={index} data-entering={(index === ph.index && ph.prev >= 0) || undefined} data-leaving={(!reduced && index === ph.prev) || undefined}>
          {line}
        </span>
      ) : null,
    )
  );

  const sendTip = running ? `发送 · Enter\n加入队列 · ${MOD}+Enter` : undefined;
  const trailing = (
    <span className="composer-trailing">
      {shell && (
        <span className="shell-pill" title="作为 Shell 命令运行（不经沙箱）" aria-hidden="true">
          {shellName}
        </span>
      )}
      {running && hasInput && matchMedia("(pointer: coarse)").matches && (
        <Popover
          open={menu === "send"}
          onClose={() => setMenu(null)}
          placement="top-end"
          anchor={<Button variant="ghost" icon={<ChevronDown size={16} />} label="更多发送选项" aria-expanded={menu === "send"} onClick={() => toggle("send")} />}
        >
          <MenuItem
            icon={<CornerDownLeft size={16} />}
            label="加入队列"
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
          variant="ghost"
          icon={<CornerDownLeft size={20} />}
          label="发送"
          tip={sendTip}
          kbd={running ? undefined : "Enter"}
          disabled={!hasInput || sending}
          onClick={() => void submit()}
        />
        <Button
          data-on={showStop || undefined}
          inert={!showStop}
          aria-hidden={!showStop || undefined}
          variant="ghost"
          icon={<CircleStop size={20} />}
          label="停止"
          kbd="Esc"
          onClick={() => threadId && void interrupt(threadId)}
        />
      </span>
    </span>
  );

  const myVoice = voice.status !== "idle" && voice.threadId === threadId ? voice.status : "idle";

  return (
    <fieldset className="composer-wrap" data-form={form}>
      {myVoice === "active" && <VoiceOrb />}
      {form === "home" && (
        <div className="env-row">
          <EnvPill open={menu === "env"} onToggle={() => toggle("env")} onClose={() => setMenu(null)} />
        </div>
      )}
      {form === "reply" && thread && (
        <QueueBar
          thread={thread}
          onEdit={(value) => {
            setText((current) => (current ? `${current}\n${value}` : value));
            focusEnd();
          }}
        />
      )}
      <div className="composer" data-shell={shell || undefined}>
        {popup === "slash" && (
          <div className="composer-popup" role="listbox">
            <div className="menu-section">命令</div>
            {slashMatches.map((command, index) => (
              <button
                key={command.name}
                type="button"
                role="option"
                aria-selected={index === selected}
                className={`popup-item ${index === selected ? "active" : ""}`}
                onMouseEnter={() => setSelected(index)}
                onClick={() => runCommand(command)}
              >
                <span className="popup-name">/{command.name}</span>
                <span className="popup-desc">{command.description}</span>
              </button>
            ))}
          </div>
        )}
        {popup === "mention" && (
          <div className="composer-popup" role="listbox">
            <div className="menu-section">文件</div>
            {mentionResults.map((file, index) => (
              <button
                key={file.path}
                type="button"
                role="option"
                aria-selected={index === selected}
                className={`popup-item ${index === selected ? "active" : ""}`}
                onMouseEnter={() => setSelected(index)}
                onClick={() => insertMention(file.path)}
              >
                {file.dir ? <Folder size={16} className="popup-icon" /> : <FileText size={16} className="popup-icon" />}
                <span className="popup-name">{file.name}</span>
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
              历史 {history.index}/{sent.length}
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

        {(attachments.length > 0 || skills.length > 0 || mentions.length > 0) && (
          <div className="attachments">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="attachment" data-tip={attachment.name} style={{ "--vt": `cmp-att-${String(attachment.id).replace(/\D/g, "")}` } as CSSProperties}>
                <img src={attachment.url} alt={attachment.name} className="zoomable" onClick={() => setState({ lightbox: attachment.url })} />
                <button
                  type="button"
                  className="attachment-remove"
                  aria-label="移除附件"
                  onClick={() => removeAttachment(attachment.id)}
                >
                  <X size={11} />
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
              rows={form === "home" ? 2 : 1}
              onChange={(event) => {
                setText(event.target.value);
                setHistory(null);
                setRewinding(null);
              }}
              onBlur={() => setRewinding(null)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onCompositionStart={() => (composing.current = true)}
              onCompositionEnd={(event) => {
                composing.current = false;
                compositionEnd.current = event.timeStamp;
              }}
              aria-label={shell ? `${shellName} 命令` : "消息输入框"}
            />
            {!text && placeholder && (
              <span className="composer-placeholder" aria-hidden="true">
                {placeholder}
              </span>
            )}
          </div>
          {form === "reply" && trailing}
        </div>

        {form === "home" && <div className="composer-actions">{trailing}</div>}

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

      <div className="chin" data-open={chinOpen || undefined} aria-hidden={!chinOpen || undefined}>
        <div className="chin-grid">
          <div className="chin-clip">
            <div className="chin-row" data-size="xs">
              <div className="chin-lead">
                <Popover
                  open={menu === "plus"}
                  onClose={() => setMenu(null)}
                  placement={placeStart}
                  className="menu-plus"
                  anchor={
                    <Button variant="ghost" size="xs" data-touch-size icon={<Plus size={16} />} label="添加文件等" aria-expanded={menu === "plus"} onClick={() => toggle("plus")} />
                  }
                >
                  <MenuItem
                    icon={<ImagePlus size={16} />}
                    label="添加图片"
                    kbd={`${MOD}+U`}
                    disabled={!acceptsImages || shell}
                    onClick={() => {
                      setMenu(null);
                      fileInput.current?.click();
                    }}
                  />
                  <MenuItem
                    icon={<SquareSlash size={16} />}
                    label="斜杠命令"
                    kbd="/"
                    disabled={!!text || shell}
                    onClick={() => {
                      setMenu(null);
                      setText("/");
                      focusEnd();
                    }}
                  />
                  <MenuSep />
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
                              setSkills((current) => (current.some((s) => s.path === skill.path) ? current.filter((s) => s.path !== skill.path) : [...current, skill]));
                              input.current?.focus();
                            }}
                          />
                        ))}
                      </div>
                    </Submenu>
                  </div>
                  {connectors?.length !== 0 && (
                    <Submenu icon={<Plug size={16} />} label="连接器">
                      {connectors === null && <div className="menu-empty">正在读取…</div>}
                      <div className="menu-scroll">
                        {connectors?.map((connector) => {
                          const icon = document.documentElement.classList.contains("dark") ? (connector.iconUrlDark ?? connector.iconUrl) : connector.iconUrl;
                          return (
                            <MenuItem
                              key={connector.id}
                              icon={icon ? <img className="mention-icon" src={icon} alt="" /> : <Plug size={16} />}
                              label={connector.name}
                              hint={!connector.enabled ? "已停用" : !connector.callable ? "暂时无法使用" : (connector.description ?? undefined)}
                              disabled={!connector.enabled || !connector.callable}
                              onClick={() => addMention(connectorMention(connector))}
                            />
                          );
                        })}
                      </div>
                    </Submenu>
                  )}
                  {plugins?.some((p) => p.installed && p.enabled) !== false && (
                    <Submenu icon={<Puzzle size={16} />} label="插件">
                      {plugins === null && <div className="menu-empty">正在读取…</div>}
                      <div className="menu-scroll">
                        {plugins
                          ?.filter((p) => p.installed && p.enabled)
                          .map((plugin) => (
                            <MenuItem
                              key={plugin.id}
                              icon={plugin.interface?.composerIconUrl ? <img className="mention-icon" src={plugin.interface.composerIconUrl} alt="" /> : <Puzzle size={16} />}
                              label={plugin.interface?.displayName ?? plugin.name}
                              hint={plugin.interface?.shortDescription ?? undefined}
                              onClick={() => addMention(pluginMention(plugin))}
                            />
                          ))}
                      </div>
                    </Submenu>
                  )}
                  {memoryOffered && (
                    <>
                      <MenuSep />
                      <MenuItem
                        icon={<Brain size={16} />}
                        label="记忆"
                        toggle
                        checked={memoryOn}
                        onClick={() => {
                          setMenu(null);
                          setMemoryMode(threadId, memoryOn ? "disabled" : "enabled").catch((error) => toast("error", "无法更改记忆设置", errorMessage(error)));
                        }}
                      />
                    </>
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
                  placement={placeStart}
                  className="menu-digits"
                  anchor={
                    <Button
                      variant="ghost"
                      size="xs"
                      ink2
                      data-touch-size
                      className={mode === "bypass" ? "chin-warn" : ""}
                      tip={mode === "bypass" ? "Codex 可以不经询问修改或删除文件" : "模式"}
                      kbd="Ctrl+Alt+M"
                      aria-expanded={menu === "mode"}
                      onClick={() => toggle("mode")}
                    >
                      <span className="label-stack">
                        {modeItems.map((m) => (
                          <span key={m.id} data-on={m.id === mode || undefined} aria-hidden={m.id !== mode || undefined}>
                            {m.label}
                          </span>
                        ))}
                        <span data-on={mode === null || undefined} aria-hidden={mode !== null || undefined}>
                          {profile ?? "自定义"}
                        </span>
                      </span>
                      <ChevronDown size={12} className="caret" />
                    </Button>
                  }
                >
                  <MenuSection title="模式" />
                  {modeItems.map((m, index) => {
                    const allowed = m.id === "plan" || presetAllowed(MODE_PRESET[m.id as Exclude<ModeId, "plan">]);
                    return (
                      <MenuItem
                        key={m.id}
                        icon={m.id === "bypass" ? <span className="menu-warn">{m.icon}</span> : m.icon}
                        label={m.id === "bypass" ? <span className="menu-warn">{m.label}</span> : m.label}
                        hint={allowed ? m.hint : "组织策略不允许使用此模式"}
                        kbd={String(index + 1)}
                        checked={mode === m.id}
                        disabled={!allowed}
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
                  placement={placeEnd}
                  className="menu-model menu-digits"
                  anchor={
                    <Button variant="ghost" size="xs" ink2 data-touch-size kbd="Ctrl+Shift+I" tip="模型" aria-expanded={menu === "model"} onClick={() => toggle("model")}>
                      <span className="btn-label">{modelLabel(effective.model)}</span>
                      <ChevronDown size={12} className="caret" />
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
                        kbd={index < 9 ? String(index + 1) : undefined}
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
                            <MenuItem key={m.id} label={m.displayName} hint={m.description} checked={m.id === model?.id} onClick={() => pick({ model: m.id })} />
                          ))}
                        </div>
                      </Submenu>
                    </>
                  )}
                  {fastOffered && (
                    <>
                      <MenuSep />
                      <MenuItem
                        icon={<Zap size={16} />}
                        label="快速模式"
                        kbd="Ctrl+Alt+F"
                        toggle
                        checked={fastOn}
                        onClick={() => {
                          setMenu(null);
                          toggleFast();
                        }}
                      />
                    </>
                  )}
                </Popover>

                <EffortControl
                  model={model}
                  effort={effective.effort}
                  open={menu === "effort"}
                  placement={placeEnd}
                  onToggle={() => toggle("effort")}
                  onClose={() => setMenu(null)}
                  onPick={(effort) => override({ effort })}
                />

                <UsageMeter thread={thread} open={menu === "usage"} placement={placeEnd} onToggle={() => toggle("usage")} onClose={() => setMenu(null)} />
                {fastOffered && <span className="sr-only">{fastOn ? "已开启快速模式" : "已关闭快速模式"}</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {shell ? `${shellName} 模式，按 Esc 返回对话。` : status}
      </span>
      {dragging && <DropScrim label="拖放文件到这里" />}
    </fieldset>
  );
}
