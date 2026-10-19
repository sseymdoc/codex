// Settings and the sign-in page.
//
// Settings is the desktop 2.42304 settings modal (ion-dist shared-19 `pA` frame, `Uk` rail, `qk` nav
// row, `Nw` / `Pw` groups; cc011544b `SettingsNavSearch`; shared-1 `gx` row, `xx` section, `hx`
// deep-link highlight; cd19fedd2 / c7357c32b setting registries). The Codex page is the real
// "Claude Code" page (c71860c77 Bl2Tfe3A), 系统 the "This computer → System" page (CGKWOsmF). The
// customize pages live in SettingsCustomize.tsx.

import type { Config } from "@protocol/v2/Config";
import type { ExternalAgentConfigMigrationItem } from "@protocol/v2/ExternalAgentConfigMigrationItem";
import type { ExternalAgentConfigMigrationItemType } from "@protocol/v2/ExternalAgentConfigMigrationItemType";
import type { GetAccountTokenUsageResponse } from "@protocol/v2/GetAccountTokenUsageResponse";
import type { Model } from "@protocol/v2/Model";
import type { RateLimitSnapshot } from "@protocol/v2/RateLimitSnapshot";
import type { RateLimitWindow } from "@protocol/v2/RateLimitWindow";
import type { WindowsSandboxReadiness } from "@protocol/v2/WindowsSandboxReadiness";
import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  BUILD,
  PRESETS,
  archiveInactiveThreads,
  cancelLogin,
  consumeRateLimitResetCredit,
  detectImports,
  errorMessage,
  listHooks,
  loginApiKey,
  loginChatGpt,
  memoriesEnabled,
  pairingClaimed,
  presetAllowed,
  presetOf,
  readUsage,
  refreshConfig,
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
import { externalUrl, formatDuration, formatTokens, limitName } from "../lib/format";
import { VIEWS, type TranscriptView } from "../lib/session";
import { searchSettings, type SearchHit, type SearchSection } from "../lib/settings";
import { getState, hooksNeedingReview, readPref, setState, toast, useStore, writePref, type LoginState, type PermissionPreset, type SettingsTab } from "../lib/store";
import { EFFORT_LABELS } from "./Composer";
import { VIEW_LABELS } from "./Main";
import { ConnectorsTab, HooksTab, MemoryTab, PluginsTab, SkillsTab, savedSkillRoots } from "./SettingsCustomize";
import { Button, Dialog, Icon, MOTION_KEY, MenuSelect, Segmented, Skeleton, Spark, Spinner, Toggle, UsageRing, applyMotion, type IconName } from "./ui";

const DESKTOP = typeof window !== "undefined" && !!window.codexDesktop;

function platformName(): "Windows" | "Mac" | "Linux" {
  const agent = navigator.userAgent;
  return agent.includes("Windows") ? "Windows" : agent.includes("Mac") ? "Mac" : "Linux";
}

const report = (error: string | null) => {
  if (error) toast("danger", "保存失败", error);
};

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

// Code font (cd19fedd2 codeFont, editorPrefs.editorFont): one family name in front of the
// monospace stack, as shared-frame Ra() writes --cds-font-mono-override (quoted, then a comma).
const CODE_FONT_KEY = "codex-ui:code-font";

function codeFont(): string {
  try {
    return localStorage.getItem(CODE_FONT_KEY) ?? "";
  } catch {
    return "";
  }
}

/** The code font stack (tokens.css --font-mono, 代码字体 first if set); the terminal hands it to xterm. */
export function codeFontFamily(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
}

function applyCodeFont() {
  const font = codeFont().trim().replaceAll(/[\u0000-\u001f\u007f]/g, "").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const root = document.documentElement.style;
  if (font) root.setProperty("--cds-font-mono-override", `"${font}",`);
  else root.removeProperty("--cds-font-mono-override");
}

applyCodeFont();

// Interface font (cd19fedd2 interfaceFont: "anthropic" by default, kept on this device). shared-52
// cm() marks <html>: data-font="system" for System and OpenDyslexic, then data-system-font or
// data-dyslexic-font (tokens.css, transcript.css).
type InterfaceFont = "anthropic" | "system" | "dyslexic";
const INTERFACE_FONT_KEY = "codex-ui:interface-font";
const INTERFACE_FONTS: { value: InterfaceFont; label: string }[] = [
  { value: "anthropic", label: "Anthropic Sans" },
  { value: "system", label: "系统" },
  { value: "dyslexic", label: "OpenDyslexic" },
];

function applyInterfaceFont(font: InterfaceFont) {
  const root = document.documentElement;
  if (font === "anthropic") root.removeAttribute("data-font");
  else root.dataset.font = "system";
  root.toggleAttribute("data-system-font", font === "system");
  root.toggleAttribute("data-dyslexic-font", font === "dyslexic");
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
  below,
  indent,
  children,
}: {
  id?: string;
  label: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  /** The label opens a detail page. */
  onOpen?: () => void;
  /** A line under the row (a status, an error). */
  below?: ReactNode;
  /** A sub-setting of the row above (ps-lg). */
  indent?: boolean;
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
  const main = (
    <>
      {leading && <span className="settings-row-leading">{leading}</span>}
      {onOpen ? (
        <button type="button" className="settings-row-text settings-row-open" onClick={onOpen}>
          {text}
        </button>
      ) : (
        <div className="settings-row-text">{text}</div>
      )}
      {children && <div className="settings-row-control">{children}</div>}
    </>
  );
  const group = { id, role: "group", "aria-labelledby": labelId, "aria-describedby": description ? descriptionId : undefined, "data-indent": indent || undefined };
  return below ? (
    <div {...group} className="settings-row settings-row-below">
      <div className="settings-row-main">{main}</div>
      {below}
    </div>
  ) : (
    <div {...group} className="settings-row">
      {main}
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

/** The desktop shell's settings (null in a browser and until read); a refused patch is put back and reported. */
function useDesktopSettings() {
  const [settings, setSettings] = useState<CodexDesktopSettings | null>(null);
  useEffect(() => {
    void window.codexDesktop?.getDesktopSettings().then(setSettings);
  }, []);
  const save = async (patch: Partial<CodexDesktopSettings>): Promise<string | null> => {
    const previous = settings;
    setSettings((current) => current && { ...current, ...patch });
    const result = await window.codexDesktop?.setDesktopSettings(patch).catch((error: unknown) => ({ ok: false as const, error: errorMessage(error) }));
    if (!result || result.ok) return null;
    setSettings(previous);
    return result.error;
  };
  return [settings, save] as const;
}

// ---------------------------------------------------------------------------
// General (c0db37792: the Appearance group; the transcript rows live here, as with
// transcriptTextSizeInGeneral / transcriptWidthInGeneral)

function GeneralTab() {
  const [theme, setTheme] = useState(currentTheme);
  const [textSize, setTextSize] = useState(() => readPref<Size>(CHAT_TEXT_SIZE_KEY, SIZES, "m"));
  const [width, setWidth] = useState(() => readPref<Size>(TRANSCRIPT_WIDTH_KEY, SIZES, "s"));
  const [motion, setMotion] = useState(() => readPref<"system" | "reduce">(MOTION_KEY, ["system", "reduce"], "system"));
  return (
    <Section id="setting-general-appearance" title="外观">
      <Row id="setting-general-theme" label="主题">
        <Segmented
          value={theme}
          options={[
            { value: "system", label: <ThemeIcon icon="Computer" label="系统" /> },
            { value: "light", label: <ThemeIcon icon="Sun" label="浅色" /> },
            { value: "dark", label: <ThemeIcon icon="Moon" label="深色" /> },
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
      <Row id="setting-general-motion" label="动效" description="减少流式回复和其他界面元素中的动画。">
        <Segmented
          value={motion}
          options={[
            { value: "system", label: "系统" },
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

// shared-frame hO draws a segment's icon at size "auto" (the density's icon size).
function ThemeIcon({ icon, label }: { icon: IconName; label: string }) {
  return (
    <span className="settings-theme-icon" data-tip={label}>
      <Icon name={icon} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Codex (c71860c77 Bl2Tfe3A ta(): code appearance, appearance, Remote Control, sessions; then
// Codex's own new-session defaults)

function CodeAppearanceSection() {
  const [font, setFont] = useState(codeFont);
  return (
    <Section id="setting-codex-code-appearance" title="代码外观">
      <Row id="setting-codex-code-font" label="代码字体" description="为代码和终端设置自定义等宽字体。">
        <input
          className="input settings-code-font"
          value={font}
          placeholder="例如 JetBrains Mono"
          aria-label="代码字体名称"
          onChange={(event) => {
            setFont(event.target.value);
            writePref(CODE_FONT_KEY, event.target.value);
            applyCodeFont();
          }}
        />
      </Row>
    </Section>
  );
}

/** c71860c77 Xn: 界面字体 (here while interfaceFontInGeneral, __gb__1197194941, is off), then 默认对话视图. */
function AppearanceSection() {
  const defaultView = useStore((s) => s.defaultView);
  const [font, setFont] = useState(() =>
    readPref<InterfaceFont>(
      INTERFACE_FONT_KEY,
      INTERFACE_FONTS.map((option) => option.value),
      "anthropic",
    ),
  );
  return (
    <Section id="setting-codex-appearance" title="外观">
      <Row
        id="setting-codex-interface-font"
        label="界面字体"
        description={
          <>
            整个界面使用的字体，包括菜单、侧栏和面板。 <FontLicenses />
          </>
        }
      >
        <Segmented
          value={font}
          options={INTERFACE_FONTS}
          onChange={(value) => {
            setFont(value);
            writePref(INTERFACE_FONT_KEY, value);
            applyInterfaceFont(value);
          }}
        />
      </Row>
      <Row id="setting-codex-default-transcript-view" label="默认对话视图" description="会话打开时使用的视图。在会话的“对话视图”菜单中选择视图只会更改该会话。">
        <Segmented
          value={defaultView}
          options={VIEWS.map((view) => ({ value: view, label: VIEW_LABELS[view] }))}
          onChange={(value: TranscriptView) => {
            writePref("codex-ui:view", value);
            setState({ defaultView: value });
          }}
        />
      </Row>
    </Section>
  );
}

/** 字体许可 (cea462098): the licence text of the faces in use (Claude Desktop's, else codex-ui's own for
 *  its stand-ins), fetched on first open; the dialog stays empty without it. */
function FontLicenses() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const show = () => {
    setOpen(true);
    if (text === null)
      void fetch("/third-party-notices.txt")
        .then((response) => (response.ok && response.headers.get("content-type")?.startsWith("text/plain") ? response.text() : null))
        .catch(() => null)
        .then((body) => body !== null && setText(body));
  };
  return (
    <>
      <button type="button" className="link-btn" aria-haspopup="dialog" onClick={show}>
        字体许可
      </button>
      {open && (
        <Dialog title="字体许可" size="lg" onClose={() => setOpen(false)}>
          <pre className="font-licenses scroll-fade-y" role="region" aria-label="字体许可" tabIndex={0}>
            {text}
          </pre>
        </Dialog>
      )}
    </>
  );
}

const REMOTE_TEXT = { disabled: "已关闭", connecting: "正在连接…", connected: "已连接", errored: "连接失败" } as const;

const remoteAvailable = () => getState().remoteControl !== null && getState().requirements?.allowRemoteControl !== false;

/** Remote Control (U19): this window's app-server, ephemeral; pair a device with a manual code. */
function RemoteControlSection() {
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
          toast("neutral", "设备已配对");
          loadClients();
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [pairing]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!remote || !allowed) return null;
  const on = remote.status !== "disabled";
  return (
    <Section id="setting-codex-remote-control" title="Remote Control">
      <Row
        id="setting-codex-remote-control-enabled"
        label="Remote Control"
        description={`从其他设备继续这台电脑上的会话。仅在此窗口打开期间有效。当前状态：${REMOTE_TEXT[remote.status]}。`}
      >
        <Toggle
          checked={on}
          label="Remote Control"
          onChange={(enabled) => void setRemoteControl(enabled).catch((error) => toast("danger", enabled ? "开启 Remote Control 失败" : "关闭 Remote Control 失败", errorMessage(error)))}
        />
      </Row>
      {on && (
        <Row
          id="setting-codex-remote-pairing"
          label="配对设备"
          description={
            pairing ? (
              <>
                在要配对的设备上输入 <code className="inline-code">{pairing.manualPairingCode ?? pairing.pairingCode}</code>，
                {new Date(pairing.expiresAt * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 前有效。
              </>
            ) : (
              "生成一次性配对码，在其他设备上输入后即可使用 Remote Control。"
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
                .catch((error) => toast("danger", "无法生成配对码", errorMessage(error)))
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
                  .catch((error) => toast("danger", "撤销失败", errorMessage(error)))
              }
            >
              撤销
            </Button>
          </Row>
        ))}
    </Section>
  );
}

// Bl2Tfe3A pr: drawAttention's description per platform.
const DRAW_ATTENTION_TEXT = {
  Mac: "当 Codex 需要您注意且应用不在前台时，让程序坞图标跳动。",
  Windows: "当 Codex 需要您注意且应用不在前台时，闪烁任务栏按钮。",
  Linux: "当 Codex 需要您注意且应用不在前台时，闪烁应用图标。",
};

// Bl2Tfe3A ur.
const ARCHIVE_DAYS = [0, 1, 2, 7, 14, 30];

/** Bl2Tfe3A pr, the "Sessions" group (rows Codex has no counterpart for are left out). */
function SessionsSection() {
  const allowFullAccess = useStore((s) => s.allowFullAccess);
  const archiveDays = useStore((s) => s.autoArchiveDays);
  const [desktop, saveDesktop] = useDesktopSettings();
  return (
    <Section id="setting-codex-sessions" title="会话">
      <Row
        id="setting-codex-bypass-permissions"
        label="允许绕过权限模式"
        description="绕过所有权限检查，让 Codex 不间断地工作。这适用于修复 lint 错误或生成样板代码等工作流。让 Codex 运行任意命令存在风险，可能导致数据丢失、系统损坏或数据外泄（例如通过提示注入攻击）。"
      >
        <Toggle
          checked={allowFullAccess}
          label="允许绕过权限模式"
          onChange={(on) => {
            writePref("codex-ui:allow-full-access", String(on));
            setState({ allowFullAccess: on });
          }}
        />
      </Row>
      {desktop && (
        <>
          <Row id="setting-codex-draw-attention" label="通知时引起注意" description={DRAW_ATTENTION_TEXT[platformName()]}>
            <Toggle checked={desktop.drawAttention} label="通知时引起注意" onChange={(drawAttention) => void saveDesktop({ drawAttention }).then(report)} />
          </Row>
          <Row
            id="setting-codex-keep-awake-while-working"
            label="Codex 工作时让电脑保持唤醒"
            description="在会话运行期间阻止电脑睡眠，让长任务能够完成。显示器仍可关闭。合上笔记本电脑的盖子仍会使其睡眠。"
          >
            <Toggle checked={desktop.keepAwake} label="Codex 工作时让电脑保持唤醒" onChange={(keepAwake) => void saveDesktop({ keepAwake }).then(report)} />
          </Row>
          {desktop.keepAwake && (
            <Row id="setting-codex-keep-awake-on-battery" indent label="使用电池供电时也保持唤醒">
              <Toggle checked={desktop.keepAwakeOnBattery} label="使用电池供电时也保持唤醒" onChange={(keepAwakeOnBattery) => void saveDesktop({ keepAwakeOnBattery }).then(report)} />
            </Row>
          )}
        </>
      )}
      <Row id="setting-codex-archive-inactive-sessions" label="归档不活跃的会话" description="在一段时间没有活动后自动归档本地会话。正在运行或有后台任务的会话永远不会被归档。">
        <MenuSelect
          label="归档不活跃的会话"
          value={String(archiveDays)}
          options={ARCHIVE_DAYS.map((days) => ({ value: String(days), label: days ? `${days} 天` : "从不" }))}
          onChange={(value) => {
            writePref("codex-ui:auto-archive-days", value);
            setState({ autoArchiveDays: Number(value) });
          }}
        />
      </Row>
      <LocalSandboxRow />
    </Section>
  );
}

/** windows.sandbox in the effective config.toml (elevated / unelevated / mxc), if set. */
function sandboxMode(config: Config | null): unknown {
  const windows = config?.windows;
  return windows && typeof windows === "object" && !Array.isArray(windows) ? (windows.sandbox ?? null) : null;
}

const windowsHost = () => getState().server.info?.platformOs === "windows";

type SandboxSetup = { since: boolean; until: number } | { error: string } | null;

/**
 * Bl2Tfe3A rr, Windows only: on runs the elevated setup (a UAC prompt once), which writes
 * windows.sandbox when it succeeds; off clears windows.sandbox (Codex then runs without it).
 * Readiness comes from the config app-server started with, so a change made here is tracked
 * through config/read and kept locally.
 */
function LocalSandboxRow() {
  const configured = useStore((s) => !!sandboxMode(s.config));
  const [readiness, setReadiness] = useState<WindowsSandboxReadiness | null>(null);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<SandboxSetup>(null);
  useEffect(() => {
    void windowsSandboxReadiness().then(setReadiness);
  }, []);
  // The outcome arrives as a notification (codex.ts toasts it): a success writes the mode, and a
  // mode configured before only needs readiness to flip.
  useEffect(() => {
    if (!setup || "error" in setup) return;
    const timer = setInterval(() => {
      void Promise.all([refreshConfig(), windowsSandboxReadiness()]).then(([, next]) => {
        if (sandboxMode(getState().config) && (!setup.since || next === "ready")) {
          setChosen(true);
          setSetup(null);
        } else if (Date.now() > setup.until) setSetup({ error: "" });
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [setup]);
  if (!readiness) return null;
  const busy = !!setup && !("error" in setup);
  const on = chosen ?? (configured && readiness !== "updateRequired");
  const turn = (next: boolean) => {
    if (next) {
      setSetup({ since: configured, until: Date.now() + 120_000 });
      startWindowsSandboxSetup("elevated")
        .then((started) => started || setSetup({ error: "" }))
        .catch((error) => setSetup({ error: errorMessage(error) }));
      return;
    }
    setSetup(null);
    writeConfig([{ keyPath: "windows.sandbox", value: null, mergeStrategy: "replace" }])
      .then(() => setChosen(false))
      .catch((error) => toast("danger", "保存失败", errorMessage(error)));
  };
  return (
    <Row
      id="setting-codex-local-sandbox"
      label="本地沙箱"
      description={`在隔离的沙箱中运行 Codex 的命令。对新会话生效。${on || busy ? "" : "开启时会请求一次管理员权限。"}`}
      below={
        busy ? (
          <div className="settings-row-desc">正在设置…</div>
        ) : setup && "error" in setup ? (
          <div className="settings-row-desc settings-row-status">
            设置未完成。
            {setup.error && <code className="about-value">{setup.error}</code>}
          </div>
        ) : undefined
      }
    >
      <Toggle checked={on || busy} disabled={busy} label="本地沙箱" onChange={turn} />
    </Row>
  );
}

const modelOf = (config: Config | null, models: Model[]) => models.find((m) => m.id === config?.model || m.model === config?.model);

function DefaultsSection() {
  const config = useStore((s) => s.config);
  const models = useStore((s) => s.models);
  useStore((s) => s.requirements);
  useStore((s) => s.allowFullAccess);
  const model = modelOf(config, models);
  const preset = presetOf(config?.approval_policy, config?.sandbox_mode);
  const save = (edits: Parameters<typeof writeConfig>[0]) =>
    writeConfig(edits)
      .then(() => toast("neutral", "已保存到 config.toml"))
      .catch((error) => toast("danger", "保存失败", errorMessage(error)));
  return (
    <Section id="setting-codex-defaults" title="新会话默认值" description="写入 config.toml，对之后新建的会话生效；也可以在输入框下方为单个会话临时调整。">
      <Row id="setting-codex-model" label="模型">
        <MenuSelect
          label="模型"
          value={config?.model ?? ""}
          options={[{ value: "", label: "自动（服务端默认）" }, ...models.map((m) => ({ value: m.model, label: m.displayName }))]}
          onChange={(value) => void save([{ keyPath: "model", value: value || null, mergeStrategy: "replace" }])}
        />
      </Row>
      {model && model.supportedReasoningEfforts.length > 0 && (
        <Row id="setting-codex-effort" label="推理强度">
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
      <Row id="setting-codex-permission" label="权限" description={preset ? PRESETS[preset].description : "当前配置不属于预设组合。"}>
        <MenuSelect<PermissionPreset | "">
          label="权限"
          value={preset ?? ""}
          options={[
            ...(preset ? [] : [{ value: "" as const, label: "自定义" }]),
            // A preset that is not allowed (full access before it is turned on) stays only while it is the current one.
            ...(Object.keys(PRESETS) as PermissionPreset[]).filter((id) => id === preset || presetAllowed(id)).map((id) => ({ value: id, label: PRESETS[id].label })),
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

function CodexTab() {
  return (
    <>
      <CodeAppearanceSection />
      <AppearanceSection />
      <RemoteControlSection />
      <SessionsSection />
      <DefaultsSection />
    </>
  );
}

// ---------------------------------------------------------------------------
// Import (where the real Import & export page sits)

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
function ImportTab() {
  const imports = useStore((s) => s.imports);
  const [items, setItems] = useState<ExternalAgentConfigMigrationItem[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const running = imports !== null && !imports.done;
  return (
    <Section
      id="setting-import-agents"
      title="从其他代理导入"
      description="将其他编程代理的说明文件、技能、MCP 服务器等配置迁移到 Codex。"
      action={
        items !== null && items.length > 0 ? (
          <Button
            variant="primary"
            size="sm"
            disabled={!picked.size || running}
            onClick={() =>
              void runImport(items.filter((_, index) => picked.has(index))).catch((error) => toast("danger", "导入失败", errorMessage(error)))
            }
          >
            {running ? "正在导入…" : `导入所选（${picked.size}）`}
          </Button>
        ) : undefined
      }
    >
      {items === null ? (
        <Row id="setting-import-detect" label="检测可导入的配置" description="在用户目录和当前工作区中查找。">
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
                .catch((error) => toast("danger", "检测失败", errorMessage(error)))
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
// System, desktop shell only (CGKWOsmF Li(): version, run on startup, the Quick Entry hotkey
// recorder Oi, the system tray). Windows has no separate Quick Entry switch: an empty recorder
// turns the hotkey off.

const RESERVED_SHORTCUTS = [
  // c71860c77: the system's.
  ...["Cmd+Q", "Cmd+W", "Cmd+H", "Cmd+M", "Cmd+,", "Cmd+N", "Cmd+O", "Cmd+T", "Cmd+S", "Cmd+C", "Cmd+V", "Ctrl+W", "Ctrl+N", "Ctrl+O", "Ctrl+T", "Ctrl+S", "Ctrl+C", "Ctrl+V"],
  // codex-ui's own (Palette.tsx bindings), spelled the way the recorder does (Shift+Alt+Ctrl+key): a global hotkey would take them from the page.
  ..."KB/,F=-`0123456789".split("").map((key) => `Ctrl+${key}`),
  ...["K", ",", "O", "D", "M", "I", "E", "Tab", "Backspace"].map((key) => `Shift+Ctrl+${key}`),
  "Ctrl+Tab",
  "Alt+Ctrl+M",
  "Alt+Ctrl+F",
];
const MODIFIER_CODES = ["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"];

// CGKWOsmF Si / Ci: how each modifier the recorder writes is shown, and in which order.
const SHORTCUT_KEYS: Record<"Windows" | "Mac" | "Linux", Record<string, [string, number]>> = {
  Windows: { Ctrl: ["Ctrl", 0], Alt: ["Alt", 1], Shift: ["Shift", 2], Super: ["Windows", 3] },
  Mac: { Ctrl: ["⌃", 0], Alt: ["⌥", 1], Shift: ["⇧", 2], Cmd: ["⌘", 3] },
  Linux: { Ctrl: ["Ctrl", 0], Alt: ["Alt", 1], Shift: ["Shift", 2], Super: ["Super", 3] },
};

/** CGKWOsmF Ei(): modifiers first in Ctrl / Alt / Shift / Windows order, joined with + (a space on a Mac). */
function acceleratorText(accelerator: string): string {
  const platform = platformName();
  const names = SHORTCUT_KEYS[platform];
  const parts = accelerator.split(/\s*\+\s*/);
  const modifiers = parts
    .filter((part) => part in names)
    .map((part) => names[part])
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name);
  return [...modifiers, ...parts.filter((part) => !(part in names))].join(platform === "Mac" ? " " : "+");
}

/** Focus it (click or Tab) and press a combination. `save` resolves to an error or null. */
function ShortcutInput({ label, value, save }: { label: string; value: string; save(accelerator: string): Promise<string | null> }) {
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const commit = (accelerator: string) => {
    setError(null);
    void save(accelerator).then(setError);
  };
  // Recording owns the keys: no app shortcut and no closing settings while it listens (Esc included, as Oi).
  const swallow = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const modified = event.altKey || event.ctrlKey || event.metaKey;
    if ((event.key === "Tab" && !modified) || event.nativeEvent.isComposing) return;
    swallow(event);
    if (MODIFIER_CODES.includes(event.code)) return;
    const modifiers = [event.shiftKey && "Shift", event.altKey && "Alt", event.ctrlKey && "Ctrl", event.metaKey && (platformName() === "Mac" ? "Cmd" : "Super")].filter(
      (name): name is string => !!name,
    );
    const key = event.code.startsWith("Key") ? event.code.slice(-1) : event.code === "Space" ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.code;
    const accelerator = [...modifiers, key].join("+");
    if ((!modifiers.length && !/^F\d+$/.test(key)) || RESERVED_SHORTCUTS.includes(accelerator)) {
      setError("此快捷键保留给常用操作。请尝试其他组合。");
      return;
    }
    commit(accelerator);
  };
  const text = value ? acceleratorText(value) : "";
  return (
    <div className="shortcut-field">
      <div
        role="button"
        tabIndex={0}
        aria-label={`${label}：${text || "未设置"}`}
        aria-describedby={error ? errorId : undefined}
        className="shortcut-input"
        data-empty={!value || undefined}
        onKeyDown={onKeyDown}
        onKeyUp={swallow}
      >
        <span title={text || undefined}>{text || "设置快捷键"}</span>
        {value && (
          <button type="button" className="shortcut-clear" aria-label="清除快捷键" data-tip="清除快捷键" onClick={() => commit("")}>
            <Icon name="XCircle" size={16} />
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

function SystemTab() {
  const [settings, save] = useDesktopSettings();
  if (!settings) return null;
  return (
    <Section id="setting-system-system" title="系统">
      <Row id="setting-system-desktop-app-version" label="桌面应用版本">
        <span className="settings-version">{BUILD.version}</span>
      </Row>
      <Row id="setting-system-run-on-startup" label="开机时运行" description="登录电脑时自动启动 Codex。">
        <Toggle checked={settings.runOnStartup} label="开机时运行" onChange={(runOnStartup) => void save({ runOnStartup }).then(report)} />
      </Row>
      <Row id="setting-system-quick-entry-shortcut" label="快速输入键盘快捷键" description="随时随地快速打开 Codex。">
        <ShortcutInput
          label="快速输入键盘快捷键"
          value={settings.quickEntry ? settings.quickEntryShortcut : ""}
          save={(accelerator) => save(accelerator ? { quickEntry: true, quickEntryShortcut: accelerator } : { quickEntry: false })}
        />
      </Row>
      <Row id="setting-system-menu-bar" label="系统托盘" description="让 Codex 在系统托盘中保持运行。">
        <Toggle checked={settings.menuBar} label="系统托盘" onChange={(menuBar) => void save({ menuBar }).then(report)} />
      </Row>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Usage (the real "Usage" page, qhVBcowZ: a 7 / 30 / 90 day range over the usage chart; the
// rate limits and reset credits are Codex's own)

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
  const caption = `近 ${days.length} 天每日 tokens`;
  return (
    <figure className="usage-chart">
      <figcaption className="usage-chart-title">{caption}</figcaption>
      <div className="usage-plot">
        <div className="usage-grid" aria-hidden="true">
          {[top, top / 2, 0].map((tick) => (
            <div key={tick} className="usage-gridline">
              <span>{formatTokens(tick)}</span>
            </div>
          ))}
        </div>
        <div className="usage-bars" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }} onPointerLeave={() => setHover(null)}>
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
              <span className="usage-day" style={{ height: `${(day.tokens / top) * 100}%` }}>
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
        <caption>{caption}</caption>
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

function UsageDashboard({ usage, days }: { usage: GetAccountTokenUsageResponse; days: number }) {
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
      {usage.dailyUsageBuckets?.length ? <DailyChart days={lastDays(usage.dailyUsageBuckets, days)} /> : <p className="settings-note">还没有每日用量数据。</p>}
    </div>
  );
}

// qhVBcowZ B.
const RANGES = [7, 30, 90];

function UsageSection() {
  const [usage, setUsage] = useState<GetAccountTokenUsageResponse | "error" | null>(null);
  const [range, setRange] = useState("30");
  useEffect(() => {
    readUsage()
      .then(setUsage)
      .catch(() => setUsage("error"));
  }, []);
  return (
    <Section
      id="setting-account-usage"
      title="用量统计"
      action={<Segmented value={range} options={RANGES.map((days) => ({ value: String(days), label: `${days} 天` }))} onChange={setRange} />}
    >
      {usage === null ? <Skeleton lines={3} /> : usage === "error" ? <p className="settings-note">暂时无法读取用量统计。</p> : <UsageDashboard usage={usage} days={Number(range)} />}
    </Section>
  );
}

const RESET_OUTCOME = {
  reset: ["neutral", "额度已重置"],
  nothingToReset: ["neutral", "当前没有需要重置的用量"],
  noCredit: ["warning", "没有可用的重置额度"],
  alreadyRedeemed: ["neutral", "这次重置已经生效"],
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
          ? `还有 ${available} 次重置机会，可以立即清空当前的用量窗口。${expiry ? `最早的一次 ${new Date(expiry * 1000).toLocaleDateString("zh-CN")} 到期。` : ""}`
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
          description="当前的用量窗口会立即清空；这次重置额度用掉后不能退回。"
          confirm="使用"
          onClose={() => setConfirm(false)}
          onConfirm={() =>
            consumeRateLimitResetCredit()
              .then((outcome) => {
                const [kind, title] = RESET_OUTCOME[outcome];
                toast(kind, title);
              })
              .catch((error) => toast("danger", "使用重置额度失败", errorMessage(error)))
          }
        />
      )}
    </Row>
  );
}

function UsageTab() {
  const account = useStore((s) => s.account);
  const limits = useStore((s) => s.rateLimits);
  const info = account?.account;
  // qhVBcowZ U: usage the app cannot see is reported elsewhere.
  if (!info) return <p className="settings-note">自定义模型提供方的用量由该提供方报告，不在此处显示。</p>;
  // One snapshot per metered limit when the server reports several, else the single bucket.
  const snapshots = Object.values(limits?.rateLimitsByLimitId ?? {}).filter((snapshot): snapshot is RateLimitSnapshot => !!snapshot);
  const buckets = snapshots.length ? snapshots : limits ? [limits.rateLimits] : [];
  const owner = limits?.accountId ?? (info.type === "chatgpt" ? info.email : null) ?? "local";
  const windows = buckets.flatMap((snapshot) =>
    [snapshot.primary, snapshot.secondary]
      .filter((window): window is RateLimitWindow => !!window)
      .map((window) => ({ window, key: `${owner}:${snapshot.limitId ?? "codex"}:${window.windowDurationMins ?? 0}:${window.resetsAt ?? 0}`, name: snapshot.limitName ?? snapshot.limitId })),
  );
  const credits = buckets.find((snapshot) => snapshot.credits?.hasCredits)?.credits;
  return (
    <>
      <Section
        id="setting-account-limits"
        title="额度"
        action={<Button variant="ghost" size="xs" muted icon={<Icon name="ArrowClockwise" size={16} />} label="刷新额度" onClick={() => void refreshRateLimits()} />}
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
      {info.type === "chatgpt" && <UsageSection />}
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
            onChange={(enabled) => void setFeature(feature.name, enabled).catch((error) => toast("danger", "切换实验功能失败", errorMessage(error)))}
          />
        </Row>
      ))}
    </Section>
  );
}

/** W15 About window as a page, opened by the desktop shell's 关于 Codex (not in the rail): the version line copies "app version time" and confirms for 2s. */
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
          {DESKTOP && (
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
          {copied ? "已将版本复制到剪贴板" : `版本 ${version}`}
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
      <Section id="setting-about-details" title="详细信息" description="会话、配置与账户数据通过本机的 codex app-server 读写；外观偏好保存在此浏览器中。">
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

// shared-19 Nw / Pw section icons (Usage: the control arm's Chart). Labs, Hooks and About have
// no section there: Beaker is Claude's beta glyph, Lightning its hooks glyph (c71860c77 on).
const PAGES: Record<Page, { label: string; icon: IconName }> = {
  general: { label: "通用", icon: "Settings" },
  account: { label: "用量", icon: "Chart" },
  memory: { label: "记忆", icon: "Memory" },
  codex: { label: "Codex", icon: "Code" },
  import: { label: "导入", icon: "Download" },
  labs: { label: "实验功能", icon: "Beaker" },
  system: { label: "系统", icon: "Computer" },
  skills: { label: "技能", icon: "Scroll" },
  connectors: { label: "连接器", icon: "Connectors" },
  plugins: { label: "插件", icon: "Plugin" },
  hooks: { label: "Hooks", icon: "Lightning" },
  about: { label: "关于", icon: "Info" },
};

// shared-19 Nw / Pw: Settings, This computer (the desktop app only), Customize.
const NAV: { title: string; pages: Page[]; customize?: true }[] = [
  { title: "设置", pages: ["general", "account", "memory", "codex", "import", "labs"] },
  ...(DESKTOP ? [{ title: "这台电脑", pages: ["system" as const] }] : []),
  { title: "自定义", pages: ["skills", "connectors", "plugins", "hooks"], customize: true },
];

// cc011544b Qt: words that find a whole page.
const KEYWORDS: Partial<Record<Page, string[]>> = {
  connectors: ["mcp", "integrations", "tools"],
  skills: ["custom instructions", "agent skills"],
  plugins: ["marketplace", "extensions"],
};

/**
 * The searchable rows: labels as the pages show them, the registry's search phrases (cd19fedd2
 * searchPhrases), and `when` for rows a page shows only sometimes (ca25db325 O()).
 */
const INDEX: { page: Page; anchor: string; label: string; phrases?: string[]; when?: () => boolean }[] = [
  { page: "general", anchor: "setting-general-appearance", label: "外观" },
  { page: "general", anchor: "setting-general-theme", label: "主题" },
  { page: "general", anchor: "setting-general-transcript-text-size", label: "对话文字大小", phrases: ["字号", "更大的文字", "放大文字"] },
  { page: "general", anchor: "setting-general-transcript-width", label: "对话宽度", phrases: ["行宽", "行长", "栏宽"] },
  { page: "general", anchor: "setting-general-motion", label: "动效" },
  { page: "account", anchor: "setting-account-limits", label: "额度", when: () => !!getState().account?.account },
  { page: "account", anchor: "setting-account-reset-credit", label: "重置额度", when: () => !!getState().account?.account && !!getState().rateLimits?.rateLimitResetCredits },
  { page: "account", anchor: "setting-account-usage", label: "用量统计", when: () => getState().account?.account?.type === "chatgpt" },
  { page: "memory", anchor: "setting-memory-enabled", label: "启用记忆" },
  { page: "memory", anchor: "setting-memory-use", label: "在新会话中使用记忆", when: memoriesEnabled },
  { page: "memory", anchor: "setting-memory-generate", label: "从会话中生成记忆", when: memoriesEnabled },
  { page: "memory", anchor: "setting-memory-files", label: "记忆文件" },
  { page: "codex", anchor: "setting-codex-code-appearance", label: "代码外观" },
  { page: "codex", anchor: "setting-codex-code-font", label: "代码字体", phrases: ["等宽", "编辑器字体"] },
  { page: "codex", anchor: "setting-codex-appearance", label: "外观" },
  { page: "codex", anchor: "setting-codex-interface-font", label: "界面字体", phrases: ["UI 字体"] },
  { page: "codex", anchor: "setting-codex-default-transcript-view", label: "默认对话视图" },
  { page: "codex", anchor: "setting-codex-remote-control", label: "Remote Control", when: remoteAvailable },
  { page: "codex", anchor: "setting-codex-sessions", label: "会话" },
  { page: "codex", anchor: "setting-codex-bypass-permissions", label: "允许绕过权限模式" },
  { page: "codex", anchor: "setting-codex-keep-awake-while-working", label: "Codex 工作时让电脑保持唤醒", when: () => DESKTOP },
  { page: "codex", anchor: "setting-codex-keep-awake-on-battery", label: "使用电池供电时也保持唤醒", when: () => DESKTOP },
  { page: "codex", anchor: "setting-codex-archive-inactive-sessions", label: "归档不活跃的会话" },
  { page: "codex", anchor: "setting-codex-local-sandbox", label: "本地沙箱", when: windowsHost },
  { page: "codex", anchor: "setting-codex-defaults", label: "新会话默认值" },
  { page: "codex", anchor: "setting-codex-model", label: "模型" },
  { page: "codex", anchor: "setting-codex-effort", label: "推理强度", when: () => !!modelOf(getState().config, getState().models)?.supportedReasoningEfforts.length },
  { page: "codex", anchor: "setting-codex-permission", label: "权限" },
  { page: "import", anchor: "setting-import-agents", label: "从其他代理导入" },
  { page: "system", anchor: "setting-system-desktop-app-version", label: "桌面应用版本" },
  { page: "system", anchor: "setting-system-run-on-startup", label: "开机时运行" },
  { page: "system", anchor: "setting-system-quick-entry-shortcut", label: "快速输入键盘快捷键" },
  { page: "system", anchor: "setting-system-menu-bar", label: "系统托盘" },
  { page: "skills", anchor: "setting-skills-roots", label: "额外技能目录" },
  { page: "connectors", anchor: "setting-connectors-apps", label: "应用" },
  { page: "connectors", anchor: "setting-connectors-browse", label: "浏览连接器", when: () => getState().account?.account?.type === "chatgpt" },
  { page: "connectors", anchor: "setting-connectors-mcp", label: "MCP 服务器" },
  { page: "plugins", anchor: "setting-plugins-installed", label: "已安装" },
  { page: "plugins", anchor: "setting-plugins-shared", label: "已分享", when: () => getState().account?.account?.type === "chatgpt" },
  { page: "plugins", anchor: "setting-plugins-directory", label: "插件目录" },
  { page: "plugins", anchor: "setting-plugins-marketplaces", label: "插件市场" },
];

/** The rail's pages with the rows they show right now (cc011544b: only listed sections are searched). */
function searchSections(): SearchSection[] {
  return NAV.flatMap((group) =>
    group.pages.map((page) => ({
      id: page,
      name: PAGES[page].label,
      keywords: KEYWORDS[page],
      open: group.customize,
      rows: INDEX.filter((entry) => entry.page === page && (entry.when?.() ?? true)).flatMap((entry) => [
        { text: entry.label, display: entry.label, anchor: entry.anchor },
        ...(entry.phrases ?? []).map((text) => ({ text, display: entry.label, anchor: entry.anchor, phrase: true })),
      ]),
    })),
  );
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
  const hits = query ? searchSettings(searchSections(), text) : [];
  const clear = () => {
    setText("");
    setActive(0);
  };
  const pick = (hit: SearchHit) => {
    clear();
    input.current?.blur();
    openSettings(hit.section as Page, hit.kind === "more" ? undefined : hit.anchor);
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
        <Icon name="Search" size={20} />
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
                <Icon name="SearchCircle" size={28} />
                <span>没有匹配的设置</span>
              </div>
            ) : (
              hits.map((hit, index) => {
                const page = hit.section as Page;
                const title = PAGES[page].label;
                return (
                  <button
                    key={`${hit.kind}:${page}:${hit.kind === "more" ? "" : (hit.via ?? "")}`}
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    aria-label={hit.kind === "child" ? `${title}中的${hit.via}` : hit.kind === "more" ? `${title}中还有 ${hit.count} 项匹配` : undefined}
                    className="menu-item"
                    data-highlighted={index === active || undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setActive(index)}
                    onClick={() => pick(hit)}
                  >
                    {hit.kind === "hit" ? (
                      <span className="settings-hit">
                        <span className="settings-hit-name">
                          <Icon name={PAGES[page].icon} size={20} />
                          <span>
                            <Highlight text={title} query={query} />
                          </span>
                        </span>
                        {hit.via && (
                          <span className="settings-hit-via">
                            <Highlight text={hit.via} query={query} />
                          </span>
                        )}
                      </span>
                    ) : hit.kind === "child" ? (
                      <span className="settings-hit-child">
                        <Highlight text={hit.via} query={query} />
                      </span>
                    ) : (
                      <span className="settings-hit-child settings-hit-more">+{hit.count} 项</span>
                    )}
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
  const page: Page = tab === "mcp" ? "connectors" : tab === "system" && !DESKTOP ? "general" : tab;
  const hooks = useStore((s) => s.hooks);
  const review = hooks ? hooksNeedingReview(getState()).length : 0;
  // The Hooks row carries a count of hooks waiting for trust.
  useEffect(() => {
    if (getState().hooks === null) void listHooks();
  }, []);
  return (
    <Dialog title="设置" onClose={() => setState({ settings: null })} size="xl">
      {/* shared-19 pA: in the desktop app the frame grows past 1024 x 50rem. */}
      <div className="settings" data-desktop={DESKTOP || undefined}>
        <nav className="settings-rail" aria-label="设置">
          <SettingsSearch />
          <div className="settings-nav scroll-fade-y">
            {NAV.map((group, index) => (
              <Fragment key={group.title}>
                <div className="settings-nav-title" id={`settings-nav-${index}`}>
                  {group.title}
                </div>
                <ul className="settings-nav-list" aria-labelledby={`settings-nav-${index}`}>
                  {group.pages.map((id) => {
                    return (
                      <li key={id}>
                        <button type="button" className="settings-tab" aria-current={id === page ? "page" : undefined} onClick={() => setState({ settings: id })}>
                          <Icon name={PAGES[id].icon} size={20} />
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
            {page === "account" && <UsageTab />}
            {page === "memory" && <MemoryTab />}
            {page === "codex" && <CodexTab />}
            {page === "import" && <ImportTab />}
            {page === "labs" && <LabsTab />}
            {page === "system" && <SystemTab />}
            {page === "skills" && <SkillsTab />}
            {page === "connectors" && <ConnectorsTab />}
            {page === "plugins" && <PluginsTab />}
            {page === "hooks" && <HooksTab />}
            {page === "about" && <AboutTab />}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

const HOUR_MS = 60 * 60 * 1000;

export function SettingsDialog() {
  const tab = useStore((s) => s.settings);
  const ready = useStore((s) => s.conn.status === "ready");
  const archiveDays = useStore((s) => s.autoArchiveDays);
  // Extra skill roots live only in the running app-server: hand them over again on every connect.
  useEffect(() => {
    const roots = ready ? savedSkillRoots() : [];
    if (roots.length) void setSkillRoots(roots).catch(() => {});
  }, [ready]);
  // 归档不活跃的会话: sweep on connect and every hour while it is on.
  useEffect(() => {
    if (!ready || !archiveDays) return;
    const sweep = () => void archiveInactiveThreads(archiveDays).catch(() => {});
    sweep();
    const timer = setInterval(sweep, HOUR_MS);
    return () => clearInterval(timer);
  }, [ready, archiveDays]);
  return tab ? <SettingsModal tab={tab} /> : null;
}

// ---------------------------------------------------------------------------
// Sign-in. The desktop shell runs the real desktop flow (c632c9594 Sm: the start page xm, then
// "Sign In"; ca8113618 Hn frame, B title) in its 600 x 600 window; a browser keeps the /login
// frame (W11 nav and hero) around the same steps. Waiting on the browser is tm, a card is nm.

type LoginStep = "splash" | "signin" | "apikey";

function LoginCard({ error, children }: { error?: string | null; children?: ReactNode }) {
  return (
    <div className="login-card">
      {error && <LoginAlert text={error} />}
      {children}
    </div>
  );
}

function LoginAlert({ text }: { text: string }) {
  return (
    <div role="alert" className="login-alert">
      <Icon name="Info" size={16} />
      <span>{text}</span>
    </div>
  );
}

// The device code attempt whose page was opened (once per attempt, StrictMode re-runs effects).
let openedLogin = "";

/** tm: the spinner, the status title, the hint or the device code, and back (cancels the attempt). */
function LoginWaiting({ login }: { login: LoginState }) {
  const device = login.kind === "chatgptDeviceCode";
  const url = externalUrl((device ? login.verificationUrl : login.authUrl) ?? "");
  // The ChatGPT flow opened the page already (loginChatGpt); the device code flow opens it here.
  useEffect(() => {
    if (!device || !url || openedLogin === login.loginId) return;
    openedLogin = login.loginId;
    window.open(url, "_blank", "noopener");
  }, [login.loginId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="login-wait">
      <Spinner size={48} />
      <div role="status">
        <h1 className="login-wait-title">正在打开浏览器以登录…</h1>
      </div>
      {device ? (
        <>
          <div className="login-code" aria-describedby="login-code-hint">
            {login.userCode}
          </div>
          <p id="login-code-hint" className="login-hint">
            在浏览器中使用此代码完成登录。
          </p>
        </>
      ) : (
        <p className="login-hint">在浏览器中批准请求，然后返回此处。</p>
      )}
      {/* Codex's own: open the page again (on another device, the device code's address). */}
      {url && (
        <a className="login-link" href={url} target="_blank" rel="noopener noreferrer">
          {device ? url : "重新打开登录页面"}
        </a>
      )}
      {login.error && <LoginAlert text={login.error} />}
      <button type="button" className="login-link login-back" onClick={() => void cancelLogin()}>
        返回
      </button>
    </div>
  );
}

export function LoginView() {
  const login = useStore((s) => s.login);
  // D12: configRequirements/read allowedLoginMethods (empty allows none) and forced_login_method.
  const allowedMethods = useStore((s) => s.requirements?.allowedLoginMethods ?? null);
  const forced = useStore((s) => s.config?.forced_login_method ?? null);
  const [step, setStep] = useState<LoginStep>(DESKTOP ? "splash" : "signin");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The desktop shell shows sign-in in a 600 x 600 window and restores the app size once signed in.
  useEffect(() => {
    window.codexDesktop?.setAuthWindow?.(false);
    return () => {
      if (getState().account?.account) window.codexDesktop?.setAuthWindow?.(true);
    };
  }, []);
  const allowed = (allowedMethods ?? ["chatgpt", "api"]).filter((method) => !forced || method === forced);
  const chatgpt = allowed.includes("chatgpt");
  const api = allowed.includes("api");
  const go = (next: LoginStep) => {
    setError(null);
    setStep(next);
  };
  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    fn()
      .catch((reason) => setError(errorMessage(reason)))
      .finally(() => setBusy(false));
  };
  let body: ReactNode;
  if (login) body = <LoginWaiting login={login} />;
  else if (step === "splash")
    body = (
      <>
        <Spark size={72} className="login-splash-mark" />
        <h1 className="login-platform">
          Codex <em>for</em> {platformName()}
        </h1>
        <div className="login-splash-foot">
          <Button variant="primary" size="lg" onClick={() => go("signin")}>
            开始使用
          </Button>
        </div>
      </>
    );
  else if (!chatgpt && !api)
    body = (
      <>
        <h1 className="login-title">登录</h1>
        <LoginCard error="您的组织已拒绝访问。请联系您的管理员。" />
      </>
    );
  else if (!chatgpt || (api && step === "apikey"))
    body = (
      <>
        <h1 className="login-title">使用您的 OpenAI API 账户</h1>
        <LoginCard error={error}>
          <p className="login-body">用量将按 OpenAI API 的价格计入您的 API 组织，不使用 ChatGPT 套餐中的 Codex 额度。</p>
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
              继续
            </Button>
          </form>
        </LoginCard>
        {chatgpt && (
          <button type="button" className="login-link login-switch" onClick={() => go("signin")}>
            <Icon name="CaretLeft" size={16} />
            或使用 ChatGPT 登录
          </button>
        )}
      </>
    );
  else
    body = (
      <>
        <h1 className="login-title">登录</h1>
        <LoginCard error={error}>
          <Button variant="primary" size="lg" disabled={busy} onClick={() => run(() => loginChatGpt(false))}>
            使用 ChatGPT 继续
          </Button>
          <Button variant="secondary" size="lg" disabled={busy} onClick={() => run(() => loginChatGpt(true))}>
            使用设备码登录
          </Button>
        </LoginCard>
        {api && (
          <button type="button" className="login-link login-switch" onClick={() => go("apikey")}>
            或使用 API Key 登录
            <Icon name="CaretRight" size={16} />
          </button>
        )}
      </>
    );
  return DESKTOP ? (
    <div className="login" data-desktop="">
      {body}
    </div>
  ) : (
    <div className="login">
      <header className="login-nav">
        <span className="login-brand">
          <Spark size={20} />
          Codex
        </span>
      </header>
      <main className="login-main">{body}</main>
    </div>
  );
}
