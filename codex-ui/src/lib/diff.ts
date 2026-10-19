// Unified diff parsing shared by the transcript file cards, the diff panel and the
// session rail's changes card, and the files the rail's 输出 lists.

import type { FileUpdateChange } from "@protocol/v2/FileUpdateChange";
import type { ThreadItem } from "@protocol/v2/ThreadItem";
// .ts extension so the Node test runner can load this module directly.
import { diffStats, relativePath } from "./format.ts";

export interface DiffRow {
  /** gap: the 4px between two hunks (hunkSeparators "simple": no @@ text, none before the first). */
  kind: "add" | "del" | "ctx" | "gap";
  oldNo?: number;
  newNo?: number;
  text: string;
}

/** A whole file's lines; an empty file has none. */
export function fileLines(content: string): string[] {
  return content ? content.replace(/\n$/, "").split("\n") : [];
}

/**
 * A diff's rows: its hunks', or with `whole` every line of the added or deleted file it carries
 * as is. The diff's source decides which (see FileDiff.whole), never its text: a .patch file's
 * content has @@ lines too.
 */
export function parseDiff(diff: string, kind: "add" | "delete" | "update", whole = false): DiffRow[] {
  if (whole)
    return fileLines(diff).map((text, i) =>
      kind === "delete" ? { kind: "del", oldNo: i + 1, text } : { kind: "add", newNo: i + 1, text },
    );
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  // File headers come before the first hunk or after a `diff ` line; inside a hunk, `---` and
  // `+++` are a removed `--…` line and an added `++…` one.
  let inHunk = false;
  for (const line of diff.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hunk) {
      inHunk = true;
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      if (rows.length) rows.push({ kind: "gap", text: "" });
    } else if (line.startsWith("diff ")) {
      inHunk = false;
    } else if (!inHunk) {
      continue;
    } else if (line.startsWith("+")) {
      rows.push({ kind: "add", newNo: newNo++, text: line.slice(1) });
    } else if (line.startsWith("-")) {
      rows.push({ kind: "del", oldNo: oldNo++, text: line.slice(1) });
    } else if (line.startsWith(" ")) {
      rows.push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
    }
    // Anything else: "\ No newline at end of file", the blank tail of a split diff, or the
    // "Moved to: <path>" line Codex ends a move's diff with (item_builders.rs format_file_change_diff).
  }
  return rows;
}

export interface FileDiff {
  path: string;
  kind: "add" | "delete" | "update";
  diff: string;
  /**
   * `diff` is the added or deleted file as is: a history turn's one file-change item add or
   * delete (item_builders.rs format_file_change_diff). Otherwise, as in every turn diff section,
   * it is hunks.
   */
  whole?: boolean;
  /**
   * git wrote no hunks for it, only that it differs or a `GIT binary patch` (c44d00c7f Er), so it
   * has no lines to show or count.
   */
  binary?: boolean;
  /** git's `old mode` / `new mode` lines set (true) or cleared (false) the executable bit (c219730b0 Bt). */
  executable?: boolean;
  /** Where the file moved to; `path` is where it was. */
  movePath?: string | null;
}

const EXECUTABLE: Record<string, boolean> = { "100644 100755": true, "100755 100644": false };
/** The bytes C quoting spells as a letter (quote.c cq_lookup); `\"` and `\\` are the character itself. */
const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };

/**
 * A path as git writes it: C-quoted (quote.c quote_c_style) when it holds a control character, `"`
 * or `\`, or, under core.quotePath (on by default), any non-ASCII character, whose UTF-8 bytes the
 * quotes spell in octal.
 */
function gitPath(text: string): string {
  if (!/^"(?:[^"\\]|\\.)*"$/.test(text)) return text;
  const bytes: number[] = [];
  for (const [, octal, escape, plain] of text.slice(1, -1).matchAll(/\\([0-7]{3})|\\(.)|([^\\]+)/g))
    bytes.push(...(octal ? [parseInt(octal, 8)] : escape ? [ESCAPES[escape] ?? escape.charCodeAt(0)] : new TextEncoder().encode(plain)));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Split a multi-file `git diff` into per-file sections. */
export function splitUnifiedDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let oldMode = "";
  for (const line of diff.split("\n")) {
    // git quotes either path on its own (gitPath); Codex's turn diff writes both as they are.
    const header = /^diff --git ("a\/(?:[^"\\]|\\.)*"|a\/.+?) ("b\/(?:[^"\\]|\\.)*"|b\/.+)$/.exec(line);
    if (header) {
      // "a/P b/P" for a file that stays (P may hold " b/"). A move's two ends are named here, and
      // by git exactly in its rename lines too; Codex's turn diff has none (turn_diff_tracker.rs).
      const same = line.slice(13, 13 + (line.length - 16) / 2);
      const [from, to] = line === `diff --git a/${same} b/${same}` ? [same, same] : [gitPath(header[1]).slice(2), gitPath(header[2]).slice(2)];
      current = { path: from, kind: "update", diff: "", movePath: from === to ? null : to };
      oldMode = "";
      files.push(current);
      continue;
    }
    // A header this cannot read (prefixes other than a/ and b/): its lines belong to no file.
    if (line.startsWith("diff ")) current = null;
    if (!current) continue;
    if (line.startsWith("new file mode")) current.kind = "add";
    else if (line.startsWith("deleted file mode")) current.kind = "delete";
    else current.diff += `${line}\n`;
    // Hunk lines start with a sign, a space or a backslash, so these are always headers.
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) current.binary = true;
    else if (line.startsWith("rename from ")) current.path = gitPath(line.slice(12));
    else if (line.startsWith("rename to ")) current.movePath = gitPath(line.slice(10));
    else if (line.startsWith("copy to ")) {
      // A copy (diff.renames=copies) is a new file; what it copied stays.
      current.path = gitPath(line.slice(8));
      current.movePath = null;
      current.kind = "add";
    } else if (line.startsWith("old mode ")) oldMode = line.slice(9);
    else if (line.startsWith("new mode ")) current.executable = EXECUTABLE[`${oldMode} ${line.slice(9)}`];
  }
  return files;
}

/** A change's diff as hunks: an add or a delete carries the whole file instead (an empty one, none). */
function asHunks({ kind, diff }: FileUpdateChange): string {
  if (kind.type === "update") return diff.endsWith("\n") ? diff : `${diff}\n`;
  const lines = fileLines(diff);
  if (!lines.length) return "";
  const [sign, range] = kind.type === "add" ? ["+", `-0,0 +1,${lines.length}`] : ["-", `-1,${lines.length} +0,0`];
  return `@@ ${range} @@\n${lines.map((line) => sign + line).join("\n")}\n`;
}

/**
 * A turn's changed files: its turn diff while live, or, for history (which carries no
 * turn diff), the completed file-change items, one entry per file as Claude sums a turn's
 * edits (c96d752d0 w2e): keyed by where the file ends up, added if its first change adds it,
 * deleted if its last change deletes it, with every change's hunks in order.
 */
export function turnFiles(turn: { diff?: string; items: ThreadItem[] }, cwd: string): FileDiff[] {
  if (turn.diff) return splitUnifiedDiff(turn.diff);
  const files = new Map<string, { path: string; changes: FileUpdateChange[] }>();
  for (const item of turn.items) {
    if (item.type !== "fileChange" || item.status !== "completed") continue;
    for (const change of item.changes) {
      const path = relativePath(change.path, cwd);
      const key = change.kind.type === "update" && change.kind.move_path ? relativePath(change.kind.move_path, cwd) : path;
      const file = files.get(key);
      if (file) file.changes.push(change);
      else files.set(key, { path, changes: [change] });
    }
  }
  return [...files].map(([key, { path, changes }]) => {
    const first = changes[0].kind.type;
    const last = changes[changes.length - 1].kind.type;
    return {
      path,
      kind: last === "delete" ? "delete" : first === "add" ? "add" : "update",
      diff: changes.length === 1 ? changes[0].diff : changes.map(asHunks).join(""),
      whole: changes.length === 1 && first !== "update",
      movePath: key === path ? null : key,
    };
  });
}

/** What 输出 keeps even inside the checkout: documents and media (c73f45bc3 kv). */
const OUTPUT_TYPES = new Set("md markdown txt rtf pdf doc docx xls xlsx ppt pptx csv tsv html htm png jpg jpeg gif webp mp4 mov webm mp3 wav zip".split(" "));
/** The system's temp folders (shared-130 jR), on a path with forward slashes. */
const TEMP = /^(?:\/private)?(?:\/tmp|\/var\/tmp|\/var\/folders\/[^/]+\/[^/]+\/T)\/|^[a-z]:\/users\/[^/]+\/appdata\/local\/temp\//i;

/**
 * The session rail's 输出 (c73f45bc3 Rv): the files a session made, newest first, at most 50.
 * Images Codex generated always count (as files Claude sends do); files it created count as
 * Claude's Write results do, unless they sit in a temp folder outside the working folder, are
 * Codex's own (.codex/, AGENTS.md, where Claude leaves out .claude/ and CLAUDE.md), or are in the
 * checkout and neither a document nor media.
 */
export function outputFiles(turns: { items: ThreadItem[] }[], cwd: string, checkout: boolean): string[] {
  const norm = (path: string) => {
    const p = path.replace(/\\/g, "/");
    return /^[A-Za-z]:\//.test(p) ? p.toLowerCase() : p;
  };
  const root = norm(cwd).replace(/\/?$/, "/");
  const kept = (path: string) => {
    const p = norm(path);
    const inside = p.startsWith(root);
    const name = p.slice(p.lastIndexOf("/") + 1).toLowerCase();
    if ((TEMP.test(p) && !inside) || /(?:^|\/)\.codex\//.test(p) || name === "agents.md") return false;
    return !checkout || !inside || OUTPUT_TYPES.has(name.slice(name.lastIndexOf(".") + 1));
  };
  const found = new Set<string>();
  for (const turn of turns)
    for (const item of turn.items) {
      const made =
        item.type === "imageGeneration"
          ? item.savedPath
            ? [item.savedPath]
            : []
          : item.type === "fileChange" && item.status === "completed"
            ? item.changes.filter((change) => change.kind.type === "add" && kept(change.path)).map((change) => change.path)
            : [];
      for (const path of made) {
        found.delete(path);
        found.add(path);
      }
    }
  return [...found].reverse().slice(0, 50);
}

/**
 * Lines added and removed across files: a whole file's every line, otherwise the hunks' (none
 * for a pure move or an empty file).
 */
export function filesStats(files: FileDiff[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const file of files) {
    if (!file.whole) {
      const stats = diffStats(file.diff);
      added += stats.added;
      removed += stats.removed;
    } else if (file.kind === "delete") removed += fileLines(file.diff).length;
    else added += fileLines(file.diff).length;
  }
  return { added, removed };
}
