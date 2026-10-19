// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of landing.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { attentionRows, projectRows, projectSessions, relativeTime, repoSlug, rowLimit } from "./landing.ts";

const session = (id, at, extra = {}) => ({ id, at, blocked: false, working: false, unread: false, projectId: null, ...extra });

test("attention lists blocked sessions before unread ones, newest first, and skips working or dismissed ones", () => {
  const sessions = [
    session("old-unread", 10, { unread: true }),
    session("blocked", 5, { blocked: true }),
    session("new-unread", 20, { unread: true }),
    session("working", 30, { unread: true, working: true }),
    session("dismissed", 40, { blocked: true }),
    session("idle", 50),
  ];
  assert.deepEqual(attentionRows(sessions, { dismissed: 40 }), [
    { id: "blocked", kind: "blocked" },
    { id: "new-unread", kind: "unread" },
    { id: "old-unread", kind: "unread" },
  ]);
  // A dismissed session comes back once it moves again.
  assert.equal(attentionRows([session("dismissed", 41, { blocked: true })], { dismissed: 40 }).length, 1);
});

test("projects in flight: unread, then working, then recent; stale idle projects drop out", () => {
  const now = 1_000_000;
  const projects = [
    { id: "stale", name: "Stale", recencyAt: now - 8 * 86400 },
    { id: "recent", name: "Recent", recencyAt: now - 3600 },
    { id: "busy", name: "Busy", recencyAt: now - 9 * 86400 },
    { id: "unread", name: "Unread", recencyAt: null },
  ];
  const sessions = [session("a", now - 9 * 86400, { projectId: "busy", working: true }), session("b", now - 20 * 86400, { projectId: "unread", unread: true })];
  assert.deepEqual(
    projectRows(projects, sessions, now).map((row) => [row.project.id, row.unread]),
    [
      ["unread", true],
      ["busy", false],
      ["recent", false],
    ],
  );
});

test("a project's sessions: blocked before working, capped, with counts", () => {
  const sessions = [
    session("w1", 30, { projectId: "p", working: true }),
    session("b1", 10, { projectId: "p", blocked: true }),
    session("w2", 40, { projectId: "p", working: true }),
    session("idle", 50, { projectId: "p" }),
    session("other", 60, { projectId: "q", blocked: true }),
  ];
  const { rows, counts } = projectSessions(sessions, "p", 2);
  assert.deepEqual(rows.map((row) => row.id), ["b1", "w2"]);
  assert.deepEqual(counts, { blocked: 1, working: 2 });
});

test("repoSlug reads owner/name from https, ssh and scp remotes", () => {
  assert.equal(repoSlug("https://github.com/openai/codex.git"), "openai/codex");
  assert.equal(repoSlug("git@github.com:openai/codex.git"), "openai/codex");
  assert.equal(repoSlug("ssh://git@github.com/openai/codex"), "openai/codex");
  assert.equal(repoSlug("https://user:token@example.com/group/sub/repo/"), "sub/repo");
  assert.equal(repoSlug("codex"), "codex");
  assert.equal(repoSlug(null), null);
});

test("relativeTime is narrow and relative; rowLimit grows with the window", () => {
  const now = 2_000_000_000_000;
  assert.equal(relativeTime(now / 1000 - 20, now), "现在");
  assert.equal(relativeTime(now / 1000 - 5 * 60, now), "5分钟前");
  assert.equal(relativeTime(now / 1000 - 86400, now), "昨天");
  assert.deepEqual([700, 800, 950, 1200].map(rowLimit), [3, 4, 5, 7]);
});
