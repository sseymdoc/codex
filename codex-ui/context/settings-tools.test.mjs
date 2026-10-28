import assert from "node:assert/strict";
import { test } from "node:test";
import { DESKTOP_TOOLS, validateDesktopInput, validateDesktopResult } from "./desktop-tools.mjs";
import { MODEL_SETTINGS, SETTINGS_TOOL_NAMES, settingsResult } from "./settings-tools.mjs";

const check = (name, args, value) => validateDesktopResult(name, { threadId: "t", cwd: "/p", ...value }, { threadId: "t", cwd: "/p", name, args: validateDesktopInput(name, args) });

test("the settings tools are offered with the other desktop tools", () => {
  for (const name of SETTINGS_TOOL_NAMES) assert.ok(DESKTOP_TOOLS.some((tool) => tool.name === name), name);
});

test("only listed preferences, only their values; nothing that widens what Codex may do", () => {
  assert.deepEqual(validateDesktopInput("set_setting", { key: "theme", value: "dark" }), { key: "theme", value: "dark" });
  for (const key of ["tool_access_mode", "backend_channel", "experimental_backend", "allow_full_access", "permission", "connector_search", "model", "__proto__", "toString"]) {
    assert.throws(() => validateDesktopInput("set_setting", { key, value: "on" }), /not one Codex may change/, key);
  }
  assert.throws(() => validateDesktopInput("set_setting", { key: "theme", value: "blue" }), /value must be one of: system, light, dark/);
  assert.throws(() => validateDesktopInput("set_setting", { key: "theme", value: "dark", force: true }), /Unknown set_setting arguments: force/);
  assert.throws(() => validateDesktopInput("get_settings", { key: "theme" }), /Unknown get_settings arguments/);
  assert.equal(Object.keys(MODEL_SETTINGS).length, 13);
});

test("receipts answer their call", () => {
  assert.doesNotThrow(() => check("get_settings", {}, { values: { theme: "dark", plan_card: "on" } }));
  assert.throws(() => check("get_settings", {}, { values: { theme: "blue" } }));
  assert.throws(() => check("get_settings", {}, { values: { tool_access_mode: "all" } }));
  assert.doesNotThrow(() => check("set_setting", { key: "theme", value: "dark" }, { key: "theme", value: "dark", previous: "system", outcome: "changed" }));
  assert.throws(() => check("set_setting", { key: "theme", value: "dark" }, { key: "theme", value: "light", previous: "system", outcome: "changed" }));
  assert.throws(() => check("set_setting", { key: "theme", value: "dark" }, { key: "theme", value: "dark", previous: "system", outcome: "forced" }));
});

test("results name the setting as the Settings page does", () => {
  assert.equal(settingsResult("set_setting", {}, { key: "theme", value: "dark", previous: "system", outcome: "changed" }).content[0].text, "Changed “主题” to “深色” (was “系统”).");
  assert.equal(settingsResult("set_setting", {}, { key: "theme", value: "dark", previous: "dark", outcome: "unchanged" }).content[0].text, "“主题” is already “深色”; nothing was changed.");
  assert.deepEqual(settingsResult("set_setting", {}, { key: "plan_card", value: "off", previous: "on", outcome: "declined" }), { isError: true, content: [{ type: "text", text: "The user declined changing “计划卡”. Nothing was changed." }] });
  const listed = JSON.parse(settingsResult("get_settings", {}, { values: { theme: "dark" } }).content[0].text).settings;
  assert.deepEqual(listed, [{ key: "theme", label: "主题", value: "dark", options: [{ value: "system", label: "系统" }, { value: "light", label: "浅色" }, { value: "dark", label: "深色" }] }]);
});
