import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { byteRange, defaultAppRefusal, editorUrl, handleFiles, localPath } from "./files.mjs";

test("a range is one span of the file, clipped to it", () => {
  assert.equal(byteRange(undefined, 100), null);
  assert.equal(byteRange("bytes=-", 100), null);
  assert.deepEqual(byteRange("bytes=0-", 100), { start: 0, end: 99 });
  assert.deepEqual(byteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(byteRange("bytes=90-500", 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange("bytes=-30", 100), { start: 70, end: 99 });
  assert.equal(byteRange("bytes=100-", 100), false);
  assert.equal(byteRange("bytes=-0", 100), false);
  assert.equal(byteRange("bytes=0-", 0), false);
});

test("an editor link is Claude's, and refused for a path it cannot carry", () => {
  const sep = path.win32.sep;
  assert.equal(editorUrl("vscode", ["D:", "w", "a b.ts"].join(sep), 12), "vscode://file/D%3A/w/a%20b.ts:12");
  assert.equal(editorUrl("cursor", "/home/u/报告.md"), `cursor://file//home/u/${encodeURIComponent("报告.md")}`);
  assert.equal(editorUrl("vscode", "/w/100%.md"), null);
  assert.equal(editorUrl("vscode", "/w/a#b.md"), null);
});

test("only a local absolute path is acted on", () => {
  assert.equal(localPath("relative/a.txt"), null);
  assert.equal(localPath("//server/share/a.txt"), null);
  assert.equal(localPath(""), null);
  assert.equal(localPath(path.resolve("a.txt")), path.resolve("a.txt"));
});

test("sizes and ranged media come from the file", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "codex-ui-files-"));
  const clip = path.join(dir, "clip.mp3");
  writeFileSync(clip, "0123456789");
  const server = createServer((req, res) => {
    if (handleFiles(req, res, new URL(req.url, "http://localhost")) === false) res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/files`;
  const sizes = await (await fetch(`${base}/sizes?path=${encodeURIComponent(clip)}&path=${encodeURIComponent(path.join(dir, "gone.pdf"))}&path=x`)).json();
  assert.deepEqual(sizes, { [clip]: 10, [path.join(dir, "gone.pdf")]: null, x: null });
  const part = await fetch(`${base}/media?path=${encodeURIComponent(clip)}`, { headers: { Range: "bytes=2-5" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-type"), "audio/mpeg");
  assert.equal(part.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await part.text(), "2345");
  assert.equal((await fetch(`${base}/media?path=${encodeURIComponent(path.join(dir, "a.txt"))}`)).status, 404);
  assert.equal((await fetch(`${base}/open?path=${encodeURIComponent(path.join(dir, "gone.pdf"))}&editor=default`, { method: "POST" })).status, 404);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
});

test("the default app opens a plain file in the session folder, as Claude's gate allows", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-ui-open-"));
  const file = (name) => {
    const full = path.join(root, ...name.split("/"));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, "x");
    return full;
  };
  assert.equal(await defaultAppRefusal(file("out/report.pdf"), root), null);
  assert.equal(await defaultAppRefusal(file("out/report.pdf"), path.join(root, "out", "..", "elsewhere")), "not found");
  assert.equal(await defaultAppRefusal(file("other/a.txt"), path.dirname(file("out/b.txt"))), "outside the session folder");
  assert.equal(await defaultAppRefusal(file("setup.EXE"), root), "executable file type");
  assert.equal(await defaultAppRefusal(file("run.ps1"), root), "executable file type");
  assert.equal(await defaultAppRefusal(file(".git/hooks/pre-commit.txt"), root), "executable config");
  assert.equal(await defaultAppRefusal(file(".mcp.json"), root), "executable config");
  assert.equal(await defaultAppRefusal(file(".claude/worktrees/w/notes.md"), root), null);
  assert.equal(await defaultAppRefusal(file("bidi\u202Etxt.pdf"), root), "unsafe characters in path");
});

test("the editor writes only a regular file inside the session folder, and only over the bytes it opened", async (t) => {
  const { createHash } = await import("node:crypto");
  const { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { writeSessionFile } = await import("./files.mjs");
  const base = mkdtempSync(path.join(tmpdir(), "codex-ui-write-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const cwd = path.join(base, "project");
  mkdirSync(cwd);
  const file = path.join(cwd, "a.txt");
  writeFileSync(file, "old\n");
  const secret = path.join(base, "secret.txt");
  writeFileSync(secret, "keep\n");
  symlinkSync(secret, path.join(cwd, "link.txt"));
  const sha = (text) => createHash("sha256").update(text).digest("hex");
  assert.deepEqual(await writeSessionFile(cwd, { path: file, text: "new\n", expected: sha("old\n") }), { conflict: false, sha: sha("new\n") });
  assert.equal(readFileSync(file, "utf8"), "new\n");
  // Changed on disk since it was opened: nothing is written.
  assert.deepEqual(await writeSessionFile(cwd, { path: file, text: "mine\n", expected: sha("old\n") }), { conflict: true });
  assert.equal(readFileSync(file, "utf8"), "new\n");
  // A link out of the folder, a path outside it, a relative path or a bad hash never write.
  await assert.rejects(writeSessionFile(cwd, { path: path.join(cwd, "link.txt"), text: "x", expected: sha("keep\n") }), /工作目录/);
  await assert.rejects(writeSessionFile(cwd, { path: secret, text: "x", expected: sha("keep\n") }), /工作目录/);
  await assert.rejects(writeSessionFile(cwd, { path: "a.txt", text: "x", expected: sha("new\n") }), /无效/);
  await assert.rejects(writeSessionFile(cwd, { path: file, text: "x", expected: "nope" }), /无效/);
  assert.equal(readFileSync(secret, "utf8"), "keep\n");
});
