// Settings and the sign-in page.
//
// Settings is the desktop 2.42304 settings modal (ion-dist shared-19 `pA` frame, `Uk` rail, `qk` nav
// row; cc011544b `SettingsNavSearch`; shared-1 `gx` row, `xx` section, `hx` deep-link highlight;
// cd19fedd2 setting registry for the appearance rows). The customize pages live in
// SettingsCustomize.tsx.

import type { ExternalAgentConfigMigrationItem } from "@protocol/v2/ExternalAgentConfigMigrationItem";
import type { ExternalAgentConfigMigrationItemType } from "@protocol/v2/ExternalAgentConfigMigrationItemType";
import type { GetAccountTokenUsageResponse } from "@protocol/v2/GetAccountTokenUsageResponse";
import type { RateLimitSnapshot } from "@protocol/v2/RateLimitSnapshot";
import type { RateLimitWindow } from "@protocol/v2/RateLimitWindow";
import type { WindowsSandboxReadiness } from "@protocol/v2/WindowsSandboxReadiness";
import {
  Brain,
  ChevronRight,
  CircleX,
  FlaskConical,
  Info,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Plug,
  Puzzle,
  RefreshCw,
  Search,
  SearchX,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
  User,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  BUILD,
  PRESETS,
  cancelLogin,
  consumeRateLimitResetCredit,
  detectImports,
  errorMessage,
  listHooks,
  loginApiKey,
  loginChatGpt,
  logout,
  pairingClaimed,
  presetAllowed,
  presetOf,
  readUsage,
  refreshAccount,
  refreshRateLimits,
  remoteClients,
  revokeRemoteClient,
  runImport,
  serverDiagnostics,
  setFeature,
  setRemoteControl,
  setSkillRoots,
  startPairing,
  startWindowsSandboxSetup,
  windowsSandboxReadiness,
  writeConfig,
  type RemoteClient,
  type RemotePairing,
  type ServerDiagnostics,
} from "../lib/codex";
import { formatDuration, formatTokens, limitName } from "../lib/format";
import { VIEWS, type TranscriptView } from "../lib/session";
import { getState, hooksNeedingReview, readPref, setState, toast, useStore, writePref, type PermissionPreset, type SettingsTab } from "../lib/store";
import { EFFORT_LABELS } from "./Composer";
import { VIEW_LABELS } from "./Main";
import { ConnectorsTab, HooksTab, MemoryTab, PluginsTab, SkillsTab, savedSkillRoots } from "./SettingsCustomize";
import { Button, Dialog, MOTION_KEY, MenuSelect, Segmented, Skeleton, Spark, Spinner, Toggle, UsageRing, applyMotion } from "./ui";

// ---------------------------------------------------------------------------
// Theme (applied before first paint by public/theme-init.js)

export type Theme = "light" | "dark" | "system";
const THEME_KEY = "codex-ui:theme";

export function currentTheme(): Theme {
  return readPref<Theme>(THEME_KEY, ["light", "dark", "system"], "system");
}

export function applyTheme(theme = currentTheme()) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function saveTheme(theme: Theme) {
  writePref(THEME_KEY, theme);
  window.codexDesktop?.setTheme(theme);
  applyTheme(theme);
}

// Appearance choices mirrored on <html> (public/theme-init.js writes them before first paint).
type Size = "s" | "m" | "l";
const SIZES: Size[] = ["s", "m", "l"];
const CHAT_TEXT_SIZE_KEY = "codex-ui:chat-text-size";
const TRANSCRIPT_WIDTH_KEY = "codex-ui:transcript-width";

function saveHtmlPref(key: string, attr: "chatTextSize" | "transcriptWidth", value: string) {
  writePref(key, value);
  document.documentElement.dataset[attr] = value;
}

// ---------------------------------------------------------------------------
// Rows and sections (shared-1 gx / xx). Row and section ids are the deep-link anchors
// (`setting-<page>-<name>`, as the real registry builds them).

export function Section({
  id,
  title,
  description,
  action,
  children,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section id={id} className="settings-section">
      <div className="settings-section-head" data-settings-group-header="">
        <div>
          <h3 className="settings-section-title settings-row-title">{title}</h3>
          {description && <p className="settings-section-desc">{description}</p>}
        </div>
        {action && <div className="settings-section-action">{action}</div>}
      </div>
      {children && <div className="settings-rows">{children}</div>}
    </section>
  );
}

export function Row({
  id,
  label,
  description,
  leading,
  onOpen,
  children,
}: {
  id?: string;
  label: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  /** The label opens a detail page. */
  onOpen?: () => void;
  children?: ReactNode;
}) {
  const labelId = useId();
  const descriptionId = useId();
  const text = (
    <>
      <div id={labelId} className="settings-row-label">
        <span className="settings-row-title">{label}</span>
      </div>
      {description && (
        <div id={descriptionId} className="settings-row-desc">
          {description}
        </div>
      )}
    </>
  );
  return (
    <div id={id} role="group" aria-labelledby={labelId} aria-describedby={description ? descriptionId : undefined} className="settings-row">
      {leading && <span className="settings-row-leading">{leading}</span>}
      {onOpen ? (
        <button type="button" className="settings-row-text settings-row-open" onClick={onOpen}>
          {text}
        </button>
      ) : (
        <div className="settings-row-text">{text}</div>
      )}
      {children && <div className="settings-row-control">{children}</div>}
    </div>
  );
}


/** A confirmation on top of settings; the settings dialog blurs underneath (nested dialog). */
export function Confirm({
  title,
  description,
  confirm,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  description: ReactNode;
  confirm: string;
  danger?: boolean;
  onConfirm(): Promise<unknown>;
  onClose(): void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      alert
      title={title}
      description={description}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={onClose}>
            取消
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onConfirm().finally(onClose);
            }}
          >
            {confirm}
          </Button>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Deep link (shared-1 hx, W20): scroll the row title to the middle of its scroller, wait
// until it holds still (3 frames and 250ms, at most 1500ms), re-centre at once if the user
// has not touched anything and it is more than a quarter off, then play the highlight.

const SETTLE_MS = 250;
const SETTLE_CAP_MS = 1500;
const STILL_FRAMES = 3;

function scrollParents(element: HTMLElement): HTMLElement[] {
  const scrollers: HTMLElement[] = [];
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY, position } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) scrollers.push(node);
    if (position === "fixed") break;
  }
  return scrollers;
}

function viewBox(scroller: HTMLElement | undefined): { top: number; bottom: number } {
  if (!scroller) return { top: 0, bottom: innerHeight };
  const top = scroller.getBoundingClientRect().top + scroller.clientTop;
  return { top, bottom: top + scroller.clientHeight };
}

function centre(element: HTMLElement, behavior: ScrollBehavior) {
  const rect = element.getBoundingClientRect();
  let middle = (rect.top + rect.bottom) / 2;
  for (const scroller of scrollParents(element)) {
    const box = viewBox(scroller);
    const target = Math.max(0, Math.min(scroller.scrollTop + middle - (box.top + box.bottom) / 2, scroller.scrollHeight - scroller.clientHeight));
    middle -= target - scroller.scrollTop;
    scroller.scrollTo({ top: target, behavior });
  }
}

/** Scroll a settings row or section into the middle and play the feature-anchor highlight. */
export function highlightSetting(target: HTMLElement): () => void {
  const title = target.querySelector<HTMLElement>(".settings-row-title") ?? target;
  const fill = target.tagName === "SECTION" && title !== target ? (title.closest<HTMLElement>("[data-settings-group-header]") ?? title) : target;
  const reduced = document.documentElement.dataset.reduceMotion === "true" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  centre(title, reduced ? "instant" : "smooth");
  const events = ["wheel", "touchstart", "keydown", "mousedown"] as const;
  const started = performance.now();
  let touched = false;
  let finished = false;
  let frame = 0;
  let timer = 0;
  let lastTop: number | undefined;
  let still = 0;
  const touch = () => {
    touched = true;
  };
  const arm = window.setTimeout(() => events.forEach((name) => window.addEventListener(name, touch, { once: true, passive: true })), 0);
  const onEnd = (event: AnimationEvent) => {
    if (event.animationName.startsWith("feature-anchor-highlight-underline")) finish();
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    clearTimeout(arm);
    events.forEach((name) => window.removeEventListener(name, touch));
    title.classList.remove("feature-anchor-highlight");
    fill.classList.remove("feature-anchor-row-fill");
    title.removeEventListener("animationend", onEnd);
  };
  const settle = () => {
    if (!title.isConnected) return finish();
    const elapsed = performance.now() - started;
    const { top } = title.getBoundingClientRect();
    still = lastTop !== undefined && Math.abs(top - lastTop) < 0.5 ? still + 1 : 0;
    lastTop = top;
    if (!((elapsed >= SETTLE_MS && still >= STILL_FRAMES) || elapsed >= SETTLE_CAP_MS)) {
      frame = requestAnimationFrame(settle);
      return;
    }
    if (!touched) {
      const rect = title.getBoundingClientRect();
      const box = viewBox(scrollParents(title)[0]);
      if (Math.abs((rect.top + rect.bottom) / 2 - (box.top + box.bottom) / 2) > (box.bottom - box.top) / 4) centre(title, "instant");
    }
    title.classList.add("feature-anchor-highlight");
    fill.classList.add("feature-anchor-row-fill");
    title.addEventListener("animationend", onEnd);
    // Reduced motion shows both statically; this timer clears them either way.
    timer = window.setTimeout(finish, 2050);
  };
  frame = requestAnimationFrame(settle);
  return finish;
}

/** Open settings on `tab`; with `anchor` (a row or section id) scroll to it and highlight it. */
export function openSettings(tab: SettingsTab, anchor?: string) {
  setState({ settings: tab });
  if (!anchor) return;
  // Pages that load first show their rows a moment later.
  const until = performance.now() + 3000;
  const find = () => {
    const element = document.getElementById(anchor);
    if (element) highlightSetting(element);
    else if (performance.now() < until) requestAnimationFrame(find);
  };
  requestAnimationFrame(find);
}

// ---------------------------------------------------------------------------
// General

function AppearanceSection() {
  const [theme, setTheme] = useState(currentTheme);
  const [textSize, setTextSize] = useState(() => readPref<Size>(CHAT_TEXT_SIZE_KEY, SIZES, "m"));
  const [width, setWidth] = useState(() => readPref<Size>(TRANSCRIPT_WIDTH_KEY, SIZES, "s"));
  const [motion, setMotion] = useState(() => readPref<"system" | "reduce">(MOTION_KEY, ["system", "reduce"], "system"));
  const defaultView = useStore((s) => s.defaultView);
  return (
    <Section id="setting-general-appearance" title="外观">
      <Row id="setting-general-theme" label="主题">
        <Segmented
          value={theme}
          options={[
            { value: "system", label: <ThemeIcon icon={Monitor} label="跟随系统" /> },
            { value: "light", label: <ThemeIcon icon={Sun} label="浅色" /> },
            { value: "dark", label: <ThemeIcon icon={Moon} label="深色" /> },
          ]}
          onChange={(value) => {
            setTheme(value);
            saveTheme(value);
          }}
        />
      </Row>
      <Row id="setting-general-transcript-text-size" label="对话文字大小" description="对话记录的文字大小。">
        <Segmented
          value={textSize}
          options={[
            { value: "s", label: "小" },
            { value: "m", label: "中" },
            { value: "l", label: "大" },
          ]}
          onChange={(value) => {
            setTextSize(value);
            saveHtmlPref(CHAT_TEXT_SIZE_KEY, "chatTextSize", value);
          }}
        />
      </Row>
      <Row id="setting-general-transcript-width" label="对话宽度" description="对话与输入框两列的最大宽度。">
        <Segmented
          value={width}
          options={[
            { value: "s", label: "窄" },
            { value: "m", label: "中" },
            { value: "l", label: "宽" },
          ]}
          onChange={(value) => {
            setWidth(value);
            saveHtmlPref(TRANSCRIPT_WIDTH_KEY, "transcriptWidth", value);
          }}
        />
      </Row>
      <Row id="setting-general-default-transcript-view" label="默认对话视图" description="会话打开时使用的视图。在会话的「对话视图」菜单里选择只改变该会话。">
        <Segmented
          value={defaultView}
          options={VIEWS.map((view) => ({ value: view, label: VIEW_LABELS[view] }))}
          onChange={(value: TranscriptView) => {
            writePref("codex-ui:view", value);
            setState({ defaultView: value });
          }}
        />
      </Row>
      <Row id="setting-general-motion" label="动效" description="减少流式回复和其他界面元素中的动画。">
        <Segmented
          value={motion}
          options={[
            { value: "system", label: "跟随系统" },
            { value: "reduce", label: "减少" },
          ]}
          onChange={(value) => {
            setMotion(value);
            writePref(MOTION_KEY, value);
            applyMotion();
          }}
        />
      </Row>
    </Section>
  );
}

function ThemeIcon({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="settings-theme-icon" data-tip={label}>
      <Icon size={16} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function DefaultsSection() {
  const config = useStore((s) => s.config);
  const models = useStore((s) => s.models);
  useStore((s) => s.requirements);
  const model = models.find((m) => m.id === config?.model || m.model === config?.model);
  const preset = presetOf(config?.approval_policy, config?.sandbox_mode);
  const save = (edits: Parameters<typeof writeConfig>[0]) =>
    writeConfig(edits)
      .then(() => toast("success", "已保存到 config.toml"))
      .catch((error) => toast("error", "保存失败", errorMessage(error)));
  return (
    <Section id="setting-general-defaults" title="新会话默认值" description="写入 config.toml，对之后新建的会话生效；也可以在输入框下方为单个会话临时调整。">
      <Row id="setting-general-model" label="模型">
        <MenuSelect
          label="模型"
          value={config?.model ?? ""}
          options={[{ value: "", label: "自动（服务端默认）" }, ...models.map((m) => ({ value: m.model, label: m.displayName }))]}
          onChange={(value) => void save([{ keyPath: "model", value: value || null, mergeStrategy: "replace" }])}
        />
      </Row>
      {model && model.supportedReasoningEfforts.length > 0 && (
        <Row id="setting-general-effort" label="推理强度">
          <MenuSelect
            label="推理强度"
            value={config?.model_reasoning_effort ?? ""}
            options={[
              { value: "", label: `默认（${EFFORT_LABELS[model.defaultReasoningEffort] ?? model.defaultReasoningEffort}）` },
              ...model.supportedReasoningEfforts.map((option) => ({ value: option.reasoningEffort as string, label: EFFORT_LABELS[option.reasoningEffort] ?? option.reasoningEffort })),
            ]}
            onChange={(value) => void save([{ keyPath: "model_reasoning_effort", value: value || null, mergeStrategy: "replace" }])}
          />
        </Row>
      )}
      <Row id="setting-general-permission" label="权限" description={preset ? PRESETS[preset].description : "当前配置不属于预设组合。"}>
        <MenuSelect<PermissionPreset | "">
          label="权限"
          value={preset ?? ""}
          options={[
            ...(preset ? [] : [{ value: "" as const, label: "自定义" }]),
            ...(Object.keys(PRESETS) as PermissionPreset[]).map((id) => ({ value: id, label: PRESETS[id].label, disabled: !presetAllowed(id) })),
          ]}
          onChange={(value) => {
            if (!value) return;
            void save([
              { keyPath: "approval_policy", value: PRESETS[value].approval as string, mergeStrategy: "replace" },
              { keyPath: "sandbox_mode", value: PRESETS[value].sandbox, mergeStrategy: "replace" },
            ]);
          }}
        />
      </Row>
    </Section>
  );
}

const SANDBOX_TEXT: Record<WindowsSandboxReadiness, string> = {
  ready: "已就绪",
  notConfigured: "还没有设置",
  updateRequired: "需要更新",
};

/** Windows sandbox (the real "Local sandbox" row): setup asks for administrator permission once. */
function SandboxRow() {
  const [status, setStatus] = useState<WindowsSandboxReadiness | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void windowsSandboxReadiness().then(setStatus);
  }, []);
  // The result arrives as a notification (F toasts it); poll readiness until it flips.
  useEffect(() => {
    if (!busy) return;
    const until = Date.now() + 120_000;
    const timer = setInterval(() => {
      void windowsSandboxReadiness().then((next) => {
        if (next === "ready" || Date.now() > until) {
          setBusy(false);
          setStatus(next);
        }
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [busy]);
  if (status === undefined || status === null) return null;
  return (
    <Row
      id="setting-general-windows-sandbox"
      label="Windows 沙箱"
      description={busy ? "正在设置…" : `在隔离的沙箱里运行 Codex 的命令，对新会话生效。设置时需要一次管理员权限。${status === "ready" ? "" : `当前${SANDBOX_TEXT[status]}。`}`}
    >
      {status === "ready" ? (
        <span className="badge">已就绪</span>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          icon={busy ? <Spinner size={12} /> : undefined}
          onClick={() => {
            setBusy(true);
            startWindowsSandboxSetup("elevated")
              .then((started) => {
                if (!started) {
                  setBusy(false);
                  toast("error", "无法开始设置 Windows 沙箱");
                }
              })
              .catch((error) => {
                setBusy(false);
                toast("error", "无法开始设置 Windows 沙箱", errorMessage(error));
              });
          }}
        >
          {status === "updateRequired" ? "更新" : "设置"}
        </Button>
      )}
    </Row>
  );
}

const REMOTE_TEXT = { disabled: "已关闭", connecting: "正在连接…", connected: "已连接", errored: "连接失败" } as const;

/** Remote control (U19): this window's app-server, ephemeral; pair a device with a manual code. */
function RemoteControlRows() {
  const remote = useStore((s) => s.remoteControl);
  const allowed = useStore((s) => s.requirements?.allowRemoteControl !== false);
  const [pairing, setPairing] = useState<RemotePairing | null>(null);
  const [clients, setClients] = useState<RemoteClient[] | null>(null);
  const [busy, setBusy] = useState(false);
  const environmentId = pairing?.environmentId ?? remote?.environmentId ?? null;
  const loadClients = () => {
    if (environmentId)
      remoteClients(environmentId)
        .then(setClients)
        .catch(() => setClients([]));
  };
  useEffect(loadClients, [environmentId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Poll the code until a device claims it or it expires.
  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => {
      if (Date.now() / 1000 > pairing.expiresAt) {
        setPairing(null);
        return;
      }
      void pairingClaimed({ pairingCode: pairing.pairingCode, manualPairingCode: pairing.manualPairingCode })
        .then((claimed) => {
          if (!claimed) return;
          setPairing(null);
          toast("success", "设备已配对");
          loadClients();
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [pairing]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!remote || !allowed) return null;
  const on = remote.status !== "disabled";
  return (
    <>
      <Row
        id="setting-general-remote-control"
        label="远程控制"
        description={`从其他设备继续这台电脑上的会话。只在这个窗口打开期间有效；与 Codex 桌面版同时开启可能互相顶替。当前：${REMOTE_TEXT[remote.status]}。`}
      >
        <Toggle
          checked={on}
          label="远程控制"
          onChange={(enabled) => void setRemoteControl(enabled).catch((error) => toast("error", enabled ? "开启远程控制失败" : "关闭远程控制失败", errorMessage(error)))}
        />
      </Row>
      {on && (
        <Row
          id="setting-general-remote-pairing"
          label="配对设备"
          description={
            pairing ? (
              <>
                在要配对的设备上输入 <code className="inline-code">{pairing.manualPairingCode ?? pairing.pairingCode}</code>，
                {new Date(pairing.expiresAt * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 前有效。
              </>
            ) : (
              "生成一次性配对码，在其他设备上输入后即可远程控制。"
            )
          }
        >
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              startPairing()
                .then(setPairing)
                .catch((error) => toast("error", "无法生成配对码", errorMessage(error)))
                .finally(() => setBusy(false));
            }}
          >
            {pairing ? "重新生成" : "生成配对码"}
          </Button>
        </Row>
      )}
      {environmentId &&
        clients?.map((client) => (
          <Row
            key={client.clientId}
            label={client.displayName ?? client.deviceModel ?? "未命名设备"}
            description={[client.platform, client.osVersion, client.lastSeenAt ? `上次在线 ${new Date(client.lastSeenAt * 1000).toLocaleString("zh-CN")}` : null].filter(Boolean).join(" · ")}
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void revokeRemoteClient(environmentId, client.clientId)
                  .then(loadClients)
                  .catch((error) => toast("error", "撤销失败", errorMessage(error)))
              }
            >
              撤销
            </Button>
          </Row>
        ))}
    </>
  );
}

function ThisComputerSection() {
  const windows = useStore((s) => s.server.info?.platformOs === "windows");
  const remote = useStore((s) => s.remoteControl !== null);
  if (!windows && !remote) return null;
  return (
    <Section id="setting-general-computer" title="这台电脑">
      {windows && <SandboxRow />}
      <RemoteControlRows />
    </Section>
  );
}

const IMPORT_LABELS: Record<ExternalAgentConfigMigrationItemType, string> = {
  AGENTS_MD: "说明文件（AGENTS.md）",
  CONFIG: "配置",
  SKILLS: "技能",
  PLUGINS: "插件",
  MCP_SERVER_CONFIG: "MCP 服务器",
  SUBAGENTS: "子代理",
  HOOKS: "Hooks",
  COMMANDS: "命令",
  MEMORY: "记忆",
  SESSIONS: "会话",
};

/** U21: migrate another coding agent's instructions, skills, MCP servers… into Codex. */
function ImportSection() {
  const imports = useStore((s) => s.imports);
  const [items, setItems] = useState<ExternalAgentConfigMigrationItem[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const running = imports !== null && !imports.done;
  return (
    <Section
      id="setting-general-import"
      title="从其他代理导入"
      description="把其他编程代理的说明文件、技能、MCP 服务器等配置迁移到 Codex。"
      action={
        items !== null && items.length > 0 ? (
          <Button
            variant="primary"
            size="sm"
            disabled={!picked.size || running}
            onClick={() =>
              void runImport(items.filter((_, index) => picked.has(index))).catch((error) => toast("error", "导入失败", errorMessage(error)))
            }
          >
            {running ? "正在导入…" : `导入所选（${picked.size}）`}
          </Button>
        ) : undefined
      }
    >
      {items === null ? (
        <Row id="setting-general-import-detect" label="检测可导入的配置" description="在用户目录和当前工作区里查找。">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              detectImports()
                .then((found) => {
                  setItems(found);
                  setPicked(new Set(found.map((_, index) => index)));
                })
                .catch((error) => toast("error", "检测失败", errorMessage(error)))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "正在检测…" : "检测"}
          </Button>
        </Row>
      ) : items.length === 0 ? (
        <p className="settings-note">没有发现可导入的配置。</p>
      ) : (
        items.map((item, index) => (
          <Row key={index} label={IMPORT_LABELS[item.itemType] ?? item.itemType} description={`${item.description}${item.cwd ? ` · ${item.cwd}` : " · 用户目录"}`}>
            <Toggle
              checked={picked.has(index)}
              label={`导入${IMPORT_LABELS[item.itemType] ?? item.itemType}`}
              onChange={(on) =>
                setPicked((current) => {
                  const next = new Set(current);
                  if (on) next.add(index);
                  else next.delete(index);
                  return next;
                })
              }
            />
          </Row>
        ))
      )}
      {imports &&
        imports.results.map((result) => (
          <Row
            key={result.itemType}
            label={IMPORT_LABELS[result.itemType] ?? result.itemType}
            description={[`成功 ${result.successes.length} 项`, result.failures.length ? `失败 ${result.failures.length} 项：${result.failures.map((f) => f.message).join("；")}` : ""].filter(Boolean).join(" · ")}
          />
        ))}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Desktop shell only: the real Settings → General "System" group (c7357c32b menuBar /
// quickEntryShortcut; the recorder follows c71860c77 Oi). Windows has no separate Quick Entry
// switch: an empty recorder turns the hotkey off.

const RESERVED_SHORTCUTS = ["Cmd+Q", "Cmd+W", "Cmd+H", "Cmd+M", "Cmd+,", "Cmd+N", "Cmd+O", "Cmd+T", "Cmd+S", "Cmd+C", "Cmd+V", "Ctrl+W", "Ctrl+N", "Ctrl+O", "Ctrl+T", "Ctrl+S", "Ctrl+C", "Ctrl+V"];
const MODIFIER_CODES = ["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"];

/** Focus it (click or Tab) and press a combination; Esc cancels. `save` resolves to an error or null. */
function ShortcutInput({ label, value, save }: { label: string; value: string; save(accelerator: string): Promise<string | null> }) {
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const commit = (accelerator: string) => {
    setError(null);
    void save(accelerator).then(setError);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const modified = event.altKey || event.ctrlKey || event.metaKey;
    if ((event.key === "Tab" && !modified) || event.nativeEvent.isComposing) return;
    // Recording owns the keys: no app shortcut and no closing settings while it listens.
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape" && !modified && !event.shiftKey) {
      setError(null);
      event.currentTarget.blur();
      return;
    }
    if (MODIFIER_CODES.includes(event.code)) return;
    const modifiers = [event.shiftKey && "Shift", event.altKey && "Alt", event.ctrlKey && "Ctrl", event.metaKey && (platformName() === "Mac" ? "Cmd" : "Super")].filter(
      (name): name is string => !!name,
    );
    const key = event.code.startsWith("Key") ? event.code.slice(-1) : event.code === "Space" ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.code;
    const accelerator = [...modifiers, key].join("+");
    if ((!modifiers.length && !/^F\d+$/.test(key)) || RESERVED_SHORTCUTS.includes(accelerator)) {
      setError("这个快捷键留给常用操作，请换一个组合。");
      return;
    }
    commit(accelerator);
  };
  return (
    <div className="shortcut-field">
      <div
        role="button"
        tabIndex={0}
        aria-label={`${label}：${value || "未设置"}`}
        aria-describedby={error ? errorId : undefined}
        className="shortcut-input"
        data-empty={!value || undefined}
        onKeyDown={onKeyDown}
      >
        <span>{value || "设置快捷键"}</span>
        {value && (
          <button type="button" className="shortcut-clear" aria-label="清除快捷键" data-tip="清除快捷键" onClick={() => commit("")}>
            <CircleX size={16} />
          </button>
        )}
      </div>
      {error && (
        <div id={errorId} role="alert" className="shortcut-error">
          {error}
        </div>
      )}
    </div>
  );
}

function DesktopSection() {
  const [settings, setSettings] = useState<CodexDesktopSettings | null>(null);
  useEffect(() => {
    void window.codexDesktop?.getDesktopSettings().then(setSettings);
  }, []);
  if (!settings) return null;
  // Applies the patch at once and puts it back if the shell refuses; resolves to the refusal.
  const save = async (patch: Partial<CodexDesktopSettings>): Promise<string | null> => {
    const previous = settings;
    setSettings({ ...settings, ...patch });
    const result = await window.codexDesktop?.setDesktopSettings(patch).catch((error: unknown) => ({ ok: false as const, error: errorMessage(error) }));
    if (!result || result.ok) return null;
    setSettings(previous);
    return result.error;
  };
  return (
    <Section id="setting-general-system" title="系统">
      <Row id="setting-general-tray" label="系统托盘" description="让 Codex 在系统托盘中保持运行。">
        <Toggle checked={settings.menuBar} label="系统托盘" onChange={(menuBar) => void save({ menuBar }).then((error) => error && toast("error", "保存失败", error))} />
      </Row>
      <Row id="setting-general-quick-entry-shortcut" label="快速输入快捷键" description="随时随地快速打开 Codex。">
        <ShortcutInput
          label="快速输入快捷键"
          value={settings.quickEntry ? settings.quickEntryShortcut : ""}
          save={(accelerator) => save(accelerator ? { quickEntry: true, quickEntryShortcut: accelerator } : { quickEntry: false })}
        />
      </Row>
    </Section>
  );
}

function GeneralTab() {
  return (
    <>
      <AppearanceSection />
      <DefaultsSection />
      <DesktopSection />
      <ThisComputerSection />
      <ImportSection />
    </>
  );
}

// ---------------------------------------------------------------------------
// Account and usage

function LimitRing({ window, motionKey, bucket }: { window: RateLimitWindow; motionKey: string; bucket: string | null }) {
  const percent = Math.min(100, Math.max(0, window.usedPercent));
  return (
    <div className="limit-card">
      <UsageRing value={percent} size={44} stroke={4} motionKey={motionKey}>
        {Math.round(percent)}%
      </UsageRing>
      <div className="limit-text">
        <div className="limit-name">
          {bucket ? `${bucket} · ` : ""}
          {limitName(window)}
        </div>
        <div className="muted small">{percent >= 100 ? "已用完" : `已用 ${Math.round(percent)}%`}</div>
        {window.resetsAt && (
          <div className="muted small">{new Date(window.resetsAt * 1000).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} 重置</div>
        )}
      </div>
    </div>
  );
}

interface Day {
  key: string;
  label: string;
  tokens: number;
}

/** The last `count` local days, oldest first; days without a bucket count as zero. */
function lastDays(buckets: { startDate: string; tokens: bigint | number }[], count: number): Day[] {
  const byDate = new Map(buckets.map((bucket) => [bucket.startDate, Number(bucket.tokens)]));
  const today = new Date();
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (count - 1 - index));
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    return { key, label: `${day.getMonth() + 1}月${day.getDate()}日`, tokens: byDate.get(key) ?? 0 };
  });
}

/** Round up to 1 / 2 / 5 x 10^n so the axis reads in clean steps. */
function niceCeil(value: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  return [1, 2, 5, 10].map((step) => step * power).find((step) => step >= value) ?? value;
}

function DailyChart({ days }: { days: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const peak = Math.max(...days.map((day) => day.tokens));
  const top = niceCeil(peak);
  const peakIndex = days.findIndex((day) => day.tokens === peak);
  const tip = hover === null ? null : days[hover];
  return (
    <figure className="usage-chart">
      <figcaption className="usage-chart-title">近 30 天每日 tokens</figcaption>
      <div className="usage-plot">
        <div className="usage-grid" aria-hidden="true">
          {[top, top / 2, 0].map((tick) => (
            <div key={tick} className="usage-gridline">
              <span>{formatTokens(tick)}</span>
            </div>
          ))}
        </div>
        <div className="usage-bars" onPointerLeave={() => setHover(null)}>
          {days.map((day, index) => (
            <button
              key={day.key}
              type="button"
              className={`usage-col ${hover === index ? "hover" : ""}`}
              aria-label={`${day.label}：${formatTokens(day.tokens)} tokens`}
              onPointerEnter={() => setHover(index)}
              onFocus={() => setHover(index)}
              onBlur={() => setHover(null)}
            >
              <span className="usage-bar" style={{ height: `${(day.tokens / top) * 100}%` }}>
                {index === peakIndex && peak > 0 && hover === null && <span className="usage-peak">{formatTokens(peak)}</span>}
              </span>
            </button>
          ))}
          {tip && (
            <div className="usage-tip" style={{ left: `clamp(56px, ${((hover! + 0.5) / days.length) * 100}%, calc(100% - 56px))` }} role="status">
              <strong>{formatTokens(tip.tokens)} tokens</strong>
              <span>{tip.label}</span>
            </div>
          )}
        </div>
      </div>
      <div className="usage-axis" aria-hidden="true">
        <span>{days[0].label}</span>
        <span>{days[Math.floor(days.length / 2)].label}</span>
        <span>今天</span>
      </div>
      <table className="sr-only">
        <caption>近 30 天每日 tokens</caption>
        <tbody>
          {days.map((day) => (
            <tr key={day.key}>
              <th scope="row">{day.label}</th>
              <td>{day.tokens}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function UsageDashboard() {
  const [usage, setUsage] = useState<GetAccountTokenUsageResponse | "error" | null>(null);
  useEffect(() => {
    readUsage()
      .then(setUsage)
      .catch(() => setUsage("error"));
  }, []);
  if (usage === null) return <Skeleton lines={3} />;
  if (usage === "error") return <p className="settings-note">暂时无法读取用量统计。</p>;
  const { summary } = usage;
  const number = (value: bigint | number | null) => (value === null ? null : Number(value));
  const stats: [string, string | null][] = [
    ["单日峰值", summary.peakDailyTokens === null ? null : formatTokens(number(summary.peakDailyTokens))],
    ["当前连续", summary.currentStreakDays === null ? null : `${number(summary.currentStreakDays)} 天`],
    ["最长连续", summary.longestStreakDays === null ? null : `${number(summary.longestStreakDays)} 天`],
    ["最长的一轮", summary.longestRunningTurnSec === null ? null : formatDuration((number(summary.longestRunningTurnSec) ?? 0) * 1000)],
  ];
  return (
    <div className="usage-dashboard">
      <div className="usage-hero">
        <div className="usage-hero-value">{summary.lifetimeTokens === null ? "—" : formatTokens(number(summary.lifetimeTokens))}</div>
        <div className="usage-hero-label">累计使用的 tokens</div>
      </div>
      <div className="stat-tiles">
        {stats.map(([label, value]) => (
          <div key={label} className="stat-tile">
            <div className="stat-label">{label}</div>
            <div className="stat-value">{value ?? "—"}</div>
          </div>
        ))}
      </div>
      {usage.dailyUsageBuckets?.length ? <DailyChart days={lastDays(usage.dailyUsageBuckets, 30)} /> : <p className="settings-note">还没有每日用量数据。</p>}
    </div>
  );
}

const RESET_OUTCOME = {
  reset: ["success", "额度已重置"],
  nothingToReset: ["info", "当前没有需要重置的用量"],
  noCredit: ["warning", "没有可用的重置额度"],
  alreadyRedeemed: ["info", "这次重置已经生效"],
} as const;

/** U14: redeem one rate-limit reset credit. */
function ResetCreditRow() {
  const credits = useStore((s) => s.rateLimits?.rateLimitResetCredits ?? null);
  const [confirm, setConfirm] = useState(false);
  if (!credits) return null;
  const available = Number(credits.availableCount);
  const expiries = credits.credits?.map((credit) => credit.expiresAt).filter((at): at is number => at !== null) ?? [];
  const expiry = expiries.length ? Math.min(...expiries) : null;
  return (
    <Row
      id="setting-account-reset-credit"
      label="重置额度"
      description={
        available > 0
          ? `还有 ${available} 次重置机会，可以立刻清空当前的用量窗口。${expiry ? `最早的一次 ${new Date(expiry * 1000).toLocaleDateString("zh-CN")} 到期。` : ""}`
          : "没有可用的重置额度。"
      }
    >
      {available > 0 && (
        <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}>
          使用重置额度
        </Button>
      )}
      {confirm && (
        <Confirm
          title="使用一次重置额度？"
          description="当前的用量窗口会立刻清空；这次重置额度用掉后不能退回。"
          confirm="使用"
          onClose={() => setConfirm(false)}
          onConfirm={() =>
            consumeRateLimitResetCredit()
              .then((outcome) => {
                const [kind, title] = RESET_OUTCOME[outcome];
                toast(kind, title);
              })
              .catch((error) => toast("error", "使用重置额度失败", errorMessage(error)))
          }
        />
      )}
    </Row>
  );
}

function AccountTab() {
  const account = useStore((s) => s.account);
  const limits = useStore((s) => s.rateLimits);
  const info = account?.account;
  // One snapshot per metered limit when the server reports several, else the single bucket.
  const snapshots = Object.values(limits?.rateLimitsByLimitId ?? {}).filter((snapshot): snapshot is RateLimitSnapshot => !!snapshot);
  const buckets = snapshots.length ? snapshots : limits ? [limits.rateLimits] : [];
  const owner = limits?.accountId ?? (info?.type === "chatgpt" ? info.email : null) ?? "local";
  const windows = buckets.flatMap((snapshot) =>
    [snapshot.primary, snapshot.secondary]
      .filter((window): window is RateLimitWindow => !!window)
      .map((window) => ({ window, key: `${owner}:${snapshot.limitId ?? "codex"}:${window.windowDurationMins ?? 0}:${window.resetsAt ?? 0}`, name: snapshot.limitName ?? snapshot.limitId })),
  );
  const credits = buckets.find((snapshot) => snapshot.credits?.hasCredits)?.credits;
  return (
    <>
      <Section id="setting-account-account" title="账户">
        <Row
          leading={<User size={18} />}
          label={
            info?.type === "chatgpt"
              ? (info.email ?? "ChatGPT 账户")
              : info?.type === "apiKey"
                ? "API Key"
                : info?.type === "amazonBedrock"
                  ? "Amazon Bedrock"
                  : account?.requiresOpenaiAuth
                    ? "未登录"
                    : "自定义模型提供方"
          }
          description={info?.type === "chatgpt" ? `ChatGPT · ${info.planType}` : info ? "按量计费" : account?.requiresOpenaiAuth ? "需要登录才能使用 Codex" : "当前模型提供方无需登录"}
        >
          {info ? (
            <Button variant="secondary" size="sm" icon={<LogOut size={16} />} onClick={() => void logout().catch((error) => toast("error", "退出失败", errorMessage(error)))}>
              退出登录
            </Button>
          ) : (
            account?.requiresOpenaiAuth && (
              <Button variant="primary" size="sm" icon={<LogIn size={16} />} onClick={() => setState({ settings: null })}>
                去登录
              </Button>
            )
          )}
        </Row>
      </Section>
      {info && (
        <Section
          id="setting-account-limits"
          title="额度"
          action={<Button variant="ghost" size="xs" muted icon={<RefreshCw size={16} />} label="刷新额度" onClick={() => void refreshRateLimits()} />}
        >
          {windows.length > 0 ? (
            <div className="limit-grid">
              {windows.map(({ window, key, name }) => (
                <LimitRing key={key} window={window} motionKey={key} bucket={buckets.length > 1 ? name : null} />
              ))}
            </div>
          ) : (
            <p className="settings-note">暂无额度数据。</p>
          )}
          {credits && <Row id="setting-account-credits" label="点数余额">{credits.unlimited ? "无限" : (credits.balance ?? "—")}</Row>}
          <ResetCreditRow />
        </Section>
      )}
      {info?.type === "chatgpt" && (
        <Section id="setting-account-usage" title="用量统计">
          <UsageDashboard />
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Labs, about

function LabsTab() {
  const features = useStore((s) => s.features);
  const beta = features.filter((feature) => feature.stage === "beta" && feature.displayName);
  return (
    <Section
      id="setting-labs-features"
      title="实验功能"
      description={
        <>
          这些功能仍在测试中，可能不稳定。开关在当前运行的 app-server 中立即生效；要长期保留，请在 config.toml 的 <code className="inline-code">[features]</code> 中设置。
        </>
      }
    >
      {beta.length === 0 && <p className="settings-note">当前没有可试用的实验功能。</p>}
      {beta.map((feature) => (
        <Row
          key={feature.name}
          id={`setting-labs-${feature.name}`}
          label={
            <>
              {feature.displayName}
              <span className="badge">Beta</span>
            </>
          }
          description={feature.description ?? feature.name}
        >
          <Toggle
            checked={feature.enabled}
            label={`启用 ${feature.displayName}`}
            onChange={(enabled) => void setFeature(feature.name, enabled).catch((error) => toast("error", "切换实验功能失败", errorMessage(error)))}
          />
        </Row>
      ))}
    </Section>
  );
}

function platformName(): string {
  const agent = navigator.userAgent;
  return agent.includes("Windows") ? "Windows" : agent.includes("Mac") ? "Mac" : "Linux";
}

/** W15 About window as a page: version line copies "app version time" and confirms for 2s. */
function AboutTab() {
  const server = useStore((s) => s.server);
  const [copied, setCopied] = useState(false);
  const [diagnostics, setDiagnostics] = useState<ServerDiagnostics | null>(null);
  useEffect(() => {
    void serverDiagnostics().then(setDiagnostics);
  }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const version = BUILD.sha ? `${BUILD.version} (${BUILD.sha})` : BUILD.version;
  const built = BUILD.time ? new Date(BUILD.time).toLocaleString("zh-CN", { dateStyle: "long", timeStyle: "short" }) : "";
  const memory = diagnostics?.process.residentMemoryBytes;
  const rows: [string, string | undefined | null][] = [
    ["Codex", server.version],
    ["app-server", server.info?.userAgent],
    ["CODEX_HOME", server.info?.codexHome],
    ["平台", server.info ? `${server.info.platformOs} (${server.info.platformFamily})` : undefined],
    ["启动命令", server.command],
    ["启动目录", server.cwd],
    ["app-server 内存", memory ? `${Math.round(memory / 1048576)} MB（进程 ${diagnostics!.process.id}）` : null],
  ];
  return (
    <>
      <div className="about-hero">
        <div className="about-icon">
          <Spark size={36} />
        </div>
        <h3 className="about-title">
          Codex UI
          {window.codexDesktop && (
            <>
              {" "}
              <em>for</em> {platformName()}
            </>
          )}
        </h3>
        <button
          type="button"
          className="about-version"
          aria-label={`将版本 ${version} 复制到剪贴板`}
          onClick={() => {
            void navigator.clipboard.writeText(["Codex UI", version, BUILD.time].filter(Boolean).join(" "));
            setCopied(true);
          }}
        >
          {copied ? "已把版本号复制到剪贴板" : `版本 ${version}`}
        </button>
        {built && <p className="about-built">构建于 {built}</p>}
        <div className="about-actions">
          <a className="about-btn" href="https://developers.openai.com/codex" target="_blank" rel="noopener noreferrer">
            帮助
          </a>
          <a className="about-btn" href="https://github.com/openai/codex/issues" target="_blank" rel="noopener noreferrer">
            获取支持
          </a>
        </div>
      </div>
      <Section id="setting-about-details" title="详细信息" description="所有数据都通过本机的 codex app-server 读写。">
        {rows
          .filter(([, value]) => value !== null)
          .map(([key, value]) => (
            <Row key={key} label={key} description={<span className="about-value">{value || "—"}</span>} />
          ))}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// The modal: rail (search + grouped nav) and content pane.

type Page = Exclude<SettingsTab, "mcp">;

const PAGES: Record<Page, { label: string; icon: LucideIcon }> = {
  general: { label: "通用", icon: SettingsIcon },
  account: { label: "账户与用量", icon: User },
  memory: { label: "记忆", icon: Brain },
  labs: { label: "实验功能", icon: FlaskConical },
  plugins: { label: "插件", icon: Puzzle },
  skills: { label: "技能", icon: Sparkles },
  connectors: { label: "连接器", icon: Plug },
  hooks: { label: "Hooks", icon: Webhook },
  about: { label: "关于", icon: Info },
};

// The real rail: a "Settings" group, then "Customize"; untitled groups get a hairline.
const NAV: { title?: string; pages: Page[] }[] = [
  { title: "设置", pages: ["general", "account", "memory", "labs"] },
  { title: "自定义", pages: ["plugins", "skills", "connectors", "hooks"] },
  { pages: ["about"] },
];

// Search index: rows and sections by label plus search phrases (the registry's searchPhrases).
const INDEX: { page: Page; anchor: string; label: string; keys?: string }[] = [
  { page: "general", anchor: "setting-general-theme", label: "主题", keys: "外观 深色 浅色 暗色 跟随系统 dark light theme" },
  { page: "general", anchor: "setting-general-transcript-text-size", label: "对话文字大小", keys: "字号 字体大小 更大的字 放大文字 font size" },
  { page: "general", anchor: "setting-general-transcript-width", label: "对话宽度", keys: "行宽 行长 栏宽 line width column width" },
  { page: "general", anchor: "setting-general-default-transcript-view", label: "默认对话视图", keys: "标准 思考 详细 ctrl+o transcript view" },
  { page: "general", anchor: "setting-general-motion", label: "动效", keys: "减少动态效果 动画 reduce motion" },
  { page: "general", anchor: "setting-general-model", label: "模型", keys: "默认模型 model" },
  { page: "general", anchor: "setting-general-effort", label: "推理强度", keys: "努力程度 思考 effort reasoning" },
  { page: "general", anchor: "setting-general-permission", label: "权限", keys: "沙箱 审批 只读 完全访问 sandbox approval" },
  { page: "general", anchor: "setting-general-tray", label: "系统托盘", keys: "系统 托盘 菜单栏 后台运行 关闭窗口 system tray menu bar" },
  { page: "general", anchor: "setting-general-quick-entry-shortcut", label: "快速输入快捷键", keys: "快速输入 全局快捷键 快捷键 热键 quick entry shortcut hotkey" },
  { page: "general", anchor: "setting-general-windows-sandbox", label: "Windows 沙箱", keys: "sandbox 管理员" },
  { page: "general", anchor: "setting-general-remote-control", label: "远程控制", keys: "配对 设备 手机 remote control" },
  { page: "general", anchor: "setting-general-import", label: "从其他代理导入", keys: "导入 迁移 claude import" },
  { page: "account", anchor: "setting-account-account", label: "账户", keys: "退出登录 登录 chatgpt api key 登出" },
  { page: "account", anchor: "setting-account-limits", label: "额度", keys: "用量 限额 剩余 rate limit" },
  { page: "account", anchor: "setting-account-reset-credit", label: "重置额度", keys: "重置 reset" },
  { page: "account", anchor: "setting-account-usage", label: "用量统计", keys: "tokens 统计 每日" },
  { page: "memory", anchor: "setting-memory-enabled", label: "启用记忆", keys: "memory 记住" },
  { page: "memory", anchor: "setting-memory-reset", label: "清空记忆", keys: "删除 重置 memory" },
  { page: "memory", anchor: "setting-memory-files", label: "记忆文件", keys: "memory.md" },
  { page: "labs", anchor: "setting-labs-features", label: "实验功能", keys: "beta 测试" },
  { page: "plugins", anchor: "setting-plugins-installed", label: "已安装的插件", keys: "plugin 卸载 启用" },
  { page: "plugins", anchor: "setting-plugins-directory", label: "插件目录", keys: "安装 plugin 搜索" },
  { page: "plugins", anchor: "setting-plugins-marketplaces", label: "插件市场", keys: "marketplace 添加市场 更新" },
  { page: "skills", anchor: "setting-skills-list", label: "技能", keys: "skill skill.md" },
  { page: "skills", anchor: "setting-skills-roots", label: "额外技能目录", keys: "目录 skill root" },
  { page: "connectors", anchor: "setting-connectors-apps", label: "应用", keys: "connector app chatgpt" },
  { page: "connectors", anchor: "setting-connectors-mcp", label: "MCP 服务器", keys: "mcp server 工具 tools" },
  { page: "hooks", anchor: "setting-hooks-list", label: "Hooks", keys: "hook 信任 trust 钩子" },
  { page: "about", anchor: "setting-about-details", label: "详细信息", keys: "版本 version codex_home 诊断" },
];

interface Hit {
  page: Page;
  via?: string;
  anchor?: string;
}

function searchSettings(query: string): Hit[] {
  const hits: Hit[] = [];
  for (const group of NAV) {
    for (const page of group.pages) {
      const rows = INDEX.filter((entry) => entry.page === page && (entry.label.toLowerCase().includes(query) || entry.keys?.includes(query)));
      if (!rows.length && PAGES[page].label.toLowerCase().includes(query)) hits.push({ page });
      for (const row of rows) hits.push({ page, via: row.label, anchor: row.anchor });
    }
  }
  return hits.slice(0, 20);
}

function Highlight({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query);
  if (!query || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

/**
 * cc011544b SettingsNavSearch: results drop 4px below the field (280 wide) while there is a query;
 * ↑↓ move, Enter opens, Esc / Tab / a press elsewhere clear, Ctrl+F focuses the field. Focus
 * stays in the field (a combobox), so this is not the menu Popover.
 */
function SettingsSearch() {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const field = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const listId = useId();
  const query = text.trim().toLowerCase();
  const hits = query ? searchSettings(query) : [];
  const clear = () => {
    setText("");
    setActive(0);
  };
  const pick = (hit: Hit) => {
    clear();
    input.current?.blur();
    openSettings(hit.page, hit.anchor);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey === event.ctrlKey || event.altKey || event.key.toLowerCase() !== "f") return;
      const own = input.current?.closest('[role="dialog"]');
      const from = event.target instanceof Element ? event.target.closest('[role="dialog"],[role="alertdialog"]') : null;
      if (from && from !== own) return;
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  // The field takes focus on open without the focus ring (focusVisible: false, as the real one).
  useEffect(() => {
    const node = input.current;
    if (!node) return;
    node.blur();
    node.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
  }, []);
  useEffect(() => {
    if (!query) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!field.current?.contains(target) && !panel.current?.contains(target)) clear();
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [query]);
  useEffect(() => {
    panel.current?.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
  }, [active, query]);
  const box = query ? field.current?.getBoundingClientRect() : undefined;
  return (
    <div className="settings-search-wrap">
      <div ref={field} className="settings-search" onClick={() => input.current?.focus()}>
        <Search size={20} />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded={!!query}
          aria-controls={listId}
          value={text}
          placeholder="搜索"
          aria-label="搜索设置"
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || !query) return;
            if (event.key === "Tab") {
              clear();
            } else if (event.key === "Escape") {
              // Clears the search instead of closing settings.
              event.preventDefault();
              event.stopPropagation();
              clear();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const count = hits.length;
              if (count) setActive((index) => (index + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (hits[active]) pick(hits[active]);
            }
          }}
        />
      </div>
      {box &&
        createPortal(
          <div ref={panel} id={listId} role="listbox" aria-label="搜索结果" className="popover settings-search-menu" style={{ top: box.bottom + 4, left: box.left }}>
            {hits.length === 0 ? (
              <div className="settings-search-empty">
                <SearchX size={32} />
                <span>没有匹配的设置</span>
              </div>
            ) : (
              hits.map((hit, index) => {
                const Icon = PAGES[hit.page].icon;
                return (
                  <button
                    key={`${hit.page}:${hit.anchor ?? ""}`}
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    className="menu-item"
                    data-highlighted={index === active || undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setActive(index)}
                    onClick={() => pick(hit)}
                  >
                    <span className="settings-hit">
                      <span className="settings-hit-name">
                        <Icon size={20} />
                        <span>
                          <Highlight text={PAGES[hit.page].label} query={query} />
                        </span>
                      </span>
                      {hit.via && (
                        <span className="settings-hit-via">
                          <Highlight text={hit.via} query={query} />
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

function SettingsModal({ tab }: { tab: SettingsTab }) {
  const page: Page = tab === "mcp" ? "connectors" : tab;
  const hooks = useStore((s) => s.hooks);
  const review = hooks ? hooksNeedingReview(getState()).length : 0;
  // The Hooks row carries a count of hooks waiting for trust.
  useEffect(() => {
    if (getState().hooks === null) void listHooks();
  }, []);
  return (
    <Dialog title="设置" onClose={() => setState({ settings: null })} size="xl">
      <div className="settings">
        <nav className="settings-rail" aria-label="设置">
          <SettingsSearch />
          <div className="settings-nav scroll-fade-y">
            {NAV.map((group, index) => (
              <Fragment key={index}>
                {!group.title && index > 0 && <div className="settings-nav-sep" aria-hidden="true" />}
                {group.title && (
                  <div className="settings-nav-title" id={`settings-nav-${index}`}>
                    {group.title}
                  </div>
                )}
                <ul className="settings-nav-list" aria-labelledby={group.title ? `settings-nav-${index}` : undefined}>
                  {group.pages.map((id) => {
                    const Icon = PAGES[id].icon;
                    return (
                      <li key={id}>
                        <button type="button" className="settings-tab" aria-current={id === page ? "page" : undefined} onClick={() => setState({ settings: id })}>
                          <Icon size={20} />
                          <span>{PAGES[id].label}</span>
                          {id === "hooks" && review > 0 && (
                            <span className="badge badge-warning" aria-label={`${review} 个 hook 待信任`}>
                              {review}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Fragment>
            ))}
          </div>
        </nav>
        <div className="settings-pane">
          <div className="settings-pane-head" aria-hidden="true" />
          <div key={page} className="settings-scroll">
            {page === "general" && <GeneralTab />}
            {page === "account" && <AccountTab />}
            {page === "memory" && <MemoryTab />}
            {page === "labs" && <LabsTab />}
            {page === "plugins" && <PluginsTab />}
            {page === "skills" && <SkillsTab />}
            {page === "connectors" && <ConnectorsTab />}
            {page === "hooks" && <HooksTab />}
            {page === "about" && <AboutTab />}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export function SettingsDialog() {
  const tab = useStore((s) => s.settings);
  const ready = useStore((s) => s.conn.status === "ready");
  // Extra skill roots live only in the running app-server: hand them over again on every connect.
  useEffect(() => {
    const roots = ready ? savedSkillRoots() : [];
    if (roots.length) void setSkillRoots(roots).catch(() => {});
  }, [ready]);
  return tab ? <SettingsModal tab={tab} /> : null;
}

// ---------------------------------------------------------------------------
// Sign-in (W11 /login; W15: the desktop window is 600 x 600 while signed out)

function LoginFaq() {
  const [open, setOpen] = useState<number | null>(null);
  const items: [string, ReactNode][] = [
    ["ChatGPT 账户和 API Key 有什么区别？", "ChatGPT 账户（Plus、Pro、Business 等）使用套餐里包含的 Codex 额度；API Key 按 OpenAI API 的价格按量计费。"],
    [
      "已经在终端里登录过 Codex？",
      <>
        Codex UI 和 Codex CLI 共用 CODEX_HOME 里的登录信息。在终端运行 <code className="inline-code">codex login</code> 之后，
        <button type="button" className="link-btn" onClick={() => void refreshAccount()}>
          刷新状态
        </button>
        。
      </>,
    ],
    ["什么时候用设备码？", "这台电脑上的浏览器打不开登录页面，或者登录后回不到这里时，可以用设备码在另一台设备上完成登录。"],
  ];
  return (
    <div className="login-faq">
      {items.map(([question, answer], index) => (
        <div key={question}>
          <button type="button" className="login-acc" aria-expanded={open === index} onClick={() => setOpen(open === index ? null : index)}>
            {question}
            <ChevronRight size={16} />
          </button>
          {open === index && <div className="login-acc-panel">{answer}</div>}
        </div>
      ))}
    </div>
  );
}

export function LoginView() {
  const login = useStore((s) => s.login);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  // The desktop shell shows sign-in in a 600 x 600 window and restores the app size once signed in.
  useEffect(() => {
    window.codexDesktop?.setAuthWindow?.(false);
    return () => {
      if (getState().account?.account) window.codexDesktop?.setAuthWindow?.(true);
    };
  }, []);
  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    fn()
      .catch((error) => toast("error", "登录失败", errorMessage(error)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="login">
      <header className="login-nav">
        <span className="login-brand">
          <Spark size={20} />
          Codex
        </span>
      </header>
      <main className="login-main">
        <h1 className="login-title">登录 Codex</h1>
        <div className="login-card">
          {login ? (
            <>
              {login.kind === "chatgptDeviceCode" ? (
                <>
                  <p>在浏览器打开下面的链接，并输入验证码：</p>
                  <div className="device-code mono">{login.userCode}</div>
                  <a className="btn btn-secondary btn-lg" href={login.verificationUrl} target="_blank" rel="noopener noreferrer">
                    <span className="btn-label">{login.verificationUrl}</span>
                  </a>
                </>
              ) : (
                <>
                  <p>已在浏览器打开 ChatGPT 登录页面，完成后会自动返回。</p>
                  <a className="btn btn-secondary btn-lg" href={login.authUrl} target="_blank" rel="noopener noreferrer">
                    重新打开登录页面
                  </a>
                </>
              )}
              {login.error && <div className="error-text">{login.error}</div>}
              <div className="login-wait">
                <Spinner size={14} /> 等待登录完成…
              </div>
              <Button variant="ghost" size="lg" onClick={() => void cancelLogin()}>
                取消
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="lg" disabled={busy} onClick={() => run(() => loginChatGpt(false))}>
                使用 ChatGPT 账户继续
              </Button>
              <Button variant="secondary" size="lg" disabled={busy} onClick={() => run(() => loginChatGpt(true))}>
                使用设备码登录
              </Button>
              <div className="login-or">或</div>
              <form
                className="login-key"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (apiKey.trim()) run(() => loginApiKey(apiKey.trim()));
                }}
              >
                <input
                  className="input input-lg mono"
                  type="password"
                  autoComplete="off"
                  placeholder="OpenAI API Key（sk-…）"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  aria-label="OpenAI API Key"
                />
                <Button variant="primary" size="lg" type="submit" disabled={busy || !apiKey.trim()}>
                  使用 API Key 继续
                </Button>
              </form>
              <p className="login-terms">ChatGPT 账户使用套餐内的 Codex 额度，API Key 按量计费。</p>
            </>
          )}
        </div>
        <LoginFaq />
      </main>
    </div>
  );
}
