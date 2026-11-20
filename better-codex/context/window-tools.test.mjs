import assert from "node:assert/strict";
import { test } from "node:test";
import { DESKTOP_TOOLS, validateDesktopInput, validateDesktopResult } from "./desktop-tools.mjs";
import { WINDOW_TOOL_NAMES, windowResult } from "./window-tools.mjs";

const check = (name, args, value) => validateDesktopResult(name, { threadId: "t", cwd: "/p", ...value }, { threadId: "t", cwd: "/p", name, args: validateDesktopInput(name, args) });

test("the window tools are offered with the other desktop tools", () => {
  for (const name of WINDOW_TOOL_NAMES) assert.ok(DESKTOP_TOOLS.some((tool) => tool.name === name), name);
});

test("a session id and a place; the others take nothing", () => {
  assert.deepEqual(validateDesktopInput("open_session_in", { session_id: " s-2 " }), { session_id: "s-2", place: "beside" });
  assert.deepEqual(validateDesktopInput("open_session_in", { session_id: "s-2", place: "here" }), { session_id: "s-2", place: "here" });
  for (const session_id of ["", "a\"b", "x".repeat(201), `a${String.fromCharCode(10)}b`]) assert.throws(() => validateDesktopInput("open_session_in", { session_id }), /session_id must be a session id/);
  assert.throws(() => validateDesktopInput("open_session_in", { session_id: "s", place: "left" }), /place must be/);
  assert.throws(() => validateDesktopInput("close_split", { all: true }), /Unknown close_split arguments/);
});

test("receipts answer their call", () => {
  assert.doesNotThrow(() => check("get_window_layout", {}, { columns: [{ sessionId: "a", title: "A", focused: true }, { sessionId: "b", title: "B", focused: false }] }));
  assert.throws(() => check("get_window_layout", {}, { columns: [{ sessionId: "a", title: "A", focused: true }, { sessionId: "b", title: "B", focused: true }] }));
  assert.throws(() => check("get_window_layout", {}, { columns: [1, 2, 3] }));
  assert.doesNotThrow(() => check("open_session_in", { session_id: "b" }, { sessionId: "b", place: "beside", outcome: "opened" }));
  assert.throws(() => check("open_session_in", { session_id: "b" }, { sessionId: "c", place: "beside", outcome: "opened" }));
  assert.throws(() => check("close_split", {}, { outcome: "split" }));
});

test("results say where the session went", () => {
  assert.match(windowResult("open_session_in", { place: "beside" }, { outcome: "opened" }).content[0].text, /beside this chat in split view/);
  assert.match(windowResult("open_session_in", { place: "here" }, { outcome: "already" }).content[0].text, /already in this chat's column/);
  assert.match(windowResult("close_split", {}, { outcome: "no_split" }).content[0].text, /no split to close/);
});
