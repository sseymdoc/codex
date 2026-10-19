import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ccSwitchQuota } from "./ccswitch.mjs";

const relayToml = (url = "https://relay.example/v1") =>
  `model_provider = "custom"\nmodel = "gpt-5.1-codex"\n\n[model_providers.custom]\nname = "custom"\nbase_url = "${url}"\nwire_api = "responses"\n`;

/** cc-switch's database with `settings` / `meta` as its current Codex provider, and Codex's live config.toml. */
function homes({ settings = { auth: { OPENAI_API_KEY: "sk-relay" }, config: relayToml() }, meta = {}, live = relayToml(), proxy = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "codex-ui-ccswitch-"));
  const dir = path.join(root, ".cc-switch");
  const codexHome = path.join(root, ".codex");
  mkdirSync(dir);
  mkdirSync(codexHome);
  writeFileSync(path.join(codexHome, "config.toml"), live);
  const db = new DatabaseSync(path.join(dir, "cc-switch.db"));
  db.exec("CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, settings_config TEXT, meta TEXT, is_current INTEGER)");
  db.exec("CREATE TABLE proxy_config (app_type TEXT, proxy_enabled INTEGER, enabled INTEGER)");
  db.prepare("INSERT INTO providers VALUES ('relay', 'codex', 'Relay', ?, ?, 1)").run(JSON.stringify(settings), JSON.stringify(meta));
  db.prepare("INSERT INTO providers VALUES ('official', 'codex', 'OpenAI Official', '{}', '{}', 0)").run();
  db.prepare("INSERT INTO proxy_config VALUES ('codex', 0, ?)").run(proxy ? 1 : 0);
  db.close();
  return { dir, codexHome, maxAge: 0 };
}

/** A fetch answering from `routes` (URL → JSON body, or an HTTP status), recording each request. */
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const answer = routes[url];
    if (answer === undefined) throw new Error(`unreachable ${url}`);
    return typeof answer === "number" ? { ok: false, status: answer } : { ok: true, status: 200, json: async () => answer };
  };
  return { fetch, calls };
}

const script = (fields) => ({ usage_script: { enabled: true, language: "javascript", ...fields } });
const newApi = script({ templateType: "newapi", code: 'url: "{{baseUrl}}/api/user/self"', accessToken: "tok-1", userId: "42" });

test("reads cc-switch's provider only while Codex's config.toml still selects it", async () => {
  const none = fakeFetch({});
  assert.deepEqual(await ccSwitchQuota({ dir: mkdtempSync(path.join(tmpdir(), "codex-ui-ccswitch-")), fetch: none.fetch }), { report: null });
  // Another tool rewrote config.toml, to another provider or another address.
  assert.deepEqual(await ccSwitchQuota({ ...homes({ live: relayToml().replace('"custom"', '"other"') }), fetch: none.fetch }), { report: null });
  assert.deepEqual(await ccSwitchQuota({ ...homes({ live: relayToml("https://elsewhere.example/v1") }), fetch: none.fetch }), { report: null });
  // An official login is Codex's own account.
  const official = { auth: { OPENAI_API_KEY: "" }, config: 'model = "gpt-5.1-codex"\n' };
  assert.deepEqual(await ccSwitchQuota({ ...homes({ settings: official, live: official.config }), fetch: none.fetch }), { report: null });
  // cc-switch's takeover proxy stands on loopback in place of the provider.
  const proxied = relayToml("http://127.0.0.1:15721/v1");
  assert.equal(await ccSwitchQuota({ ...homes({ live: proxied }), fetch: none.fetch }).then((r) => r.report), null);
  assert.equal(await ccSwitchQuota({ ...homes({ live: proxied, proxy: true }), fetch: none.fetch }).then((r) => r.report?.modelProvider), "custom");
  // Text inside a multi-line string is not a key.
  const instructed = `developer_instructions = """\nmodel_provider = "other"\n"""\n${relayToml()}`;
  const { report } = await ccSwitchQuota({ ...homes({ live: instructed }), fetch: none.fetch });
  assert.deepEqual(report && { ...report, updatedAt: 0 }, { provider: "cc-switch/relay", label: "Relay", modelProvider: "custom", updatedAt: 0, quota: {} });
  assert.equal(none.calls.length, 0);
});

test("runs the NewAPI template with its access token and hands no key to the page", async () => {
  const upstream = fakeFetch({ "https://relay.example/v1/api/user/self": { success: true, data: { group: "vip", quota: 5_000_000, used_quota: 5_000_000 } } });
  const result = await ccSwitchQuota({ ...homes({ meta: newApi }), fetch: upstream.fetch });
  assert.deepEqual(result.report.quota, { customWindows: [{ label: "vip · $10.00 / $20.00", percent: 50 }] });
  assert.equal(upstream.calls[0].headers.Authorization, "Bearer tok-1");
  assert.equal(upstream.calls[0].headers["New-Api-User"], "42");
  assert.doesNotMatch(JSON.stringify(result), /sk-relay|tok-1/);
});

test("reads native balances and coding plans the way cc-switch does", async () => {
  const at = (url) => ({ auth: { OPENAI_API_KEY: "sk-x" }, config: relayToml(url) });
  const run = async (url, meta, routes) => {
    const upstream = fakeFetch(routes);
    const { report } = await ccSwitchQuota({ ...homes({ settings: at(url), live: relayToml(url), meta }), fetch: upstream.fetch });
    return { quota: report.quota, headers: upstream.calls[0]?.headers };
  };

  // DeepSeek lists a CNY and a USD wallet; the empty one is dropped.
  const deepseek = await run("https://api.deepseek.com", script({ templateType: "balance" }), {
    "https://api.deepseek.com/user/balance": { is_available: true, balance_infos: [{ currency: "CNY", total_balance: "23.34" }, { currency: "USD", total_balance: "0.00" }] },
  });
  assert.deepEqual(deepseek.quota, { customWindows: [{ label: "余额 (¥23.34)", percent: 0 }] });

  const kimi = await run("https://api.kimi.com/coding/v1", script({ templateType: "token_plan" }), {
    "https://api.kimi.com/coding/v1/usages": {
      limits: [{ detail: { limit: 100, remaining: 75, resetTime: "2026-10-19T12:00:00Z" } }],
      usage: { limit: "1000", remaining: "400", resetTime: 1792500000 },
    },
  });
  assert.deepEqual(kimi.quota, { fiveHourPercent: 25, fiveHourResetAt: Date.parse("2026-10-19T12:00:00Z"), weeklyPercent: 60, weeklyResetAt: 1792500000000 });

  // Zhipu marks windows by unit (3 = five hours, 6 = week) and takes the key without Bearer.
  const zhipu = await run("https://open.bigmodel.cn/api/coding/paas/v4", script({ templateType: "token_plan", codingPlanProvider: "zhipu" }), {
    "https://open.bigmodel.cn/api/monitor/usage/quota/limit": {
      success: true,
      data: {
        limits: [
          { type: "TOKENS_LIMIT", unit: 6, percentage: 30, nextResetTime: 1792600000000 },
          { type: "TIME_LIMIT", unit: 5, percentage: 99 },
          { type: "TOKENS_LIMIT", unit: 3, percentage: 12, nextResetTime: 1792400000000 },
        ],
      },
    },
  });
  assert.deepEqual(zhipu.quota, { fiveHourPercent: 12, fiveHourResetAt: 1792400000000, weeklyPercent: 30, weeklyResetAt: 1792600000000 });
  assert.equal(zhipu.headers.Authorization, "sk-x");

  // MiniMax reports what is left of the "general" model's windows.
  const minimax = await run("https://api.minimaxi.com/v1", script({ templateType: "token_plan" }), {
    "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains": {
      base_resp: { status_code: 0 },
      model_remains: [
        { model_name: "video", current_interval_remaining_percent: 1 },
        { model_name: "general", current_interval_remaining_percent: 70, end_time: 1792400000000, current_weekly_status: 1, current_weekly_remaining_percent: 55, weekly_end_time: 1792900000000 },
      ],
    },
  });
  assert.deepEqual(minimax.quota, { fiveHourPercent: 30, fiveHourResetAt: 1792400000000, weeklyPercent: 45, weeklyResetAt: 1792900000000 });
});

test("leaves custom scripts to cc-switch and shows failures, keeping the last good reading through outages", async () => {
  const quiet = fakeFetch({});
  const textOf = async (meta) => (await ccSwitchQuota({ ...homes({ meta }), fetch: quiet.fetch })).report.quota;
  const custom = { customWindows: [{ label: "自定义用量脚本只能在 cc-switch 中查询", percent: 0 }] };
  assert.deepEqual(await textOf(script({ templateType: "custom", code: "({ request: { url: 'https://x' } })" })), custom);
  // A template whose code was rewritten is a custom script too.
  assert.deepEqual(await textOf(script({ templateType: "newapi", code: "({ request: { url: 'https://x' } })" })), custom);
  assert.deepEqual(await textOf({ usage_script: { ...newApi.usage_script, enabled: false } }), {});
  assert.equal(quiet.calls.length, 0);

  const refused = fakeFetch({ "https://relay.example/v1/api/user/self": 401 });
  assert.deepEqual((await ccSwitchQuota({ ...homes({ meta: newApi }), fetch: refused.fetch })).report.quota, {
    customWindows: [{ label: "额度查询失败（HTTP 401）", percent: 0 }],
  });

  const setup = homes({ meta: newApi });
  const good = fakeFetch({ "https://relay.example/v1/api/user/self": { success: true, data: { group: "vip", quota: 0, used_quota: 1_000_000 } } });
  const first = await ccSwitchQuota({ ...setup, fetch: good.fetch });
  const outage = await ccSwitchQuota({ ...setup, fetch: async () => Promise.reject(new Error("ECONNRESET")) });
  assert.deepEqual(outage.report.quota, first.report.quota);
  const fresh = await ccSwitchQuota({ ...homes({ meta: { usage_script: { ...newApi.usage_script, userId: "7" } } }), fetch: async () => Promise.reject(new Error("ECONNRESET")) });
  assert.deepEqual(fresh.report.quota, { customWindows: [{ label: "额度查询失败：ECONNRESET", percent: 0 }] });
});
