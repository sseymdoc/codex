// Run with `pnpm test` (Node strips the TypeScript types of environments.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { ENVIRONMENT_KEY, envError, environmentOf, formatEnv, localName, numberedName, parseEnv, parseEnvKeeping, sortBranches, sshStateLabel, withEnvironment } from "./environments.ts";

test("a project without the key is a plain local environment; a bad value reads as one too", () => {
  const plain = { version: 1, kind: "local", settings: {}, folderSettings: {}, env: {} };
  assert.deepEqual(environmentOf({ metadata: {} }), plain);
  assert.deepEqual(environmentOf({ metadata: { [ENVIRONMENT_KEY]: "{" } }), plain);
  assert.deepEqual(environmentOf(undefined), plain);
  const stored = { kind: "local", settings: { worktree: true, branch: "dev", extra: 1 }, folderSettings: { "D:\\b": { worktree: "yes", branch: "x" } }, env: { A: "1", B: 2 } };
  assert.deepEqual(environmentOf({ metadata: { [ENVIRONMENT_KEY]: JSON.stringify(stored) } }), {
    version: 1,
    kind: "local",
    settings: { worktree: true, branch: "dev" },
    folderSettings: { "D:\\b": { branch: "x" } },
    env: { A: "1" },
  });
});

test("改代码前再建工作树 only means something with a worktree", () => {
  const lazy = (settings) => environmentOf({ metadata: { [ENVIRONMENT_KEY]: JSON.stringify({ kind: "local", settings, folderSettings: {}, env: {} }) } }).settings;
  assert.deepEqual(lazy({ worktree: true, lazy: true }), { worktree: true, lazy: true });
  assert.deepEqual(lazy({ worktree: false, lazy: true }), { worktree: false });
  assert.deepEqual(lazy({ worktree: true, lazy: "yes" }), { worktree: true });
});

test("writing the environment keeps the metadata other clients wrote", () => {
  const config = { version: 1, kind: "local", settings: {}, folderSettings: {}, env: { A: "1" } };
  const metadata = withEnvironment({ "appearance.color": "\"blue\"", [ENVIRONMENT_KEY]: "old" }, config);
  assert.equal(metadata["appearance.color"], "\"blue\"");
  assert.deepEqual(environmentOf({ metadata }), config);
});

test(".env text reads like Claude's: export, quotes, comments, escapes", () => {
  assert.deepEqual({ ...parseEnv("A=1\nexport B = two # note\nC='x # y'\nD=\"line\\nnext\"\n# skip\nE:  colon") }, {
    A: "1",
    B: "two",
    C: "x # y",
    D: "line\nnext",
    E: "colon",
  });
  assert.deepEqual({ ...parseEnv("A=1\r\nB=2") }, { A: "1", B: "2" });
});

test("errors name the first bad line or key; a bare key being typed is fine while typing", () => {
  assert.equal(envError(""), undefined);
  assert.equal(envError("A=1\n# c\nB=2"), undefined);
  assert.equal(envError("A=1\nnot a pair"), "无法解析“not a pair”。请使用 KEY=value 格式。");
  assert.equal(envError("A=1\nB"), "无法解析“B”。请使用 KEY=value 格式。");
  assert.equal(envError("A=1\nB", { allowTrailingBareKey: true }), undefined);
  assert.equal(envError("1A=x"), "无效的键“1A”。只能使用字母、数字和下划线。");
  assert.equal(envError("a.b=x"), "无效的键“a.b”。只能使用字母、数字和下划线。");
  assert.equal(envError("path=/bin"), "“path”由 Codex 管理，无法覆盖。");
  assert.equal(envError("CODEX_SANDBOX=none"), "“CODEX_SANDBOX”由 Codex 管理，无法覆盖。");
});

test("values round-trip through the text, quoted only when they must be", () => {
  const vars = { A: "plain", B: "has space ", C: "a#b", D: "it's", E: 'say "hi"', F: "$HOME", G: "two\nlines", H: "both ' and \"", I: "" };
  const text = formatEnv(vars);
  assert.equal(text.split("\n")[0], "A=plain");
  assert.deepEqual({ ...parseEnv(text) }, vars);
  assert.deepEqual(parseEnvKeeping(text, vars), vars);
});

test("names: numbered, or the nearest telling parent folder for a local folder", () => {
  assert.equal(numberedName("app", []), "app");
  assert.equal(numberedName("app", ["App", "app 2"]), "app 3");
  assert.equal(localName("D:\\work\\client\\app", []), "app");
  assert.equal(localName("D:\\work\\client\\app", ["APP"]), "app (client)");
  assert.equal(localName("D:\\src\\repos\\app", ["app"]), "app 2");
  assert.equal(localName("/home/me/code/app", ["app", "app (me)"]), "app 2");
});

test("branches: main, master, then by name; a picked branch missing from the list leads", () => {
  assert.deepEqual(sortBranches(["feature", "master", "dev", "main"]), ["main", "master", "dev", "feature"]);
  assert.deepEqual(sortBranches(["main"], "gone"), ["gone", "main"]);
});

test("an SSH host reads as Claude's row: nothing when ready, connecting only while a turn runs", () => {
  assert.equal(sshStateLabel("ready", true), null);
  assert.deepEqual(sshStateLabel("disconnected", false), { label: "已断开连接", danger: true });
  assert.deepEqual(sshStateLabel("pending", true), { label: "正在连接" });
  assert.deepEqual(sshStateLabel("pending", false), { label: "未连接" });
  assert.deepEqual(sshStateLabel("unknown", true), { label: "未连接" });
  assert.deepEqual(sshStateLabel(undefined, false), { label: "未连接" });
});
