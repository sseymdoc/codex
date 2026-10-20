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
