// This machine's files through the bridge (server/files.mjs): what Claude's desktop host tells
// the page about a sent file and does with it, which the app-server has no RPC for.

/** shared-3 ZC: decimal units, narrow, a decimal place past bytes ("12.3 kB"). */
export function fileSize(bytes: number): string {
  const units = ["byte", "kilobyte", "megabyte", "gigabyte"];
  const at = bytes < 1000 ? 0 : Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1000)));
  return new Intl.NumberFormat("zh-Hans", { style: "unit", unit: units[at], unitDisplay: "narrow", maximumFractionDigits: at === 0 ? 0 : 1 }).format(bytes / 1000 ** at);
}

const sizes = new Map<string, Promise<number | null>>();

/** Each file's size in bytes, null when it is gone; asked once per path. */
export function fileSizes(paths: string[]): Promise<(number | null)[]> {
  const asked = paths.filter((path) => !sizes.has(path));
  if (asked.length) {
    const query = asked.map((path) => `path=${encodeURIComponent(path)}`).join("&");
    const answer: Promise<Record<string, number | null>> = fetch(`/api/files/sizes?${query}`)
      .then((response) => (response.ok ? response.json() : {}))
      .catch(() => ({}));
    for (const path of asked) sizes.set(path, answer.then((found) => found[path] ?? null));
  }
  return Promise.all(paths.map((path) => sizes.get(path)!));
}

/**
 * The files of `paths` that are gone, asked afresh (the session rail's 输出 drops them, c73f45bc3
 * Gx); none when the bridge cannot say.
 */
export async function goneFiles(paths: string[]): Promise<Set<string>> {
  if (!paths.length) return new Set();
  const query = paths.map((path) => `path=${encodeURIComponent(path)}`).join("&");
  const found: Record<string, number | null> | null = await fetch(`/api/files/sizes?${query}`)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  return new Set(found ? paths.filter((path) => path in found && found[path] === null) : []);
}

/** Whether the file is there now (the file menu leaves out opening one that is gone). */
export async function fileExists(path: string): Promise<boolean> {
  sizes.delete(path);
  return (await fileSizes([path]))[0] !== null;
}

/** A sent audio or video file, streamed with ranges so its player can seek. */
export const mediaUrl = (path: string) => `/api/files/media?path=${encodeURIComponent(path)}`;

export interface Editor {
  id: string;
  name: string;
}

let editors: Promise<Editor[]> | undefined;

/** The editors installed (VS Code, Cursor, Zed, Windsurf), asked once. */
export function installedEditors(): Promise<Editor[]> {
  editors ??= fetch("/api/files/editors")
    .then((response) => (response.ok ? (response.json() as Promise<Editor[]>) : []))
    .catch(() => []);
  return editors;
}

const post = (route: string, params: Record<string, string>) =>
  fetch(`/api/files/${route}?${new URLSearchParams(params)}`, { method: "POST" }).then(
    (response) => response.ok,
    () => false,
  );

/** Opens the file in an editor, at its line. */
export const openIn = (path: string, editor: string, line?: number) => post("open", { path, editor, ...(line ? { line: String(line) } : {}) });

/** Opens a file of session folder `root` in the app the system has for it, as far as Claude's gate allows. */
export const openWithDefaultApp = (path: string, root: string) => post("open", { path, editor: "default", root });

/** Shows the file selected in its folder (Explorer, Finder). */
export const revealFile = (path: string) => post("reveal", { path });
/** "Show in Explorer" / "Show in Finder". */
export const REVEAL_LABEL = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "在访达中显示" : "在资源管理器中显示";

export interface ContentMatch { line: number; column: number; text: string }
export interface ContentHits { path: string; matches: ContentMatch[]; more: boolean }

/**
 * rg's `--null -n --column --no-heading` lines grouped by file (Claude 4.4212 c9bd7af9c mD): at
 * most `perFile` lines a file (more past that) and `total` in all (truncated past that).
 */
export function groupMatches(stdout: string, total = 200, perFile = 5): { files: ContentHits[]; truncated: boolean } {
  const files: ContentHits[] = [];
  let count = 0, truncated = false;
  for (const raw of stdout.split("\n")) {
    const nul = raw.indexOf("\0");
    if (nul < 0) continue;
    const path = raw.slice(0, nul).replace(/^\.\//, "");
    const rest = /^(\d+):(\d+):(.*)$/.exec(raw.slice(nul + 1));
    if (!rest) continue;
    let file = files.at(-1);
    if (!file || file.path !== path) files.push((file = { path, matches: [], more: false }));
    if (file.matches.length >= perFile) { file.more = true; continue; }
    if (count >= total) { truncated = true; break; }
    file.matches.push({ line: Number(rest[1]), column: Number(rest[2]), text: rest[3].slice(0, 250) });
    count += 1;
  }
  return { files, truncated };
}

/** ? in the file tree's filter: the session folder's contents searched with rg, read-only and bounded. */
export async function searchFiles(cwd: string, query: string, options: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean } = {}): Promise<{ files: ContentHits[]; truncated: boolean }> {
  if (options.regex) new RegExp(query); // a bad pattern throws here, in the user's words below
  const { call } = await import("./codex");
  const result = (await call("command/exec", {
    command: ["rg", "--null", "-n", "--column", "--no-heading", "--color=never", "-m", "6", "--max-columns", "250", "--max-filesize", "1M", ...(options.caseSensitive ? ["-s"] : ["-i"]), ...(options.wholeWord ? ["-w"] : []), options.regex ? "-e" : "-F", query, "."],
    cwd,
    timeoutMs: 10_000,
    outputBytesCap: 1 << 20,
    sandboxPolicy: { type: "readOnly", networkAccess: false },
  })) as { exitCode: number; stdout: string; stderr: string };
  // rg exits 1 for no match, 2 for an error (a bad pattern, a missing rg reads as 127).
  if (result.exitCode === 2) throw new Error("无效的正则表达式");
  if (result.exitCode !== 0 && result.exitCode !== 1) throw new Error(result.stderr.trim().split("\n")[0] || "无法搜索文件内容");
  return groupMatches(result.stdout);
}
