// Unified diff parsing shared by the transcript file cards, the diff panel and the
// session rail's changes card, and the files the rail's 输出 lists.

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

export function parseDiff(diff: string, kind: "add" | "delete" | "update"): DiffRow[] {
  const lines = diff.replace(/\n$/, "").split("\n");
  if (!diff.includes("@@")) {
    // Added/deleted files arrive as raw content rather than hunks.
    return lines.map((text, i) =>
      kind === "delete" ? { kind: "del", oldNo: i + 1, text } : { kind: "add", newNo: i + 1, text },
    );
  }
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      if (rows.length) rows.push({ kind: "gap", text: "" });
    } else if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) {
      continue;
    } else if (line.startsWith("+")) {
      rows.push({ kind: "add", newNo: newNo++, text: line.slice(1) });
    } else if (line.startsWith("-")) {
      rows.push({ kind: "del", oldNo: oldNo++, text: line.slice(1) });
    } else if (line.startsWith("\\") || line === "") {
      // "\ No newline at end of file", or the blank tail of a split diff (context lines start with " ").
      continue;
    } else {
      rows.push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
    }
  }
  return rows;
}

export interface FileDiff {
  path: string;
  kind: "add" | "delete" | "update";
  diff: string;
  movePath?: string | null;
}

/** Split a multi-file `git diff` into per-file sections. */
export function splitUnifiedDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      current = { path: header[2], kind: "update", diff: "" };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("new file mode")) current.kind = "add";
    else if (line.startsWith("deleted file mode")) current.kind = "delete";
    else current.diff += `${line}\n`;
  }
  return files;
}

/**
 * A turn's changed files: its turn diff while live, or, for history (which carries no
 * turn diff), the completed file-change items.
 */
export function turnFiles(turn: { diff?: string; items: ThreadItem[] }, cwd: string): FileDiff[] {
  if (turn.diff) return splitUnifiedDiff(turn.diff);
  return turn.items.flatMap((item) =>
    item.type === "fileChange" && item.status === "completed"
      ? item.changes.map((change) => ({
          path: relativePath(change.path, cwd),
          kind: change.kind.type,
          diff: change.diff,
          movePath: change.kind.type === "update" && change.kind.move_path ? relativePath(change.kind.move_path, cwd) : null,
        }))
      : [],
  );
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

/** Lines added and removed across files; whole-file adds and deletes count every line. */
export function filesStats(files: FileDiff[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const file of files) {
    if (file.diff.includes("@@")) {
      const stats = diffStats(file.diff);
      added += stats.added;
      removed += stats.removed;
    } else {
      const lines = file.diff.replace(/\n$/, "").split("\n").length;
      if (file.kind === "delete") removed += lines;
      else added += lines;
    }
  }
  return { added, removed };
}
