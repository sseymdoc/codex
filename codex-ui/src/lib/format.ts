import type { GetAccountRateLimitsResponse } from "@protocol/v2/GetAccountRateLimitsResponse";
import type { RateLimitWindow } from "@protocol/v2/RateLimitWindow";
import type { Thread } from "@protocol/v2/Thread";
import type { ThreadItem } from "@protocol/v2/ThreadItem";

/** A sub-agent goes by its nickname: its preview is the task it was given, or nothing (MultiAgentV2). */
export function threadTitle(thread: Thread): string {
  return thread.name?.trim() || thread.agentNickname?.trim() || thread.preview?.trim().split("\n")[0] || "未命名";
}

export function timeAgo(seconds: number | null | undefined): string {
  if (!seconds) return "";
  const diff = Date.now() / 1000 - seconds;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(seconds * 1000).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} 毫秒`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${Math.round(seconds % 60)} 秒`;
}

/** 963, 127.7k, 185k, 1.2M: one decimal with a trailing .0 dropped (W13 session rail). */
export function formatTokens(count: number | null | undefined): string {
  if (!count) return "0";
  const short = (value: number, unit: string) => `${value.toFixed(1).replace(/\.0$/, "")}${unit}`;
  if (count < 1000) return String(count);
  // 999 950 would round to "1000.0k"; it reads as 1M instead.
  if (count < 999_950) return short(count / 1000, "k");
  return short(count / 1_000_000, "M");
}

export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || trimmed;
}

export function parentDir(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index <= 0) return trimmed.slice(0, index + 1) || trimmed;
  const parent = trimmed.slice(0, index);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}

export function joinPath(dir: string, name: string): string {
  const separator = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(separator) ? dir + name : dir + separator + name;
}

/** Path relative to `root` when it lives inside it, otherwise unchanged. */
export function relativePath(path: string, root: string | null | undefined): string {
  if (!root) return path;
  const normalized = (p: string) => p.replaceAll("\\", "/").replace(/\/+$/, "");
  const target = normalized(path);
  const base = normalized(root);
  if (target.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return target.slice(base.length + 1);
  return path;
}

/** Lines a diff's hunks add and remove; `---` / `+++` are file headers only outside a hunk. */
export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) inHunk = true;
    else if (line.startsWith("diff ")) inHunk = false;
    else if (inHunk && line.startsWith("+")) added++;
    else if (inHunk && line.startsWith("-")) removed++;
  }
  return { added, removed };
}

export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 13) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

/** A server-supplied link we may open: https with a host and no embedded credentials, like the TUI's validate_external_url. */
export function externalUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * A Markdown link target that names a local file, as a path with its line suffix: a file: URL,
 * a drive (`C:/…`, `/D:/…`) or anything else without a scheme; null for other URLs, #anchors and "".
 */
export function localPath(href: string): string | null {
  let path = href;
  if (/^file:/i.test(href)) {
    try {
      const url = new URL(href);
      path = (url.host && `//${url.host}`) + url.pathname + url.hash;
    } catch {
      return null;
    }
  } else if (/^(?:[a-z][a-z0-9+.-]+:|#|$)/i.test(href)) {
    // A one-letter "scheme" is a drive.
    return null;
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    // a lone % stays as written
  }
  return path.replace(/^\/(?=[a-z]:)/i, "");
}

/**
 * Whether a local file may be read without a click, to show it inline (c19e90103 fk / ok): not on a
 * network share or in the NT namespace, as a read there hands the host the Windows sign-in; WSL's
 * shares are this machine's own. ponytail: no device-name check (Claude's ck), since Windows 11
 * reads CON.png as a file; add it if Windows 10's devices matter.
 */
export function mayReadUnasked(path: string): boolean {
  return !/^(?:[\\/]{2}|[\\/]\?\?[\\/])/.test(path) || /^[\\/]{2}(?:wsl\$|wsl\.localhost)(?=[\\/]|$)/i.test(path);
}

/** Path equality that ignores separator style, trailing slashes and (Windows) case. */
export function samePath(a: string, b: string): boolean {
  const normalize = (p: string) => p.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
  return normalize(a) === normalize(b);
}

const SPACED = /[\p{Script=Latin}\p{N}]/u;
const CLOSED = /[\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u;

/** The draft with dictated text in place of the selection, a space apart from Latin words beside it. */
export function spliceDictation(text: string, start: number, end: number, spoken: string): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before && !CLOSED.test(before.at(-1)!) && SPACED.test(spoken[0] ?? "") ? " " : "";
  const tail = after && SPACED.test(after[0]) && !CLOSED.test(spoken.at(-1) ?? " ") ? " " : "";
  const head = before + lead + spoken;
  return { text: head + tail + after, caret: head.length };
}

/** The thread as a Markdown document: prompts, replies, and the commands and edits between them. */
export function threadMarkdown(title: string, turns: { items: ThreadItem[] }[]): string {
  const out = [`# ${title}`];
  for (const turn of turns) {
    let replying = false;
    for (const item of turn.items) {
      if (item.type === "userMessage") {
        const text = item.content.map((part) => (part.type === "text" ? part.text : "")).join("\n").trim();
        if (text) out.push(`## 你\n\n${text}`);
        replying = false;
        continue;
      }
      const block =
        item.type === "agentMessage"
          ? item.text.trim()
          : item.type === "commandExecution"
            ? `\`\`\`sh\n$ ${item.command}\n\`\`\``
            : item.type === "fileChange"
              ? item.changes.map((change) => `- 修改 \`${change.path}\``).join("\n")
              : "";
      if (!block) continue;
      if (!replying) out.push("## Codex");
      replying = true;
      out.push(block);
    }
  }
  return `${out.join("\n\n")}\n`;
}

/**
 * Optical hanging punctuation (CDS [data-hang-face]): an opening quote that starts a
 * paragraph or heading is wrapped so CSS can hang it into the margin, keeping the
 * text edge straight.
 */
export function hangQuotes(html: string): string {
  return html.replace(/<(p|h[1-3])>(“|‘|&quot;|&#39;)/g, (_, tag: string, quote: string) => {
    const kind = quote === "‘" || quote === "&#39;" ? "sq" : "dq";
    return `<${tag}><span data-hang-quote="${kind}">${quote}</span>`;
  });
}

/**
 * A rate-limit window by its length, as shared-8 ZV names them: "Session limit" for the short
 * window, "Weekly · all models" for the week (Codex has one model pool, so 每周).
 */
export function limitName(window: RateLimitWindow): string {
  const minutes = window.windowDurationMins;
  if (!minutes) return "用量";
  if (minutes < 1440) return "会话限额";
  if (minutes % 10080 === 0) return minutes === 10080 ? "每周" : `${minutes / 10080} 周额度`;
  if (minutes % 1440 === 0) return `${minutes / 1440} 天额度`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时额度`;
  return `${minutes} 分钟额度`;
}

/**
 * One provider's report from a local opencodex proxy (bridge GET /api/opencodex/quotas), or
 * cc-switch's current Codex provider (GET /api/ccswitch/quota); times in ms.
 */
export interface ProviderQuotaReport {
  provider: string;
  label: string;
  updatedAt: number;
  /** cc-switch's report: the config.toml model_provider it serves, for every model. */
  modelProvider?: string;
  quota: {
    fiveHourPercent?: number;
    fiveHourResetAt?: number;
    weeklyPercent?: number;
    weeklyResetAt?: number;
    monthlyPercent?: number;
    monthlyResetAt?: number;
    customWindows?: QuotaWindow[];
    creditsUsd?: { percent: number; expiresAt?: number; unlimited?: boolean };
  };
}

interface QuotaWindow {
  label: string;
  percent: number;
  resetAt?: number;
  modelId?: string;
  scope?: "model";
}

/**
 * A balance-only window's unit and amount. opencodex and the cc-switch bridge report balances as
 * percent 0 with no reset, the amount first in the label: "API balance (¥23.34 total, ¥5.00
 * granted)" → ¥ 23.34, "余额 ($12.00)" → $ 12.
 */
function balanceOf(w: QuotaWindow): { unit: string; amount: number } | null {
  if (w.percent !== 0 || w.resetAt !== undefined || !/balance|余额/i.test(w.label)) return null;
  const match = /\(([^\d(]*)(\d+(?:\.\d+)?)/.exec(w.label);
  return match ? { unit: match[1].trim(), amount: Number(match[2]) } : null;
}

/** Per provider and unit: everything the balance has held (the bar's 100%), and the last reading. */
export type BalanceTracks = Record<string, { total: number; last: number }>;

/**
 * Balances as spending bars: spent / total (¥10 with ¥3 spent reads 30%). The first reading is the
 * total; a drop is spending; a rise (a top-up) adds to the total and what was spent stays spent
 * (another ¥10 then reads 3/20 = 15%). Returns the reports with those percents filled in, and the
 * tracks for the next read.
 */
export function meterBalances(reports: ProviderQuotaReport[], tracks: BalanceTracks): { reports: ProviderQuotaReport[]; tracks: BalanceTracks } {
  const next = { ...tracks };
  const meter = (provider: string) => (w: QuotaWindow) => {
    const balance = balanceOf(w);
    if (!balance) return w;
    const key = `${provider} ${balance.unit}`;
    const { percent, track } = meterBalance(next[key], balance.amount);
    next[key] = track;
    return { ...w, percent };
  };
  const metered = reports.map((r) => (r.quota.customWindows ? { ...r, quota: { ...r.quota, customWindows: r.quota.customWindows.map(meter(r.provider)) } } : r));
  return { reports: metered, tracks: next };
}

/** One balance reading against its track: the percent spent, and the track for the next read. */
function meterBalance(track: BalanceTracks[string] | undefined, amount: number): { percent: number; track: BalanceTracks[string] } {
  const total = track ? track.total + Math.max(0, amount - track.last) : amount;
  return { percent: total > 0 ? ((total - amount) * 100) / total : 100, track: { total, last: amount } };
}

/**
 * The ChatGPT account's credits as a spending bar, metered like a provider balance. Every balance
 * the account reports is metered, so spending down to nothing and a later top-up both count, but
 * the bar shows only while some credits are left; unlimited credits have nothing to meter.
 */
export function meterCredits(
  limits: GetAccountRateLimitsResponse | null,
  owner: string,
  tracks: BalanceTracks,
): { credits: { balance: number; percent: number } | null; tracks: BalanceTracks } {
  const snapshots = limits ? [limits.rateLimits, ...Object.values(limits.rateLimitsByLimitId ?? {})] : [];
  const credits = snapshots.find((snapshot) => snapshot?.credits?.balance)?.credits;
  const balance = Number(credits?.balance);
  if (!credits || credits.unlimited || !Number.isFinite(balance)) return { credits: null, tracks };
  const key = `chatgpt:${owner} credits`;
  const { percent, track } = meterBalance(tracks[key], balance);
  return { credits: credits.hasCredits && balance > 0 ? { balance, percent } : null, tracks: { ...tracks, [key]: track } };
}

/** A usage popover row: a metered window, or a line of text when pct is null. resetsAt in seconds. */
export interface QuotaRow {
  name: string;
  pct: number | null;
  resetsAt: number | null;
  primary: boolean;
  /** Decimal places its percent shows; whole percents without. */
  digits?: number;
}

/** opencodex's Antigravity family windows ("Cla", "Cla (Weekly)") and the model ids each one meters. */
const QUOTA_FAMILIES: Record<string, string[]> = { gem: ["gemini"], cla: ["claude", "opus", "sonnet", "gpt-oss", "gpt_oss"] };
const WEEKLY_SUFFIX = /\s*\(weekly\)$/i;

/**
 * The quota a model draws on. Under a provider cc-switch switched Codex to (`modelProvider`, the
 * thread's config.toml provider), every model draws on that provider's. A routed model
 * ("provider/model", opencodex's naming) draws on its provider's windows, minus family and model
 * windows that meter other models. null for a native model (no prefix, or openai/) or a provider
 * nothing reports on: Codex's own limits apply then.
 */
export function providerQuota(model: string | null, reports: ProviderQuotaReport[], modelProvider?: string | null): { label: string; rows: QuotaRow[] } | null {
  const switched = modelProvider ? reports.find((r) => r.modelProvider === modelProvider) : undefined;
  const slash = switched ? -1 : (model?.indexOf("/") ?? -1);
  const provider = model?.slice(0, slash);
  const report = switched ?? (slash > 0 && provider !== "openai" ? reports.find((r) => r.provider === provider) : undefined);
  if (!report) return null;
  const id = (model ?? "").slice(slash + 1).toLowerCase();
  const q = report.quota;
  const rows: QuotaRow[] = [];
  const add = (name: string, pct: number | undefined, resetAt: number | undefined, primary = false) => {
    if (typeof pct === "number") rows.push({ name, pct, resetsAt: resetAt ? Math.round(resetAt / 1000) : null, primary });
  };
  add("会话限额", q.fiveHourPercent, q.fiveHourResetAt, true);
  add("每周", q.weeklyPercent, q.weeklyResetAt);
  add("每月", q.monthlyPercent, q.monthlyResetAt);
  for (const w of q.customWindows ?? []) {
    const weekly = WEEKLY_SUFFIX.test(w.label);
    const stem = w.label.replace(WEEKLY_SUFFIX, "").trim().toLowerCase();
    const family = QUOTA_FAMILIES[stem];
    if (w.modelId ? w.modelId.toLowerCase() !== id : family ? !family.some((k) => id.includes(k)) : w.scope === "model" && !id.includes(stem)) continue;
    if (family) add(weekly ? "每周" : "会话限额", w.percent, w.resetAt, !weekly);
    // Model-scoped windows are Anthropic's weekly per-family limits (seven_day_<family>).
    else if (w.scope === "model") add(`每周 · ${w.label}`, w.percent, w.resetAt);
    // A balance-style line with nothing to meter ("Unlimited API credits") stays text.
    else if (w.percent === 0 && w.resetAt === undefined && !balanceOf(w)) rows.push({ name: w.label, pct: null, resetsAt: null, primary: false });
    else add(w.label, w.percent, w.resetAt);
  }
  if (q.creditsUsd && !q.creditsUsd.unlimited) add("订阅额度", q.creditsUsd.percent, q.creditsUsd.expiresAt);
  return { label: report.label, rows };
}
