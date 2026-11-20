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
    const answer: Promise<Record<string, number | null> | null> = fetch(`/api/files/sizes?${query}`)
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    for (const path of asked) {
      // A bridge that could not answer says nothing about the file: ask again next time.
      const size: Promise<number | null> = answer.then((found) => {
        if (!found && sizes.get(path) === size) sizes.delete(path);
        return found?.[path] ?? null;
      });
      sizes.set(path, size);
    }
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

/** The editors installed (VS Code, Cursor, Zed, Windsurf), asked each time: the server caches its probe for a minute. */
export const installedEditors = (): Promise<Editor[]> =>
  fetch("/api/files/editors")
    .then((response) => (response.ok ? (response.json() as Promise<Editor[]>) : []))
    .catch(() => []);

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
    const rest = /^(\d+):(\d+):(.*?)\r?$/.exec(raw.slice(nul + 1));
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

type SearchOptions = { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean };

/** The rg command for a content search: the query always after -e, so one starting with - is searched, not read as a flag. */
export const searchCommand = (query: string, options: SearchOptions = {}) =>
  ["rg", "--null", "-n", "--column", "--no-heading", "--color=never", "-m", "6", "--max-columns", "250", "--max-filesize", "1M", ...(options.caseSensitive ? ["-s"] : ["-i"]), ...(options.wholeWord ? ["-w"] : []), ...(options.regex ? [] : ["-F"]), "-e", query, "."];

/** ? in the file tree's filter: the session folder's contents searched with rg, read-only and bounded. */
export async function searchFiles(cwd: string, query: string, options: SearchOptions = {}): Promise<{ files: ContentHits[]; truncated: boolean }> {
  // No JS pre-check of the pattern: rg's syntax is not JavaScript's ((?i), say); its exit 2 says it is bad.
  const { call } = await import("./codex");
  const result = (await call("command/exec", {
    command: searchCommand(query, options),
    cwd,
    timeoutMs: 10_000,
    outputBytesCap: 1 << 20,
    sandboxPolicy: { type: "readOnly", networkAccess: false },
  })) as { exitCode: number; stdout: string; stderr: string };
  // rg exits 1 for no match, 2 for an error (a bad pattern, a missing rg reads as 127); a file it
  // could not read also makes 2, so what it did find still counts. Only its parse error is the pattern's.
  if (result.exitCode === 2 && !result.stdout && options.regex && /regex parse error|error compiling pattern|exceeds size limit/i.test(result.stderr)) throw new Error("无效的正则表达式");
  if (result.exitCode !== 0 && result.exitCode !== 1 && !(result.exitCode === 2 && result.stdout)) throw new Error(result.stderr.trim().split("\n")[0] || "无法搜索文件内容");
  return groupMatches(result.stdout);
}
