// The Code composer (Claude Desktop 2.42304.0.0 Code tab with the session-presets flag on: cc43287c9
// pickerRow, c227f4d5e bQ with layout "row"). The new-session page and a session share one card
// (cc43287c9 kP singleRowCard): 「+」 before the editor, send (only with something to send) and voice
// after it, all on the last line however far the text wraps; the pickers sit in the row under it:
//   [place][mode] ……… [model level][context ring]
// Settings → 功能 → 合并模型与努力程度 (on by default) picks the right end's form. On, as in Claude's
// row, the model pill names the effort level too (shared-7 xx); its menu leads with a model row
// whose list unfolds on a click, then sets the level with the slider of Claude's separate effort
// control (c8e04f916) rather than the row's effort submenu. Off, the model pill and an effort
// button of its own, as Claude's "separate" thinking style draws them (c227f4d5e xK).
// - draft (form "home"): the working folder is the place at the head of the row (cc43287c9 l0);
// - reply: no place (the titlebar names the folder), queue bands on top (cf74bc599).
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
import type { Project } from "@protocol/v2/Project";
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
  type RefObject,
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
  openCloudTask,
  pluginMention,
  presetAllowed,
  presetOf,
  projectFor,
  refreshConfig,
  refreshPermissionProfiles,
  refreshProviderQuotas,
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
  sshSupported,
  startThread,
  supports,
  transcribe,
  VERSION,
} from "../lib/codex";
import { startCloudTask } from "../lib/cloud";
import { autoCompactAt } from "../lib/context";
import { environmentOf } from "../lib/environments";
import { dictationSupported, micError, record, type Recording } from "../lib/dictation";
import { basename, externalUrl, formatTokens, homeRelative, limitName, parentDir, providerQuota, relativePath, samePath, spliceDictation, type QuotaRow } from "../lib/format";
import { answerWithMessage } from "../lib/asked";
import { hasPlan, layoutOf, openPane, togglePane } from "../lib/panes";
import { getState, setState, toast, useStore, type PermissionPreset, type ThreadState } from "../lib/store";
import { startVoice, stopVoice, voiceAvailable, voiceStreams } from "../lib/voice";
import { openSettings } from "./Settings";
import { noteUserMessage } from "../lib/linked";
import { ConnectorIcon } from "./ConnectorIcon";
import { Button, DropScrim, Icon, MenuItem, MenuSection, MenuSep, Popover, Spinner, Submenu, UsageRing, fileGlyph, useReducedMotion } from "./ui";

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
/** Codex's top level, shown like Ultracode: its name in pro violet, its charge Claude's own. */
const PRO_EFFORT = "ultra";
/**
 * Each level's charge color, from the user's chart: Claude's violet field (Ultracode's) through the
 * CSS filter that takes its ground's deep end #8964C4 to the level's color (hue-rotate, saturate,
 * brightness, which Chromium applies in sRGB; solved per color). Every level has the same three
 * functions, so a change of level eases from one filter to the next. Levels the chart leaves out
 * charge as 低.
 */
const EFFORT_CHARGE: Record<string, [hue: number, saturate: number, brightness: number]> = {
  low: [-43.3, 0.069, 1.651], // #B9BEC6
  medium: [-76.9, 0.352, 1.545], // #89BBC7
  high: [-55.8, 0.613, 1.416], // #73ABDA
  xhigh: [-39.8, 0.784, 1.292], // #7197E2
  max: [-21.2, 0.907, 1.169], // #7D80DF
  ultra: [0, 1, 1], // #8964C4
};
/**
 * shared-7 effortWarningTooltip in Claude's zh-Hans words (e66iS0i8Yn, “最大” as Claude writes it):
 * two balanced lines when it is a trigger's whole tooltip (shared-7 xx content de, multiline), and
 * the hover tip of the warning glyph beside the effort section's level name.
 */
const WARNING_TEXT = "使用“最大”努力程度时，Codex 会思考更长时间，消耗您的使用限额的速度也比“高”更快。";

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
type Menu = null | "plus" | "model" | "models" | "effort" | "mode" | "usage" | "env" | "folder" | "send";
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

const DRAFT_IMAGES = "codex-ui:draft-images:";
let imageDb: Promise<IDBDatabase> | undefined;

/** One request on codex-ui's IndexedDB key-value store (idb-keyval's shape, where Claude keeps draft images). */
function imageStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  imageDb ??= new Promise((resolve, reject) => {
    const open = indexedDB.open("codex-ui");
    open.onupgradeneeded = () => open.result.createObjectStore("keyval");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return imageDb.then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = run(db.transaction("keyval", mode).objectStore("keyval"));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

// An install (every one bumps the version) starts with empty composers: what was typed into the
// version before it is not offered again, nor what was pasted.
let draftsWiped: Promise<unknown> = Promise.resolve();
try {
  if (localStorage.getItem("codex-ui:draft-version") !== VERSION) {
    for (const key of Object.keys(localStorage)) if (key.startsWith("codex-ui:draft:")) localStorage.removeItem(key);
    localStorage.setItem("codex-ui:draft-version", VERSION);
    draftsWiped = imageStore("readonly", (store) => store.getAllKeys())
      .then((keys) =>
        Promise.all(keys.filter((key) => typeof key === "string" && key.startsWith(DRAFT_IMAGES)).map((key) => imageStore("readwrite", (store) => store.delete(key)))),
      )
      .catch(() => undefined);
  }
} catch {
  // Private mode: no drafts to drop.
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

/**
 * Pasted images per draft, as Claude keeps them (composer-draft-images): in memory for the
 * composer's remount on a session switch, in IndexedDB across reloads (too large for localStorage).
 */
const keptAttachments = new Map<string, Attachment[]>();

async function readDraftImages(id: string): Promise<Attachment[]> {
  await draftsWiped;
  try {
    const images: Attachment[] = (await imageStore("readonly", (store) => store.get(DRAFT_IMAGES + id))) ?? [];
    if (images.length) keptAttachments.set(id, images);
    return images;
  } catch {
    return [];
  }
}

function saveDraftImages(id: string, images: Attachment[]) {
  const kept = keptAttachments.get(id);
  if (kept === images || (!kept && !images.length)) return;
  if (!images.length) return clearDraftImages(id);
  keptAttachments.set(id, images);
  // No IndexedDB (private mode): images just do not survive a reload.
  imageStore("readwrite", (store) => store.put(images, DRAFT_IMAGES + id)).catch(() => undefined);
}

function clearDraftImages(id: string) {
  keptAttachments.delete(id);
  imageStore("readwrite", (store) => store.delete(DRAFT_IMAGES + id)).catch(() => undefined);
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
  { id: "manual", label: "手动", hint: "更改前始终询问" },
  { id: "acceptEdits", label: "接受编辑", hint: "自动接受所有文件编辑" },
  { id: "plan", label: "计划", hint: "在进行更改前制定计划" },
  { id: "auto", label: "自动", hint: "由 Codex 处理权限决策" },
  { id: "bypass", label: "跳过权限确认", hint: "接受所有权限" },
];

const MODE_PRESET: Record<Exclude<ModeId, "plan">, PermissionPreset> = {
  manual: "read-only",
  acceptEdits: "auto",
  auto: "auto",
  bypass: "full-access",
};

/** Modes that act without asking (c227f4d5e AI: bypass and auto) get the warning tooltip. */
const DANGER_TIP = "Codex 可以在不询问的情况下修改或删除文件";

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
  const hint = headOnly ? "停止 Codex 当前的回复。" : "Codex 会在下一步读取此消息。";
  const fail = (title: string) => (error: unknown) => toast("warning", title, errorMessage(error));
  const sendNow = (q: QueuedSubmission) => {
    if (queue.length === 1) setLeaving(q);
    setSending(q.id);
    sendQueuedNow(id, q.id)
      .catch((error) => {
        setLeaving(null);
        fail("暂时无法发送该消息。消息仍在队列中。")(error);
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
    reorderQueue(id, ids).catch(fail("无法重新排序队列中的消息。请重试。"));
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
      <Button variant="ghost" muted icon={<Icon name="ArrowReturn" size={16} />} label="立即发送" aria-describedby={hintId} onClick={() => sendNow(q)} />
    );

  const band = (q: QueuedSubmission, exiting = false) => (
    <div className="queue" data-text-size>
      <div className="queue-band" data-leaving={exiting || undefined} onAnimationEnd={exiting ? () => setLeaving(null) : undefined}>
        <span className="queue-count">1 条消息已排队</span>
        <span className="queue-preview">{queuePreview(q.input)}</span>
        {!exiting && (
          <span className="queue-actions" data-tip-group="">
            {sendButton(q)}
            <Button variant="ghost" muted icon={<Icon name="Edit" size={16} />} label="在输入框中编辑" onClick={() => edit(q)} />
            <Button variant="ghost" muted icon={<Icon name="X" size={16} />} label="从队列中移除" onClick={() => void remove(q.id)} />
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
          <span className="queue-count">{queue.length} 条消息已排队</span>
          <span className="queue-preview">接下来：{queuePreview(queue[0].input)}</span>
          <span className="queue-caret" aria-hidden="true">
            <Icon name="CaretDown" />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="queue" data-text-size>
      <div className="queue-box">
        <div className="queue-head">
          <span className="queue-count">{queue.length} 条消息已排队</span>
          <Button
            ref={toggle}
            variant="ghost"
            muted
            icon={<Icon name="CaretUp" size={16} />}
            label="折叠排队消息"
            aria-expanded
            onClick={() => {
              setOpen(false);
              moveFocus();
            }}
          />
        </div>
        <div className="queue-list" role="list" aria-label="已排队的消息">
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
                    aria-label="调整排队消息顺序"
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
                    <Icon name="Reorder" size="sm" />
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
                        icon={<Icon name="DotsVertical" size={16} />}
                        label="排队消息的操作"
                        aria-expanded={menu === q.id}
                        onClick={() => setMenu(menu === q.id ? null : q.id)}
                      />
                    }
                  >
                    <MenuItem
                      label="在输入框中编辑"
                      onClick={() => {
                        setMenu(null);
                        edit(q);
                      }}
                    />
                    {canSend && (
                      <MenuItem
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
                      label="从队列中移除"
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
// Draft: where the next session runs (cc43287c9 cie). The place pill (b6: Laptop, the environment
// or 本电脑) heads the picker row and opens the environment picker (P8); on 本电脑 a folder pill
// (b6: Folder, the folder's name) follows it and opens the folder menu (F8). A Codex desktop
// project is a local environment, and a folder inside one runs as that project, so the folder
// menu lists the others. The new-session page's 选择环境 opens the same picker (Uae). No branch
// or worktree API.

/** Folders of past sessions, newest first. */
export function useRecentFolders() {
  const cwd = useStore((s) => s.prefs.cwd);
  const threads = useStore((s) => s.threads);
  return useMemo(() => {
    const latest = new Map<string, number>();
    for (const { meta } of Object.values(threads)) {
      const key = [...latest.keys()].find((path) => samePath(path, meta.cwd)) ?? meta.cwd;
      latest.set(key, Math.max(latest.get(key) ?? 0, meta.recencyAt ?? meta.updatedAt));
    }
    return { cwd, recent: [...latest.entries()].sort((a, b) => b[1] - a[1]).map(([path]) => path) };
  }, [threads, cwd]);
}

/** Work in `path` from the next session on; config and custom permission profiles both depend on the folder. */
export function chooseFolder(path: string) {
  setState((s) => ({ prefs: { ...s.prefs, cwd: path, projectId: null } }));
  void refreshConfig();
  void refreshPermissionProfiles();
}

export function pickFolder() {
  setState({ dialog: { type: "folder" } });
}

/** The environment the draft runs in: the chosen project, else the one holding the folder. */
function useDraftProject() {
  const cwd = useStore((s) => s.prefs.cwd);
  const projectId = useStore((s) => s.prefs.projectId);
  // projectFor reads the store's projects; subscribing re-renders as they change.
  const projects = useStore((s) => s.projects);
  return projects.find((p) => p.id === projectId) ?? projectFor(cwd);
}

/**
 * yT's header: a borderless search field over a full-width hairline. It takes focus on open; ↓ / ↑
 * go to the first / last row (the menu's own keys), Enter submits the query.
 */
export function MenuSearch({ label, value, onChange, onSubmit }: { label: string; value: string; onChange(value: string): void; onSubmit?(query: string): void }) {
  const input = useRef<HTMLInputElement>(null);
  // After the menu's layout effects, so the menu still hands focus back to its trigger.
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="menu-search" role="presentation">
      <input
        ref={input}
        className="input"
        value={value}
        placeholder={label}
        aria-label={label}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Home" || event.key === "End") event.stopPropagation();
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (value.trim()) onSubmit?.(value.trim());
        }}
      />
    </div>
  );
}

/** An environment's glyph: Laptop for a local one, CommandLine for an SSH host, Cloud for Codex Cloud (cc43287c9's rows). */
export const environmentIcon = (project: Project | null | undefined): "Laptop" | "CommandLine" | "Cloud" => ({ local: "Laptop", ssh: "CommandLine", cloud: "Cloud" } as const)[environmentOf(project).kind];

/** z6: Laptop, the name and its radio check; the highlighted row shows GS's Settings key, and → opens the same settings. */
function EnvironmentRow({ project, checked, onPick, onEdit }: { project: Project; checked: boolean; onPick(): void; onEdit?(): void }) {
  const kind = environmentOf(project).kind;
  const chatgpt = useStore((s) => s.account?.account?.type === "chatgpt");
  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== "ArrowRight" || !onEdit) return;
        event.preventDefault();
        event.stopPropagation();
        onEdit();
      }}
    >
      <MenuItem
        icon={<Icon name={environmentIcon(project)} size="sm" />}
        label={<>{project.name}{onEdit && <span className="sr-only">，编辑环境，右方向键</span>}</>}
        checked={checked}
        disabled={kind === "ssh" ? !sshSupported() : kind === "cloud" ? !chatgpt : !project.roots.length}
        onClick={onPick}
        trailing={onEdit && (
          <span
            className="menu-key"
            aria-hidden="true"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
          >
            <Icon name="Settings" size="sm" />
          </span>
        )}
      />
    </div>
  );
}

/**
 * cc43287c9 P8 on the start page: 搜索环境… over 本地 — 本电脑 (y8), the most recently used
 * environment and 更多 with the rest (C8 = 1 shown) — then 新建环境 (V6). A query lists the
 * matches flat, or 没有匹配项 (N8). 本电脑 works in the latest folder outside every project.
 */
export function EnvironmentMenu({ onClose }: { onClose(): void }) {
  const { cwd, recent } = useRecentFolders();
  const projects = useStore((s) => s.projects);
  const current = useDraftProject();
  const [query, setQuery] = useState("");
  const close = (then: () => void) => () => {
    onClose();
    then();
  };
  const edit = supports("project/update") ? (id: string) => close(() => setState({ dialog: { type: "editProject", projectId: id } })) : undefined;
  const row = (project: Project) => (
    <EnvironmentRow key={project.id} project={project} checked={project.id === current?.id} onPick={close(() => chooseProject(project.id))} onEdit={edit?.(project.id)} />
  );
  const computer = (
    <MenuItem
      icon={<Icon name="Laptop" size="sm" />}
      label="本电脑"
      checked={!current}
      onClick={close(() => {
        if (!current) return;
        const folder = [cwd, ...recent].find((path) => path && !projectFor(path));
        if (folder) chooseFolder(folder);
        else pickFolder();
      })}
    />
  );
  const sorted = [...projects].sort((a, b) => (b.recencyAt ?? b.createdAt) - (a.recencyAt ?? a.createdAt));
  const q = query.trim().toLowerCase();
  const hits = sorted.filter((project) => project.name.toLowerCase().includes(q));
  // cc43287c9 vi: after 本地, the cloud environments, then the SSH hosts.
  const ssh = sorted.filter((project) => environmentOf(project).kind === "ssh");
  const cloud = sorted.filter((project) => environmentOf(project).kind === "cloud");
  const [first, ...rest] = sorted.filter((project) => environmentOf(project).kind === "local");
  return (
    <>
      <MenuSearch label="搜索环境…" value={query} onChange={setQuery} />
      {q ? (
        hits.length || "本电脑".includes(q) ? (
          <>
            {"本电脑".includes(q) && computer}
            {hits.map(row)}
          </>
        ) : (
          <div className="menu-none">没有匹配项</div>
        )
      ) : (
        <>
          <MenuSection title="本地" />
          {computer}
          {first && row(first)}
          {rest.length > 0 && (
            <Submenu icon={<Icon name="Laptop" size="sm" />} label="更多" value={String(rest.length)} className="submenu-env">
              {rest.map(row)}
            </Submenu>
          )}
          {cloud.length > 0 && (
            <>
              <MenuSep />
              <MenuSection title="云端" />
              {cloud.map(row)}
            </>
          )}
          {ssh.length > 0 && (
            <>
              <MenuSep />
              <MenuSection title="SSH" />
              {ssh.map(row)}
            </>
          )}
          {supports("project/create") && (
            <>
              <MenuSep />
              <MenuItem icon={<Icon name="Add" size="sm" />} label="新建环境" onClick={close(() => setState({ dialog: { type: "createProject", cwd: current ? undefined : cwd || undefined } }))} />
            </>
          )}
        </>
      )}
    </>
  );
}

/**
 * cc43287c9 F8: 最近 — eight folders by name (the path as their title, the parent folder under a
 * name two of them share), the working folder first when it is not among them — then 打开文件
 * 夹…. Past eight, 搜索文件夹… searches them all by path; Enter opens the first match, or the
 * folder dialog.
 */
export function FolderMenu({ onClose }: { onClose(): void }) {
  const { cwd, recent } = useRecentFolders();
  // projectFor reads the store; re-render as projects change.
  useStore((s) => s.projects);
  const [query, setQuery] = useState("");
  const folders = recent.filter((path) => !projectFor(path));
  const lead = (list: string[]) => (cwd && !projectFor(cwd) && !list.some((path) => samePath(path, cwd)) ? [cwd, ...list] : list);
  const q = query.trim().toLowerCase();
  const shown = q ? lead(folders).filter((path) => [path, homeRelative(path)].some((text) => text.toLowerCase().includes(q))) : lead(folders.slice(0, 8));
  const names = new Map<string, number>();
  for (const path of shown) names.set(basename(path), (names.get(basename(path)) ?? 0) + 1);
  const pick = (path: string) => {
    onClose();
    chooseFolder(path);
  };
  const browse = () => {
    onClose();
    pickFolder();
  };
  return (
    <>
      {folders.length > 8 && <MenuSearch label="搜索文件夹…" value={query} onChange={setQuery} onSubmit={() => (shown[0] ? pick(shown[0]) : browse())} />}
      {q && !shown.length && <div className="menu-none">没有匹配项</div>}
      {shown.length > 0 && (
        <>
          {!q && <MenuSection title="最近" />}
          {shown.map((path) => (
            <MenuItem key={path} title={path} label={basename(path)} hint={(names.get(basename(path)) ?? 0) > 1 ? parentDir(path) : undefined} onClick={() => pick(path)} />
          ))}
          <MenuSep />
        </>
      )}
      <MenuItem label="打开文件夹…" onClick={browse} />
    </>
  );
}

/** b6 in the picker row: ghost, the sm glyph 2px in on both sides, the name truncated at 256 in secondary ink. */
function PlacePill({ open, onToggle, onClose }: { open: boolean; onToggle(): void; onClose(): void }) {
  const project = useDraftProject();
  const label = project?.name ?? "本电脑";
  const pill = (
    <Button variant="ghost" size="xs" ink2 className="place-pill" icon={<Icon name={environmentIcon(project)} />} tip="Codex 的运行位置" aria-label={`环境：${label}`} aria-expanded={open} onClick={onToggle}>
      <span className="btn-label">{label}</span>
    </Button>
  );
  return (
    <Popover open={open} onClose={onClose} className="menu-env" density="compact" anchor={pill}>
      <EnvironmentMenu onClose={onClose} />
    </Popover>
  );
}

/** cie's folder pill (environment-bar-folder), on 本电脑 only: its title is the folder, or 选择… with none. */
function FolderPill({ open, onToggle, onClose }: { open: boolean; onToggle(): void; onClose(): void }) {
  const cwd = useStore((s) => s.prefs.cwd);
  const path = cwd ? homeRelative(cwd) : undefined;
  const pill = (
    <Button variant="ghost" size="xs" ink2 className="place-pill folder-pill" icon={<Icon name="Folder" />} title={path} aria-label={`文件夹：${path ?? "选择…"}`} aria-expanded={open} onClick={onToggle}>
      <span className="btn-label">{cwd ? basename(cwd) : "选择…"}</span>
    </Button>
  );
  return (
    <Popover open={open} onClose={onClose} anchor={pill}>
      <FolderMenu onClose={onClose} />
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Effort (c8e04f916 EffortControl + c2d9b9a76 Slider): the block Claude's separate control opens
// in a 220 popover of its own (EffortControl); merged, it is the model menu's section under the
// model row and its list, where Claude's row keeps its effort submenu (shared-7 yx). The stepped
// slider commits on release.

function effortName(id: string | undefined): string {
  return id ? (EFFORT_LABELS[id] ?? id) : "默认";
}

function EffortSlider({ model, effort, fast, autoFocus, onPick }: { model: Model | undefined; effort: string | null; fast: boolean; autoFocus: boolean; onPick(effort: string): void }) {
  const options = model?.supportedReasoningEfforts ?? [];
  const n = options.length;
  const current = Math.max(0, options.findIndex((o) => o.reasoningEffort === effort));
  const [preview, setPreview] = useState<number | null>(null);
  // A pick reaches `effort` a frame later (the store notifies on the next frame); until then keep
  // showing it, so the handle and the name don't step back for a frame (c8e04f916 B).
  const [picked, setPicked] = useState<number | null>(null);
  if (picked !== null && (!options[picked] || options[picked].reasoningEffort === effort)) setPicked(null);
  const range = useRef<HTMLInputElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ x: number; grab: number } | null>(null);
  const reduced = useReducedMotion();
  const shown = Math.min(preview ?? picked ?? current, n - 1);
  // The touch note follows the committed level, not a drag's preview, so a drag does not grow
  // and shrink the card; it changes once, on release (c8e04f916 Fe).
  const chosen = Math.min(picked ?? current, n - 1);
  // c2d9b9a76: while a pointer holds the slider, the handle and the fill lean toward it by up to
  // .12 of a step (eased 1 − e^(−d/.12), on half pixels), and glide back to the stop on release.
  const lean = () => {
    const el = track.current;
    if (!el || !drag.current || !range.current || n < 2) return;
    const inset = (handle.current?.offsetWidth ?? 0) / 2;
    const box = el.getBoundingClientRect();
    const span = box.width - 2 * inset;
    const steps = (Math.min(Math.max((drag.current.x - drag.current.grab - box.left - inset) / span, 0), 1) - Number(range.current.value) / (n - 1)) * (n - 1);
    const px = `${(Math.round((Math.sign(steps) * 0.12 * (1 - Math.exp(-Math.abs(steps) / 0.12)) * span) / (n - 1) / 0.5) * 0.5).toFixed(1)}px`;
    if (span > 0 && el.style.getPropertyValue("--lean") !== px) el.style.setProperty("--lean", px);
  };
  const release = () => {
    drag.current = null;
    track.current?.style.removeProperty("--lean");
  };
  useLayoutEffect(lean, [shown]);
  // The effort chord opens the menu on the slider.
  useEffect(() => {
    if (autoFocus) requestAnimationFrame(() => range.current?.focus());
  }, [autoFocus]);
  if (n < 2) return null;

  const id = (index: number) => options[index]?.reasoningEffort;
  const info = (index: number) => EFFORT_INFO[id(index) ?? ""] ?? options[index]?.description ?? "";
  const mark = options.findIndex((o) => o.reasoningEffort === model?.defaultReasoningEffort);
  // Every stop charges as Ultracode's top stop does, in its level's color. Reduced motion has no
  // base and no field (yK); the fill takes the color instead.
  const [hue, saturate, brightness] = EFFORT_CHARGE[id(shown) ?? ""] ?? EFFORT_CHARGE.low;
  const commit = () => {
    const value = Number(range.current?.value ?? current);
    setPreview(null);
    const next = id(value);
    if (next && next !== effort) {
      setPicked(value);
      onPick(next);
    }
  };

  return (
    <div className="effort-section">
      <div className="effort-head">
        <div className="effort-title">
          <span>努力程度</span>
          <EffortName index={shown} label={effortName(id(shown))} pro={id(shown) === PRO_EFFORT} reduced={reduced} />
          {id(shown) === WARNING_EFFORT && (
            <span className="effort-warn" role="img" aria-label={WARNING_TEXT} data-tip={WARNING_TEXT} data-tip-multiline>
              <Icon name="Warning" size="xs" />
            </span>
          )}
        </div>
        {info(shown) && (
          <button type="button" className="effort-help" aria-label="关于努力程度">
            <Icon name="Help" size="sm" />
            <span className="effort-help-card" role="tooltip">
              <span>{effortName(id(shown))}</span>
              <span>{info(shown)}</span>
            </span>
          </button>
        )}
      </div>
      <div className="effort-body">
        <div className="effort-ends" dir="ltr">
          <span>速度更快</span>
          <span>更智能</span>
        </div>
        <div className="effort-slider">
          <div
            ref={track}
            className="effort-track"
            style={{ "--pos": shown / (n - 1), "--charge": `hue-rotate(${hue}deg) saturate(${saturate}) brightness(${brightness})` } as CSSProperties}
          >
            <span className="effort-fill" />
            <span className="effort-charge" data-on={!reduced || undefined}>
              <ChargeCanvas lit={!reduced} stop={shown / (n - 1)} power={id(shown) === PRO_EFFORT} rush={fast} handle={handle} />
            </span>
            <span className="effort-stops" aria-hidden="true">
              {options.map((option, index) => (
                <span key={option.reasoningEffort} data-mark={index === mark || undefined} />
              ))}
            </span>
            <input
              ref={range}
              type="range"
              className="effort-range"
              // In the model menu, a stop in its ↑ ↓ order; ← → and Home / End stay the slider's.
              data-menu-stop
              min={0}
              max={n - 1}
              step={1}
              value={shown}
              aria-label="努力程度"
              aria-valuetext={shown === mark ? `${effortName(id(shown))}（推荐）` : effortName(id(shown))}
              onChange={(event) => setPreview(Number(event.target.value))}
              onPointerDown={(event) => {
                if (event.button !== 0 || reduced || !track.current) return;
                const inset = (handle.current?.offsetWidth ?? 0) / 2;
                const box = track.current.getBoundingClientRect();
                const offset = event.clientX - (box.left + inset + (shown / (n - 1)) * (box.width - 2 * inset));
                // A press on the handle keeps where it was grabbed; one on the track aims its centre.
                drag.current = { x: event.clientX, grab: Math.abs(offset) <= 0.7 * inset ? offset : 0 };
                lean();
              }}
              onPointerMove={(event) => {
                if (!drag.current) return;
                if (event.buttons === 0) return release();
                drag.current.x = event.clientX;
                lean();
              }}
              onPointerUp={() => {
                release();
                commit();
              }}
              onPointerCancel={() => {
                release();
                setPreview(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Home" || event.key === "End") event.stopPropagation();
              }}
              onKeyUp={(event) => {
                if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End" || event.key.startsWith("Page")) commit();
              }}
            />
            <span ref={handle} className="effort-handle" aria-hidden="true" />
          </div>
          {mark >= 0 && (
            <div className="effort-mark" data-on={shown === mark || undefined} style={{ "--mark": mark / (n - 1) } as CSSProperties} aria-hidden="true">
              <span>推荐</span>
            </div>
          )}
        </div>
        {info(chosen) && <span className="effort-desc">{info(chosen)}</span>}
      </div>
    </div>
  );
}

/** Claude's separate effort control (c227f4d5e xK, thinkingStyle "separate"): its own picker-row button and a 220 popover holding the slider. */
function EffortControl({
  model,
  effort,
  fast,
  open,
  onToggle,
  onClose,
  onPick,
}: {
  model: Model | undefined;
  effort: string | null;
  fast: boolean;
  open: boolean;
  onToggle(): void;
  onClose(): void;
  onPick(effort: string): void;
}) {
  const options = model?.supportedReasoningEfforts ?? [];
  if (options.length === 0) return null;
  const id = (options.find((o) => o.reasoningEffort === effort) ?? options[0]).reasoningEffort;
  const label = effortName(id);
  const warning = id === WARNING_EFFORT;
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
          data-pro={id === PRO_EFFORT || undefined}
          disabled={options.length < 2}
          aria-label={`投入程度：${label}${warning ? " 使用量较高" : ""}`}
          // At Max the warning is the whole tooltip, as on Claude's model pill.
          tip={warning ? WARNING_TEXT : "努力程度"}
          kbd={warning ? undefined : "Ctrl+Shift+E"}
          data-tip-multiline={warning || undefined}
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="btn-label">{label}</span>
          {warning && <Icon name="Warning" size="xs" className="warn-glyph" />}
        </Button>
      }
    >
      <EffortSlider model={model} effort={effort} fast={fast} autoFocus onPick={onPick} />
    </Popover>
  );
}

/** Framer Motion's easeOut. */
const EASE_OUT = "cubic-bezier(0, 0, 0.58, 1)";
/** c8e04f916 S: the name's blur copies (px); each one's opacity at .342 / .563 of the way in and where it goes on the way out. */
const NAME_BLUR = [0, 0.5, 1, 2];
const NAME_TIMES = [0, 0.342, 0.563, 1];
const NAME_IN = [
  [0, 0, 0, 1],
  [0, 0, 1, 0],
  [0, 1, 0, 0],
  [1, 0, 0, 0],
];
const NAME_OUT = [0, 0, 0, 1];

/**
 * The level name (c8e04f916 ae): a change slides the new name .55em in from the direction of travel
 * over .2s while it sharpens through stacked blur copies (2 → 1 → .5px → crisp, plus-lighter); the
 * name it replaces leaves the flow and slides on out, blurring as it fades. The first name, and any
 * under reduced motion, just appear.
 */
function EffortName({ index, label, pro, reduced }: { index: number; label: string; pro: boolean; reduced: boolean }) {
  const [names, setNames] = useState([{ seq: 0, index, label, pro, dir: 1 }]);
  const current = names[names.length - 1];
  if (current.index !== index) {
    const next = { seq: current.seq + 1, index, label, pro, dir: index > current.index ? 1 : -1 };
    setNames(reduced ? [next] : [...names, next]);
  }
  const box = useRef<HTMLSpanElement>(null);
  const leaving = useRef(new Set<number>());
  useLayoutEffect(() => {
    const nodes = [...(box.current?.children ?? [])] as HTMLElement[];
    if (current.seq === 0 || reduced || nodes.length !== names.length) return;
    const layers = (node: HTMLElement) => [...node.children] as HTMLElement[];
    const node = nodes[nodes.length - 1];
    node.animate([{ transform: `translateY(${current.dir * 0.55}em)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 200, easing: EASE_OUT });
    layers(node).forEach((layer, k) => layer.animate(NAME_IN[k].map((opacity, i) => ({ opacity, offset: NAME_TIMES[i], easing: i === 2 ? EASE_OUT : "linear" })), 200));
    names.slice(0, -1).forEach(({ seq }, i) => {
      if (leaving.current.has(seq)) return;
      leaving.current.add(seq);
      // From wherever it is, mid-entrance included.
      const old = nodes[i];
      const from = getComputedStyle(old);
      const exit = old.animate([{ transform: from.transform, opacity: from.opacity }, { transform: `translateY(${-current.dir * 0.55}em)`, opacity: 0 }], { duration: 200, easing: EASE_OUT, fill: "forwards" });
      exit.onfinish = () => {
        leaving.current.delete(seq);
        setNames((list) => list.filter((name) => name.seq !== seq));
      };
      layers(old).forEach((layer, k) => layer.animate([{ opacity: getComputedStyle(layer).opacity }, { opacity: NAME_OUT[k] }], { duration: 200, easing: EASE_OUT, fill: "forwards" }));
    });
  }, [current.seq]);
  return (
    <span ref={box} className="effort-names" aria-hidden="true">
      {names.map((name) => (
        <span key={name.seq} className="effort-name" data-pro={(name === current ? pro : name.pro) || undefined} data-leaving={name !== current || undefined}>
          {NAME_BLUR.map((blur) => (
            <span key={blur} style={blur ? { filter: `blur(${blur}px)` } : undefined}>
              {name === current ? label : name.label}
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

/**
 * W22 Ultracode charge (c227f4d5e yK / bK): the original WebGL2 field of 3px cells on a 4px pitch.
 * While the handle sits at a stop a burst leaves it every .3–.75s, its strength building over 1.6s
 * from the stop's arrival; each races out by Manhattan distance with a ragged front, lights a fresh
 * subset of cells that cool through a five-step ramp, and brings the charged ground with it. The
 * whole field eases in over .7s and cools out over .85s once it goes out. Claude charges only the
 * top stop; here every stop does, the field following the handle, and the canvas's filter
 * (EFFORT_CHARGE) colors it for the level. Fast mode (rush) adds streaks: one-row runs of the same
 * cells racing from the handle toward the faster end. 极限 (power) runs hotter: a shockwave on
 * arrival and a slower beat while it stays, stronger and quicker bursts, and a core of hot cells
 * against the handle that they flare.
 */
function ChargeCanvas({ lit, stop, power, rush, handle }: { lit: boolean; stop: number; power: boolean; rush: boolean; handle: RefObject<HTMLElement | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = useRef<ReturnType<typeof chargeField>>(null);
  useEffect(
    () => () => {
      field.current?.dispose();
      field.current = null;
    },
    [],
  );
  useEffect(() => {
    // The context is made the first time the field lights (yK mounts it then).
    if (lit && !field.current && canvas.current && handle.current) field.current = chargeField(canvas.current, handle.current, stop, power, rush);
    field.current?.press(lit);
  }, [lit]);
  useEffect(() => field.current?.aim(stop, power), [stop, power]);
  useEffect(() => field.current?.rush(rush), [rush]);
  // Dark's hot ink is the pro text color (mK), read back from the canvas.
  return <canvas ref={canvas} style={{ color: "var(--cds-text-pro)" }} aria-hidden="true" />;
}

const rgb = (hex: number) => [(hex >> 16) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

/** Inks and ramp per theme (c227f4d5e mK + hK), keyed by uniform. */
const CHARGE_LIGHT: Record<string, number | number[]> = {
  u_fg: rgb(0xfbedf1),
  u_fg2: rgb(0xc6c0f3),
  u_charge0: [...rgb(0x888edd), 1],
  u_charge1: [...rgb(0x8964c4), 1],
  u_tintA: [...rgb(0xbfd6f3), 0.28],
  u_tintB: [...rgb(0xf0bccc), 0.28],
  u_bedFill: 1,
  u_chargeMax: 0.92,
  u_chargeRamp: 0.5,
  u_inkFloor: 0.28,
  u_inkCeil: 1,
  u_energyGain: 1.18,
  u_maskEnd: 0.45,
};
const CHARGE_DARK: Record<string, number | number[]> = {
  u_fg2: [1, 1, 1],
  u_charge0: [0.62, 0.5, 0.92, 1],
  u_charge1: [0.35, 0.25, 0.6, 1],
  u_tintA: [0, 0, 0, 0],
  u_tintB: [0, 0, 0, 0],
  u_bedFill: 0,
  u_chargeMax: 0.85,
  u_chargeRamp: 1.1,
  u_inkFloor: 0.08,
  u_inkCeil: 0.85,
  u_energyGain: 1,
  u_maskEnd: 0.6,
};

const CHARGE_VERTEX = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
uniform vec2 u_resolution;
void main() {
  v_uv = (a_position * 0.5 + 0.5) * u_resolution;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

/** c227f4d5e rK as shipped, its notes shortened. */
const CHARGE_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_fg;  // hot ink
uniform vec3 u_fg2; // cool ink, always brighter than the ground
uniform float u_seed;
// Burst ring: when each fired (u_time clock), its origin (px) and strength 0..1.
const int MAX_BURSTS = 8;
uniform float u_burstTime[MAX_BURSTS];
uniform vec2 u_burstCenter[MAX_BURSTS];
uniform float u_burstGain[MAX_BURSTS];
uniform float u_fade; // master envelope, applied before quantizing
uniform float u_pos;  // handle fraction
uniform vec4 u_charge0;
uniform vec4 u_charge1;
uniform float u_bedFill;
uniform vec4 u_tintA;
uniform vec4 u_tintB;
uniform float u_chargeMax;
uniform float u_chargeRamp;
uniform float u_inkFloor;
uniform float u_inkCeil;
uniform float u_energyGain;
uniform float u_maskEnd; // yK's canvas mask, transparent to opaque over this much of the handle's span
// Fast mode's streak ring: when each left (u_time clock); its origin x (px), row, speed (px/s), strength.
const int MAX_STREAKS = 12;
uniform float u_streakTime[MAX_STREAKS];
uniform vec4 u_streak[MAX_STREAKS];
// 极限's shockwave ring: each one's origin x (px), when it left (u_time clock), strength and speed
// (cells/s), from mid-height.
const int MAX_SHOCKS = 2;
uniform vec4 u_shock[MAX_SHOCKS];
uniform float u_core; // 极限's core, 0 elsewhere: held while there, flickered by bursts, flared by shockwaves
uniform float u_knob; // the handle's width (px), so the core hugs its near edge
in vec2 v_uv;
out vec4 fragColor;

const float CELL_PITCH = 4.0;
const float CELL_SIZE = 3.0;
const float CELL_R = 0.9;
const float SPEED_LO = 20.0;
const float SPEED_HI = 36.0;
const float RANGE_LO = 10.0;
const float RANGE_HI = 55.0;
const float DENSITY_LO = 0.30;
const float DENSITY_HI = 0.85;
const float JITTER = 0.10;
const float HEAD_GAIN = 1.25;
const float HEAD_DECAY = 5.0;
const float BODY_GAIN = 0.65;
const float BODY_LO = 3.3;
const float BODY_HI = 0.77;
const float AMP_LO = 0.55;
const float MAX_AGE = 5.0;
const float RAMP_POW = 1.4;
const float BREATH_DIP = 0.28;
const float BREATH_BASE = 2.4;
const float BREATH_VARY = 1.4;
const float STREAK_DECAY = 11.0;
const float STREAK_TAIL = 0.4;
const float STREAK_DENSITY = 0.9;
const float SHOCK_HEAD = 1.3;
const float SHOCK_HEAD_DECAY = 8.0;
const float SHOCK_BODY = 0.6;
const float SHOCK_BODY_DECAY = 2.5;
const float SHOCK_AGE = 2.5;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  // Whole rows tile the bar height; cells stay square.
  float pitch = u_resolution.y / max(round(u_resolution.y / CELL_PITCH), 1.0);
  float cellScale = pitch / CELL_PITCH;
  vec2 cell = floor(v_uv / pitch);
  vec2 cellCenter = (cell + 0.5) * pitch;

  // Anti-aliased rounded-rect cell mask.
  float cellHalf = CELL_SIZE * 0.5 * cellScale;
  float cellR = CELL_R * cellScale;
  vec2 q = abs(v_uv - cellCenter) - vec2(cellHalf - cellR);
  float distC = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - cellR;
  float aa = min(fwidth(v_uv.x), 1.5);
  float cellMask = 1.0 - smoothstep(-aa, aa, distC);
  if (cellMask <= 0.0 && u_bedFill <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  float jitter = (hash21(cell + 41.7 + u_seed) - 0.5) * 2.0 * JITTER;
  float vary = 0.35 + 0.65 * hash21(cell + 13.7 + u_seed);

  float energy = 0.0;
  float charged = 0.0;
  for (int i = 0; i < MAX_BURSTS; i++) {
    float age = u_time - u_burstTime[i];
    if (age < 0.0 || age > MAX_AGE) continue;
    float k = clamp(u_burstGain[i], 0.0, 1.0);
    vec2 originCell = floor(u_burstCenter[i] / pitch);
    float manh = abs(cell.x - originCell.x) + abs(cell.y - originCell.y);
    float range = mix(RANGE_LO, RANGE_HI, k);
    float falloff = exp(-manh / (range * 0.85));
    float reach = exp(-max(manh - range, 0.0) * 0.12);
    float speed = mix(SPEED_LO, SPEED_HI, k);
    float t = age - manh / speed - jitter;
    // The charged ground arrives with the front and stays while the burst lives.
    charged = max(charged, smoothstep(0.0, 0.15, t) * reach);
    if (t < 0.0) continue;
    // Each burst re-rolls which cells it recruits.
    float rank = hash21(cell + 7.3 + u_seed + u_burstTime[i]);
    if (rank > mix(DENSITY_LO, DENSITY_HI, k)) continue;
    float head = HEAD_GAIN * exp(-t * HEAD_DECAY);
    float body = BODY_GAIN * exp(-t * mix(BODY_LO, BODY_HI, k));
    energy += (head + body) * mix(AMP_LO, 1.0, k) * falloff * reach * vary;
  }

  // Fast mode: each streak's head lights its row's cells as it passes and they cool down the same
  // five steps, so a faster one trails a longer tail.
  float dash = 0.0;
  for (int i = 0; i < MAX_STREAKS; i++) {
    vec4 s = u_streak[i];
    float behind = s.x - cellCenter.x;
    if (cell.y != s.y || behind < 0.0) continue;
    float t = u_time - u_streakTime[i] - behind / s.z;
    if (t < 0.0 || t > STREAK_TAIL) continue;
    if (hash21(cell + 3.9 + u_seed + u_streakTime[i]) > STREAK_DENSITY) continue;
    dash = max(dash, s.w * exp(-t * STREAK_DECAY));
  }

  // 极限's shockwaves: full-height fronts from the handle through every cell they reach, a hot wall
  // with a glow cooling behind it, the ground charged in their wake (let go over their last second,
  // as the bursts take over).
  float shock = 0.0;
  for (int i = 0; i < MAX_SHOCKS; i++) {
    vec4 s = u_shock[i];
    float age = u_time - s.y;
    if (age < 0.0 || age > SHOCK_AGE) continue;
    vec2 origin = floor(vec2(s.x, u_resolution.y * 0.5) / pitch);
    float t = age - (abs(cell.x - origin.x) + abs(cell.y - origin.y)) / s.w - jitter * 0.3;
    charged = max(charged, smoothstep(0.0, 0.1, t) * s.z * (1.0 - smoothstep(SHOCK_AGE - 1.0, SHOCK_AGE, age)));
    if (t >= 0.0) shock = max(shock, s.z * (SHOCK_HEAD * exp(-t * SHOCK_HEAD_DECAY) + SHOCK_BODY * exp(-t * SHOCK_BODY_DECAY)));
  }

  // Per-cell brightness drifts between two identities; a faint wave streams right to left.
  float lumA = hash21(cell + 8.8 + u_seed);
  float lumB = hash21(cell + 88.8 + u_seed);
  float lumDrift = 0.5 + 0.5 * sin(u_time * 0.35 + lumA * 6.2832);
  float lum = pow(mix(lumA, lumB, lumDrift), 1.9);
  float stream = 0.9 + 0.16 * sin(u_time * 1.3 + cell.x * 0.45 + lumB * 2.0);
  float e = clamp(energy, 0.0, 1.0) * u_fade * mix(0.16, 1.0, lum) * stream * u_energyGain;
  e = max(e, min(dash, 1.0) * u_fade * mix(0.7, 1.0, lum));
  e = max(e, min(shock, 1.0) * u_fade * mix(0.85, 1.0, lum));

  // 极限's core: the cells against the handle burn, hottest beside it and cooling step by step away
  // (a little sooner off the middle row), reaching further as the core flares.
  if (u_core > 0.0) {
    float d = (u_pos * u_resolution.x - u_knob - cellCenter.x) / pitch + abs(cellCenter.y - u_resolution.y * 0.5) / pitch * 0.5;
    float core = u_core * exp(-max(d, 0.0) / mix(2.0, 5.0, u_core));
    e = max(e, min(core, 1.0) * u_fade * mix(0.75, 1.0, lum));
  }

  // Charged ground: left edge to handle gradient, deeper toward the handle.
  float g = clamp(v_uv.x / max(u_pos * u_resolution.x, 1.0), 0.0, 1.0);
  vec3 chargeColor = mix(u_charge0.rgb, u_charge1.rgb, g);
  float bedMask = mix(u_bedFill, 1.0, cellMask);
  float chargeA = u_chargeMax * pow(g, u_chargeRamp) * charged * u_fade * bedMask * mix(u_charge0.a, u_charge1.a, g);

  // Five discrete steps, never a gradient; only the top step breathes.
  float lv = step(0.04, e) + step(0.2, e) + step(0.4, e) + step(0.6, e) + step(0.8, e);
  float alpha = lv <= 0.0 ? 0.0 : mix(u_inkFloor, u_inkCeil, (lv - 1.0) / 4.0);
  if (lv >= 5.0) {
    float period = BREATH_BASE + BREATH_VARY * hash21(cell + 3.1 + u_seed);
    float phase = hash21(cell + 5.5 + u_seed) * 6.2832;
    alpha *= 1.0 - BREATH_DIP * 0.5 * (1.0 + sin(u_time * 6.2832 / period + phase));
  }

  // Energy over charge, premultiplied; a minority of cells lean blue or pink.
  vec3 ink = mix(u_fg2, u_fg, pow(lv / 5.0, RAMP_POW));
  float hueSel = hash21(cell + 27.9 + u_seed);
  ink = mix(ink, u_tintA.rgb, u_tintA.a * smoothstep(0.62, 0.95, hueSel));
  ink = mix(ink, u_tintB.rgb, u_tintB.a * (1.0 - smoothstep(0.05, 0.38, hueSel)));
  float eA = alpha * cellMask;
  vec3 col = ink * eA + chargeColor * chargeA * (1.0 - eA);
  float a = eA + chargeA * (1.0 - eA);
  if (a <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }
  fragColor = vec4(col, a) * clamp(v_uv.x / max(u_maskEnd * u_pos * u_resolution.x, 1.0), 0.0, 1.0);
}`;

/**
 * c227f4d5e gK, charging wherever the handle is. press(true) starts the bursts and press(false)
 * lets the field cool; aim(stop, power) takes it to another stop, 极限 being powered; rush(on)
 * sends fast mode's streaks. Frames run only while something is visible. Null without WebGL2 (the
 * track then keeps just the charge base).
 */
function chargeField(el: HTMLCanvasElement, handle: HTMLElement, stop: number, powered: boolean, rushing: boolean) {
  const gl = el.getContext("webgl2", { alpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) return null;
  const program = gl.createProgram();
  const shaders = (
    [
      [gl.VERTEX_SHADER, CHARGE_VERTEX],
      [gl.FRAGMENT_SHADER, CHARGE_FRAGMENT],
    ] as const
  ).map(([type, source]) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    return shader;
  });
  gl.linkProgram(program);
  for (const shader of shaders) gl.deleteShader(shader);
  const buffer = gl.createBuffer();
  const locations: Record<string, WebGLUniformLocation | null> = {};
  const u = (name: string) => (locations[name] ??= gl.getUniformLocation(program, name));
  const parallel = gl.getExtension("KHR_parallel_shader_compile");

  const dpr = devicePixelRatio || 1;
  const width = Math.max(1, el.clientWidth);
  const height = Math.max(1, el.clientHeight);
  el.width = Math.round(width * dpr);
  el.height = Math.round(height * dpr);

  const BURSTS = 8;
  const times = new Float32Array(BURSTS).fill(-1e3);
  const centers = new Float32Array(BURSTS * 2);
  const gains = new Float32Array(BURSTS);
  let slot = 0;
  let clock = 0; // shader time (s); it only advances while frames run
  let last = -1;
  let fade = 0;
  let held = 0;
  let lastBurst = -Infinity;
  let lastBurstAt = -Infinity;
  let gap = 0.45;
  let pressed = false;
  let ready = false;
  let running = false;
  let frame = 0;

  // The handle's far edge as a fraction of the track (gK's u_pos, 1 at the top stop): where it rests
  // at the stop, or where it is now, mid-glide or leaning toward a pointer. Bursts leave it; the
  // ground and the mask run up to it.
  const rest = () => (stop * (width - handle.offsetWidth) + handle.offsetWidth) / width;
  const here = () => {
    const knob = handle.getBoundingClientRect();
    return ((knob.left + knob.right + handle.offsetWidth) / 2 - el.getBoundingClientRect().left) / width;
  };
  // se(1, t): the top stop's burst strength t of the way through the build-up. 极限 builds up
  // quicker (1s) to full strength, its bursts closer together.
  const strength = (t: number) => Math.min((powered ? 1 : 0.85) * (0.45 + 0.55 * t), 1);
  const built = () => Math.min(held / (powered ? 1 : 1.6), 1);
  // 极限's core (u_core): held at a floor while there, flickered by the bursts and flared by each
  // shockwave.
  let surge = 0;
  // 极限's shockwaves, a ring of two: the arrival's, fast; then while it stays, a weaker beat every
  // 1.4–1.8s, heavier and slower than fast mode's streaks (built up by then) so the two read apart.
  const shocks = new Float32Array([0, -1e3, 0, 1, 0, -1e3, 0, 1]);
  let shockSlot = 0;
  let lastShock = -Infinity;
  let nextBeat = 0;
  const shock = (x: number, gain: number, speed: number) => {
    shocks.set([x * width, clock, gain, speed], shockSlot * 4);
    shockSlot = (shockSlot + 1) % 2;
    gl.uniform4fv(u("u_shock[0]"), shocks);
    lastShock = clock;
    nextBeat = clock + 1.4 + Math.random() * 0.4;
    surge = Math.max(surge, 0.6 + 0.4 * gain);
    wake();
  };
  const burst = (gain: number, x: number) => {
    if (powered) surge = Math.max(surge, 0.5 + 0.15 * Math.min(gain, 1));
    times[slot] = clock;
    centers[slot * 2] = x * width;
    centers[slot * 2 + 1] = height * (0.35 + Math.random() * 0.3);
    gains[slot] = gain;
    slot = (slot + 1) % BURSTS;
    gl.uniform1fv(u("u_burstTime[0]"), times);
    gl.uniform2fv(u("u_burstCenter[0]"), centers);
    gl.uniform1fv(u("u_burstGain[0]"), gains);
    lastBurst = clock;
    lastBurstAt = performance.now();
    wake();
  };
  // Fast mode's streaks, a ring like the bursts': each leaves the handle on a row other than the
  // last one's, quicker and more often as the charge builds.
  const STREAKS = 12;
  const streakTimes = new Float32Array(STREAKS).fill(-1e3);
  const streaks = new Float32Array(STREAKS * 4);
  const rows = Math.max(Math.round(height / 4), 1);
  let streakSlot = 0;
  let lastStreak = -Infinity;
  let streakGap = 0;
  let row = -1;
  const streak = (k: number, x: number, delay = 0) => {
    row = (row + 1 + Math.floor(Math.random() * Math.max(rows - 1, 1))) % rows;
    streakTimes[streakSlot] = clock + delay;
    streaks.set([x * width, row, (200 + 160 * k) * (0.85 + Math.random() * 0.3), 1 + Math.random() * 0.3], streakSlot * 4);
    streakSlot = (streakSlot + 1) % STREAKS;
    gl.uniform1fv(u("u_streakTime[0]"), streakTimes);
    gl.uniform4fv(u("u_streak[0]"), streaks);
    lastStreak = clock + delay;
    wake();
  };
  const tick = (now: number) => {
    const dt = last < 0 ? 0 : Math.max(0, (now - last) / 1000);
    clock += dt;
    last = now;
    fade = pressed ? Math.min(fade + dt / 0.7, 1) : Math.max(fade - dt / 0.85, 0);
    held = pressed ? held + dt : 0;
    const pos = here();
    if (pressed && clock - lastBurst > gap) {
      gap = (0.3 + Math.random() * 0.45) * (powered ? 0.7 : 1);
      burst(strength(built()) * (0.85 + Math.random() * 0.3), pos + (Math.random() - 0.5) * 0.08);
    }
    if (pressed && rushing && clock - lastStreak > streakGap) {
      const k = built();
      streakGap = (0.22 - 0.1 * k) * (0.6 + Math.random() * 0.8);
      streak(k, pos);
    }
    if (pressed && powered && clock > nextBeat) shock(pos, 0.6, 45);
    const eased = fade * fade * (3 - 2 * fade);
    surge = Math.max(surge * Math.exp(-dt * 1.5), powered && pressed ? 0.5 : 0);
    gl.uniform1f(u("u_core"), surge);
    gl.uniform1f(u("u_pos"), pos);
    gl.uniform1f(u("u_fade"), eased);
    gl.uniform1f(u("u_time"), clock);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    running = pressed || (clock - lastBurst < 5 && fade > 0);
    if (running) frame = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (running) return;
    running = true;
    last = -1;
    frame = requestAnimationFrame(tick);
  };
  const start = () => {
    const style = getComputedStyle(el);
    const ink = style.colorScheme.includes("dark") ? { ...CHARGE_DARK, u_fg: style.color.match(/[\d.]+/g)!.slice(0, 3).map((v) => Number(v) / 255) } : CHARGE_LIGHT;
    for (const [name, value] of Object.entries(ink)) {
      if (typeof value === "number") gl.uniform1f(u(name), value);
      else if (value.length === 3) gl.uniform3fv(u(name), value);
      else gl.uniform4fv(u(name), value);
    }
    // A press after a rest re-rolls the seed: fresh jitter and recruitment.
    if (performance.now() - lastBurstAt > 5000 && fade <= 0) {
      times.fill(-1e3);
      gl.uniform1f(u("u_seed"), Math.random() * 512);
    }
    held = 0;
    // Opened on 极限, its beat starts once the field is up.
    nextBeat = clock + 1.2;
    burst(strength(0), rest());
  };
  const init = () => {
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.viewport(0, 0, el.width, el.height);
    gl.clearColor(0, 0, 0, 0);
    gl.uniform2f(u("u_resolution"), width, height);
    gl.uniform1fv(u("u_burstTime[0]"), times);
    gl.uniform4fv(u("u_shock[0]"), shocks);
    gl.uniform1f(u("u_knob"), handle.offsetWidth);
    ready = true;
    if (pressed) start();
  };
  // KHR_parallel_shader_compile links off the main thread, so opening the popover never stalls on it.
  const link = () => {
    if (parallel && !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) frame = requestAnimationFrame(link);
    else if (gl.getProgramParameter(program, gl.LINK_STATUS)) init();
  };
  link();

  return {
    press(on: boolean) {
      if (on === pressed) return;
      pressed = on;
      if (ready) {
        if (on) start();
        else wake();
      }
    },
    aim(next: number, power: boolean) {
      if (next === stop && power === powered) return;
      const arriving = power && !powered;
      stop = next;
      powered = power;
      // Each arrival charges as yK's top stop does: a burst there, and the build-up anew. 极限's
      // also sends its shockwave, at most one a .8s however often a drag crosses back onto it.
      if (ready && pressed) {
        held = 0;
        burst(strength(0), rest());
        if (arriving && clock - lastShock > 0.8) shock(rest(), 1, 70);
      }
    },
    rush(on: boolean) {
      if (on === rushing) return;
      rushing = on;
      // Switching it on sends a volley off at once; switched off, the streaks out finish their run.
      if (on && ready && pressed) for (let i = 0; i < 4; i++) streak(1, here(), i * 0.05);
    },
    dispose() {
      cancelAnimationFrame(frame);
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
    },
  };
}

// ---------------------------------------------------------------------------
// Usage ring (c227f4d5e n4 / o4 / s4 in the picker row, always shown): a 14px icon-only ring (the
// row's ringSize, on an alpha-3 track). With a plan window (DX "meters") it shows the busiest one
// in its severity's colour and opens the 360 plan popover (O2: 套餐使用限额 · plan with the gauge
// to Settings, a j2 block per window, 请求更多 as its banner). Without one it falls back to the
// context window and the same popover (c2d611398 Se): 上下文窗口 with the compact row from 50% (Jz).

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
  rate_limit_reached: "已达到使用限额",
  workspace_owner_credits_depleted: "您的组织已用完用量额度",
  workspace_member_credits_depleted: "您的组织已用完用量额度",
  workspace_owner_usage_limit_reached: "您的组织已用尽用量",
  workspace_member_usage_limit_reached: "您的组织已用尽用量",
};

/** The owner's way out (TUI backend_banners/actions.rs); members ask the owner instead. */
function ownerLink(type: RateLimitReachedType, accountId: string | null): { label: string; url: string } | null {
  if (!accountId) return null;
  const account = `account_id=${encodeURIComponent(accountId)}`;
  if (type === "workspace_owner_credits_depleted") return { label: "购买额度", url: `https://chatgpt.com/admin/billing?codex_credit_action=add_credits&${account}` };
  if (type === "workspace_owner_usage_limit_reached") return { label: "管理支出限额", url: `https://chatgpt.com/admin/usage-limits/workspace?${account}` };
  return null;
}

/**
 * The session's context window, read by the chin's popover and the session rail's 上下文 card
 * (Rail.tsx). A session without a token report yet has no data (c2d611398 noData); shared-8 qV:
 * a known window gives "used / max", otherwise (or when over it) only "used". The compact row
 * shows from 50% (Jz) with the distance to where Codex compacts on its own (c227f4d5e eB / tB).
 */
export function useContextUsage(thread: ThreadState | undefined) {
  const configured = useStore((s) => s.config?.model_auto_compact_token_limit);
  const usage = thread?.tokenUsage;
  const used = usage?.last.totalTokens ?? 0;
  const max = usage?.modelContextWindow ?? null;
  const pct = max && used <= max ? Math.round((used / max) * 100) : null;
  const compactAt = usage ? autoCompactAt(max, configured ? Number(configured) : null) : null;
  const left = compactAt === null ? null : compactAt - used;
  return {
    noData: !!thread && !usage,
    used,
    max,
    compactAt,
    pct,
    level: level(pct ?? 0),
    summary: pct !== null && max ? `${formatTokens(used)} / ${formatTokens(max)}` : formatTokens(used),
    compactHint: left === null ? null : left < 30000 ? "即将自动压缩" : `距自动压缩还剩 ${formatTokens(twoDigits(left))}`,
    canCompact: !!thread && pct !== null && pct >= 50,
    running: !!activeTurn(thread),
  };
}

function UsageMeter({ thread, model, open, onToggle, onClose }: { thread: ThreadState | undefined; model: string | null; open: boolean; onToggle(): void; onClose(): void }) {
  const rateLimits = useStore((s) => s.rateLimits);
  const account = useStore((s) => s.account?.account);
  const providerQuotas = useStore((s) => s.providerQuotas);
  const configProvider = useStore((s) => s.config?.model_provider);
  const credits = useStore((s) => s.chatgptCredits);
  const [request, setRequest] = useState<"idle" | "busy" | "sent">("idle");
  useEffect(() => {
    if (open) void refreshProviderQuotas();
  }, [open]);
  // A model a local opencodex proxy routes to another provider, or any model under a provider
  // cc-switch switched Codex to, spends that provider's quota, which Codex's own limits (the
  // ChatGPT account) do not describe.
  const routed = providerQuota(model, providerQuotas, thread?.meta.modelProvider ?? configProvider);
  const snapshot = rateLimits?.rateLimits;
  const rows: QuotaRow[] =
    routed?.rows ??
    [snapshot?.primary, snapshot?.secondary].flatMap((w, index) =>
      w ? [{ name: windowName(w, index === 0), pct: w.usedPercent, resetsAt: w.resetsAt, primary: index === 0 }] : [],
    );
  const top = rows.reduce<QuotaRow | null>((a, b) => (b.pct !== null && b.pct > (a?.pct ?? -1) ? b : a), null);
  // The ChatGPT account's credits go under its limits. They only run down once those are used up,
  // so the ring and its line keep describing the limits.
  const listed: QuotaRow[] =
    !routed && credits
      ? [
          ...rows,
          {
            name: `额度余额（${credits.balance.toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}）`,
            pct: credits.percent,
            resetsAt: null,
            primary: false,
            digits: 1,
          },
        ]
      : rows;
  const context = useContextUsage(thread);
  const { noData, compactHint, running } = context;
  const contextPct = context.pct;
  const summary = contextPct !== null ? `${context.summary} (${contextPct}%)` : context.summary;
  const planPct = top?.pct != null ? Math.round(top.pct) : null;
  const ringPct = top ? (planPct ?? 0) : (contextPct ?? 0);
  const tooltip = top ? (top.primary ? `已使用会话限额的 ${planPct}%` : `${top.name}：${planPct}%`) : noData ? "用量" : `上下文 ${summary}`;
  const detail = top ? resetLabel(top.resetsAt) : null;
  const ariaParts = [tooltip, detail].filter(Boolean).join("，");
  const plan = account?.type === "chatgpt" && account.planType !== "unknown" ? account.planType : null;
  const reached = routed ? null : (snapshot?.rateLimitReachedType ?? null);
  const memberAsk = reached === "workspace_member_credits_depleted" ? "credits" : reached === "workspace_member_usage_limit_reached" ? "usage_limit" : null;
  const owner = reached ? ownerLink(reached, rateLimits?.accountId ?? null) : null;
  // shared-156 GV · UV: the plan reads as Codex knows it, the routed provider's name or ChatGPT's plan.
  const limits = `${!routed && plan && WORKSPACE_PLAN.test(plan) ? "您的使用限额" : "套餐使用限额"}${routed ? ` · ${routed.label}` : plan ? ` · ${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : ""}`;
  // Settings show the ChatGPT account's limits only.
  const toSettings = routed
    ? undefined
    : () => {
        onClose();
        openSettings("account", "setting-account-limits");
      };
  const ask = () => {
    if (!memberAsk) return;
    setRequest("busy");
    requestMoreUsage(memberAsk)
      .then(() => setRequest("sent"))
      .catch((error) => {
        setRequest("idle");
        toast("warning", "无法发送您的请求。请重试。", errorMessage(error));
      });
  };
  const bar = (pct: number | null, label: string, value?: string) => (
    <div className="usage-bar" role="progressbar" aria-label={label} aria-valuenow={pct ?? undefined} aria-valuetext={pct === null ? value : undefined} aria-valuemin={0} aria-valuemax={100}>
      {pct !== null && <span data-level={level(pct)} style={{ width: `${Math.min(100, pct)}%` }} />}
    </div>
  );
  const banner = reached && (
    <div className="usage-line">
      <span className="usage-hint">{LIMIT_TEXT[reached]}</span>
      {memberAsk && (
        <Button size="xs" disabled={request !== "idle"} aria-busy={request === "busy" || undefined} onClick={ask}>
          {request === "sent" ? "已向管理员发送请求" : "申请更多"}
        </Button>
      )}
      {owner && (
        <Button size="xs" onClick={() => window.open(owner.url, "_blank", "noopener")}>
          {owner.label}
        </Button>
      )}
    </div>
  );
  return (
    <Popover
      open={open}
      onClose={onClose}
      placement="top-end"
      className={top ? "usage-pop usage-pop-plan" : "usage-pop"}
      anchor={
        <Button
          variant="ghost"
          size="xs"
          className="usage-trigger"
          icon={
            <UsageRing
              value={ringPct}
              size={14}
              stroke={2}
              motionKey={top ? `plan:${top.name}:${top.resetsAt ?? ""}` : thread ? `context:${thread.meta.id}` : undefined}
              streaming={running}
            />
          }
          label={top || !noData ? `用量：${ariaParts}` : ariaParts}
          tip={detail ? `${tooltip}\n${detail}` : tooltip}
          aria-expanded={open}
          onClick={onToggle}
        />
      }
    >
      <h2 className="sr-only">用量</h2>
      {top ? (
        <PlanUsage rows={listed} title={limits} routed={!!routed} banner={banner} onSettings={toSettings} />
      ) : (
        <>
          {banner && (
            <>
              {banner}
              <div className="usage-sep" />
            </>
          )}
          <div className="usage-line">
            <span className="usage-label">上下文窗口</span>
            {!noData && <span className="usage-value">{summary}</span>}
          </div>
          <div className="usage-pad">{noData ? <span className="usage-note">发送消息即可查看上下文用量。</span> : bar(contextPct, "上下文窗口", summary)}</div>
          {thread && context.canCompact && (
            <div className="usage-line">
              <span className="usage-hint">{compactHint}</span>
              <Button
                size="xs"
                disabled={running}
                tip={running ? "Codex 完成本轮回复后可用" : undefined}
                onClick={() => {
                  onClose();
                  compactThread(thread.meta.id).catch((error) => toast("warning", "无法开始压缩。", errorMessage(error)));
                }}
              >
                压缩会话
              </Button>
            </div>
          )}
          {listed.length > 0 && (
            <>
              <div className="usage-sep" />
              <div className="usage-line">
                <span className="usage-label">{limits}</span>
                {toSettings && <Button variant="ghost" className="plan-usage-gauge" icon={<Icon name="UsageGaugeMiddle" />} label="在设置中查看用量" onClick={toSettings} />}
              </div>
              <div className="usage-windows">
                {listed.map((row, index) => {
                  const scale = 10 ** (row.digits ?? 0);
                  const pct = row.pct === null ? null : Math.round(Math.max(0, Math.min(100, row.pct)) * scale) / scale;
                  return (
                    <div key={`${index}-${row.name}`} className="usage-window">
                      <div className="usage-window-head">
                        <span className="usage-window-name">{row.name}</span>
                        {pct !== null && (
                          <span className="usage-window-value">
                            {resetLabel(row.resetsAt) && <span>{resetLabel(row.resetsAt)}</span>}
                            <span>{pct.toFixed(row.digits ?? 0)}%</span>
                          </span>
                        )}
                      </div>
                      {pct !== null && bar(pct, row.name)}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </Popover>
  );
}

/**
 * The plan popover (c227f4d5e O2 / k2 / j2): 套餐使用限额 · plan with the gauge to Settings
 * (c1564829c T), the banner, then a block per window: the name, its reset and N% ("发送消息后开始计时"
 * for a ChatGPT window that has not started, u2), over a 4px meter on alpha-2 (shared-3 Meter, sm).
 */
function PlanUsage({ rows, title, routed, banner, onSettings }: { rows: QuotaRow[]; title: string; routed: boolean; banner: ReactNode; onSettings?: () => void }) {
  return (
    <div className="plan-usage">
      <div className="plan-usage-head" data-tip-group="">
        <span>{title}</span>
        {onSettings && <Button variant="ghost" className="plan-usage-gauge" icon={<Icon name="UsageGaugeMiddle" />} label="在设置中查看用量" onClick={onSettings} />}
      </div>
      <div className="plan-usage-rows" role="group" aria-label="使用限额">
        {banner}
        <div className="plan-usage-list">
          {rows.map((row, index) => {
            const scale = 10 ** (row.digits ?? 0);
            const pct = row.pct === null ? null : Math.round(Math.max(0, Math.min(100, row.pct)) * scale) / scale;
            const share = pct === null ? null : `${pct.toFixed(row.digits ?? 0)}%`;
            const caption = resetLabel(row.resetsAt) ?? (!routed && row.digits === undefined ? "发送消息后开始计时" : null);
            return (
              <div key={`${index}-${row.name}`} className="plan-usage-row">
                <div className="plan-usage-row-head">
                  <span className="plan-usage-name">{row.name}</span>
                  <span className="plan-usage-value">
                    {caption && <span>{caption}</span>}
                    {share && <span aria-hidden="true">{share}</span>}
                  </span>
                </div>
                {pct !== null && (
                  <div className="plan-usage-meter" role="meter" aria-label={row.name} aria-valuenow={pct} aria-valuetext={`已使用 ${share}`} aria-valuemin={0} aria-valuemax={100}>
                    {pct > 0 && <span data-level={level(pct)} style={{ "--pct": `${pct}%` } as CSSProperties} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voice chat (W22, thread/realtime/* over WebRTC via lib/voice.ts; Codex's composer.realtime,
// after the Dictate slot): six bars idle, three dots while connecting, three live bars (200–4000
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

/** A switch drawn in a menu row's trailing slot; the row itself is the menuitemcheckbox. */
export const MenuSwitch = ({ on }: { on: boolean }) => <span className="toggle" aria-hidden="true" aria-checked={on} />;

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
      <Submenu icon={<Icon name="Add" />} label="浏览连接器">
        {apps === null && <div className="menu-empty">正在加载…</div>}
        {apps?.length === 0 && <div className="menu-empty">没有可用的连接器</div>}
        <div className="menu-scroll">
          {apps?.map((app) => {
            const url = app.installUrl ? externalUrl(app.installUrl) : null;
            return (
              <MenuItem
                key={app.id}
                icon={<ConnectorIcon light={app.logoUrl} dark={app.logoUrlDark} />}
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
  if (connectors === null) return <MenuItem icon={<Icon name="Connectors" />} label="连接器" disabled onClick={() => {}} />;
  if (connectors.length === 0) return <MenuItem icon={<Icon name="Connectors" />} label="管理连接器" onClick={manage} />;
  return (
    <Submenu icon={<Icon name="Connectors" />} label="连接器">
      <MenuItem icon={<Icon name="Tool" />} label="管理连接器" onClick={manage} />
      <BrowseConnectors threadId={threadId} />
      <MenuSep />
      <div className="menu-scroll">
        {connectors.map((connector) => {
          const noTools = connector.enabled && !connector.callable;
          return (
            <MenuItem
              key={connector.id}
              icon={<ConnectorIcon light={connector.iconUrl} dark={connector.iconUrlDark} />}
              label={connector.name}
              hint={noTools ? "此连接器没有可用的工具" : undefined}
              toggle
              checked={connector.enabled}
              value={<MenuSwitch on={connector.enabled} />}
              disabled={noTools}
              onClick={() => setConnectorEnabled(connector.id, !connector.enabled).catch((error) => toast("warning", "切换连接器失败", errorMessage(error)))}
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
  if (plugins === null) return <MenuItem icon={<Icon name="Plugin" />} label="插件" disabled onClick={() => {}} />;
  if (enabled.length === 0) return <MenuItem icon={<Icon name="Plugin" />} label="添加插件" onClick={settings("setting-plugins-directory")} />;
  return (
    <Submenu icon={<Icon name="Plugin" />} label="插件">
      <div className="menu-scroll">
        {enabled.map((plugin) => (
          <MenuItem
            key={plugin.id}
            icon={plugin.interface?.composerIconUrl ? <img className="mention-icon" src={plugin.interface.composerIconUrl} alt="" /> : <Icon name="Plugin" />}
            label={plugin.interface?.displayName ?? plugin.name}
            hint={plugin.interface?.shortDescription ?? undefined}
            onClick={() => onPick(pluginMention(plugin))}
          />
        ))}
      </div>
      <MenuSep />
      <MenuItem icon={<Icon name="Tool" />} label="管理插件" onClick={settings("setting-plugins-installed")} />
      <MenuItem icon={<Icon name="Add" />} label="浏览插件" onClick={settings("setting-plugins-directory")} />
    </Submenu>
  );
}

// ---------------------------------------------------------------------------

/** Shell commands run from a composer, per session (no server history of the raw command lines). */
const shellRuns = new Map<string, string[]>();

type Dictation = "idle" | "starting" | "recording" | "finishing" | "error";
/** Claude's zh-Hans words for the dictation button (c47a58ae1: Dictate, Stop dictation, Finishing dictation…). */
const DICTATION_LABELS: Record<Dictation, string> = { idle: "语音输入", starting: "正在启动听写…", recording: "停止听写", finishing: "正在完成听写…", error: "语音输入" };

export function Composer({ threadId, form, autoFocus }: { threadId: string | null; form: "home" | "reply"; autoFocus?: boolean }) {
  const pendingSend = useStore((s) => s.pendingMessages[threadId ?? ""]);
  const thread = useStore((s) => (threadId ? s.threads[threadId] : undefined));
  const models = useStore((s) => s.models);
  const hiddenModels = useStore((s) => s.hiddenModels);
  const merged = useStore((s) => s.mergedModelPicker);
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
  const draftId = threadId ?? "new";
  const draftKey = `codex-ui:draft:${draftId}`;
  const [text, setText] = useState(() => readDraft(draftKey));
  const [attachments, setAttachments] = useState<Attachment[]>(() => keptAttachments.get(draftId) ?? []);
  /** Whether this draft's stored images are back; nothing is written over them before (c0fbbe82d `E`). */
  const [imagesRead, setImagesRead] = useState(() => keptAttachments.has(draftId));
  const [skills, setSkills] = useState<SkillMetadata[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [skillList, setSkillList] = useState<SkillMetadata[] | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const draftProject = useDraftProject();
  const [selected, setSelected] = useState(0);
  const [mentionResults, setMentionResults] = useState<{ path: string; name: string; dir: boolean; hits: number[] }[]>([]);
  const [sending, setSending] = useState(false);
  const [shell, setShell] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("");
  const [swapped, setSwapped] = useState(false);
  const [history, setHistory] = useState<{ index: number; draft: string } | null>(null);
  const [rewinding, setRewinding] = useState<number | null>(null);
  /** The caret, for the slash and @ menus (null: the end of the text). */
  const [caretAt, setCaretAt] = useState<number | null>(null);
  /** A press outside the slash or @ menu shuts it until the text or the caret moves (shared-5 $S). */
  const [shut, setShut] = useState(false);
  const lastEscape = useRef(-Infinity);
  const reduced = useReducedMotion();
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const compositionEnd = useRef(-Infinity);
  const chatgpt = useStore((s) => s.account?.account?.type === "chatgpt");
  const [dictation, setDictation] = useState<Dictation>("idle");
  const recording = useRef<Recording | null>(null);
  const alive = useRef(true);

  // The microphone closes with the composer.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      recording.current?.cancel();
      recording.current = null;
    };
  }, []);

  const running = !!activeTurn(thread);
  const effective = effectiveSettings(thread ?? null);
  const model = [...models, ...hiddenModels].find((m) => m.id === effective.model || m.model === effective.model);
  const acceptsImages = !model || model.inputModalities.includes("image");
  const planAvailable = modes.some((mode) => mode.mode === "plan");
  const autoAvailable = autoReviewAvailable();
  const goals = features.some((feature) => feature.name === "goals" && feature.enabled);
  const fastOffered = fastAvailable(effective.model);
  // The pick outlives a switch to a model without the tier (the server drops it per request),
  // so it only reads as on where the model offers it (c9543da06 Vs: modelSupportsFastMode && on).
  const fastOn = fastOffered && effective.serviceTier === "priority";
  const fastTier = model?.serviceTiers.find((tier) => tier.id === "priority");
  const efforts = model?.supportedReasoningEfforts ?? [];
  // Merged, the model pill names the level too: the one set, else the model's first, as the slider shows it.
  const pillEffort = merged ? (efforts.find((o) => o.reasoningEffort === effective.effort) ?? efforts[0])?.reasoningEffort : undefined;
  const shellName = platform === "windows" ? "PowerShell" : "bash";
  const hasInput = !!text.trim() || attachments.length > 0 || skills.length > 0 || mentions.length > 0;
  const showStop = running && !hasInput;
  const mode = modeOf(effective);
  const profile = effective.permissionProfile;
  // The model menu is one popover however it is open: its list folded ("model"), unfolded
  // ("models") or, merged, on the effort slider ("effort"); the pill and the chords close it from
  // any. Unmerged, "effort" is the effort button's popover and the list always shows.
  const modelMenu = (m: Menu) => m === "model" || m === "models" || (merged && m === "effort");
  const toggle = (next: Exclude<Menu, null>) => setMenu((current) => (current === next || (modelMenu(current) && modelMenu(next)) ? null : next));
  const modelOpen = modelMenu(menu);
  const listShown = !merged || menu === "models";
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
    if (imagesRead) return;
    let live = true;
    void readDraftImages(draftId).then((images) => {
      if (!live) return;
      // Images added while the read was out win over the stored ones.
      if (images.length) setAttachments((current) => (current.length ? current : images));
      setImagesRead(true);
    });
    return () => {
      live = false;
    };
  }, [draftId, imagesRead]);
  useEffect(() => {
    if (imagesRead) saveDraftImages(draftId, attachments);
  }, [draftId, attachments, imagesRead]);

  // A kept draft takes the caret at its end, not before its first character.
  useEffect(() => {
    const el = input.current;
    if (!autoFocus || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
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

  // Browser picks and annotations attach to their originating session, never the active draft of another one.
  useEffect(() => {
    const receive = (event: Event) => {
      const data = (event as CustomEvent<{ view: string; text: string; image: string }>).detail;
      if (data.view !== threadId || !data.image?.startsWith("data:image/png;base64,") || data.image.length > 32 * 1024 * 1024) return;
      setText((current) => `${current}${current ? "\n\n" : ""}${data.text}`);
      setAttachments((current) => [...current, { id: Date.now(), name: "浏览器截图.png", url: data.image }]);
      focusEnd();
    };
    window.addEventListener("composer-browser-context", receive);
    return () => window.removeEventListener("composer-browser-context", receive);
  }, [threadId]);

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

  const chips = attachments.length + skills.length + mentions.length;

  const override = (patch: OverridePatch) => setOverride(threadId, patch);
  const pick = (patch: OverridePatch) => {
    override(patch);
    setMenu(null);
  };
  // Merged, a model pick folds the list again and leaves the menu open on the effort and fast
  // mode; focus in the list moves to the 模型 row as the list goes.
  const pickModel = (id: string) => {
    if (!merged) return pick({ model: id });
    override({ model: id });
    setMenu("model");
    (document.activeElement as HTMLElement | null)?.closest(".popover")?.querySelector<HTMLElement>(".model-row")?.focus({ preventScroll: true });
  };
  const pickMode = (id: ModeId) => {
    if (id === "plan") return pick({ planMode: true });
    const reviewer = autoAvailable || effective.reviewer === "auto_review" ? (id === "auto" ? "auto_review" : "user") : undefined;
    pick({ planMode: false, permission: MODE_PRESET[id], ...(reviewer ? { reviewer } : {}) });
  };
  const setFast = (on: boolean) => {
    override({ serviceTier: on ? "priority" : "default" });
    setStatus(on ? "快速模式已开启" : "快速模式已关闭");
  };
  const toggleFast = () => setFast(!fastOn);
  const effortMenu = () => setMenu(efforts.length > 1 ? "effort" : "models");

  // Global keys while this composer is on screen (W14 shortcut table, desktop column).
  const keys = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    // Digits 1–9 pick within the open mode menu or the model menu's shown list (shared-7 shortcuts).
    if (!mod && !event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key) && ((modelOpen && listShown) || menu === "mode")) {
      const index = Number(event.key) - 1;
      if (modelOpen && listShown && mainModels[index]) pickModel(mainModels[index].id);
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
        ? "models"
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
        // It opens the slider (in the model menu when merged), or the model list with one level or
        // none (c227f4d5e pQ).
        if (modelOpen || menu === "effort") setMenu(null);
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
    // Space presses a focused button instead (cc43287c9).
    if (event.key === " " && active?.matches("button, [role=button], [role=switch], [role=checkbox], [role=radio]")) return;
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

  const fail = (title: string) => (error: unknown) => toast("warning", title, errorMessage(error));

  // App commands (cc183b3ab, descriptions translated) plus Codex's own (/goal, /hooks, /memory,
  // /logout). Picking one inserts it; Enter runs it with what follows (c5cd1b4dc 3255-3263).
  const commands: SlashCommand[] = [
      { name: "new", description: "以空白上下文开始新会话", run: newChat },
      {
        name: "model",
        description: "设置此会话的模型",
        run: (args) => {
          const query = args.toLowerCase();
          const found = query && [...models, ...hiddenModels].find((m) => [m.id, m.model, m.displayName].some((name) => name.toLowerCase() === query));
          if (found) override({ model: found.id });
          else setMenu("models");
        },
      },
      {
        name: "effort",
        description: "设置本次会话的投入程度",
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
              description: "切换到计划模式或查看此会话的计划",
              // cc43287c9 T$: a description (anything but open / share) is sent in plan mode; without
              // one the plan pane opens when there is a plan, or a notice says plan mode is on already.
              run: (args: string) => {
                const described = args !== "" && !["open", "share"].includes(args.toLowerCase());
                if (described && (/^\/[\w:-]+(?=[\s:,.]|$)/.test(args) || args.startsWith("!"))) {
                  setText(`/plan ${args}`);
                  toast("warning", "/plan 接受的是描述，而不是命令。请去掉描述开头的“/”或“!”后重试。");
                  return;
                }
                const planning = effective.planMode;
                if (!planning) override({ planMode: true });
                if (described) return args;
                const planned = !!thread && (hasPlan(thread) || !!thread.olderCursor);
                if (planned && threadId && !layoutOf(threadId).open.includes("plan")) openPane("plan", threadId);
                else if (planning) toast("neutral", planned ? "已处于规划模式。" : "已处于计划模式。尚未编写计划。");
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
      { name: "review", description: "审查当前差异，查找缺陷和需清理之处", run: () => setState({ dialog: { type: "review", threadId } }) },
      { name: "init", description: "初始化包含代码库文档的新 AGENTS.md 文件", run: () => initPrompt },
      { name: "compact", description: "通过总结目前为止的会话内容来释放上下文", needsThread: true, run: () => threadId && compactThread(threadId).catch(fail("无法开始压缩。")) },
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
            .catch(fail("无法分叉此会话。")),
      },
      {
        name: "rename",
        description: "重命名此会话",
        needsThread: true,
        run: (args) => threadId && (args ? renameThread(threadId, args).catch(fail("重命名失败。您可以重试。")) : setState({ dialog: { type: "rename", threadId } })),
      },
      { name: "rewind", description: "将会话回退到较早的消息", needsThread: true, run: () => sent.length && setRewinding(0) },
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
      { name: "usage", description: "显示套餐用量和使用限额", run: () => setMenu("usage") },
      { name: "mcp", description: "管理 MCP 连接器", run: () => openSettings("mcp") },
      { name: "skills", description: "浏览和管理您的 Skills", run: () => openSettings("skills") },
      { name: "plugin", aliases: ["plugins"], description: "管理 Codex 插件", run: () => openSettings("plugins") },
      { name: "hooks", description: "管理钩子", run: () => openSettings("hooks") },
      { name: "memory", description: "管理记忆", run: () => openSettings("memory") },
      { name: "config", aliases: ["settings"], description: "打开 Codex 设置", run: () => openSettings("general") },
      { name: "logout", description: "退出登录", run: () => void logout().catch(fail("退出登录失败")) },
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

  useEffect(() => setShut(false), [text, caret]);
  const popup: "slash" | "mention" | null = shut ? null : slashMatches.length ? "slash" : mentionQuery !== undefined && mentionResults.length ? "mention" : null;
  const popupLength = popup === "slash" ? slashMatches.length : mentionResults.length;
  useEffect(() => setSelected(0), [popup, slashQuery, mentionQuery]);
  useEffect(() => {
    if (!popup) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element;
      if (target !== input.current && !target.closest?.(".composer-popup")) setShut(true);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [popup]);

  async function addFiles(files: Iterable<File>) {
    const list = [...files];
    if (!list.length) return;
    if (shell) {
      toast("neutral", `${shellName} 模式已开启，因此未添加任何内容。请在空白消息框中按 Backspace 键返回对话，然后重试。`);
      return;
    }
    if (!acceptsImages) {
      toast("warning", "此模型不支持图像。");
      return;
    }
    const images = list.filter((file) => IMAGE_TYPES.includes(file.type));
    if (images.length < list.length) toast("warning", "仅支持 PNG、JPEG、GIF 和 WebP 图片。");
    const small = images.filter((file) => file.size <= MAX_IMAGE_BYTES);
    if (small.length < images.length) toast("warning", "部分图片过大，无法附加。最大为 30 MB。");
    const room = MAX_IMAGES - attachments.length;
    if (small.length > room) toast("warning", `最多允许 ${MAX_IMAGES} 张图片。`);
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

  // Dictation (Codex composer.dictation): a tap records, the next one transcribes into the draft
  // at the caret; a failure says why and turns the button red for 1.5s (c47a58ae1 De).
  async function dictate() {
    if (dictation === "recording") {
      const clip = recording.current;
      recording.current = null;
      setDictation("finishing");
      try {
        const spoken = clip ? (await transcribe(await clip.stop())).trim() : "";
        if (!spoken) throw new Error("没听清楚。请重试");
        if (!alive.current) return;
        const value = input.current?.value ?? "";
        const next = spliceDictation(value, input.current?.selectionStart ?? value.length, input.current?.selectionEnd ?? value.length, spoken);
        writeAt(next.text, next.caret);
        setDictation("idle");
      } catch (error) {
        failDictation("无法转录音频", errorMessage(error));
      }
      return;
    }
    if (dictation !== "idle") return;
    setDictation("starting");
    try {
      const started = await record();
      if (!alive.current) return started.cancel();
      recording.current = started;
      setDictation("recording");
    } catch (error) {
      failDictation("无法开始听写", micError(error));
    }
  }

  function failDictation(title: string, message: string) {
    if (!alive.current) return;
    toast("warning", title, message);
    setDictation("error");
    setTimeout(() => setDictation((state) => (state === "error" ? "idle" : state)), 1500);
  }

  // Voice chat (Codex composer.realtime): in a session it talks there; the new-session page
  // starts the session first (开始新的语音聊天).
  async function toggleVoice() {
    if (myVoice !== "idle") return void stopVoice();
    let id = threadId;
    try {
      id ??= await startThread();
    } catch (error) {
      return void toast("warning", "无法开启语音对话", errorMessage(error));
    }
    void startVoice(id).catch(() => {});
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
      toast("neutral", "消息已撤回。其附件无法返回到输入框。");
    focusEnd();
  }

  /**
   * Sent or run: the editor empties, and its stored draft goes here rather than through the save
   * effect, as the composer may be gone by now (sending from the new-session page opens the
   * session in its place) and an unmounted one never writes the empty text back.
   */
  function clearDraft() {
    saveDraft(draftKey, "");
    setText("");
    setHistory(null);
  }

  async function submit(opts: { queue?: boolean } = {}) {
    let body = text.trim();
    if (sending || pendingSend) return;
    if (shell) {
      if (!body) return;
      setSending(true);
      try {
        await runShellCommand(threadId, body);
        const key = getState().activeId ?? threadId ?? "";
        shellRuns.set(key, [...(shellRuns.get(key) ?? []), body]);
        clearDraft();
      } catch (error) {
        toast("warning", "命令未运行", errorMessage(error));
      } finally {
        setSending(false);
        input.current?.focus();
      }
      return;
    }
    const slash = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(body);
    const command = slash && findCommand(slash[1]);
    if (command) {
      clearDraft();
      const message = command.run(slash?.[2]?.trim() ?? "");
      if (typeof message !== "string" || !message) return;
      body = message;
    }
    if (!body && attachments.length === 0 && skills.length === 0 && mentions.length === 0) return;
    // A cloud environment's first message starts a Codex Cloud task, which takes text only.
    const cloud = threadId ? undefined : getState().projects.find((project) => project.id === prefs.projectId && environmentOf(project).kind === "cloud");
    if (cloud) {
      if (attachments.length || skills.length || mentions.length || !body) return void toast("warning", "云端任务只能发送文字消息");
      setSending(true);
      try {
        openCloudTask(await startCloudTask(cloud, body));
        clearDraft();
      } catch (error) {
        toast("warning", "发送失败", errorMessage(error));
      } finally {
        setSending(false);
      }
      return;
    }
    setSending(true);
    try {
      const inputs: UserInput[] = [
        ...attachments.map((a): UserInput => ({ type: "image", url: a.url })),
        ...skills.map((skill): UserInput => ({ type: "skill", name: skill.name, path: skill.path })),
        ...mentions,
      ];
      if (body) inputs.push({ type: "text", text: body, text_elements: [] });
      // A message sent while a question waits answers it first, so the turn reads it next (asked.ts).
      if (threadId && !opts.queue) answerWithMessage(threadId);
      // An offer waiting on its card closes too: the agent reads this message first (Claude typedPast).
      if (threadId) noteUserMessage(threadId);
      const submitted = sendMessage(threadId, inputs, opts);
      const echoed = getState().pendingMessages[threadId ?? ""]?.item.content === inputs;
      const clearSubmitted = () => {
        clearDraft();
        // Directly too: sending from the new-session page may unmount this composer first.
        clearDraftImages(draftId);
        setAttachments([]);
        setSkills([]);
        setMentions([]);
      };
      // The local echo owns failed input now; do not erase a newer draft when the request returns.
      if (echoed) clearSubmitted();
      await submitted;
      if (!echoed) clearSubmitted();
    } catch (error) {
      toast("warning", opts.queue ? "加入队列失败" : "发送失败", errorMessage(error));
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  /** A keyboard move keeps the popup's row in view (shared-5 SS); the first row shows the top. */
  function reveal(index: number) {
    const row = input.current?.closest(".composer")?.querySelectorAll(".popup-item")[index];
    if (index) row?.scrollIntoView({ block: "nearest" });
    else row?.parentElement?.scrollTo({ top: 0 });
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
        const next = (rewinding + (event.key === "ArrowDown" ? 1 : sent.length - 1)) % sent.length;
        setRewinding(next);
        reveal(next);
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
        const next = (selected + (event.key === "ArrowDown" ? 1 : popupLength - 1)) % popupLength;
        setSelected(next);
        reveal(next);
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
    setStatus("对话模式");
  }

  function recall(index: number, draft: string) {
    setHistory({ index, draft });
    setText(recalled[recalled.length - index].text);
    setStatus(`历史记录 ${index}/${recalled.length}${draft.trim() ? " 按 ↓ 恢复您的草稿" : ""}`);
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
  // Enter / Ctrl+Enter, shortened on a narrow card; shell mode asks for a command. While dictation
  // records, it says so in italics above all of these (c227f4d5e uM / kM, shared-5 eN).
  const placeholder: ReactNode = dictation === "recording" ? (
    <span className="ph-listening">正在聆听…</span>
  ) : shell ? (
    <span>输入 shell 命令</span>
  ) : running ? (
    <>
      <span className="ph-full">
        按 {SEND_KEY} 发送，按 {QUEUE_KEY} 加入队列稍后发送
      </span>
      <span className="ph-short">按 {QUEUE_KEY} 加入队列</span>
    </>
  ) : form === "reply" ? (
    <span>输入 / 以使用命令</span>
  ) : (
    <span>{firstRun ? "描述要构建、修改或修复的内容" : "描述任务或提出问题"}</span>
  );

  const sendTip = running ? `发送 · ${SEND_KEY}\n加入队列稍后执行 · ${QUEUE_KEY}` : undefined;
  const coarse = matchMedia("(pointer: coarse)").matches;
  const myVoice = voice.status !== "idle" && voice.threadId === threadId ? voice.status : "idle";
  // The card's Dictate slot (c227f4d5e CQ) holds Claude's microphone, which dictates as Codex's
  // does (ChatGPT transcription, so it needs a ChatGPT login) and is otherwise disabled with the
  // reason in its tooltip; Codex's voice chat follows where Codex offers it.
  const dictationBlocked = !dictationSupported() ? "此设备不支持听写" : !chatgpt ? "听写需要使用 ChatGPT 账户登录 Codex" : null;
  const listening = dictation === "starting" || dictation === "recording";
  // The send cell keeps its square while empty (c227f4d5e lM sendOnDraftOnly): send shows only with
  // something to send, stop while a turn runs on an empty draft; voice follows it (idleSendAction).
  const trailing = (
    <span className="composer-trailing" data-tip-group="">
      {shell && (
        <span className="shell-pill" data-tip={"作为 shell 命令运行\n不经过沙盒"} aria-hidden="true">
          {shellName}
        </span>
      )}
      {running && hasInput && coarse && (
        <Popover
          open={menu === "send"}
          onClose={() => setMenu(null)}
          placement="top-end"
          anchor={<Button variant="ghost" icon={<Icon name="CaretDown" size={16} />} label="更多发送选项" aria-expanded={menu === "send"} onClick={() => toggle("send")} />}
        >
          <MenuItem
            label="加入队列稍后执行"
            onClick={() => {
              setMenu(null);
              void submit({ queue: true });
            }}
          />
          <MenuSep />
          <MenuItem
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
          data-on={hasInput || undefined}
          inert={!hasInput}
          aria-hidden={!hasInput || undefined}
          aria-busy={sending || undefined}
          variant="ghost"
          icon={sending ? <Spinner size={16} inherit /> : <Icon name="ArrowReturn" />}
          label={sending ? "正在发送" : "发送"}
          tip={sendTip}
          kbd={running ? undefined : SEND_KEY}
          disabled={sending || !!pendingSend}
          onClick={() => void submit()}
        />
        <Button
          data-on={showStop || undefined}
          inert={!showStop}
          aria-hidden={!showStop || undefined}
          variant="ghost"
          icon={<Icon name="StopCircle" />}
          label="停止"
          kbd="Esc"
          onClick={() => threadId && void interrupt(threadId)}
        />
      </span>
      <Button
        variant="ghost"
        ink2
        active={dictation === "recording"}
        className="dictate-btn"
        data-error={dictation === "error" || undefined}
        icon={dictation === "finishing" ? <Spinner size={16} inherit /> : <Icon name={listening ? "MicrophoneFilled" : "Microphone"} />}
        label={DICTATION_LABELS[dictation]}
        data-tip-detail={dictationBlocked ?? undefined}
        aria-pressed={dictationBlocked ? undefined : listening}
        aria-busy={dictation === "starting" || dictation === "finishing" || undefined}
        disabled={!!dictationBlocked && dictation === "idle"}
        onClick={() => void dictate()}
      />
      {voiceAvailable() && (
        <Button
          variant="ghost"
          ink2
          className="voice-btn"
          icon={<VoiceBars state={myVoice} />}
          label={myVoice === "connecting" ? "取消语音对话" : myVoice === "active" ? "结束语音对话" : threadId ? "开启语音对话" : "开始新的语音对话"}
          aria-pressed={myVoice !== "idle"}
          onClick={() => void toggleVoice()}
        />
      )}
    </span>
  );

  const modeLabel = mode ? (MODES.find((m) => m.id === mode)?.label ?? "") : (profile ?? "自定义");

  return (
    <fieldset className="composer-wrap" data-form={form}>
      {myVoice === "active" && <VoiceOrb />}
      {form === "reply" && thread && <QueueBar thread={thread} onEdit={takeBack} />}
      <div className="composer" data-shell={shell || undefined}>
        {/* Rows take the pointer on mousemove, not mouseenter: rows a keyboard move scrolls
            under a resting pointer keep the keyboard's pick (shared-5 hasMouseMoved). */}
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
                onMouseMove={() => setSelected(index)}
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
                onMouseMove={() => setSelected(index)}
                onClick={() => insertMention(file.path)}
              >
                <Icon name={file.dir ? "Folder" : fileGlyph(file.path)} size="sm" className="popup-icon" />
                <span className="popup-name">
                  {Array.from(file.name).map((char, i) => (file.hits.includes(i) ? <b key={i}>{char}</b> : char))}
                </span>
                {relativePath(file.path, cwd) !== file.name && <span className="popup-desc">{relativePath(file.path, cwd)}</span>}
              </button>
            ))}
          </div>
        )}
        {rewinding !== null && (
          <div className="composer-popup" role="listbox" aria-label="回退会话">
            <div className="menu-section">回溯</div>
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
                  onMouseMove={() => setRewinding(index)}
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
              历史记录 {history.index}/{recalled.length}
            </span>
            {history.draft.trim() && (
              <>
                <span>·</span>
                <span>
                  按 <kbd className="kbd">↓</kbd> 恢复您的草稿
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
                  <Icon name="X" size="xs" />
                </button>
              </div>
            ))}
            {skills.map((skill) => (
              <button
                key={skill.path}
                type="button"
                className="skill-chip"
                data-tip="移除 Skill"
                aria-label={`移除 Skill ${skill.interface?.displayName ?? skill.name}`}
                onClick={() => setSkills((current) => current.filter((s) => s.path !== skill.path))}
              >
                <span className="skill-chip-slash" aria-hidden="true">
                  /
                </span>
                {skill.interface?.displayName ?? skill.name}
              </button>
            ))}
            {mentions.map((mention) => (
              <button
                key={mention.path}
                type="button"
                className="skill-chip"
                data-tip="移除"
                aria-label={`移除 ${mention.name}`}
                onClick={() => setMentions((current) => current.filter((m) => m.path !== mention.path))}
              >
                {mention.name}
              </button>
            ))}
          </div>
        )}

        <div className="composer-body">
          <Popover
            open={menu === "plus"}
            onClose={() => setMenu(null)}
            placement="top-start"
            className="menu-plus"
            anchor={<Button variant="ghost" ink2 icon={<Icon name="Add" />} label="添加" data-tip-group="" aria-expanded={menu === "plus"} onClick={() => toggle("plus")} />}
          >
            <MenuItem
              icon={<Icon name="Attachment" />}
              label="添加图片"
              kbd={FILE_KEY}
              disabled={!acceptsImages || shell}
              onClick={() => {
                setMenu(null);
                fileInput.current?.click();
              }}
            />
            <MenuItem
              icon={<Icon name="SlashShortcutCommand" />}
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
              <Submenu icon={<Icon name="Scroll" />} label="Skills">
                {skillList === null && <div className="menu-empty">正在加载…</div>}
                {skillList?.length === 0 && <div className="menu-empty">没有可用的 Skills</div>}
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
                icon={<Icon name="Memory" />}
                label="记忆"
                toggle
                checked={memoryOn}
                onClick={() => {
                  setMenu(null);
                  setMemoryMode(threadId, memoryOn ? "disabled" : "enabled").catch(fail("无法更新记忆设置。请重试。"));
                }}
              />
            )}
          </Popover>
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
        <div className="chin-row" data-size="xs" data-tip-group={form === "home" ? "" : undefined}>
          <div className="chin-lead">
            {form === "home" && <PlacePill open={menu === "env"} onToggle={() => toggle("env")} onClose={() => setMenu(null)} />}
            {form === "home" && !draftProject && <FolderPill open={menu === "folder"} onToggle={() => toggle("folder")} onClose={() => setMenu(null)} />}
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
                  <MenuSection title="权限配置文件" />
                  {profiles.map((p) => (
                    <MenuItem
                      key={p.id}
                      icon={<Icon name="LockShield" />}
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
              open={modelOpen}
              onClose={() => setMenu(null)}
              placement="top-end"
              className="menu-model menu-digits"
              anchor={
                <Button
                  variant="ghost"
                  size="xs"
                  ink2
                  className="model-trigger"
                  // At Max the warning is the whole tooltip (shared-7 xx: content de, multiline).
                  kbd={pillEffort === WARNING_EFFORT ? undefined : "Ctrl+Shift+I"}
                  tip={pillEffort === WARNING_EFFORT ? WARNING_TEXT : "模型"}
                  data-tip-multiline={pillEffort === WARNING_EFFORT || undefined}
                  aria-label={`模型：${modelLabel(effective.model)}${fastOn ? " 快速" : ""}${pillEffort ? ` ${effortName(pillEffort)}` : ""}${pillEffort === WARNING_EFFORT ? " 使用量较高" : ""}`}
                  aria-expanded={modelOpen}
                  onClick={() => toggle(efforts.length > 1 ? "model" : "models")}
                >
                  <span className="btn-label">
                    {modelLabel(effective.model)}
                    {fastOn && <span className="model-fast"> 快速</span>}
                    {pillEffort && (
                      <span className="model-effort" data-pro={pillEffort === PRO_EFFORT || undefined}>
                        {" "}
                        {effortName(pillEffort)}
                      </span>
                    )}
                  </span>
                  {pillEffort === WARNING_EFFORT && <Icon name="Warning" size="xs" className="warn-glyph" />}
                </Button>
              }
            >
              {/* Merged, the model row folds the list away until it is clicked (Ctrl+Shift+I and
                  /model open the menu unfolded), and a pick folds it again. The list unfolds above
                  the row: the menu grows up from the pill, so the row stays under the pointer and
                  the same click folds it. */}
              {listShown && (
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
                      kbd={index < 9 && m.id !== model?.id ? String(index + 1) : undefined}
                      checked={m.id === model?.id}
                      onClick={() => pickModel(m.id)}
                    />
                  ))}
                  {mainModels.length === 0 && <div className="menu-empty">无可用模型</div>}
                </div>
              )}
              {merged && listShown && <MenuSep />}
              {merged && (
                <button type="button" role="menuitem" className="menu-item model-row" aria-expanded={menu === "models"} onClick={() => setMenu(menu === "models" ? "model" : "models")}>
                  <span className="menu-text">
                    <span className="menu-label">
                      <span className="model-row-title">模型</span>
                      {modelLabel(effective.model)}
                    </span>
                  </span>
                  <Icon name="CaretUp" size="sm" className="menu-chevron model-row-caret" />
                </button>
              )}
              {merged && efforts.length > 1 && (
                <>
                  <MenuSep />
                  <EffortSlider model={model} effort={effective.effort} fast={fastOn} autoFocus={menu === "effort"} onPick={(effort) => override({ effort })} />
                </>
              )}
              {fastOffered && (
                <>
                  <MenuSep />
                  <MenuItem label="快速模式" hint={fastTier?.description || undefined} toggle checked={fastOn} value={<MenuSwitch on={fastOn} />} onClick={toggleFast} />
                </>
              )}
            </Popover>

            {!merged && <EffortControl model={model} effort={effective.effort} fast={fastOn} open={menu === "effort"} onToggle={() => toggle("effort")} onClose={() => setMenu(null)} onPick={(effort) => override({ effort })} />}

            <UsageMeter thread={thread} model={effective.model} open={menu === "usage"} onToggle={() => toggle("usage")} onClose={() => setMenu(null)} />
            {fastOffered && <span className="sr-only">{fastOn ? "快速模式已开启" : "快速模式已关闭"}</span>}
          </div>
        </div>
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {shell ? `${shellName} 模式。按 Escape 键返回对话。` : status}
      </span>
      {dragging && <DropScrim label="将文件拖放到此处" />}
    </fieldset>
  );
}
