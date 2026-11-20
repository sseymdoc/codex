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

test("set_sidebar_collapsed takes one boolean, answers with one of four outcomes, and the layout says whether it is collapsed", () => {
  assert.deepEqual(validateDesktopInput("set_sidebar_collapsed", { collapsed: false }), { collapsed: false });
  for (const collapsed of [undefined, "true", 1, null]) assert.throws(() => validateDesktopInput("set_sidebar_collapsed", { collapsed }), /collapsed must be true or false/);
  assert.throws(() => validateDesktopInput("set_sidebar_collapsed", { collapsed: true, width: 0 }), /Unknown set_sidebar_collapsed arguments: width/);
  const texts = {
    changed: [true, "The sidebar is collapsed now."],
    unchanged: [false, "The sidebar is already expanded."],
    narrow: [false, "The window is too narrow to show the sidebar, so it stays collapsed."],
    not_shown: [true, "This chat isn't on screen, so the sidebar was left alone."],
  };
  for (const [outcome, [collapsed, text]] of Object.entries(texts)) {
    assert.doesNotThrow(() => check("set_sidebar_collapsed", { collapsed }, { outcome }), outcome);
    assert.equal(windowResult("set_sidebar_collapsed", { collapsed }, { outcome }).content[0].text, text);
  }
  assert.throws(() => check("set_sidebar_collapsed", { collapsed: true }, { outcome: "collapsed" }));
  assert.throws(() => check("set_sidebar_collapsed", { collapsed: true }, { outcome: "changed", collapsed: true }));
  const columns = [{ sessionId: "a", title: "A", focused: true }];
  assert.doesNotThrow(() => check("get_window_layout", {}, { columns, sidebarCollapsed: true }));
  assert.throws(() => check("get_window_layout", {}, { columns, sidebarCollapsed: "yes" }));
  assert.equal(windowResult("get_window_layout", {}, { columns, sidebarCollapsed: true }).content[0].text, JSON.stringify({ columns, sidebarCollapsed: true }));
  assert.equal(windowResult("get_window_layout", {}, { columns }).content[0].text, JSON.stringify({ columns }));
});

test("set_session_title names this chat by default or another session by id", () => {
  assert.deepEqual(validateDesktopInput("set_session_title", { title: " T " }), { title: "T" });
  assert.deepEqual(validateDesktopInput("set_session_title", { title: "T", session_id: " self " }), { title: "T" });
  assert.deepEqual(validateDesktopInput("set_session_title", { title: "T", session_id: " s-2 " }), { title: "T", session_id: "s-2" });
  for (const session_id of ["", "  ", "a\"b", "x".repeat(201), 7]) assert.throws(() => validateDesktopInput("set_session_title", { title: "T", session_id }), /session_id must be a session id/);
  assert.deepEqual(validateDesktopInput("set_session_title", { title: "T", session_id: "x".repeat(200) }), { title: "T", session_id: "x".repeat(200) });
});
