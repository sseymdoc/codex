// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of plugins.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { keptTargets, matchesPlugin, originBadge, personalSections, pluginStatus, publicSections, updateMessage } from "./plugins.ts";

test("keptTargets keeps readers and editors, drops the owner and the workspace", () => {
  const principals = [
    { principalType: "user", principalId: "u-me", role: "owner", name: "我" },
    { principalType: "user", principalId: "u-1", role: "reader", name: "小林" },
    { principalType: "group", principalId: "g-1", role: "editor", name: "设计组" },
    { principalType: "workspace", principalId: "acct-1", role: "reader", name: "工作区" },
  ];
  assert.deepEqual(keptTargets(principals), [
    { principalType: "user", principalId: "u-1", role: "reader" },
    { principalType: "group", principalId: "g-1", role: "editor" },
  ]);
  assert.deepEqual(keptTargets(null), []);
});

test("updateMessage covers the three outcomes and a failed update", () => {
  const plugin = { id: "linear@workspace-directory", remotePluginId: "plugins~Plugin_1" };
  const none = { changedPlugins: [], failedRemotePluginIds: [], failedMaterializationRemotePluginIds: [] };
  const changed = { ...none, changedPlugins: [{ id: plugin.id, hasMcps: false, hasApps: false, hasHooks: false, hasSkills: true }] };
  assert.equal(updateMessage(none, plugin, "1.0.0", "1.0.0"), "插件已是最新版本。");
  assert.equal(updateMessage(changed, plugin, "1.0.0", "1.1.0"), "已从 1.0.0 更新到 1.1.0。");
  assert.equal(updateMessage(changed, plugin, null, "1.1.0"), "插件已更新。");
  assert.equal(updateMessage(changed, plugin, "1.1.0", "1.1.0"), "插件已更新。");
  assert.equal(updateMessage({ ...none, failedRemotePluginIds: [plugin.remotePluginId] }, plugin, "1.0.0", null), null);
});

const summary = (name, overrides = {}) => ({
  id: name,
  remotePluginId: null,
  version: null,
  localVersion: null,
  name,
  shareContext: null,
  source: { type: "local", path: `/m/${name}` },
  installed: false,
  installedAt: null,
  enabled: false,
  installPolicy: "AVAILABLE",
  installPolicySource: null,
  mustShowInstallationInterstitial: null,
  authPolicy: "ON_USE",
  availability: "AVAILABLE",
  disabledReason: null,
  eligiblePlanTypes: null,
  interface: null,
  keywords: [],
  ...overrides,
});
const category = (name, value, overrides = {}) => summary(name, { interface: { category: value, displayName: null, shortDescription: null, developerName: null }, ...overrides });
const market = (name, plugins, path = `/m/${name}`) => ({ name, path, interface: null, plugins });
const ids = (section) => section.entries.map((entry) => entry.plugin.id);

test("publicSections: 精选 in feed order, categories by name with 其他 last, user marketplaces left out", () => {
  const list = {
    marketplaces: [
      market("openai-curated", [category("dup", "Coding")]),
      market("openai-curated-remote", [category("figma", "Design"), category("linear", "Coding"), summary("misc"), category("blocked", "Coding", { availability: "DISABLED_BY_ADMIN" }), category("github", "Coding")], null),
      market("my-market", [category("mine", "Coding")]),
    ],
    marketplaceLoadErrors: [],
    featuredPluginIds: ["github", "figma", "github", "dup"],
  };
  const sections = publicSections(list);
  assert.deepEqual(sections.map((section) => section.title), ["精选", "Coding", "Design", "其他"]);
  assert.deepEqual(ids(sections[0]), ["github", "figma"]);
  assert.deepEqual(ids(sections[1]), ["linear", "github", "blocked"]);
  assert.equal(sections[1].entries[0].marketplacePath, null);
  // Without the remote catalog the local curated copy is 公开 itself.
  assert.deepEqual(ids(publicSections({ ...list, marketplaces: [list.marketplaces[0]], featuredPluginIds: [] })[0]), ["dup"]);
});

test("personalSections: 由您创建, 与您共享 (every shared variant), then each added marketplace", () => {
  const list = {
    marketplaces: [
      market("openai-bundled", [summary("browser")]),
      market("my-market", [summary("a")]),
      market("workspace-shared-with-me-private", [summary("s1")], null),
      market("created-by-me-remote", [summary("c1")], null),
      market("workspace-shared-with-me", [summary("s2")], null),
      market("empty-market", []),
    ],
    marketplaceLoadErrors: [],
    featuredPluginIds: [],
  };
  const sections = personalSections(list);
  assert.deepEqual(sections.map((section) => [section.title, section.detail]), [["由您创建", undefined], ["与您共享", undefined], ["my-market", "/m/my-market"], ["empty-market", "/m/empty-market"]]);
  assert.deepEqual(ids(sections[1]), ["s1", "s2"]);
});

test("pluginStatus follows the detail page's main button", () => {
  assert.equal(pluginStatus(summary("p")), "install");
  assert.equal(pluginStatus(summary("p", { installPolicy: "NOT_AVAILABLE" })), "unavailable");
  assert.equal(pluginStatus(summary("p", { disabledReason: "required_app_unavailable" })), "unavailable");
  assert.equal(pluginStatus(summary("p", { disabledReason: "plan_not_eligible" })), "plan");
  assert.equal(pluginStatus(summary("p", { availability: "DISABLED_BY_ADMIN", installed: true, enabled: true })), "admin");
  assert.equal(pluginStatus(summary("p", { installed: true, enabled: true })), "try");
  assert.equal(pluginStatus(summary("p", { installed: true })), "enable");
  assert.equal(pluginStatus(summary("p", { installed: true, source: { type: "remote" } })), "disabled");
});

test("matchesPlugin looks at names, descriptions, developer and keywords", () => {
  const plugin = summary("linear", { keywords: ["Issues"], interface: { displayName: "Linear", shortDescription: "Plan work", developerName: "Linear Inc", category: "Productivity" } });
  for (const term of ["", "lin", "PLAN", "inc", "issues", "productivity"]) assert.equal(matchesPlugin(plugin, term), true, term);
  assert.equal(matchesPlugin(plugin, "figma"), false);
});

test("originBadge names where a plugin came from, nothing for OpenAI's marketplaces", () => {
  const entry = (marketplaceName, source = { type: "local", path: "/p" }) => ({ plugin: summary("p", { source }), marketplaceName, marketplacePath: null });
  assert.equal(originBadge(entry("openai-curated-remote")), null);
  assert.equal(originBadge(entry("created-by-me-remote")), "您的云端插件");
  assert.equal(originBadge(entry("workspace-shared-with-me-unlisted")), "工作空间插件");
  assert.equal(originBadge(entry("my-market", { type: "git", url: "u", path: null, refName: null, sha: null })), "Git 市场插件");
  assert.equal(originBadge(entry("my-market")), "本地插件");
});
