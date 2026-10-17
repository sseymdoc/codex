// Unified diff parsing shared by the transcript file cards and the diff panel.

export interface DiffRow {
  kind: "add" | "del" | "ctx" | "hunk";
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
      rows.push({ kind: "hunk", text: line });
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
