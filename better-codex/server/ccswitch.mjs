// cc-switch (github.com/farion1231/cc-switch) points Codex at another provider by rewriting
// config.toml and auth.json, and can query that provider's quota, but keeps the result inside its
// own process. This reads its database read-only for the current Codex provider and, while Codex's
// config.toml is still the one cc-switch wrote for it, runs the query cc-switch has set up: a
// script template, a native balance or a coding plan, ported from cc-switch 4.0. A custom script
// never runs here: cc-switch sandboxes those in QuickJS as untrusted code (they arrive by deep
// link and sync), and Node has no sandbox to match.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Codex's built-in provider ids: a cc-switch provider on one of them is an official login. */
const BUILT_IN = new Set(["amazon-bedrock", "amazon-bedrock-runtime", "openai", "ollama", "lmstudio"]);
/** What each script template requests; a template whose code no longer does is a custom script. */
const TEMPLATE_PATHS = { general: "/user/balance", newapi: "/api/user/self", sub2api: "/v1/usage" };
const LAST_GOOD_MS = 30 * 60_000;

/** cc-switch's data directory: the custom one its settings name, else ~/.cc-switch. */
function ccSwitchDir() {
  try {
    const store =
      process.platform === "win32"
        ? process.env.APPDATA
        : process.platform === "darwin"
          ? path.join(homedir(), "Library", "Application Support")
          : process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
    const custom = JSON.parse(readFileSync(path.join(store, "com.ccswitch.desktop", "app_paths.json"), "utf8")).app_config_dir_override?.trim();
    if (custom) return custom.replace(/^~(?=[\\/]|$)/, homedir());
  } catch {
    // No custom directory.
  }
  return path.join(homedir(), ".cc-switch");
}

/** The string keys of a config.toml, flattened to dotted paths (`model_providers.custom.base_url`). */
function tomlStrings(text) {
  const keys = {};
  let table = "";
  let multiline = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    // A multi-line string's text is not keys.
    if (multiline) {
      if (line.includes(multiline)) multiline = null;
      continue;
    }
    const opener = /=\s*("""|''')/.exec(line);
    if (opener && line.split(opener[1]).length === 2) {
      multiline = opener[1];
      continue;
    }
    if (line.startsWith("[")) {
      table = line.replace(/^\[+|\].*$/g, "").replace(/["'\s]/g, "");
      continue;
    }
    const pair = /^([\w.-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(line);
    if (!pair) continue;
    let value = pair[3];
    if (value === undefined) {
      try {
        value = JSON.parse(`"${pair[2]}"`);
      } catch {
        value = pair[2];
      }
    }
    keys[table ? `${table}.${pair[1]}` : pair[1]] = value;
  }
  return keys;
}

/** The provider a Codex config.toml selects, as cc-switch's extract_codex_base_url reads it. */
function codexProvider(text) {
  const keys = tomlStrings(text);
  const id = keys.model_provider;
  const table = `model_providers.${id}`;
  return { id, baseUrl: (keys[`${table}.base_url`] ?? keys.base_url ?? "").replace(/\/+$/, ""), bearer: keys[`${table}.experimental_bearer_token`] };
}

const num = (value) => (typeof value === "number" ? value : typeof value === "string" && value.trim() && Number.isFinite(+value) ? +value : undefined);
const money = (amount, unit = "USD") => {
  const symbol = { USD: "$", CNY: "¥" }[String(unit).toUpperCase()] ?? `${unit} `;
  return `${symbol}${Math.max(0, amount).toFixed(2)}`;
};
const text = (label) => ({ customWindows: [{ label, percent: 0 }] });
/** A reset time as cc-switch's extract_reset_time reads it (ISO text, or epoch seconds / ms), in ms. */
const resetAt = (value) => {
  const n = num(value);
  if (n !== undefined) return n > 0 ? (n < 1e12 ? n * 1000 : n) : undefined;
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? undefined : parsed;
};

/**
 * cc-switch UsageData rows as quota windows: total and used make a bar, a bare remaining amount
 * is a balance ("余额 ($12.34)", which the page meters as spent since it first saw it).
 */
function usageWindows(rows) {
  return {
    customWindows: rows.map((row) => {
      const unit = row.unit || "USD";
      if (row.isValid === false) return { label: row.invalidMessage || "额度查询失败", percent: 0 };
      if (row.total > 0 && row.used !== undefined) {
        return { label: `${row.planName || "额度"} · ${money(row.used, unit)} / ${money(row.total, unit)}`, percent: Math.min(100, (row.used * 100) / row.total) };
      }
      return { label: `余额 (${money(row.remaining ?? 0, unit)})`, percent: 0 };
    }),
  };
}

/** One GET; a non-2xx answer is a result to show, a network failure throws (last good stays). */
async function getJson(fetch, url, headers) {
  const response = await fetch(url, { headers: { Accept: "application/json", ...headers }, redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return { status: response.status };
  return { body: await response.json() };
}

const failed = (status) => text(`额度查询失败（HTTP ${status}）`);

/** cc-switch's script templates, run natively (UsageScriptModal.tsx PRESET_TEMPLATES). */
async function template(type, script, { apiKey, baseUrl }, fetch) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return text("用量查询地址必须是 HTTPS");
  const bearer = { Authorization: `Bearer ${apiKey}`, "User-Agent": "cc-switch/1.0" };
  if (type === "general") {
    const { status, body } = await getJson(fetch, `${baseUrl}/user/balance`, bearer);
    return status ? failed(status) : usageWindows([{ remaining: num(body.balance), unit: "USD" }]);
  }
  if (type === "newapi") {
    const headers = { Authorization: `Bearer ${script.accessToken ?? ""}`, "User-Agent": "cc-switch/1.0", "New-Api-User": String(script.userId ?? "") };
    const { status, body } = await getJson(fetch, `${baseUrl}/api/user/self`, headers);
    if (status) return failed(status);
    if (!body.success || !body.data) return usageWindows([{ isValid: false, invalidMessage: body.message }]);
    const quota = num(body.data.quota) ?? 0;
    const used = num(body.data.used_quota) ?? 0;
    return usageWindows([{ planName: body.data.group, used: used / 500000, total: (quota + used) / 500000, unit: "USD" }]);
  }
  const { status, body } = await getJson(fetch, `${baseUrl.replace(/\/v1$/, "")}/v1/usage`, bearer);
  if (status) return failed(status);
  const quota = body.quota ?? {};
  const unit = body.unit || quota.unit || "USD";
  if (body.isValid === false) return usageWindows([{ isValid: false, invalidMessage: body.status ? String(body.status) : undefined }]);
  if (num(quota.limit) > 0) return usageWindows([{ planName: body.planName, used: num(quota.used) ?? 0, total: num(quota.limit), unit }]);
  return num(body.remaining) >= 0 ? usageWindows([{ remaining: num(body.remaining), unit }]) : {};
}

/** cc-switch's native balances (services/balance.rs), detected from the base URL. */
async function balance({ apiKey, baseUrl }, fetch) {
  const url = baseUrl.toLowerCase();
  const bearer = { Authorization: `Bearer ${apiKey}` };
  if (url.includes("api.deepseek.com")) {
    const { status, body } = await getJson(fetch, "https://api.deepseek.com/user/balance", bearer);
    if (status) return failed(status);
    const wallets = (body.balance_infos ?? []).map((info) => ({ remaining: num(info.total_balance), unit: info.currency || "CNY" }));
    // An account lists a CNY and a USD wallet; spending draws on the funded one (#8170).
    return usageWindows(wallets.some((w) => w.remaining > 0) ? wallets.filter((w) => !(w.remaining <= 0)) : wallets);
  }
  if (url.includes("api.stepfun.")) {
    const { status, body } = await getJson(fetch, "https://api.stepfun.com/v1/accounts", bearer);
    return status ? failed(status) : usageWindows([{ remaining: num(body.balance) ?? 0, unit: "CNY" }]);
  }
  const silicon = url.includes("api.siliconflow.cn") ? "cn" : url.includes("api.siliconflow.com") ? "com" : null;
  if (silicon) {
    const { status, body } = await getJson(fetch, `https://api.siliconflow.${silicon}/v1/user/info`, bearer);
    return status ? failed(status) : usageWindows([{ remaining: num(body.data?.totalBalance) ?? 0, unit: silicon === "cn" ? "CNY" : "USD" }]);
  }
  if (url.includes("openrouter.ai")) {
    const { status, body } = await getJson(fetch, "https://openrouter.ai/api/v1/credits", bearer);
    if (status) return failed(status);
    const data = body.data ?? body;
    return usageWindows([{ planName: "OpenRouter", used: num(data.total_usage) ?? 0, total: num(data.total_credits) ?? 0, remaining: (num(data.total_credits) ?? 0) - (num(data.total_usage) ?? 0) }]);
  }
  if (url.includes("api.novita.ai")) {
    const { status, body } = await getJson(fetch, "https://api.novita.ai/v3/user/balance", bearer);
    // Novita counts in 0.0001 USD.
    return status ? failed(status) : usageWindows([{ remaining: (num(body.availableBalance) ?? 0) / 10000 }]);
  }
  return text("cc-switch 不支持此地址的余额查询");
}

/** cc-switch's coding plans (services/coding_plan.rs) as five-hour and weekly windows. */
async function codingPlan(plan, { apiKey, baseUrl }, fetch) {
  const url = baseUrl.toLowerCase();
  plan ||= url.includes("api.kimi.com/coding")
    ? "kimi"
    : url.includes("bigmodel.cn") || url.includes("api.z.ai")
      ? "zhipu"
      : /api\.minimax(i\.com|\.cn|\.io)/.test(url)
        ? "minimax"
        : "";
  if (plan === "kimi") {
    const { status, body } = await getJson(fetch, "https://api.kimi.com/coding/v1/usages", { Authorization: `Bearer ${apiKey}` });
    if (status) return failed(status);
    const used = (window) => {
      const limit = num(window?.limit) ?? 1;
      return limit > 0 ? (Math.max(0, limit - (num(window?.remaining) ?? 0)) * 100) / limit : 0;
    };
    const fiveHour = body.limits?.find((item) => item.detail)?.detail;
    return {
      ...(fiveHour && { fiveHourPercent: used(fiveHour), fiveHourResetAt: resetAt(fiveHour.resetTime) }),
      ...(body.usage && { weeklyPercent: used(body.usage), weeklyResetAt: resetAt(body.usage.resetTime) }),
    };
  }
  if (plan === "zhipu") {
    const host = url.includes("bigmodel.cn") ? "https://open.bigmodel.cn" : "https://api.z.ai";
    // Zhipu takes the bare key, without Bearer.
    const { status, body } = await getJson(fetch, `${host}/api/monitor/usage/quota/limit`, { Authorization: apiKey, "Accept-Language": "en-US,en" });
    if (status) return failed(status);
    if (body.success === false) return text(`额度查询失败：${body.msg ?? "未知错误"}`);
    // unit 3 is the five-hour window and 6 the week; without one, the window that resets first is the five-hour one.
    const limits = (body.data?.limits ?? []).filter((item) => /^(tokens|credit)_limit$/i.test(item.type ?? ""));
    const byUnit = (unit) => limits.find((item) => item.unit === unit);
    const rest = limits.filter((item) => item.unit !== 3 && item.unit !== 6).sort((a, b) => (a.nextResetTime ?? -Infinity) - (b.nextResetTime ?? -Infinity));
    const fiveHour = byUnit(3) ?? rest.shift();
    const weekly = byUnit(6) ?? rest.shift();
    return {
      ...(fiveHour && { fiveHourPercent: num(fiveHour.percentage) ?? 0, fiveHourResetAt: resetAt(fiveHour.nextResetTime) }),
      ...(weekly && { weeklyPercent: num(weekly.percentage) ?? 0, weeklyResetAt: resetAt(weekly.nextResetTime) }),
    };
  }
  if (plan === "minimax") {
    const host = /api\.minimax\.io/.test(url) ? "api.minimax.io" : "api.minimaxi.com";
    const { status, body } = await getJson(fetch, `https://${host}/v1/api/openplatform/coding_plan/remains`, { Authorization: `Bearer ${apiKey}` });
    if (status) return failed(status);
    if (body.base_resp && body.base_resp.status_code !== 0) return text(`额度查询失败：${body.base_resp.status_msg ?? "未知错误"}`);
    const general = body.model_remains?.find((item) => item.model_name === "general");
    if (!general) return {};
    const fiveHourLeft = num(general.current_interval_remaining_percent);
    const weeklyLeft = general.current_weekly_status === 1 ? num(general.current_weekly_remaining_percent) : undefined;
    return {
      ...(fiveHourLeft !== undefined && { fiveHourPercent: 100 - fiveHourLeft, fiveHourResetAt: resetAt(general.end_time) }),
      ...(weeklyLeft !== undefined && { weeklyPercent: 100 - weeklyLeft, weeklyResetAt: resetAt(general.weekly_end_time) }),
    };
  }
  return text("此套餐的额度只能在 cc-switch 中查看");
}

/** The quota cc-switch's usage query for this provider reports; {} when it has none to show. */
function queryQuota(script, credentials, fetch) {
  const type = script.templateType;
  const own = { apiKey: script.apiKey?.trim() || credentials.apiKey, baseUrl: script.baseUrl?.trim().replace(/\/+$/, "") || credentials.baseUrl };
  if (type === "token_plan") return script.teamOrganizationId ? text("团队套餐的额度只能在 cc-switch 中查看") : codingPlan(script.codingPlanProvider, own, fetch);
  if (type === "balance") return balance(credentials, fetch);
  if (type === "official_subscription" || type === "github_copilot") return {};
  if (TEMPLATE_PATHS[type] && String(script.code ?? "").includes(TEMPLATE_PATHS[type])) return template(type, script, own, fetch);
  return text("自定义用量脚本只能在 cc-switch 中查询");
}

const lastGood = new Map();

/**
 * The quota of cc-switch's current Codex provider, as a provider-quota report whose
 * `modelProvider` is the config.toml provider id it serves; null when cc-switch is absent, its
 * current provider is an official login, or Codex's config no longer selects it.
 */
export async function ccSwitchQuota({ dir = ccSwitchDir(), codexHome = process.env.CODEX_HOME || path.join(homedir(), ".codex"), fetch = globalThis.fetch, maxAge = 60_000 } = {}) {
  const file = path.join(dir, "cc-switch.db");
  if (!existsSync(file)) return { report: null };
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(file, { readOnly: true });
    let row;
    let proxied = false;
    try {
      row = db.prepare("SELECT id, name, settings_config, meta FROM providers WHERE app_type = 'codex' AND is_current = 1").get();
      try {
        proxied = db.prepare("SELECT 1 FROM proxy_config WHERE app_type = 'codex' AND (enabled = 1 OR proxy_enabled = 1)").get() !== undefined;
      } catch {
        // A cc-switch from before the proxy has no proxy_config.
      }
    } finally {
      db.close();
    }
    if (!row) return { report: null };
    const settings = JSON.parse(row.settings_config || "{}");
    const stored = codexProvider(settings.config ?? "");
    if (!stored.id || BUILT_IN.has(stored.id)) return { report: null };
    // cc-switch's takeover proxy stands in for the provider's address on loopback.
    const live = codexProvider(readFileSync(path.join(codexHome, "config.toml"), "utf8"));
    const viaProxy = proxied && /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/.test(live.baseUrl);
    if (live.id !== stored.id || (live.baseUrl !== stored.baseUrl && !viaProxy)) return { report: null };

    const report = { provider: `cc-switch/${row.id}`, label: row.name, modelProvider: stored.id, updatedAt: Date.now(), quota: {} };
    const script = JSON.parse(row.meta || "{}").usage_script;
    if (!script?.enabled) return { report };
    const key = `${row.id}\n${row.meta}\n${row.settings_config}`;
    const previous = lastGood.get(row.id);
    if (previous?.key === key && Date.now() - previous.at < maxAge) return { report: { ...report, quota: previous.quota, updatedAt: previous.at } };
    const credentials = { apiKey: settings.auth?.OPENAI_API_KEY?.trim() || stored.bearer || "", baseUrl: stored.baseUrl };
    try {
      report.quota = await queryQuota(script, credentials, fetch);
      lastGood.set(row.id, { key, at: report.updatedAt, quota: report.quota });
    } catch (error) {
      // A network failure keeps the last good reading for a while, as cc-switch does.
      report.quota = previous?.key === key && Date.now() - previous.at < LAST_GOOD_MS ? previous.quota : text(`额度查询失败：${error.message}`);
    }
    return { report };
  } catch {
    return { report: null };
  }
}
