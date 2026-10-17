// Settings dialog (general / account / MCP / skills / about) and the sign-in screen.

import type { ListMcpServerStatusResponse } from "@protocol/v2/ListMcpServerStatusResponse";
import type { RateLimitWindow } from "@protocol/v2/RateLimitWindow";
import type { SkillsListResponse } from "@protocol/v2/SkillsListResponse";
import { Info, KeyRound, LogIn, LogOut, Plug, RefreshCw, Settings as SettingsIcon, Sparkles, User } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  PRESETS,
  VERSION,
  cancelLogin,
  errorMessage,
  listMcpServers,
  listSkills,
  loginApiKey,
  loginChatGpt,
  loginMcpServer,
  logout,
  presetOf,
  refreshAccount,
  refreshRateLimits,
  reloadMcpServers,
  setSkillEnabled,
  writeConfig,
} from "../lib/codex";
import { setState, toast, useStore, type PermissionPreset, type SettingsTab } from "../lib/store";
import { EFFORT_LABELS } from "./Composer";
import { Button, Dialog, Segmented, Spinner, StatusDot, Toggle } from "./ui";

// ---------------------------------------------------------------------------
// Theme

export type Theme = "light" | "dark" | "system";
const THEME_KEY = "codex-ui:theme";

export function currentTheme(): Theme {
  try {
    return (localStorage.getItem(THEME_KEY) as Theme | null) ?? "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme = currentTheme()) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode: the choice just will not persist.
  }
  applyTheme(theme);
}

// ---------------------------------------------------------------------------

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
        {hint && <div className="settings-row-hint">{hint}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function GeneralTab() {
  const [theme, setThemeState] = useState(currentTheme);
  const config = useStore((s) => s.config);
  const models = useStore((s) => s.models);
  const model = models.find((m) => m.id === config?.model || m.model === config?.model);
  const preset = presetOf(config?.approval_policy, config?.sandbox_mode);
  const save = (edits: Parameters<typeof writeConfig>[0]) =>
    writeConfig(edits)
      .then(() => toast("success", "已保存到 config.toml"))
      .catch((error) => toast("error", "保存失败", errorMessage(error)));
  return (
    <>
      <h3 className="settings-section">外观</h3>
      <Row label="主题">
        <Segmented
          value={theme}
          options={[
            { value: "light", label: "浅色" },
            { value: "dark", label: "深色" },
            { value: "system", label: "跟随系统" },
          ]}
          onChange={(value) => {
            setThemeState(value);
            setTheme(value);
          }}
        />
      </Row>
      <h3 className="settings-section">新会话默认值</h3>
      <p className="settings-note">写入 config.toml，对之后新建的会话生效；也可以在输入框下方为单个会话临时调整。</p>
      <Row label="模型">
        <select className="input select" value={config?.model ?? ""} onChange={(event) => void save([{ keyPath: "model", value: event.target.value || null, mergeStrategy: "replace" }])}>
          <option value="">自动（服务端默认）</option>
          {models.map((m) => (
            <option key={m.id} value={m.model}>
              {m.displayName}
            </option>
          ))}
        </select>
      </Row>
      {model && model.supportedReasoningEfforts.length > 0 && (
        <Row label="推理强度">
          <select
            className="input select"
            value={config?.model_reasoning_effort ?? ""}
            onChange={(event) => void save([{ keyPath: "model_reasoning_effort", value: event.target.value || null, mergeStrategy: "replace" }])}
          >
            <option value="">默认（{EFFORT_LABELS[model.defaultReasoningEffort] ?? model.defaultReasoningEffort}）</option>
            {model.supportedReasoningEfforts.map((option) => (
              <option key={option.reasoningEffort} value={option.reasoningEffort}>
                {EFFORT_LABELS[option.reasoningEffort] ?? option.reasoningEffort}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row label="权限" hint={preset ? PRESETS[preset].description : "当前配置不属于预设组合"}>
        <select
          className="input select"
          value={preset ?? ""}
          onChange={(event) => {
            const next = PRESETS[event.target.value as PermissionPreset];
            void save([
              { keyPath: "approval_policy", value: next.approval as string, mergeStrategy: "replace" },
              { keyPath: "sandbox_mode", value: next.sandbox, mergeStrategy: "replace" },
            ]);
          }}
        >
          {!preset && <option value="">自定义</option>}
          {(Object.keys(PRESETS) as PermissionPreset[]).map((id) => (
            <option key={id} value={id}>
              {PRESETS[id].label}
            </option>
          ))}
        </select>
      </Row>
    </>
  );
}

function windowName(window: RateLimitWindow): string {
  const minutes = window.windowDurationMins;
  if (!minutes) return "用量";
  if (minutes % 10080 === 0) return minutes === 10080 ? "每周额度" : `${minutes / 10080} 周额度`;
  if (minutes % 1440 === 0) return `${minutes / 1440} 天额度`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时额度`;
  return `${minutes} 分钟额度`;
}

function UsageBar({ window }: { window: RateLimitWindow }) {
  const percent = Math.min(100, Math.max(0, window.usedPercent));
  return (
    <div className="usage">
      <div className="usage-head">
        <span>{windowName(window)}</span>
        <span className="muted tabular">已用 {Math.round(percent)}%</span>
      </div>
      <div className="usage-track">
        <div className={`usage-fill ${percent > 85 ? "hot" : ""}`} style={{ width: `${percent}%` }} />
      </div>
      {window.resetsAt && (
        <div className="muted small">
          {new Date(window.resetsAt * 1000).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} 重置
        </div>
      )}
    </div>
  );
}

function AccountTab() {
  const account = useStore((s) => s.account);
  const limits = useStore((s) => s.rateLimits);
  const info = account?.account;
  const snapshot = limits?.rateLimits;
  return (
    <>
      <h3 className="settings-section">账户</h3>
      <div className="account-card">
        <span className="avatar avatar-lg">
          <User size={18} />
        </span>
        <div className="account-text">
          <div className="account-name">
            {info?.type === "chatgpt"
              ? (info.email ?? "ChatGPT 账户")
              : info?.type === "apiKey"
                ? "API Key"
                : info?.type === "amazonBedrock"
                  ? "Amazon Bedrock"
                  : account?.requiresOpenaiAuth
                    ? "未登录"
                    : "自定义模型提供方"}
          </div>
          <div className="muted small">
            {info?.type === "chatgpt" ? `ChatGPT · ${info.planType}` : info ? "按量计费" : account?.requiresOpenaiAuth ? "需要登录才能使用 Codex" : "当前模型提供方无需登录"}
          </div>
        </div>
        <span className="head-spacer" />
        {info ? (
          <Button variant="secondary" size="sm" icon={<LogOut size={14} />} onClick={() => void logout().catch((error) => toast("error", "退出失败", errorMessage(error)))}>
            退出登录
          </Button>
        ) : (
          account?.requiresOpenaiAuth && (
            <Button variant="primary" size="sm" icon={<LogIn size={14} />} onClick={() => setState({ settings: null })}>
              去登录
            </Button>
          )
        )}
      </div>
      {info && (
        <>
          <h3 className="settings-section">
            用量
            <button type="button" className="icon-btn icon-btn-sm" title="刷新" onClick={() => void refreshRateLimits()}>
              <RefreshCw size={13} />
            </button>
          </h3>
          {snapshot?.primary && <UsageBar window={snapshot.primary} />}
          {snapshot?.secondary && <UsageBar window={snapshot.secondary} />}
          {snapshot?.credits?.hasCredits && (
            <Row label="点数余额">{snapshot.credits.unlimited ? "无限" : (snapshot.credits.balance ?? "—")}</Row>
          )}
          {!snapshot?.primary && !snapshot?.secondary && <p className="settings-note">暂无用量数据。</p>}
        </>
      )}
    </>
  );
}

const MCP_STATUS: Record<string, [string, "ready" | "running" | "error" | "idle" | "clay"]> = {
  connected: ["已连接", "ready"],
  starting: ["启动中", "running"],
  notStarted: ["未启动", "idle"],
  authenticationRequired: ["需要登录", "clay"],
  failed: ["失败", "error"],
  cancelled: ["已取消", "idle"],
  disabled: ["已停用", "idle"],
};

function McpTab() {
  const [servers, setServers] = useState<ListMcpServerStatusResponse["data"] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    listMcpServers()
      .then(setServers)
      .catch((error) => {
        setServers([]);
        toast("error", "读取 MCP 服务器失败", errorMessage(error));
      });
  useEffect(() => void load(), []);
  return (
    <>
      <h3 className="settings-section">
        MCP 服务器
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          title="重新加载配置"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            reloadMcpServers()
              .then(load)
              .catch((error) => toast("error", "重新加载失败", errorMessage(error)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? <Spinner size={12} /> : <RefreshCw size={13} />}
        </button>
      </h3>
      {servers === null && <Spinner />}
      {servers?.length === 0 && (
        <p className="settings-note">
          还没有配置 MCP 服务器。在 config.toml 中添加 <code className="inline-code">[mcp_servers.名称]</code> 后点击上方的刷新按钮重新加载。
        </p>
      )}
      {servers?.map((server) => {
        const [label, dot] = MCP_STATUS[server.runtimeStatus ?? ""] ?? ["未知", "idle"];
        const tools = Object.keys(server.tools);
        return (
          <div key={server.name} className="list-card">
            <div className="list-card-head">
              <Plug size={14} />
              <span className="list-card-title">{server.name}</span>
              <span className="badge">
                <StatusDot kind={dot} /> {label}
              </span>
              <span className="head-spacer" />
              {server.authStatus === "notLoggedIn" && (
                <Button size="xs" variant="secondary" onClick={() => void loginMcpServer(server.name).catch((error) => toast("error", "登录失败", errorMessage(error)))}>
                  登录
                </Button>
              )}
            </div>
            <div className="muted small">
              {server.serverInfo?.name ? `${server.serverInfo.name} ${server.serverInfo.version ?? ""} · ` : ""}
              {tools.length} 个工具{server.httpOrigin ? ` · ${server.httpOrigin}` : ""}
            </div>
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
          </div>
        );
      })}
    </>
  );
}

const SCOPE_LABELS: Record<string, string> = { user: "个人", repo: "仓库", system: "内置", admin: "管理员" };

function SkillsTab() {
  const cwd = useStore((s) => s.prefs.cwd);
  const [entries, setEntries] = useState<SkillsListResponse["data"] | null>(null);
  const load = (force = false) =>
    listSkills(cwd, force)
      .then(setEntries)
      .catch((error) => {
        setEntries([]);
        toast("error", "读取技能失败", errorMessage(error));
      });
  useEffect(() => void load(), [cwd]); // eslint-disable-line react-hooks/exhaustive-deps
  const skills = entries?.flatMap((entry) => entry.skills) ?? [];
  const errors = entries?.flatMap((entry) => entry.errors) ?? [];
  return (
    <>
      <h3 className="settings-section">
        技能
        <button type="button" className="icon-btn icon-btn-sm" title="重新扫描" onClick={() => void load(true)}>
          <RefreshCw size={13} />
        </button>
      </h3>
      <p className="settings-note">技能是放在 SKILL.md 里的可复用说明，Codex 会在合适的时候自动调用。</p>
      {entries === null && <Spinner />}
      {entries && skills.length === 0 && <p className="settings-note">没有发现技能。</p>}
      {skills.map((skill) => (
        <div key={skill.path} className="list-card">
          <div className="list-card-head">
            <Sparkles size={14} />
            <span className="list-card-title">{skill.interface?.displayName ?? skill.name}</span>
            <span className="badge">{SCOPE_LABELS[skill.scope] ?? skill.scope}</span>
            <span className="head-spacer" />
            <Toggle
              checked={skill.enabled}
              label={`启用 ${skill.name}`}
              onChange={(enabled) => {
                setSkillEnabled(skill.path, enabled)
                  .then(() =>
                    setEntries((current) =>
                      current?.map((entry) => ({ ...entry, skills: entry.skills.map((s) => (s.path === skill.path ? { ...s, enabled } : s)) })) ?? null,
                    ),
                  )
                  .catch((error) => toast("error", "更新技能失败", errorMessage(error)));
              }}
            />
          </div>
          <div className="muted small clamp" title={skill.description}>
            {skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description}
          </div>
        </div>
      ))}
      {errors.map((error) => (
        <div key={error.path} className="error-text small">
          {error.path}：{error.message}
        </div>
      ))}
    </>
  );
}

function AboutTab() {
  const server = useStore((s) => s.server);
  const rows: [string, string | undefined][] = [
    ["Codex UI", VERSION],
    ["app-server", server.info?.userAgent],
    ["CODEX_HOME", server.info?.codexHome],
    ["平台", server.info ? `${server.info.platformOs} (${server.info.platformFamily})` : undefined],
    ["启动命令", server.command],
    ["启动目录", server.cwd],
  ];
  return (
    <>
      <h3 className="settings-section">关于</h3>
      <dl className="about-list">
        {rows.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd className="mono">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>
      <p className="settings-note">
        界面采用 Claude Design System 的设计语言；所有数据通过本机 <code className="inline-code">codex app-server</code> 读写，不经过任何第三方服务。
      </p>
    </>
  );
}

const TABS: { id: SettingsTab; label: string; icon: ReactNode }[] = [
  { id: "general", label: "通用", icon: <SettingsIcon size={15} /> },
  { id: "account", label: "账户与用量", icon: <User size={15} /> },
  { id: "mcp", label: "MCP 服务器", icon: <Plug size={15} /> },
  { id: "skills", label: "技能", icon: <Sparkles size={15} /> },
  { id: "about", label: "关于", icon: <Info size={15} /> },
];

export function SettingsDialog() {
  const tab = useStore((s) => s.settings);
  if (!tab) return null;
  return (
    <Dialog title="设置" onClose={() => setState({ settings: null })} wide>
      <div className="settings">
        <nav className="settings-nav">
          {TABS.map((t) => (
            <button key={t.id} type="button" className={`settings-tab ${t.id === tab ? "active" : ""}`} onClick={() => setState({ settings: t.id })}>
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === "general" && <GeneralTab />}
          {tab === "account" && <AccountTab />}
          {tab === "mcp" && <McpTab />}
          {tab === "skills" && <SkillsTab />}
          {tab === "about" && <AboutTab />}
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sign-in

export function LoginView() {
  const login = useStore((s) => s.login);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    fn()
      .catch((error) => toast("error", "登录失败", errorMessage(error)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="login">
      <div className="login-card">
        <img src="/favicon.svg" alt="" width={40} height={40} />
        <h1 className="login-title">登录 Codex</h1>
        {login ? (
          <>
            {login.kind === "chatgptDeviceCode" ? (
              <>
                <p className="muted">在浏览器打开下面的链接，并输入验证码：</p>
                <div className="device-code mono">{login.userCode}</div>
                <a className="btn btn-secondary btn-md" href={login.verificationUrl} target="_blank" rel="noopener noreferrer">
                  <span className="btn-label">{login.verificationUrl}</span>
                </a>
              </>
            ) : (
              <>
                <p className="muted">已在新标签页打开 ChatGPT 登录页面，完成后会自动返回。</p>
                <a className="btn btn-secondary btn-md" href={login.authUrl} target="_blank" rel="noopener noreferrer">
                  <span className="btn-label">重新打开登录页面</span>
                </a>
              </>
            )}
            {login.error && <div className="error-text">{login.error}</div>}
            <div className="login-wait">
              <Spinner size={13} /> 等待登录完成…
            </div>
            <Button variant="ghost" onClick={() => void cancelLogin()}>
              取消
            </Button>
          </>
        ) : (
          <>
            <p className="muted">使用 ChatGPT 账户登录即可使用套餐内的 Codex 额度，也可以使用 OpenAI API Key 按量计费。</p>
            <Button variant="primary" size="lg" disabled={busy} onClick={() => run(() => loginChatGpt(false))}>
              使用 ChatGPT 登录
            </Button>
            <Button variant="secondary" size="lg" disabled={busy} onClick={() => run(() => loginChatGpt(true))}>
              使用设备码登录
            </Button>
            <div className="login-or">
              <span>或</span>
            </div>
            <form
              className="login-key"
              onSubmit={(event) => {
                event.preventDefault();
                if (apiKey.trim()) run(() => loginApiKey(apiKey.trim()));
              }}
            >
              <KeyRound size={15} className="muted" />
              <input className="input mono" type="password" autoComplete="off" placeholder="sk-…" value={apiKey} onChange={(event) => setApiKey(event.target.value)} aria-label="OpenAI API Key" />
              <Button variant="secondary" type="submit" disabled={busy || !apiKey.trim()}>
                使用 API Key
              </Button>
            </form>
            <button type="button" className="link-btn" onClick={() => void refreshAccount()}>
              已在终端登录？刷新状态
            </button>
          </>
        )}
      </div>
    </div>
  );
}
