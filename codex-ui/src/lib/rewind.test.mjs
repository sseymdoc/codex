// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of rewind.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { appliedChanges, rewindPreview, touchedPaths, undoChanges, unapply } from "./rewind.ts";

const update = (path, diff, move_path = null) => ({ path, kind: { type: "update", move_path }, diff });
const add = (path, diff) => ({ path, kind: { type: "add" }, diff });
const del = (path, diff) => ({ path, kind: { type: "delete" }, diff });
const turn = (...changes) => ({ items: [{ type: "fileChange", id: "c", status: "completed", changes }] });

test("unapply undoes hunks, finds them at an offset, keeps CRLF and refuses a mismatch", () => {
  const diff = "@@ -2,2 +2,2 @@\n b\n-c\n+C\n";
  assert.equal(unapply("a\nb\nC\nd\n", diff), "a\nb\nc\nd\n");
  // Two lines were added above since: found 2 lines down.
  assert.equal(unapply("x\ny\na\nb\nC\nd\n", diff), "x\ny\na\nb\nc\nd\n");
  assert.equal(unapply("a\r\nb\r\nC\r\n", diff), "a\r\nb\r\nc\r\n");
  assert.equal(unapply("a\nb\nZ\nd\n", diff), null);
  // A hunk that only removed lines puts them back after its start line.
  assert.equal(unapply("a\nd\n", "@@ -1,3 +1,1 @@\n a\n-b\n-c\n"), "a\nb\nc\nd\n");
  // Several hunks, undone bottom up.
  assert.equal(unapply("1\nTWO\n3\n4\nFIVE\n", "@@ -1,2 +1,2 @@\n 1\n-2\n+TWO\n@@ -4,2 +4,2 @@\n 4\n-5\n+FIVE\n"), "1\n2\n3\n4\n5\n");
});

test("undoChanges walks back adds, deletes, edits and moves, newest first", () => {
  const changes = [
    add("/w/new.txt", "hello\n"),
    update("/w/a.txt", "@@ -1 +1 @@\n-one\n+ONE\n"),
    update("/w/a.txt", "@@ -1 +1 @@\n-ONE\n+Uno\n"),
    del("/w/gone.txt", "bye\n"),
    update("/w/old.txt", "@@ -1 +1 @@\n-x\n+y\n", "/w/moved.txt"),
  ];
  const now = new Map([
    ["/w/new.txt", "hello\n"],
    ["/w/a.txt", "Uno\n"],
    ["/w/gone.txt", null],
    ["/w/old.txt", null],
    ["/w/moved.txt", "y\n"],
  ]);
  assert.deepEqual(touchedPaths(changes).sort(), [...now.keys()].sort());
  const { writes, skipped } = undoChanges(changes, now);
  assert.deepEqual(skipped, []);
  assert.deepEqual(Object.fromEntries(writes.map((w) => [w.path, w.content])), {
    "/w/new.txt": null,
    "/w/a.txt": "one\n",
    "/w/gone.txt": "bye\n",
    "/w/old.txt": "x\n",
    "/w/moved.txt": null,
  });
});

test("a file edited since is skipped whole and left as it is", () => {
  const changes = [update("/w/a.txt", "@@ -1 +1 @@\n-one\n+two\n"), update("/w/a.txt", "@@ -1 +1 @@\n-two\n+three\n"), add("/w/b.txt", "b\n")];
  const { writes, skipped } = undoChanges(changes, new Map([["/w/a.txt", "changed by hand\n"], ["/w/b.txt", "b edited\n"]]));
  assert.deepEqual(writes, []);
  assert.deepEqual(skipped.sort(), ["/w/a.txt", "/w/b.txt"]);
});

test("appliedChanges keeps completed patches with absolute paths; rewindPreview counts the turns' files", () => {
  const turns = [
    turn(update("src/a.ts", "@@ -1 +1 @@\n-a\n+b\n")),
    { items: [{ type: "fileChange", id: "d", status: "declined", changes: [add("/w/x", "x\n")] }] },
    turn(add("/w/n.ts", "1\n2\n")),
  ];
  assert.deepEqual(
    appliedChanges(turns, "/w").map((c) => c.path),
    ["/w/src/a.ts", "/w/n.ts"],
  );
  assert.deepEqual(rewindPreview(turns, "/w"), { files: ["src/a.ts", "n.ts"], insertions: 3, deletions: 1 });
  assert.equal(rewindPreview([{ items: [] }], "/w"), null);
});
