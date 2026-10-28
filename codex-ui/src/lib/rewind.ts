// Rewinding the code (cc43287c9 x_e / Yye "代码与对话" / "仅代码"): Codex keeps no file checkpoints,
// so the patches the session applied (completed fileChange items) are undone newest first. As in
// Claude, what shell commands changed stays, and a file whose content no longer matches is skipped,
// left as it is.

import type { FileUpdateChange } from "@protocol/v2/FileUpdateChange";
import type { ThreadItem } from "@protocol/v2/ThreadItem";
// .ts extensions so the Node test runner can load this module directly.
import { filesStats, turnFiles } from "./diff.ts";
import { joinPath, normalizePath } from "./format.ts";

/** What the rewind dialog shows: the files the turns from here changed, and their lines. */
export interface RewindPreview {
  files: string[];
  insertions: number;
  deletions: number;
}

export function rewindPreview(turns: { diff?: string; items: ThreadItem[] }[], cwd: string): RewindPreview | null {
  const files = new Set<string>();
  let insertions = 0;
  let deletions = 0;
  for (const turn of turns) {
    const changed = turnFiles(turn, cwd);
    for (const file of changed) files.add(file.movePath ?? file.path);
    const stats = filesStats(changed);
    insertions += stats.added;
    deletions += stats.removed;
  }
  return files.size ? { files: [...files], insertions, deletions } : null;
}

/** The patches to undo, oldest first, with absolute paths. */
export function appliedChanges(turns: { items: ThreadItem[] }[], cwd: string): FileUpdateChange[] {
  const absolute = (path: string) => (/^(?:[a-z]:[\\/]|[\\/])/i.test(path) ? path : joinPath(cwd, path));
  return turns.flatMap((turn) =>
    turn.items.flatMap((item) =>
      item.type === "fileChange" && item.status === "completed"
        ? item.changes.map((change) => ({
            ...change,
            path: absolute(change.path),
            kind: change.kind.type === "update" && change.kind.move_path ? { ...change.kind, move_path: absolute(change.kind.move_path) } : change.kind,
          }))
        : [],
    ),
  );
}

interface Hunk {
  newStart: number;
  old: string[];
  new: string[];
}

function hunks(diff: string): Hunk[] {
  const out: Hunk[] = [];
  for (const line of diff.split("\n")) {
    const head = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (head) out.push({ newStart: Number(head[1]), old: [], new: [] });
    else if (!out.length) continue;
    else if (line.startsWith("+")) out[out.length - 1].new.push(line.slice(1));
    else if (line.startsWith("-")) out[out.length - 1].old.push(line.slice(1));
    else if (line.startsWith(" ")) {
      out[out.length - 1].old.push(line.slice(1));
      out[out.length - 1].new.push(line.slice(1));
    }
  }
  return out;
}

const split = (text: string) => (text ? text.replace(/\r?\n$/, "").split(/\r?\n/) : []);
const same = (a: string, b: string) => split(a).join("\n") === split(b).join("\n");

/** `diff` undone on `text`, hunks found nearest their line (patch's fuzz-free offset search); null when one is not there. */
export function unapply(text: string, diff: string): string | null {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = split(text);
  for (const hunk of hunks(diff).reverse()) {
    // An empty new side (lines the patch only removed) goes after its start line.
    const hint = hunk.new.length ? hunk.newStart - 1 : hunk.newStart;
    const at = (start: number) => start >= 0 && start + hunk.new.length <= lines.length && hunk.new.every((line, i) => lines[start + i] === line);
    let found = -1;
    for (let offset = 0; offset <= lines.length && found < 0; offset += 1) {
      if (at(hint - offset)) found = hint - offset;
      else if (at(hint + offset)) found = hint + offset;
    }
    if (found < 0) return null;
    lines.splice(found, hunk.new.length, ...hunk.old);
  }
  return lines.length ? lines.join(eol) + (text === "" || /\n$/.test(text) ? eol : "") : "";
}

/** A file's state while undoing: its content, or null when absent. */
export type Contents = Map<string, string | null>;

export interface Restore {
  /** Final content per touched file (null: remove it), only where it differs from now. */
  writes: { path: string; content: string | null }[];
  skipped: string[];
}

/**
 * Undo `changes` (oldest first) on `now` (every path they touch, as read). A file any step cannot
 * undo cleanly is skipped as a whole and keeps its current content.
 */
export function undoChanges(changes: FileUpdateChange[], now: Contents): Restore {
  const key = (path: string) => normalizePath(path);
  const state = new Map<string, string | null>();
  const names = new Map<string, string>();
  for (const [path, content] of now) {
    state.set(key(path), content);
    names.set(key(path), path);
  }
  const skipped = new Set<string>();
  for (const change of [...changes].reverse()) {
    const from = key(change.path);
    const to = change.kind.type === "update" && change.kind.move_path ? key(change.kind.move_path) : from;
    if (skipped.has(from) || skipped.has(to)) {
      skipped.add(from).add(to);
      continue;
    }
    const current = state.get(to) ?? null;
    let undone: string | null | undefined;
    if (change.kind.type === "add") undone = current !== null && same(current, change.diff) ? null : undefined;
    else if (change.kind.type === "delete") undone = current === null ? change.diff : undefined;
    else undone = current === null || (to !== from && (state.get(from) ?? null) !== null) ? undefined : (unapply(current, change.diff) ?? undefined);
    if (undone === undefined) {
      skipped.add(from).add(to);
      continue;
    }
    if (to !== from) state.set(to, null);
    state.set(from, undone);
  }
  const writes: Restore["writes"] = [];
  for (const [k, content] of state)
    if (!skipped.has(k) && content !== (now.get(names.get(k) ?? "") ?? null)) writes.push({ path: names.get(k) ?? k, content });
  return { writes, skipped: [...skipped].map((k) => names.get(k) ?? k) };
}

/** Every path `changes` touch, to read before undoing them. */
export function touchedPaths(changes: FileUpdateChange[]): string[] {
  const paths = new Map<string, string>();
  for (const change of changes) {
    paths.set(normalizePath(change.path), change.path);
    if (change.kind.type === "update" && change.kind.move_path) paths.set(normalizePath(change.kind.move_path), change.kind.move_path);
  }
  return [...paths.values()];
}
