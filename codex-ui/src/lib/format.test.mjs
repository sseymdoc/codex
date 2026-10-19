// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of format.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { externalUrl, formatTokens, hangQuotes, meterBalances, meterCredits, providerQuota, spliceDictation, threadMarkdown } from "./format.ts";

test("dictation lands at the caret, a space apart from Latin words only", () => {
  assert.deepEqual(spliceDictation("", 0, 0, "你好"), { text: "你好", caret: 2 });
  assert.deepEqual(spliceDictation("修复", 2, 2, "登录问题"), { text: "修复登录问题", caret: 6 });
  assert.deepEqual(spliceDictation("Fix the", 7, 7, "login bug"), { text: "Fix the login bug", caret: 17 });
  assert.deepEqual(spliceDictation("helloworld", 5, 5, "big"), { text: "hello big world", caret: 9 });
  assert.deepEqual(spliceDictation("abc def", 4, 7, "xyz"), { text: "abc xyz", caret: 7 });
  assert.deepEqual(spliceDictation("看 README", 2, 2, "先"), { text: "看 先README", caret: 3 });
});

test("formatTokens keeps one decimal and drops a trailing .0", () => {
  assert.deepEqual(
    [0, 963, 1000, 12_340, 127_700, 185_000, 999_949, 999_950, 1_250_000].map(formatTokens),
    ["0", "963", "1k", "12.3k", "127.7k", "185k", "999.9k", "1M", "1.3M"],
  );
});

test("externalUrl only opens https links without credentials", () => {
  assert.equal(externalUrl("https://example.com/authorize?state=1"), "https://example.com/authorize?state=1");
  for (const unsafe of ["http://example.com/", "javascript:alert(1)", "https://user:pass@example.com/", "file:///etc/passwd", "not a url"]) {
    assert.equal(externalUrl(unsafe), null, unsafe);
  }
});

test("threadMarkdown keeps prompts, replies, commands and edits in order", () => {
  const turns = [
    {
      items: [
        { type: "userMessage", id: "u1", content: [{ type: "text", text: "修一下测试", text_elements: [] }, { type: "image", url: "data:," }] },
        { type: "reasoning", id: "r1", summary: ["想一想"], content: [] },
        { type: "commandExecution", id: "c1", command: "npm test" },
        { type: "fileChange", id: "f1", changes: [{ path: "src/a.ts" }] },
        { type: "agentMessage", id: "a1", text: "已修复。\n" },
      ],
    },
    { items: [{ type: "userMessage", id: "u2", content: [{ type: "text", text: "谢谢", text_elements: [] }] }] },
  ];
  assert.equal(
    threadMarkdown("会话", turns),
    "# 会话\n\n## 你\n\n修一下测试\n\n## Codex\n\n```sh\n$ npm test\n```\n\n- 修改 `src/a.ts`\n\n已修复。\n\n## 你\n\n谢谢\n",
  );
});

test("hangQuotes wraps only a quote that opens a paragraph or heading", () => {
  assert.equal(hangQuotes("<p>“引用”</p>"), '<p><span data-hang-quote="dq">“</span>引用”</p>');
  assert.equal(hangQuotes("<h2>&#39;single&#39;</h2>"), '<h2><span data-hang-quote="sq">&#39;</span>single&#39;</h2>');
  assert.equal(hangQuotes("<p>说“你好”</p><li>“不悬挂”</li>"), "<p>说“你好”</p><li>“不悬挂”</li>");
});

test("providerQuota shows the routed model's provider windows that meter that model", () => {
  // Shapes as a live opencodex reported them (times in ms).
  const reports = [
    { provider: "openai", label: "OpenAI (Codex login)", updatedAt: 1, quota: { fiveHourPercent: 1, weeklyPercent: 12 } },
    {
      provider: "anthropic",
      label: "Anthropic Claude",
      updatedAt: 1,
      quota: { fiveHourPercent: 7, fiveHourResetAt: 1792403999621, weeklyPercent: 42, weeklyResetAt: 1792663199621, customWindows: [{ label: "Fable", scope: "model", percent: 32, resetAt: 1792663199622 }] },
    },
    {
      provider: "google-antigravity",
      label: "Google Antigravity",
      updatedAt: 1,
      quota: {
        customWindows: [
          { label: "Gem", percent: 0, resetAt: 1792408765000 },
          { label: "Gem (Weekly)", percent: 0, resetAt: 1792995565000 },
          { label: "Cla", percent: 3, resetAt: 1792408765000 },
          { label: "Cla (Weekly)", percent: 49.0168, resetAt: 1792851703000 },
        ],
      },
    },
    { provider: "deepseek", label: "DeepSeek", updatedAt: 1, quota: { customWindows: [{ label: "API balance (¥23.34)", percent: 0 }] } },
  ];
  const rows = (model) => providerQuota(model, reports)?.rows.map((r) => [r.name, r.pct, r.resetsAt, r.primary]);

  // Native models keep Codex's own limits, as does a provider opencodex has no report for.
  for (const model of [null, "gpt-6.1-sol", "openai/gpt-6.1-sol", "ollama/qwen3", "/x"]) assert.equal(providerQuota(model, reports), null, model);
  assert.equal(providerQuota("anthropic/claude-fable-5-1", reports).label, "Anthropic Claude");
  assert.deepEqual(rows("anthropic/claude-fable-5-1"), [
    ["会话限额", 7, 1792404000, true],
    ["每周", 42, 1792663200, false],
    ["每周 · Fable", 32, 1792663200, false],
  ]);
  // The Fable window meters Fable models only.
  assert.deepEqual(rows("anthropic/claude-sonnet-5-5").map((r) => r[0]), ["会话限额", "每周"]);
  // Antigravity meters Gemini and Claude-family models separately.
  assert.deepEqual(rows("google-antigravity/claude-opus-4-6-thinking"), [
    ["会话限额", 3, 1792408765, true],
    ["每周", 49.0168, 1792851703, false],
  ]);
  assert.deepEqual(rows("google-antigravity/gpt-oss-120b"), rows("google-antigravity/claude-sonnet-4-6"));
  assert.deepEqual(rows("google-antigravity/gemini-3.8-flash").map((r) => r[1]), [0, 0]);
  // A balance is a bar (meterBalances fills in its percent); one with nothing to meter is text.
  assert.deepEqual(rows("deepseek/deepseek-v4-flash"), [["API balance (¥23.34)", 0, null, false]]);
  reports[3].quota.customWindows = [{ label: "Unlimited API credits", percent: 0 }];
  assert.deepEqual(rows("deepseek/deepseek-v4-flash"), [["Unlimited API credits", null, null, false]]);
});

test("providerQuota gives every model the quota of the provider cc-switch switched Codex to", () => {
  const reports = [
    { provider: "anthropic", label: "Anthropic Claude", updatedAt: 1, quota: { fiveHourPercent: 7 } },
    { provider: "cc-switch/relay", label: "Relay", modelProvider: "custom", updatedAt: 1, quota: { fiveHourPercent: 12, fiveHourResetAt: 1792400000000, weeklyPercent: 30 } },
  ];
  // Codex sends every model to the provider config.toml selects, a routed-looking slug included.
  for (const model of ["gpt-5.1-codex", "anthropic/claude-fable-5-1", null]) {
    const quota = providerQuota(model, reports, "custom");
    assert.equal(quota.label, "Relay", model);
    assert.deepEqual(
      quota.rows.map((r) => [r.name, r.pct, r.resetsAt, r.primary]),
      [
        ["会话限额", 12, 1792400000, true],
        ["每周", 30, null, false],
      ],
    );
  }
  // Under Codex's own provider the slug rule applies as before.
  assert.equal(providerQuota("gpt-5.1-codex", reports, "openai"), null);
  assert.equal(providerQuota("anthropic/claude-fable-5-1", reports, "openai").label, "Anthropic Claude");
  // cc-switch's balances ("余额 ($12.00)") meter like opencodex's.
  const balance = { ...reports[1], quota: { customWindows: [{ label: "余额 ($12.00)", percent: 0 }] } };
  assert.equal(meterBalances([balance], { "cc-switch/relay $": { total: 16, last: 12 } }).reports[0].quota.customWindows[0].percent, 25);
});

test("meterBalances reads a balance as spent / total, a top-up adding to the total", () => {
  let tracks = {};
  const pct = (label) => {
    const metered = meterBalances([{ provider: "deepseek", label: "DeepSeek", updatedAt: 1, quota: { customWindows: [{ label, percent: 0 }] } }], tracks);
    tracks = metered.tracks;
    return metered.reports[0].quota.customWindows[0].percent;
  };
  assert.equal(pct("API balance (¥10.00)"), 0); // the first reading is the total
  assert.equal(pct("API balance (¥7.00 total, ¥2.00 granted)"), 30); // ¥3 of ¥10 spent
  assert.equal(pct("API balance (¥7.00)"), 30);
  assert.equal(pct("API balance (¥17.00)"), 15); // a ¥10 top-up: ¥3 of ¥20
  assert.equal(pct("API balance (¥12.75)"), 36.25); // ¥7.25 of ¥20
  assert.equal(pct("API balance ($5.00)"), 0); // another currency is another balance
  assert.equal(pct("API balance (¥0.00)"), 100);
  assert.deepEqual(tracks, { "deepseek ¥": { total: 20, last: 0 }, "deepseek $": { total: 5, last: 5 } });

  // Lines without an amount, spend meters and real percents are left alone.
  const windows = [
    { label: "Unlimited API credits", percent: 0 },
    { label: "Billing cycle spend ($0.00 of $50.00)", percent: 0 },
    { label: "USD balance ($12.00)", percent: 40 },
  ];
  const others = meterBalances([{ provider: "x", label: "X", updatedAt: 1, quota: { customWindows: windows } }], {});
  assert.deepEqual(others.reports[0].quota.customWindows, windows);
  assert.deepEqual(others.tracks, {});
});

test("meterCredits meters the ChatGPT account's credits like a balance, shown while some are left", () => {
  let tracks = {};
  const read = (credits, buckets = null) => {
    const metered = meterCredits({ rateLimits: { limitId: "codex", credits }, rateLimitsByLimitId: buckets, accountId: "acct" }, "acct", tracks);
    tracks = metered.tracks;
    return metered.credits;
  };
  const left = (balance) => ({ hasCredits: true, unlimited: false, balance });
  assert.deepEqual(read(left("100")), { balance: 100, percent: 0 }); // the first reading is the total
  assert.deepEqual(read(left("87.5")), { balance: 87.5, percent: 12.5 });
  assert.deepEqual(read(left("187.5")), { balance: 187.5, percent: 6.25 }); // a top-up of 100: 12.5 of 200
  // Spent down to nothing, the bar goes but the reading counts, so the next top-up stacks.
  assert.equal(read({ hasCredits: false, unlimited: false, balance: "0" }), null);
  assert.deepEqual(read(left("50")), { balance: 50, percent: 80 }); // 200 of 250
  // Another bucket may be the one reporting them.
  assert.deepEqual(read(null, { codex: { credits: null }, other: { credits: left("50") } }), { balance: 50, percent: 80 });
  // Nothing to meter leaves the tracks alone.
  const before = tracks;
  for (const credits of [{ hasCredits: true, unlimited: true, balance: "5" }, left(null), left("n/a"), null]) assert.equal(read(credits), null);
  assert.equal(meterCredits(null, "acct", tracks).credits, null);
  assert.equal(tracks, before);
  assert.deepEqual(tracks, { "chatgpt:acct credits": { total: 250, last: 50 } });
});
