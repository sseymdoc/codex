// Environments (Claude's EpitaxyEnvironmentDialog, ca690a791) kept as Codex projects: what the
// dialog stores beyond name and roots lives in one metadata key, beside the desktop app's own.
import type { Project } from "@protocol/v2/Project";
import { basename, parentDir } from "./format.ts";

export type EnvironmentKind = "local" | "ssh" | "cloud";

/** Per folder: start the session in a worktree, and from (or switched to) which branch. */
export interface Checkout {
  worktree?: boolean;
  branch?: string;
  /** The first folder's worktree only once the session is about to change files (enter_worktree), from its HEAD. */
  lazy?: boolean;
}

export interface EnvironmentConfig {
  version: 1;
  kind: EnvironmentKind;
  /** The first folder's checkout. */
  settings: Checkout;
  /** Additional folders' checkouts, by path. */
  folderSettings: Record<string, Checkout>;
  env: Record<string, string>;
  /** An SSH environment's host (an SshConnection id) and its folders, the first the start folder. */
  ssh?: { connectionId: string; folders: string[] };
  /** A cloud environment's Codex Cloud environment, and the branch its tasks start from (else the repository's default). */
  cloud?: { environmentId: string; branch?: string };
}

export const ENVIRONMENT_KEY = "codexUi.environment";

const blank = (): EnvironmentConfig => ({ version: 1, kind: "local", settings: {}, folderSettings: {}, env: {} });

const strings = (value: unknown): Record<string, string> =>
  value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};

const checkout = (value: unknown): Checkout => {
  const { worktree, branch, lazy } = (value && typeof value === "object" ? value : {}) as Checkout;
  return { ...(typeof worktree === "boolean" && { worktree }), ...(typeof branch === "string" && branch && { branch }), ...(worktree === true && lazy === true && { lazy }) };
};

/** The environment a project describes; a project from the desktop app (no key) is a plain local one. */
export function environmentOf(project: Pick<Project, "metadata"> | null | undefined): EnvironmentConfig {
  const raw = project?.metadata?.[ENVIRONMENT_KEY];
  if (!raw) return blank();
  try {
    const value = JSON.parse(raw);
    const ssh = value.ssh && typeof value.ssh.connectionId === "string"
      ? { connectionId: value.ssh.connectionId as string, folders: Array.isArray(value.ssh.folders) ? value.ssh.folders.filter((path: unknown): path is string => typeof path === "string" && path !== "") : [] }
      : undefined;
    const cloud = value.cloud && typeof value.cloud.environmentId === "string"
      ? { environmentId: value.cloud.environmentId as string, ...(typeof value.cloud.branch === "string" && value.cloud.branch && { branch: value.cloud.branch as string }) }
      : undefined;
    return {
      version: 1,
      kind: value.kind === "ssh" || value.kind === "cloud" ? value.kind : "local",
      settings: checkout(value.settings),
      folderSettings: Object.fromEntries(Object.entries(value.folderSettings ?? {}).map(([path, entry]) => [path, checkout(entry)])),
      env: strings(value.env),
      ...(ssh && { ssh }),
      ...(cloud && { cloud }),
    };
  } catch {
    return blank();
  }
}

/** project/update replaces the whole map: keep the keys other clients wrote. */
export function withEnvironment(metadata: Project["metadata"] | null | undefined, config: EnvironmentConfig): Record<string, string> {
  return { ...strings(metadata), [ENVIRONMENT_KEY]: JSON.stringify(config) };
}

// ---------------------------------------------------------------------------
// .env text (c44400d5b d / b / S / C / w)

const LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;

export function parseEnv(text: string): Record<string, string> {
  const vars: Record<string, string> = Object.create(null);
  const source = text.replace(/\r\n?/gm, "\n");
  LINE.lastIndex = 0;
  for (let match; (match = LINE.exec(source)) !== null; ) {
    let value = (match[2] ?? "").trim();
    const quote = value[0];
    value = value.replace(/^(['"`])([\s\S]*)\1$/gm, "$2");
    if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    vars[match[1]] = value;
  }
  return vars;
}

function unparsed(text: string, allowTrailingBareKey?: boolean): string | undefined {
  if (!text.trim()) return;
  LINE.lastIndex = 0;
  const lines = text.replace(/\r\n?/g, "\n").replace(LINE, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    if (allowTrailingBareKey && i === lines.length - 1 && /^(?:export\s+)?[\w.-]+:?$/.test(line)) continue;
    return line;
  }
}

/** Codex sets these for every command; an environment overriding them breaks tools or the sandbox. */
const MANAGED = ["PATH", "CODEX_HOME", "CODEX_SANDBOX", "CODEX_SANDBOX_NETWORK_DISABLED", "CODEX_PERMISSION_PROFILE", "CODEX_SESSION_ID", "CODEX_THREAD_ID", "CODEX_TOOL_CALL_ID"];

/**
 * Why the text can't be saved, or undefined. Claude shows these in English; codex-ui says them in
 * Chinese. `allowTrailingBareKey` lets the line being typed stay a bare key.
 */
export function envError(text: string, options?: { allowTrailingBareKey?: boolean }): string | undefined {
  if (!text.trim()) return;
  const line = unparsed(text, options?.allowTrailingBareKey);
  if (line !== undefined) return `无法解析“${line}”。请使用 KEY=value 格式。`;
  for (const key of Object.keys(parseEnv(text))) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) return `无效的键“${key}”。只能使用字母、数字和下划线。`;
    if (key === "__proto__") return `“${key}”不能用作变量名。`;
    if (MANAGED.includes(key.toUpperCase())) return `“${key}”由 Codex 管理，无法覆盖。`;
  }
}

function quoteValue(value: string): string {
  const bare = !/[#\n\r]/.test(value) && value === value.trim() && !/^['"`]/.test(value);
  if (bare && !/[$'"]/.test(value)) return value;
  const open = !value.endsWith("\\");
  const single = open && !value.includes("\r");
  if (single && !value.includes("'")) return `'${value}'`;
  if (open && !value.includes('"') && !/\\[nr]/.test(value)) return `"${value.replace(/\r/g, "\\r")}"`;
  if (single && !value.includes("`")) return `\`${value}\``;
  if (bare) return value;
  if (open && !value.includes("'")) return `'${value}'`;
  if (open && !value.includes("`")) return `\`${value}\``;
  return `"${value.replace(/"/g, '\\"').replace(/\r/g, "\\r")}${open ? "" : " "}"`;
}

export function formatEnv(vars: Record<string, string>): string {
  return Object.entries(vars).map(([key, value]) => `${key}=${quoteValue(value)}`).join("\n");
}

/** The text's variables, keeping a stored value whose written form reads back differently. */
export function parseEnvKeeping(text: string, stored: Record<string, string>): Record<string, string> {
  const vars = text.trim() ? parseEnv(text) : {};
  for (const [key, value] of Object.entries(stored)) {
    const read = parseEnv(`K=${quoteValue(value)}`).K;
    if (read !== value && key in vars && vars[key] === read) vars[key] = value;
  }
  return { ...vars };
}

// ---------------------------------------------------------------------------
// Names (c579ebf88 X / Z / Q, shared-20 GV)

/** shared-20 GV: the computer's own row and the session types read as environment names. */
export const RESERVED_NAMES = ["本电脑", "本地", "SSH", "云端", "Remote Control"];

export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Z: "name", else "name 2", "name 3" … */
export function numberedName(base: string, taken: readonly string[]): string {
  const used = (name: string) => taken.some((other) => sameName(other, name));
  if (!base || !used(base)) return base;
  for (let n = 2; ; n++) if (!used(`${base} ${n}`)) return `${base} ${n}`;
}

const GENERIC = new Set(["worktrees", ".codex", "src", "code", "repos", "projects", "work", "dev", "git", "github", "home", "users"]);

/** Q for a local folder: a taken name gets its nearest telling parent folder, "app (client)". */
export function localName(cwd: string, taken: readonly string[]): string {
  const base = basename(cwd);
  if (!base || !taken.some((other) => sameName(other, base))) return base;
  for (let prev = cwd, dir = parentDir(cwd); dir && dir !== prev; prev = dir, dir = parentDir(dir)) {
    const name = basename(dir);
    if (name && !/^[A-Za-z]:$/.test(name) && !GENERIC.has(name.toLowerCase()) && !sameName(name, base)) {
      const named = `${base} (${name})`;
      return taken.some((other) => sameName(other, named)) ? numberedName(base, taken) : named;
    }
  }
  return numberedName(base, taken);
}

/**
 * How an SSH host reads after the session's environment (cf74bc599 lj, from environment/status):
 * a ready host says nothing, a failed one is 已断开连接 in danger, one that is not up yet is
 * 正在连接 while a turn runs and 未连接 otherwise. Codex has no reconnecting state.
 */
export function sshStateLabel(status: "ready" | "pending" | "disconnected" | "unknown" | undefined, running: boolean): { label: string; danger?: true } | null {
  if (status === "ready") return null;
  if (status === "disconnected") return { label: "已断开连接", danger: true };
  return { label: status === "pending" && running ? "正在连接" : "未连接" };
}

// ---------------------------------------------------------------------------
// Branches (ca690a791 Lt / zt)

/** main, then master, then the rest by name; a picked branch missing from the list leads. */
export function sortBranches(branches: readonly string[], picked?: string): string[] {
  const rank = (name: string) => (name === "main" ? 0 : name === "master" ? 1 : 2);
  const sorted = [...branches].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return picked && !sorted.includes(picked) ? [picked, ...sorted] : sorted;
}
