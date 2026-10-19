// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of plugins.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { keptTargets, updateMessage } from "./plugins.ts";

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
