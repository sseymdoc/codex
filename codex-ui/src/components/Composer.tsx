// The composer (claude.ai audit W3, W4, W5, W14). Two forms share one component:
// - home (new session): a two-row editor, "+" and send in an absolute action row, and
//   the chin below the card with the project, model and permission pickers;
// - reply (in a session): editor and send on one 32px row, "+" moved into the chin,
//   and the queue bar on top for messages sent while a turn runs.
// Slash commands, @file mentions, image attachments, skills and per-thread drafts.

import type { SkillMetadata } from "@protocol/v2/SkillMetadata";
import type { UserInput } from "@protocol/v2/UserInput";
import {
  ArrowUp,
  AtSign,
  ChevronDown,
  CornerDownLeft,
  FileText,
  Folder,
  FolderOpen,
  GripVertical,
  ImagePlus,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  Square,
  Terminal,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import initPrompt from "../../../codex-rs/tui/assets/prompt_for_init_command.md?raw";
import {
  PRESETS,
  activeTurn,
  compactThread,
  effectiveSettings,
  errorMessage,
  forkThread,
  interrupt,
  listSkills,
  logout,
  modelLabel,
  newChat,
  refreshConfig,
  removeQueued,
  reorderQueue,
  runShellCommand,
  searchFiles,
  sendMessage,
  sendQueuedNow,
  setGoal,
  setOverride,
} from "../lib/codex";
import { basename, formatTokens, relativePath, samePath } from "../lib/format";
import { getState, setState, toast, useStore, type PermissionPreset, type ThreadState } from "../lib/store";
import { Button, MenuItem, MenuSection, MenuSep, Popover, Submenu, UsageRing } from "./ui";

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

const HEAVY_EFFORTS = new Set(["xhigh", "max", "ultra"]);

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

type Menu = null | "plus" | "model" | "permission" | "project";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const FIELD_SIZING = CSS.supports("field-sizing", "content");

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

export function setComposerDraft(text: string) {
  window.dispatchEvent(new CustomEvent("composer-draft", { detail: text }));
}

// ---------------------------------------------------------------------------
// Queue bar (cf74bc599): one queued message is a single row; several fold under a
// header, each with send now, remove, a drag grip and a menu.

function QueueBar({ thread, onEdit }: { thread: ThreadState; onEdit(text: string): void }) {
  const [open, setOpen] = useState(true);
  const [menu, setMenu] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const { queue } = thread;
  const id = thread.meta.id;
  if (!queue.length) return null;
  const hint = activeTurn(thread) ? "Codex 会在下一步读到这条消息" : "立即开始这一条";
  const fail = (title: string) => (error: unknown) => toast("error", title, errorMessage(error));
  const sendNow = (qid: string) => sendQueuedNow(id, qid).catch(fail("发送失败"));
  const remove = (qid: string) => removeQueued(id, qid).catch(fail("移除失败"));
  const edit = (qid: string) => {
    const queued = queue.find((q) => q.id === qid);
    if (!queued) return;
    onEdit(inputText(queued.input));
    void remove(qid);
  };
  const drop = (target: string) => {
    if (!dragging || dragging === target) return;
    const ids = queue.map((q) => q.id).filter((x) => x !== dragging);
    ids.splice(ids.indexOf(target), 0, dragging);
    reorderQueue(id, ids).catch(fail("调整顺序失败"));
  };

  if (queue.length === 1) {
    const [only] = queue;
    return (
      <div className="queue">
        <div className="queue-single">
          <span className="queue-count">1 条消息排队中</span>
          <span className="queue-preview">{inputText(only.input) || "（图片）"}</span>
          <span className="queue-actions">
            <Button variant="ghost" size="xs" muted icon={<CornerDownLeft size={14} />} label="立即发送" tip={hint} onClick={() => void sendNow(only.id)} />
            <Button variant="ghost" size="xs" muted icon={<Pencil size={14} />} label="在输入框中编辑" onClick={() => edit(only.id)} />
            <Button variant="ghost" size="xs" muted icon={<X size={14} />} label="移出队列" onClick={() => void remove(only.id)} />
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="queue">
      <button type="button" className="queue-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="queue-count">{queue.length} 条消息排队中</span>
        <span className="rail-caret">
          <ChevronDown size={12} style={{ rotate: "-90deg" }} />
        </span>
      </button>
      {open && (
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
                event.preventDefault();
                setOver(null);
                drop(q.id);
              }}
            >
              <span className="queue-text">{inputText(q.input) || "（图片）"}</span>
              <span className="queue-actions">
                <Button variant="ghost" size="xs" muted icon={<CornerDownLeft size={14} />} label="立即发送" tip={hint} onClick={() => void sendNow(q.id)} />
                <Button variant="ghost" size="xs" muted icon={<X size={14} />} label="移出队列" onClick={() => void remove(q.id)} />
                <span
                  className="btn btn-ghost btn-xs btn-icon btn-muted queue-grip"
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
                    <Button variant="ghost" size="xs" muted icon={<MoreHorizontal size={14} />} label="更多操作" aria-expanded={menu === q.id} onClick={() => setMenu(menu === q.id ? null : q.id)} />
                  }
                >
                  <MenuItem
                    icon={<Pencil size={16} />}
                    label="在输入框中编辑"
                    onClick={() => {
                      setMenu(null);
                      edit(q.id);
                    }}
                  />
                </Popover>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ContextRing({ threadId }: { threadId: string | null }) {
  const usage = useStore((s) => (threadId ? s.threads[threadId]?.tokenUsage : null));
  if (!usage?.modelContextWindow) return null;
  const percent = Math.min(100, (usage.last.totalTokens / usage.modelContextWindow) * 100);
  // Only worth a glance when the window is filling; the session rail has the detail.
  if (percent < 60) return null;
  return (
    <span
      className="btn btn-ghost btn-xs btn-ink2 hide-narrow"
      data-tip={`上下文已用 ${Math.round(percent)}%（${formatTokens(usage.last.totalTokens)} / ${formatTokens(usage.modelContextWindow)}），可用 /compact 压缩`}
    >
      <UsageRing value={percent} size={14} stroke={2} />
      <span className="tabular">{Math.round(percent)}%</span>
    </span>
  );
}

function ProjectMenu({ open, onToggle, onClose }: { open: boolean; onToggle(): void; onClose(): void }) {
  const cwd = useStore((s) => s.prefs.cwd);
  const threads = useStore((s) => s.threads);
  const recent = useMemo(() => {
    const seen = new Map<string, number>();
    for (const { meta } of Object.values(threads)) seen.set(meta.cwd, Math.max(seen.get(meta.cwd) ?? 0, meta.recencyAt ?? meta.updatedAt));
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([path]) => path).slice(0, 6);
  }, [threads]);
  const choose = (path: string) => {
    onClose();
    setState((s) => ({ prefs: { ...s.prefs, cwd: path } }));
    void refreshConfig();
  };
  return (
    <Popover
      open={open}
      onClose={onClose}
      placement="bottom-start"
      className="menu-wide"
      anchor={
        <Button variant="ghost" size="xs" ink2 tip={cwd} aria-expanded={open} onClick={onToggle}>
          <Folder size={14} />
          <span className="btn-label">{basename(cwd) || "选择项目"}</span>
          <ChevronDown size={12} className="caret" />
        </Button>
      }
    >
      <MenuSection title="最近的项目" />
      {recent.map((path) => (
        <MenuItem key={path} icon={<Folder size={16} />} label={basename(path)} hint={path} checked={samePath(path, cwd)} onClick={() => choose(path)} />
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
    </Popover>
  );
}

export function Composer({ threadId, form, autoFocus }: { threadId: string | null; form: "home" | "reply"; autoFocus?: boolean }) {
  const thread = useStore((s) => (threadId ? s.threads[threadId] : undefined));
  const models = useStore((s) => s.models);
  const modes = useStore((s) => s.modes);
  const goals = useStore((s) => s.features.some((feature) => feature.name === "goals" && feature.enabled));
  useStore((s) => s.config);
  useStore((s) => s.prefs);
  const cwd = useStore((s) => (thread ? (thread.settings?.cwd ?? thread.meta.cwd) : s.prefs.cwd));
  const draftKey = `codex-ui:draft:${threadId ?? "new"}`;
  const [text, setText] = useState(() => readDraft(draftKey));
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [skills, setSkills] = useState<SkillMetadata[]>([]);
  const [skillList, setSkillList] = useState<SkillMetadata[] | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [selected, setSelected] = useState(0);
  const [mentionResults, setMentionResults] = useState<{ path: string; name: string; dir: boolean }[]>([]);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);

  const running = !!activeTurn(thread);
  const effective = effectiveSettings(thread ?? null);
  const model = models.find((m) => m.id === effective.model || m.model === effective.model);
  const efforts = model?.supportedReasoningEfforts ?? [];
  const acceptsImages = !model || model.inputModalities.includes("image");
  const shellMode = text.startsWith("!");
  const planAvailable = modes.some((mode) => mode.mode === "plan");
  const hasInput = !!text.trim() || attachments.length > 0 || skills.length > 0;
  const toggle = (next: Exclude<Menu, null>) => setMenu((current) => (current === next ? null : next));

  useEffect(() => saveDraft(draftKey, text), [draftKey, text]);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus, threadId]);

  // Starters on the new-session page prefill the draft.
  useEffect(() => {
    const onDraft = (event: Event) => {
      setText((event as CustomEvent<string>).detail);
      input.current?.focus();
    };
    window.addEventListener("composer-draft", onDraft);
    return () => window.removeEventListener("composer-draft", onDraft);
  }, []);

  // Type anywhere: a printable key pressed outside any field lands in the composer.
  // Ctrl+U attaches an image; Ctrl+Shift+I / E open the model menu.
  useEffect(() => {
    if (!autoFocus) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const { dialog, settings, palette, lightbox } = getState();
      if (dialog || settings || palette || lightbox) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && !event.shiftKey && !event.altKey && key === "u") {
        event.preventDefault();
        fileInput.current?.click();
        return;
      }
      if (mod && event.shiftKey && (key === "i" || key === "e")) {
        event.preventDefault();
        setMenu("model");
        return;
      }
      if (mod || event.altKey || event.key.length !== 1) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest("input, textarea, select, [contenteditable], [role=dialog], [role=alertdialog], .popover")) return;
      input.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [autoFocus]);

  // Auto-grow fallback for browsers without `field-sizing`; CSS max-height caps it.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el || FIELD_SIZING) return;
    el.style.height = "";
    if (text) el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const loadSkills = () => {
    if (skillList) return;
    listSkills(cwd)
      .then((entries) => setSkillList(entries.flatMap((entry) => entry.skills).filter((skill) => skill.enabled)))
      .catch(() => setSkillList([]));
  };

  // Slash command palette is active while the first token starts with "/".
  const slashQuery = /^\/(\S*)$/.exec(text)?.[1];
  const commands = useMemo<SlashCommand[]>(
    () => [
      { name: "new", description: "开始新的会话", run: newChat },
      { name: "model", description: "切换模型与推理强度", run: () => setMenu("model") },
      { name: "permissions", description: "设置权限模式", run: () => setMenu("permission") },
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
      { name: "init", description: "为仓库生成 AGENTS.md 贡献指南", run: () => void submit(initPrompt) },
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
      { name: "usage", description: "查看用量统计", run: () => setState({ settings: "account" }) },
      { name: "mcp", description: "查看 MCP 服务器", run: () => setState({ settings: "mcp" }) },
      { name: "skills", description: "管理技能", run: () => setState({ settings: "skills" }) },
      { name: "settings", description: "打开设置", run: () => setState({ settings: "general" }) },
      { name: "logout", description: "退出登录", run: () => void logout().catch((error) => toast("error", "退出失败", errorMessage(error))) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threadId, planAvailable, goals, effective.planMode],
  );
  const slashMatches =
    slashQuery === undefined ? [] : commands.filter((c) => c.name.startsWith(slashQuery.toLowerCase()) && (!c.needsThread || threadId));

  // @mention: the token right before the caret.
  const mentionQuery = useMemo(() => {
    const caret = input.current?.selectionStart ?? text.length;
    return /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))?.[1];
  }, [text]);

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
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > MAX_IMAGE_BYTES) {
        toast("warning", `${file.name} 超过 20 MB，已忽略`);
        continue;
      }
      const url = await readAsDataUrl(file);
      setAttachments((current) => [...current, { id: Date.now() + Math.random(), name: file.name || "粘贴的图片", url }]);
    }
  }

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

  function insertPrefix(prefix: string) {
    setMenu(null);
    setText((current) => (prefix === "!" ? `!${current.replace(/^!/, "")}` : `${current}${current && !current.endsWith(" ") ? " " : ""}${prefix}`));
    requestAnimationFrame(() => input.current?.focus());
  }

  async function submit(override?: string) {
    const body = (override ?? text).trim();
    if ((!body && attachments.length === 0 && skills.length === 0) || sending) return;
    setSending(true);
    try {
      const objective = goals && !override ? /^\/goal\s+([\s\S]+)$/.exec(body)?.[1].trim() : undefined;
      if (objective) {
        await setGoal(threadId, objective);
        toast("success", "已设定目标", objective);
      } else if (!override && body.startsWith("!") && attachments.length === 0) {
        await runShellCommand(threadId, body.slice(1).trim());
      } else {
        const inputs: UserInput[] = [
          ...attachments.map((a): UserInput => ({ type: "image", url: a.url })),
          ...skills.map((skill): UserInput => ({ type: "skill", name: skill.name, path: skill.path })),
        ];
        if (body) inputs.push({ type: "text", text: body, text_elements: [] });
        await sendMessage(threadId, inputs);
      }
      if (!override) {
        setText("");
        setAttachments([]);
        setSkills([]);
      }
    } catch (error) {
      toast("error", "发送失败", errorMessage(error));
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // CJK IME: Enter confirms a candidate and must never send.
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape" && running && threadId) {
      event.preventDefault();
      void interrupt(threadId);
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    if (files.length) {
      event.preventDefault();
      void addFiles(files);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void addFiles(event.dataTransfer.files);
  }

  const pick = (patch: Parameters<typeof setOverride>[1]) => {
    setOverride(threadId, patch);
    setMenu(null);
  };

  const placeholder = running
    ? "补充说明，或排队下一条消息…"
    : form === "reply"
      ? "回复 Codex"
      : "今天要让 Codex 做什么？输入 / 查看命令，@ 引用文件";

  const plusMenu = (
    <Popover
      open={menu === "plus"}
      onClose={() => setMenu(null)}
      placement={form === "home" ? "bottom-start" : "top-start"}
      className="menu-model"
      anchor={
        <Button
          variant="ghost"
          size={form === "home" ? "md" : "xs"}
          icon={<Plus size={form === "home" ? 20 : 16} />}
          label="添加文件等"
          aria-expanded={menu === "plus"}
          onClick={() => toggle("plus")}
        />
      }
    >
      <MenuItem
        icon={<ImagePlus size={18} />}
        label="添加图片"
        kbd="Ctrl + U"
        disabled={!acceptsImages}
        onClick={() => {
          setMenu(null);
          fileInput.current?.click();
        }}
      />
      <MenuItem icon={<AtSign size={18} />} label="引用文件" kbd="@" onClick={() => insertPrefix("@")} />
      <MenuItem icon={<Terminal size={18} />} label="运行命令" kbd="!" onClick={() => insertPrefix("!")} />
      <MenuSep />
      <div onPointerEnter={loadSkills} onFocus={loadSkills}>
        <Submenu icon={<Sparkles size={18} />} label="技能">
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
      {planAvailable && (
        <>
          <MenuSep />
          <MenuItem
            icon={<ListChecks size={18} />}
            label="计划模式"
            hint="先与你确认计划，再动手修改"
            toggle
            checked={effective.planMode}
            onClick={() => pick({ planMode: !effective.planMode })}
          />
        </>
      )}
    </Popover>
  );

  const send = running && !hasInput ? (
    <Button key="stop" variant="primary" icon={<Square size={12} fill="currentColor" />} label="停止" kbd="Esc" onClick={() => threadId && void interrupt(threadId)} />
  ) : (
    <Button
      key="send"
      variant="brand"
      icon={<ArrowUp size={20} />}
      label={running ? "加入队列" : "发送"}
      kbd="Enter"
      disabled={!hasInput || sending}
      onClick={() => void submit()}
    />
  );

  const effortLabel = EFFORT_LABELS[effective.effort ?? ""] ?? effective.effort;
  const permission = effective.permission;

  return (
    <fieldset className="composer-wrap" data-form={form}>
      {form === "reply" && thread && <QueueBar thread={thread} onEdit={(value) => {
        setText((current) => (current ? `${current}\n${value}` : value));
        input.current?.focus();
      }} />}
      <div
        className="composer"
        data-dragging={dragging || undefined}
        data-shell={shellMode || undefined}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
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

        {(attachments.length > 0 || skills.length > 0) && (
          <div className="attachments">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="attachment" data-tip={attachment.name}>
                <img src={attachment.url} alt={attachment.name} className="zoomable" onClick={() => setState({ lightbox: attachment.url })} />
                <button
                  type="button"
                  className="attachment-remove"
                  aria-label="移除附件"
                  onClick={() => setAttachments((current) => current.filter((a) => a.id !== attachment.id))}
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
                className="skill-chip"
                tip="移除技能"
                onClick={() => setSkills((current) => current.filter((s) => s.path !== skill.path))}
              >
                <Sparkles size={14} />
                {skill.interface?.displayName ?? skill.name}
                <X size={12} className="caret" />
              </Button>
            ))}
          </div>
        )}

        {shellMode && (
          <div className="shell-hint">
            <Terminal size={13} /> 将在 {basename(cwd || "") || "工作区"} 中直接运行此命令（不经沙箱）
          </div>
        )}

        <div className="composer-body">
          <div className="composer-editor">
            <textarea
              ref={input}
              className="composer-input"
              value={text}
              rows={form === "home" ? 2 : 1}
              placeholder={placeholder}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onCompositionStart={() => (composing.current = true)}
              onCompositionEnd={() => (composing.current = false)}
              aria-label="消息输入框"
            />
          </div>
          {form === "reply" && <span className="send-slot">{send}</span>}
        </div>

        {form === "home" && (
          <div className="composer-actions">
            {plusMenu}
            <span className="spacer" />
            <span className="send-slot">{send}</span>
          </div>
        )}

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      <div className="chin">
        <div>
          <div className="chin-row" data-size="xs">
            {form === "home" ? <ProjectMenu open={menu === "project"} onToggle={() => toggle("project")} onClose={() => setMenu(null)} /> : plusMenu}
            {effective.planMode && (
              <Button variant="ghost" size="xs" className="chin-chip" tip="关闭计划模式" onClick={() => setOverride(threadId, { planMode: false })}>
                <ListChecks size={14} />
                计划
                <X size={12} />
              </Button>
            )}
            <span className="spacer" />
            {form === "reply" && <ContextRing threadId={threadId} />}

            <Popover
              open={menu === "model"}
              onClose={() => setMenu(null)}
              placement={form === "home" ? "bottom-end" : "top-end"}
              className="menu-model"
              anchor={
                <Button variant="ghost" size="xs" ink2 className="chin-model" kbd="Ctrl+Shift+I" tip="模型" aria-expanded={menu === "model"} onClick={() => toggle("model")}>
                  <span className="btn-label">{modelLabel(effective.model)}</span>
                  {effortLabel && <span className="muted">{effortLabel}</span>}
                  <ChevronDown size={12} className="caret" />
                </Button>
              }
            >
              <div className="menu-scroll">
                {models.map((m) => (
                  <MenuItem
                    key={m.id}
                    label={m.displayName}
                    hint={m.description}
                    checked={m.id === effective.model || m.model === effective.model}
                    onClick={() => pick({ model: m.id })}
                  />
                ))}
                {models.length === 0 && <div className="menu-empty">暂无可用模型</div>}
              </div>
              {efforts.length > 0 && (
                <>
                  <MenuSep />
                  <Submenu label="推理强度" value={effortLabel ?? "默认"}>
                    <div className="menu-note">推理强度越高，回答前想得越充分，耗时和用量也越大。</div>
                    {efforts.map((option) => {
                      const id = option.reasoningEffort;
                      return (
                        <MenuItem
                          key={id}
                          label={
                            <>
                              {EFFORT_LABELS[id] ?? id}
                              {id === model?.defaultReasoningEffort && <span className="badge badge-2xs effort-badge">推荐</span>}
                              {HEAVY_EFFORTS.has(id) && (
                                <span className="badge badge-warning effort-badge">
                                  <TriangleAlert size={12} />
                                  用量更大
                                </span>
                              )}
                            </>
                          }
                          checked={id === effective.effort}
                          onClick={() => pick({ effort: id })}
                        />
                      );
                    })}
                  </Submenu>
                </>
              )}
            </Popover>

            <Popover
              open={menu === "permission"}
              onClose={() => setMenu(null)}
              placement={form === "home" ? "bottom-end" : "top-end"}
              className="menu-wide"
              anchor={
                <Button
                  variant="ghost"
                  size="xs"
                  ink2
                  className={permission === "full-access" ? "chin-warn" : ""}
                  tip="权限模式"
                  aria-expanded={menu === "permission"}
                  onClick={() => toggle("permission")}
                >
                  <span className="label-stack">
                    {(Object.keys(PRESETS) as PermissionPreset[]).map((id) => (
                      <span key={id} data-on={id === permission || undefined}>
                        {PRESETS[id].label}
                      </span>
                    ))}
                    <span data-on={!permission || undefined}>默认</span>
                  </span>
                </Button>
              }
            >
              {(Object.keys(PRESETS) as PermissionPreset[]).map((id) => (
                <MenuItem
                  key={id}
                  label={PRESETS[id].label}
                  hint={PRESETS[id].description}
                  checked={permission === id}
                  danger={id === "full-access"}
                  onClick={() => pick({ permission: id })}
                />
              ))}
            </Popover>
          </div>
        </div>
      </div>
    </fieldset>
  );
}
