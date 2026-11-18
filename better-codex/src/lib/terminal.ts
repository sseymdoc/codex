// What the terminal tools read out of a tab's xterm buffer, and the #terminal/<tab_id> links that
// open a tab (components/Terminal.tsx). Pure, so node can test it.

import { redactSecrets } from "./redact.ts";

/** One buffer row: its text, and whether it continues the row above (a wrapped long line). */
export interface TermRow { text: string; wrapped: boolean }

const LINE_MAX = 2000;
const TEXT_MAX = 64 * 1024;

/**
 * The last `count` lines as plain text: wrapped rows joined back into their line, blank rows under
 * the last output dropped, each line and the whole cut to size (the newest lines kept), secrets
 * redacted. xterm has already interpreted colors, cursor moves and carriage returns.
 */
export function terminalText(rows: readonly TermRow[], count: number): { text: string; lines: number; truncated: boolean } {
  const all: string[] = [];
  for (const row of rows) {
    if (row.wrapped && all.length) all[all.length - 1] += row.text;
    else all.push(row.text);
  }
  while (all.length && !all[all.length - 1].trim()) all.pop();
  let truncated = all.length > count;
  const kept = all.slice(-count).map((line) => {
    const trimmed = line.trimEnd();
    if (trimmed.length <= LINE_MAX) return trimmed;
    truncated = true;
    return `${trimmed.slice(0, LINE_MAX)}…`;
  });
  let size = 0, from = kept.length;
  while (from > 0 && size + kept[from - 1].length + 1 <= TEXT_MAX) size += kept[--from].length + 1;
  if (from > 0) truncated = true;
  const lines = kept.slice(from);
  return { text: redactSecrets(lines.join("\n")), lines: lines.length, truncated };
}

/** The tab id a `#terminal/<tab_id>` link names, or null. */
export function terminalLinkId(href: string): string | null {
  return /^#terminal\/([0-9a-f]{8})$/.exec(href.trim())?.[1] ?? null;
}

/**
 * A dropped path as the shell should receive it (c9bd7af9c YS): POSIX single quotes ('\'' for a
 * quote inside), PowerShell single quotes ('' for a quote inside); null for a path with control
 * characters, which no quoting makes safe to type.
 */
export function quotePath(path: string, powershell: boolean): string | null {
  // eslint-disable-next-line no-control-regex
  if (!path || /[\u0000-\u001f\u007f\u0080-\u009f\u2028\u2029]/.test(path)) return null;
  if (powershell) return `'${path.replace(/['\u2018\u2019\u201a\u201b]/g, "$&$&")}'`;
  // A backslash goes outside the quotes too: fish reads \' inside single quotes as a quote.
  return /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/['\\]/g, (c) => `'\\${c}'`)}'`;
}

/** /etc/shells: the absolute paths listed, comments and repeats dropped, in file order. */
export function parseShells(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const path = line.replace(/#.*/, "").trim();
    if (path.startsWith("/") && !/\s/.test(path) && !out.includes(path)) out.push(path);
  }
  return out;
}

/** `ps -o tpgid=,pgid= -p <pid>`: a command runs when the terminal's foreground group is not the shell's own. */
export function commandRunning(psOutput: string): boolean {
  const [tpgid, pgid] = psOutput.trim().split(/\s+/).map(Number);
  return Number.isInteger(tpgid) && Number.isInteger(pgid) && tpgid > 0 && tpgid !== pgid;
}
