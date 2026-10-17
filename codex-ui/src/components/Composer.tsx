// The composer terminal: prompt input with slash commands, @file mentions,
// image attachments, and the chin of model / effort / permission controls.

import type { UserInput } from "@protocol/v2/UserInput";
import {
  ArrowUp,
  AtSign,
  Brain,
  ChevronDown,
  Cpu,
  FileText,
  Folder,
  ListChecks,
  Paperclip,
  ShieldCheck,
  Square,
  Terminal,
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
  logout,
  modelLabel,
  newChat,
  runShellCommand,
  searchFiles,
  sendMessage,
  setOverride,
} from "../lib/codex";
import { basename, formatTokens, relativePath } from "../lib/format";
import { setState, toast, useStore, type PermissionPreset } from "../lib/store";
import { MenuItem, MenuSection, Popover } from "./ui";

export const EFFORT_LABELS: Record<string, string> = {
  none: "关闭",
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "最大",
  ultra: "极限",
};

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

function ContextGauge({ threadId }: { threadId: string | null }) {
  const usage = useStore((s) => (threadId ? s.threads[threadId]?.tokenUsage : null));
  if (!usage?.modelContextWindow) return null;
  const used = usage.last.totalTokens;
  const ratio = Math.min(1, used / usage.modelContextWindow);
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const title = [
    `上下文 ${formatTokens(used)} / ${formatTokens(usage.modelContextWindow)}（${Math.round(ratio * 100)}%）`,
    `会话累计：输入 ${formatTokens(usage.total.inputTokens)}（缓存 ${formatTokens(usage.total.cachedInputTokens)}），输出 ${formatTokens(usage.total.outputTokens)}（推理 ${formatTokens(usage.total.reasoningOutputTokens)}）`,
  ].join("\n");
  return (
    <span className={`gauge ${ratio > 0.85 ? "gauge-hot" : ""}`} title={title}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r={radius} className="gauge-track" />
        <circle
          cx="9"
          cy="9"
          r={radius}
          className="gauge-fill"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
      </svg>
      <span className="tabular">{Math.round(ratio * 100)}%</span>
    </span>
  );
}

export function Composer({ threadId, autoFocus }: { threadId: string | null; autoFocus?: boolean }) {
  const thread = useStore((s) => (threadId ? s.threads[threadId] : undefined));
  const models = useStore((s) => s.models);
  const modes = useStore((s) => s.modes);
  useStore((s) => s.config);
  useStore((s) => s.prefs);
  const cwd = useStore((s) => (thread ? (thread.settings?.cwd ?? thread.meta.cwd) : s.prefs.cwd));
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [menu, setMenu] = useState<null | "model" | "effort" | "permission">(null);
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

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus, threadId]);

  // Welcome-screen suggestions prefill the draft.
  useEffect(() => {
    const onDraft = (event: Event) => {
      setText((event as CustomEvent<string>).detail);
      input.current?.focus();
    };
    window.addEventListener("composer-draft", onDraft);
    return () => window.removeEventListener("composer-draft", onDraft);
  }, []);

  // Auto-grow fallback for browsers without `field-sizing`; CSS max-height caps it.
  // An empty box keeps its one-row height so a long placeholder never stretches it.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el || FIELD_SIZING) return;
    el.style.height = "";
    if (text) el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // Slash command palette is active while the first token starts with "/".
  const slashQuery = /^\/(\S*)$/.exec(text)?.[1];
  const commands = useMemo<SlashCommand[]>(
    () => [
      { name: "new", description: "开始新的会话", run: newChat },
      { name: "model", description: "切换模型", run: () => setMenu("model") },
      { name: "effort", description: "调整推理强度", run: () => setMenu("effort") },
      { name: "permissions", description: "设置权限模式", run: () => setMenu("permission") },
      ...(planAvailable
        ? [{ name: "plan", description: "切换计划模式（先规划、后执行）", run: () => setOverride(threadId, { planMode: !effective.planMode }) }]
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
        description: "从当前会话创建分支",
        needsThread: true,
        run: () => threadId && forkThread(threadId).catch((error) => toast("error", "分支失败", errorMessage(error))),
      },
      { name: "rename", description: "重命名当前会话", needsThread: true, run: () => threadId && setState({ dialog: { type: "rename", threadId } }) },
      { name: "diff", description: "查看本轮改动", needsThread: true, run: () => setState({ panel: "diff" }) },
      { name: "mcp", description: "查看 MCP 服务器", run: () => setState({ settings: "mcp" }) },
      { name: "skills", description: "管理技能", run: () => setState({ settings: "skills" }) },
      { name: "status", description: "账户与用量", run: () => setState({ settings: "account" }) },
      { name: "settings", description: "打开设置", run: () => setState({ settings: "general" }) },
      { name: "logout", description: "退出登录", run: () => void logout().catch((error) => toast("error", "退出失败", errorMessage(error))) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threadId, planAvailable, effective.planMode],
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
    const next = `${before}${relative.includes(" ") ? `"${relative}"` : relative} ${text.slice(caret)}`;
    setText(next);
    requestAnimationFrame(() => input.current?.focus());
  }

  async function submit(override?: string) {
    const body = (override ?? text).trim();
    if ((!body && attachments.length === 0) || sending) return;
    setSending(true);
    try {
      if (!override && body.startsWith("!") && attachments.length === 0) {
        await runShellCommand(threadId, body.slice(1).trim());
      } else {
        const inputs: UserInput[] = attachments.map((a) => ({ type: "image", url: a.url }));
        if (body) inputs.push({ type: "text", text: body, text_elements: [] });
        await sendMessage(threadId, inputs);
      }
      if (!override) {
        setText("");
        setAttachments([]);
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
    ? "继续输入以引导当前回合，Esc 中断…"
    : threadId
      ? "回复 Codex…  / 命令 · @ 引用文件 · ! 运行命令"
      : "让 Codex 帮你做点什么…  / 命令 · @ 引用文件";

  return (
    <div
      className={`composer ${dragging ? "dragging" : ""} ${shellMode ? "shell-mode" : ""}`}
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
              {file.dir ? <Folder size={14} className="popup-icon" /> : <FileText size={14} className="popup-icon" />}
              <span className="popup-name">{file.name}</span>
              {relativePath(file.path, cwd) !== file.name && <span className="popup-desc">{relativePath(file.path, cwd)}</span>}
            </button>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="attachments">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="attachment" title={attachment.name}>
              <img src={attachment.url} alt={attachment.name} />
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
        </div>
      )}

      {shellMode && (
        <div className="shell-hint">
          <Terminal size={13} /> 将在 {basename(cwd || "") || "工作区"} 中直接运行此命令（不经沙箱）
        </div>
      )}

      <textarea
        ref={input}
        className="composer-input"
        value={text}
        rows={1}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => (composing.current = false)}
        aria-label="消息输入框"
      />

      <div className="composer-chin">
        <div className="chin-left">
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
          <button
            type="button"
            className="chin-btn chin-icon"
            title={acceptsImages ? "添加图片" : "当前模型不支持图片输入"}
            disabled={!acceptsImages}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip size={15} />
          </button>
          <button type="button" className="chin-btn chin-icon" title="引用文件 (@)" onClick={() => {
            setText((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@`);
            input.current?.focus();
          }}>
            <AtSign size={15} />
          </button>

          <Popover
            open={menu === "model"}
            onClose={() => setMenu(null)}
            placement="top-start"
            className="menu menu-wide"
            anchor={
              <button type="button" className="chin-btn" onClick={() => setMenu(menu === "model" ? null : "model")}>
                <Cpu size={14} />
                <span>{modelLabel(effective.model)}</span>
                <ChevronDown size={12} className="chin-caret" />
              </button>
            }
          >
            <MenuSection title="模型" />
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
          </Popover>

          {efforts.length > 0 && (
            <Popover
              open={menu === "effort"}
              onClose={() => setMenu(null)}
              placement="top-start"
              className="menu"
              anchor={
                <button type="button" className="chin-btn" onClick={() => setMenu(menu === "effort" ? null : "effort")}>
                  <Brain size={14} />
                  <span>{EFFORT_LABELS[effective.effort ?? ""] ?? effective.effort ?? "默认"}</span>
                  <ChevronDown size={12} className="chin-caret" />
                </button>
              }
            >
              <MenuSection title="推理强度" />
              {efforts.map((option) => (
                <MenuItem
                  key={option.reasoningEffort}
                  label={`${EFFORT_LABELS[option.reasoningEffort] ?? option.reasoningEffort}${option.reasoningEffort === model?.defaultReasoningEffort ? "（默认）" : ""}`}
                  hint={option.description}
                  checked={option.reasoningEffort === effective.effort}
                  onClick={() => pick({ effort: option.reasoningEffort })}
                />
              ))}
            </Popover>
          )}

          <Popover
            open={menu === "permission"}
            onClose={() => setMenu(null)}
            placement="top-start"
            className="menu menu-wide"
            anchor={
              <button
                type="button"
                className={`chin-btn ${effective.permission === "full-access" ? "chin-warn" : ""}`}
                onClick={() => setMenu(menu === "permission" ? null : "permission")}
              >
                <ShieldCheck size={14} />
                <span>{effective.permission ? PRESETS[effective.permission].label : "默认权限"}</span>
                <ChevronDown size={12} className="chin-caret" />
              </button>
            }
          >
            <MenuSection title="权限模式" />
            {(Object.keys(PRESETS) as PermissionPreset[]).map((id) => (
              <MenuItem
                key={id}
                label={PRESETS[id].label}
                hint={PRESETS[id].description}
                checked={effective.permission === id}
                danger={id === "full-access"}
                onClick={() => pick({ permission: id })}
              />
            ))}
          </Popover>

          {planAvailable && (
            <button
              type="button"
              className={`chin-btn ${effective.planMode ? "chin-active" : ""}`}
              aria-pressed={effective.planMode}
              title="计划模式：先与你确认计划，再动手修改"
              onClick={() => setOverride(threadId, { planMode: !effective.planMode })}
            >
              <ListChecks size={14} />
              <span>计划</span>
            </button>
          )}
        </div>

        <div className="chin-right">
          <ContextGauge threadId={threadId} />
          {running && !text.trim() && attachments.length === 0 ? (
            <button type="button" className="send-btn stop" aria-label="停止" title="停止 (Esc)" onClick={() => threadId && void interrupt(threadId)}>
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              className="send-btn"
              aria-label={running ? "追加到当前回合" : "发送"}
              title={running ? "追加到当前回合 (Enter)" : "发送 (Enter)"}
              disabled={(!text.trim() && attachments.length === 0) || sending}
              onClick={() => void submit()}
            >
              <ArrowUp size={16} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
