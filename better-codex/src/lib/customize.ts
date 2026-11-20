// The pure parts of the 自定义 page (components/Customize.tsx): where settings links land, the custom
// MCP server form (the Codex app's plugins-settings `na` / `pgn` / `Sa`), SKILL.md headers, which
// skill folders may be removed, the recommended skills list, and what a marketplace allows.

import type { CustomizeSection, SettingsTab } from "./store";

/** One config/batchWrite keyPath segment, quoted so a name with dots or quotes stays one segment. */
export const keySegment = (name: string): string => `"${name.replace(/[\\"]/g, "\\$&")}"`;

/** A config/batchWrite edit (ConfigBatchWriteParams["edits"][number]). */
export interface ConfigEdit {
  keyPath: string;
  value: unknown;
  mergeStrategy: "replace" | "upsert";
}

// ---------------------------------------------------------------------------
// Settings links

/**
 * The 自定义 section and view a settings link opens (openSettings with one of these pages, a
 * search hit, the palette): plugin rows are in 我的, 发现连接器 is the connectors' 发现.
 */
export function customizeTarget(tab: CustomizeSection | "mcp", anchor?: string): { section: CustomizeSection; view?: "mine" | "discover" } {
  const section = tab === "mcp" ? "connectors" : tab;
  if (anchor === "setting-connectors-tabs") return { section, view: "discover" };
  if (anchor?.startsWith("setting-")) return { section, view: "mine" };
  return { section };
}

export const isCustomizeTab = (tab: SettingsTab): tab is CustomizeSection | "mcp" =>
  tab === "plugins" || tab === "skills" || tab === "connectors" || tab === "hooks" || tab === "mcp";

// ---------------------------------------------------------------------------
// Custom MCP servers

/**
 * The config key for a new server, as the Codex app's `Sa`: spaces to `_`, anything else outside
 * [a-zA-Z0-9-_] to `-` (runs collapse), lower case; `custom-server` when nothing is left, `-2`,
 * `-3`… when taken.
 */
export function newMcpServerKey(name: string, taken: Iterable<string>): string {
  const base =
    name
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9\-_]+/g, "-")
      .replace(/-+/g, "-")
      .toLowerCase() || "custom-server";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

export type McpTransport = "stdio" | "http";

/** The form's fields; the list and map fields are text, one entry per line. */
export interface McpForm {
  transport: McpTransport;
  command: string;
  /** One argument per line. */
  args: string;
  /** KEY=VALUE per line. */
  env: string;
  /** One variable name per line. */
  envVars: string;
  cwd: string;
  url: string;
  bearer: string;
  /** Name: value per line. */
  headers: string;
  /** Name: ENV_VAR per line. */
  envHeaders: string;
}

/** The `[mcp_servers.<key>]` fields the form owns; everything else in the table (enabled, tools…) is left alone. */
type EnvVar = string | { name: string; source?: string };
export interface McpTable {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  env_vars?: EnvVar[];
  cwd?: string;
  url?: string;
  bearer_token_env_var?: string;
  http_headers?: Record<string, string>;
  env_http_headers?: Record<string, string>;
  [other: string]: unknown;
}

const STDIO_FIELDS = ["command", "args", "env", "env_vars", "cwd"] as const;
const HTTP_FIELDS = ["url", "bearer_token_env_var", "http_headers", "env_http_headers"] as const;
const MAP_FIELDS = new Set(["env", "http_headers", "env_http_headers"]);

export const emptyMcpForm = (transport: McpTransport = "stdio"): McpForm => ({ transport, command: "", args: "", env: "", envVars: "", cwd: "", url: "", bearer: "", headers: "", envHeaders: "" });

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

function pairs(text: string, separator: string): Record<string, string> | undefined {
  const entries = lines(text).flatMap((line) => {
    const at = line.indexOf(separator);
    const key = (at < 0 ? line : line.slice(0, at)).trim();
    return key ? [[key, at < 0 ? "" : line.slice(at + 1).trim()] as const] : [];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

const nonEmpty = <T>(list: T[]) => (list.length ? list : undefined);

export function mcpTomlToForm(table: McpTable): McpForm {
  const map = (value: Record<string, string> | undefined, separator: string) =>
    Object.entries(value ?? {})
      .map(([key, entry]) => `${key}${separator}${entry}`)
      .join("\n");
  return {
    transport: table.url ? "http" : "stdio",
    command: table.command ?? "",
    args: (table.args ?? []).join("\n"),
    env: map(table.env, "="),
    envVars: (table.env_vars ?? []).map((entry) => (typeof entry === "string" ? entry : entry.name)).join("\n"),
    cwd: table.cwd ?? "",
    url: table.url ?? "",
    bearer: table.bearer_token_env_var ?? "",
    headers: map(table.http_headers, ": "),
    envHeaders: map(table.env_http_headers, ": "),
  };
}

/**
 * The transport's fields with a value, and nothing of the other transport: the server checks with
 * is_some, so even an empty `args` on an HTTP server is refused. A passthrough variable keeps the
 * object form (`{name, source}`) it had.
 */
export function mcpFormToToml(form: McpForm, old?: McpTable): McpTable {
  if (form.transport === "http") {
    return clean({
      url: form.url.trim() || undefined,
      bearer_token_env_var: form.bearer.trim() || undefined,
      http_headers: pairs(form.headers, ":"),
      env_http_headers: pairs(form.envHeaders, ":"),
    });
  }
  const before = new Map((old?.env_vars ?? []).map((entry) => [typeof entry === "string" ? entry : entry.name, entry] as const));
  return clean({
    command: form.command.trim() || undefined,
    args: nonEmpty(lines(form.args)),
    env: pairs(form.env, "="),
    env_vars: nonEmpty(lines(form.envVars).map((name) => before.get(name) ?? name)),
    cwd: form.cwd.trim() || undefined,
  });
}

function clean(table: McpTable): McpTable {
  return Object.fromEntries(Object.entries(table).filter(([, value]) => value !== undefined)) as McpTable;
}

/** What is missing before the form can be saved; null when it can. */
export function mcpFormProblem(form: McpForm): string | null {
  if (form.transport === "stdio") return form.command.trim() ? null : "请填写启动命令。";
  const url = URL.parse(form.url.trim());
  return url && (url.protocol === "http:" || url.protocol === "https:") ? null : "URL 格式无效";
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The writes for saving the form (the Codex app's `pgn`): a new server replaces its whole table; an
 * edit writes only the fields that changed, maps key by key, so the rest of the table (enabled,
 * tool permissions, timeouts) stays as it is.
 */
export function mcpEdits(key: string, old: McpTable | undefined, form: McpForm): ConfigEdit[] {
  const base = `mcp_servers.${keySegment(key)}`;
  const next = mcpFormToToml(form, old);
  if (!old) return [{ keyPath: base, value: next, mergeStrategy: "replace" }];
  // Compare with the table as the form reads it back (trimmed, blank lines dropped): a field the
  // user did not touch then matches and keeps its exact value in config.toml.
  const shown = mcpFormToToml(mcpTomlToForm(old), old);
  const edits: ConfigEdit[] = [];
  for (const field of form.transport === "http" ? HTTP_FIELDS : STDIO_FIELDS) {
    const before = shown[field];
    const after = next[field];
    if (same(before, after)) continue;
    if (MAP_FIELDS.has(field) && before && after) {
      const was = before as Record<string, string>;
      const now = after as Record<string, string>;
      for (const name of new Set([...Object.keys(was), ...Object.keys(now)]))
        if (was[name] !== now[name]) edits.push({ keyPath: `${base}.${field}.${keySegment(name)}`, value: now[name] ?? null, mergeStrategy: "replace" });
      continue;
    }
    edits.push({ keyPath: `${base}.${field}`, value: after ?? null, mergeStrategy: "replace" });
  }
  return edits;
}

// ---------------------------------------------------------------------------
// Skills

/** name and description from SKILL.md's front matter (simple `key: value` lines). */
export function skillFrontmatter(text: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text.replace(/^\uFEFF/, ""));
  if (!match) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^(name|description)\s*:\s*(.*)$/.exec(line);
    if (field) out[field[1] as "name" | "description"] = field[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** A path compared without the \\?\ prefix, with forward slashes, case-folded (Windows paths). */
const comparable = (path: string) =>
  path
    .replace(/^\\\\\?\\/, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();

/** The parent folder of a path that uses either separator. */
export function parentDir(path: string): string {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at > 0 ? path.slice(0, at) : path;
}

/**
 * The folder 卸载 deletes for a skill (`skillPath` is its SKILL.md), or null when it is not one of
 * the user's own: it has to sit strictly inside <codexHome>/skills and outside `.system`.
 */
export function removableSkillDir(skillPath: string, codexHome: string | null | undefined): string | null {
  if (!codexHome) return null;
  const dir = parentDir(skillPath);
  const root = `${comparable(codexHome)}/skills/`;
  const inside = comparable(dir);
  if (!inside.startsWith(root)) return null;
  const rest = inside.slice(root.length);
  if (!rest || rest.split("/")[0] === ".system") return null;
  return dir;
}

export interface RecommendedSkill {
  id: string;
  name: string;
  description: string;
  /** The skill's folder in the vendored openai/skills checkout. */
  path: string;
  experimental: boolean;
}

/**
 * The 发现 list (the Codex app's `fN` / `dN`): entries whose SKILL.md could not be read (text null)
 * and dot folders are left out, one per id with .curated before .experimental, sorted by name.
 */
export function recommendedSkills(entries: { id: string; path: string; experimental: boolean; text: string | null }[]): RecommendedSkill[] {
  const byId = new Map<string, RecommendedSkill>();
  for (const entry of [...entries].sort((a, b) => Number(a.experimental) - Number(b.experimental))) {
    if (entry.text === null || entry.id.startsWith(".") || byId.has(entry.id)) continue;
    const head = skillFrontmatter(entry.text);
    byId.set(entry.id, { id: entry.id, name: head.name || entry.id, description: head.description ?? "", path: entry.path, experimental: entry.experimental });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Marketplaces

/** Marketplaces Codex ships or manages itself (the Codex app's ZNn and the bundled ones). */
export const BUILTIN_MARKETPLACES = new Set(["codex-official", "openai-bundled", "openai-bundled-alpha", "openai-curated", "openai-curated-remote", "openai-api-curated", "openai-primary-runtime"]);

/**
 * What a marketplace's row offers (the Codex app's 市场 tab): 升级 for one the user added from Git,
 * 移除 for one the user's own config.toml adds (`layer`, its config/read origin): marketplace/remove
 * refuses one a project or managed config names. Built-in ones update themselves and stay.
 */
export function marketplaceActions(name: string, configEntry: { source_type?: string; source?: string } | undefined, layer?: string): { upgrade: string | null; remove: string | null } {
  if (BUILTIN_MARKETPLACES.has(name)) return { upgrade: "内置市场会自动更新", remove: "无法移除内置市场" };
  if (!configEntry) return { upgrade: "只能升级 Git 市场", remove: "此市场不在您的配置中" };
  return {
    upgrade: configEntry.source_type === "git" && configEntry.source ? null : "只能升级 Git 市场",
    remove: layer === undefined || layer === "user" ? null : "此市场来自其他配置来源，请在那里移除",
  };
}
