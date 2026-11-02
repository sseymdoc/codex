import assert from "node:assert/strict";
import test from "node:test";
import { DESKTOP_TOOLS, validateDesktopInput } from "./desktop-tools.mjs";
import { MAX_WIDGET_CODE, SHOWN, VISUALIZE_TOOL_NAMES, visualizeInput, visualizeResult } from "./visualize-tools.mjs";
import { VISUAL_MODULES, visualGuide } from "./visualize-guide.mjs";

test("show_widget and read_me are desktop tools with closed schemas and no approval hints", () => {
  for (const name of VISUALIZE_TOOL_NAMES) {
    const tool = DESKTOP_TOOLS.find((entry) => entry.name === name);
    assert.ok(tool, name);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.openWorldHint, false);
  }
});

test("read_me: the preamble, then each module's sections once, within Codex's tool-output cut", () => {
  const bare = visualGuide();
  assert.match(bare, /^# Inline visuals in Codex UI/);
  const all = visualGuide([...VISUAL_MODULES], "desktop");
  // 10,000 tokens is about 40,000 bytes of English; stay well under.
  assert.ok(all.length < 24_000, `${all.length}`);
  assert.equal(all.split("## Color ramps").length, 2, "shared sections appear once");
  assert.equal(all.split("## SVG setup").length, 2);
  assert.match(visualGuide(["diagram"], "mobile"), /viewBox="0 0 380 H"/);
  assert.match(visualGuide(["diagram"]), /viewBox="0 0 680 H"/);
  assert.equal(visualizeResult("read_me", { modules: ["chart"] }, { outcome: "ready" }).content[0].text, visualGuide(["chart"]));
  assert.equal(visualizeResult("show_widget", {}, { outcome: "shown" }).content[0].text, SHOWN);
});

test("show_widget's arguments: code with newlines up to the cap, a snake_case title, 1 to 4 loading messages", () => {
  const ok = { loading_messages: ["Drawing boxes"], title: "auth_flow_v2", widget_code: "<svg>\n<rect/>\n</svg>" };
  assert.deepEqual(validateDesktopInput("show_widget", ok), ok);
  const refused = (value, pattern) => assert.throws(() => visualizeInput("show_widget", { ...ok, ...value }), pattern);
  refused({ title: "Auth Flow" }, /snake_case/);
  refused({ widget_code: " " }, /widget_code is required/);
  refused({ widget_code: "x".repeat(MAX_WIDGET_CODE + 1) }, /at most/);
  refused({ loading_messages: [] }, /loading_messages takes 1 to 4/);
  refused({ loading_messages: ["a", "b", "c", "d", "e"] }, /loading_messages takes 1 to 4/);
  refused({ extra: true }, /Unknown show_widget arguments/);
  assert.deepEqual(validateDesktopInput("read_me", { modules: ["chart", "chart"], platform: "mobile" }), { modules: ["chart"], platform: "mobile" });
  assert.throws(() => validateDesktopInput("read_me", { modules: ["elicitation"] }), /must be one of/);
});
