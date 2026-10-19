// Pure helpers behind the Code transcript (no DOM, no store), so `pnpm test` runs them
// directly. Values come from Claude Desktop 2.42304.0.0; the chunk each one was read from
// is named next to it.

import type { FileUpdateChange } from "@protocol/v2/FileUpdateChange";
import type { ThreadItem } from "@protocol/v2/ThreadItem";

// ---------------------------------------------------------------------------
// Working line: retries

/**
 * codex core notify_stream_error() sends "Reconnecting... 2/5" with a codexErrorInfo; the
 * Code working line reads `{reason} · Retrying ({attempt}/{maxRetries}) · {elapsed}` with the
 * short reason of c4a9ee384 zp(): authentication, rate limit, overload, else "Request failed".
 */
const RETRY_REASONS: Record<string, string> = {
  unauthorized: "身份验证失败",
  rateLimitExceeded: "速率受限",
  usageLimitExceeded: "速率受限",
  serverOverloaded: "模型过载",
};

export interface RetryParts {
  reason: string;
  attempt: number | null;
  max: number | null;
}

/** Accepts the retry message on its own or the whole TurnError. */
export function retryParts(value: unknown): RetryParts {
  const error = typeof value === "object" && value !== null ? (value as { message?: unknown; codexErrorInfo?: unknown }) : null;
  const message = typeof value === "string" ? value : typeof error?.message === "string" ? error.message : "";
  const info = error?.codexErrorInfo;
  const key = typeof info === "string" ? info : info && typeof info === "object" ? Object.keys(info)[0] : undefined;
  const count = /(\d+)\s*\/\s*(\d+)/.exec(message);
  return {
    reason: (key && RETRY_REASONS[key]) || "请求失败",
    attempt: count ? Number(count[1]) : null,
    max: count ? Number(count[2]) : null,
  };
}

// ---------------------------------------------------------------------------
// Thinking

/** c96d752d0 BZ(): the thinking block copied as a Markdown quote, tokens ≈ chars / 4 (the header stays English). */
export function quoteThinking(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => (line ? `> ${line}` : ">"));
  return `> **Thinking** (~${Math.round(text.length / 4)} tok)\n>\n${lines.join("\n")}`;
}

/** A selection or message quoted into the composer (Attach … as context). */
export function quoteText(text: string): string {
  return `${text
    .trim()
    .split(/\r?\n/)
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n")}\n\n`;
}

// ---------------------------------------------------------------------------
// Chapters (cf74bc599 xb / Cb, c96d752d0 chapter store): the session start plus the
// replies the user pinned. Pins are local per thread, like the original's
// "epitaxy-chapters-v2" store; Codex has no mark_chapter tool, so there are no agent chapters.

export interface UserChapter {
  id: string;
  /** The turn whose reply was pinned; the heading sits before its first reply item. */
  afterId: string;
  title: string;
}

export interface ChapterStore {
  userChapters: UserChapter[];
}

export interface Chapter {
  id: string;
  title: string;
  source: "session" | "user";
  /** Turn id the chapter starts at (the session start: the first turn). */
  anchor: string;
}

export const SESSION_CHAPTER = "session-start";
export const NO_CHAPTERS: ChapterStore = { userChapters: [] };

/** The first non-empty line, at most 40 characters plus an ellipsis (c96d752d0 UTe()). */
export function chapterTitle(text: string): string {
  const line = (text.split("\n").find((part) => part.trim()) ?? "").trim();
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}

export function pinChapter(store: ChapterStore, afterId: string, title: string, id: string): ChapterStore {
  if (store.userChapters.some((chapter) => chapter.afterId === afterId)) return store;
  return { userChapters: [...store.userChapters, { id, afterId, title }] };
}

export function unpinChapter(store: ChapterStore, afterId: string): ChapterStore {
  return { userChapters: store.userChapters.filter((chapter) => chapter.afterId !== afterId) };
}

export function removeChapter(store: ChapterStore, id: string): ChapterStore {
  return { userChapters: store.userChapters.filter((chapter) => chapter.id !== id) };
}

export function renameChapter(store: ChapterStore, id: string, title: string): ChapterStore {
  return { userChapters: store.userChapters.map((chapter) => (chapter.id === id ? { ...chapter, title } : chapter)) };
}

/** 会话开始 (cf74bc599 "Session start") whenever there are turns, then the pins in transcript order. */
export function chapterList(anchors: string[], store: ChapterStore): Chapter[] {
  const order = new Map(anchors.map((id, index) => [id, index]));
  const pins: Chapter[] = store.userChapters
    .filter((chapter) => order.has(chapter.afterId))
    .sort((a, b) => order.get(a.afterId)! - order.get(b.afterId)!)
    .map((chapter) => ({ id: chapter.id, title: chapter.title, source: "user", anchor: chapter.afterId }));
  return anchors.length ? [{ id: SESSION_CHAPTER, title: "会话开始", source: "session", anchor: anchors[0] }, ...pins] : pins;
}

/** The table of contents only shows once something besides the session start exists (YTe()). */
export function showsToc(chapters: Chapter[]): boolean {
  return chapters.some((chapter) => chapter.source !== "session");
}

/**
 * cf74bc599 yb(): the last chapter whose anchor is at or above the reading line (the
 * viewport top + 64px); within 8px of the bottom the last chapter wins. `tops` holds each
 * anchor's top edge, null when it is not rendered.
 */
export function activeChapter(tops: (number | null)[], line: number, nearBottom: boolean): number {
  if (!tops.length) return -1;
  if (nearBottom) return tops.length - 1;
  let active = 0;
  tops.forEach((top, index) => {
    if (top !== null && top <= line) active = index;
  });
  return active;
}

// ---------------------------------------------------------------------------
// Tool rows: one row per call; adjacent calls on the same file share one (cd57a9664 q():
// Read / Write / Edit keyed by name and path), and a file change is one row per file.

type CommandItem = Extract<ThreadItem, { type: "commandExecution" }>;
type FileChangeItem = Extract<ThreadItem, { type: "fileChange" }>;

export interface FilePart {
  item: FileChangeItem;
  change: FileUpdateChange;
  /** The change's index within its item (for keys). */
  index: number;
}

export type Block =
  | { kind: "item"; item: ThreadItem }
  | { kind: "reads"; items: CommandItem[] }
  | { kind: "file"; parts: FilePart[] };

/** A command that only reads one file (not the user's own `!` command). */
function readOf(item: ThreadItem): string | null {
  if (item.type !== "commandExecution" || item.source === "userShell" || item.commandActions.length !== 1) return null;
  const action = item.commandActions[0];
  return action.type === "read" ? action.path : null;
}

export function toolBlocks(items: ThreadItem[]): Block[] {
  const blocks: Block[] = [];
  let key: string | null = null;
  for (const item of items) {
    if (item.type === "fileChange" && item.changes.length) {
      item.changes.forEach((change, index) => {
        const next = `${change.kind.type} ${change.path}`;
        const last = blocks.at(-1);
        if (next === key && last?.kind === "file") last.parts.push({ item, change, index });
        else blocks.push({ kind: "file", parts: [{ item, change, index }] });
        key = next;
      });
      continue;
    }
    const path = readOf(item);
    const next = path === null ? null : `read ${path}`;
    const last = blocks.at(-1);
    if (next !== null && next === key && last?.kind === "reads") last.items.push(item as CommandItem);
    else blocks.push(next === null ? { kind: "item", item } : { kind: "reads", items: [item as CommandItem] });
    key = next;
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Tool groups (c96d752d0 sWe / aG / v2e, the default design): adjacent tool rows roll up into
// one group whose line counts what they did (c24951e9f); a group of one row stays that row.
// Text, a thought the view shows and the calls that stand alone end a group.

export type Entry = { kind: "block"; block: Block } | { kind: "group"; blocks: Block[] };

/** UV rollUp "rolls-up": questions, plans, images, reports and notices stand alone. */
function rollsUp(block: Block): boolean {
  if (block.kind !== "item") return true;
  const item = block.item;
  switch (item.type) {
    case "commandExecution":
      return item.source !== "userShell";
    case "collabAgentToolCall":
      // A finished wait that brought reports reads as their messages.
      return item.tool !== "wait" || item.status === "inProgress" || !item.receiverThreadIds.some((id) => item.agentsStates[id]?.message);
    case "subAgentActivity":
      return item.kind !== "completed";
    case "mcpToolCall":
    case "dynamicToolCall":
    case "webSearch":
    case "imageView":
    case "sleep":
    case "functionCallOutput":
      return true;
    default:
      return false;
  }
}

/** `thinking`: the thinking and verbose views, where a thought shows and so ends a group (iG). */
export function rollUp(blocks: Block[], thinking: boolean): Entry[] {
  const entries: Entry[] = [];
  let run: Block[] = [];
  const close = () => {
    if (run.length > 1) entries.push({ kind: "group", blocks: run });
    else if (run.length) entries.push({ kind: "block", block: run[0] });
    run = [];
  };
  for (const block of blocks) {
    if (rollsUp(block)) run.push(block);
    // A hidden thought draws nothing, so the group runs on past it.
    else if (thinking || block.kind !== "item" || block.item.type !== "reasoning") {
      close();
      entries.push({ kind: "block", block });
    }
  }
  close();
  return entries;
}

type Category = "read" | "view" | "write" | "edit" | "delete" | "bash" | "grep" | "glob" | "web" | "fetch" | "task" | "tool";
type Ending = "pending" | "succeeded" | "failed" | "blocked" | undefined;

/** c24951e9f Z(): what `n` calls of a category did; anything else counts as 已使用 N 个工具. */
const DID: Record<Category, (n: number) => { verb: string; meta: string }> = {
  read: (n) => ({ verb: "已读取", meta: `${n} 个文件` }),
  view: (n) => ({ verb: "已查看", meta: `${n} 张图片` }),
  write: (n) => ({ verb: "已创建", meta: `${n} 个文件` }),
  edit: (n) => ({ verb: "已编辑", meta: `${n} 个文件` }),
  delete: (n) => ({ verb: "已删除", meta: `${n} 个文件` }),
  bash: (n) => ({ verb: "已运行", meta: `${n} 个命令` }),
  grep: () => ({ verb: "已搜索", meta: "代码" }),
  glob: () => ({ verb: "已查找", meta: "文件" }),
  web: () => ({ verb: "已浏览", meta: "网页" }),
  fetch: (n) => ({ verb: "已获取", meta: `${n} 个网页` }),
  task: (n) => ({ verb: "已运行", meta: `${n} 个代理` }),
  tool: (n) => ({ verb: "已使用", meta: `${n} 个工具` }),
};

/** W: work on files, keyed by path; the other calls each count once. */
const FILE_WORK = new Set<Category>(["read", "view", "write", "edit", "delete"]);

export interface SummaryPart {
  verb: string;
  meta?: string;
  count: number;
  failed?: number;
  blocked?: number;
  /** Every one of them failed: the verb reads in danger. */
  isError?: boolean;
  /** 及其他 N 项操作, which never truncates. */
  rest?: boolean;
}

/** K(): a stopped or declined call neither failed nor succeeded; an auto-review block is its own. */
function endingOf(id: string, status: string | undefined, blocked: ReadonlySet<string>): Ending {
  if (blocked.has(id)) return "blocked";
  if (status === "inProgress") return "pending";
  if (status === "failed") return "failed";
  return status === undefined || status === "completed" ? "succeeded" : undefined;
}

function callsOf(block: Block, blocked: ReadonlySet<string>): { category: Category; key: string; ending: Ending }[] {
  if (block.kind === "reads") return block.items.map((item) => ({ category: "read", key: readOf(item)!, ending: endingOf(item.id, item.status, blocked) }));
  if (block.kind === "file") {
    return block.parts.map(({ item, change }) => ({
      category: change.kind.type === "add" ? "write" : change.kind.type === "delete" ? "delete" : "edit",
      key: change.path,
      ending: endingOf(item.id, item.status, blocked),
    }));
  }
  const item = block.item;
  const status = item.type === "dynamicToolCall" && item.success === false ? "failed" : "status" in item ? item.status : undefined;
  const call = (category: Category, key = item.id) => [{ category, key, ending: endingOf(item.id, status, blocked) }];
  switch (item.type) {
    case "commandExecution": {
      const one = item.commandActions.length === 1 ? item.commandActions[0] : null;
      return one?.type === "read" ? call("read", one.path) : call(one?.type === "search" ? "grep" : one?.type === "listFiles" ? "glob" : "bash");
    }
    case "imageView":
      return call("view", item.path);
    case "webSearch":
      return call(item.action?.type === "openPage" ? "fetch" : item.action?.type === "findInPage" ? "tool" : "web");
    case "collabAgentToolCall":
      return call(item.tool === "spawnAgent" ? "task" : "tool");
    case "subAgentActivity":
      return call(item.kind === "started" ? "task" : "tool");
    default:
      return call("tool");
  }
}

/** M(): （失败 N 个）, （已拦截 N 个） or both. */
const failureNote = (failed: number, blocked: number) => `（${[failed && `失败 ${failed} 个`, blocked && `已拦截 ${blocked} 个`].filter(Boolean).join("，")}）`;

/** N(): the failures after the meta, or the whole part in danger when every one failed. */
function withFailures(part: SummaryPart, failed: number, blocked: number): SummaryPart {
  if (!failed && !blocked) return part;
  const counts = { ...(failed ? { failed } : {}), ...(blocked ? { blocked } : {}) };
  return failed >= part.count ? { ...part, ...counts, isError: true } : { ...part, ...counts, meta: `${part.meta}${failureNote(failed, blocked)}` };
}

/** formatList(conjunction): 已读取并编辑, 已读取、创建并编辑. */
function joinVerbs(verbs: string[]): string {
  if (verbs.length === 1) return verbs[0];
  const bare = verbs.map((verb) => verb.replace(/^已/, ""));
  return `${verbs[0]}${bare.slice(1, -1).map((verb) => `、${verb}`).join("")}并${bare.at(-1)}`;
}

/**
 * c24951e9f ve(): one part per category in the order it first ran, 已使用 N 个工具 last; a file
 * read or changed more than once counts once, and its last ending stands. When every file call
 * touches the same file they share one part named after it. `blocked`: the calls an
 * auto-review stopped.
 */
export function groupSummary(blocks: Block[], blocked: ReadonlySet<string> = new Set()): SummaryPart[] {
  const seen = new Map<Category, Map<string, Ending>>();
  for (const { category, key, ending } of blocks.flatMap((block) => callsOf(block, blocked))) {
    const keys = seen.get(category) ?? new Map<string, Ending>();
    seen.set(category, keys);
    // q(): a later ending wins; one still running clears it.
    keys.set(key, ending === undefined ? keys.get(key) : ending === "pending" ? undefined : ending);
  }
  const tally = (keys: Map<string, Ending>, ending: Ending) => [...keys.values()].filter((value) => value === ending).length;
  const order = [...seen.keys()].sort((a, b) => Number(a === "tool") - Number(b === "tool"));
  const files = new Set(order.flatMap((category) => (FILE_WORK.has(category) ? [...seen.get(category)!.keys()] : [])));
  const path = files.size === 1 ? [...files][0] : undefined;
  const fileWork = path === undefined ? [] : order.filter((category) => FILE_WORK.has(category));
  const parts: SummaryPart[] = [];
  for (const category of order) {
    const keys = seen.get(category)!;
    if (!fileWork.includes(category)) {
      parts.push(withFailures({ ...DID[category](keys.size), count: keys.size }, tally(keys, "failed"), tally(keys, "blocked")));
    } else if (category === fileWork[0]) {
      const endings = fileWork.map((work) => seen.get(work)!.get(path!));
      const part = { verb: joinVerbs(fileWork.map((work) => DID[work](1).verb)), meta: fileName(path!), count: fileWork.length };
      parts.push(withFailures(part, endings.filter((ending) => ending === "failed").length, endings.filter((ending) => ending === "blocked").length));
    }
  }
  return parts;
}

/** P(): past four parts, the first three and 及其他 N 项操作 with what failed among the rest. */
export function limitParts(parts: SummaryPart[]): SummaryPart[] {
  if (parts.length < 5) return parts;
  const more = parts.slice(3);
  const sum = (pick: (part: SummaryPart) => number) => more.reduce((total, part) => total + pick(part), 0);
  const [count, failed, blocked] = [sum((part) => part.count), sum((part) => part.failed ?? 0), sum((part) => part.blocked ?? 0)];
  const verb = `及其他 ${count} 项操作${failed || blocked ? failureNote(failed, blocked) : ""}`;
  return [...parts.slice(0, 3), { verb, count, rest: true }];
}

// ---------------------------------------------------------------------------
// Commands: the shell and script inside the argv, and the short summary a row shows.

/** shlex quoting back to the text: '…' with '"'"' for a quote inside, or "…". */
function unquote(text: string): string {
  const value = text.trim();
  if (/^'[\s\S]*'$/.test(value)) return value.slice(1, -1).replace(/'"'"'|'\\''/g, "'");
  if (/^"[\s\S]*"$/.test(value)) return value.slice(1, -1).replace(/\\(["\\$`])/g, "$1");
  return value;
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * app-server's command is the shlex-joined argv, e.g. `bash -lc 'npm test'` or
 * `'C:\…\powershell.exe' -Command 'Get-ChildItem'`: the shell (Bash / PowerShell, cb6930dae
 * Cu) and the script it runs.
 */
export function shellOf(command: string): { shell: "bash" | "powershell"; script: string } {
  const match = /^('[^']*'|"[^"]*"|\S+)(?:\s+-[\w-]+)*?\s+-(?:l?c|Command)\s+([\s\S]+)$/i.exec(command.trim());
  const program = match ? fileName(unquote(match[1])).toLowerCase().replace(/\.exe$/, "") : "";
  if (match && /^(?:powershell|pwsh)$/.test(program)) return { shell: "powershell", script: unquote(match[2]) };
  if (match && /^(?:ba|z)?sh$/.test(program)) return { shell: "bash", script: unquote(match[2]) };
  return { shell: /^\S*(?:powershell|pwsh)(?:\.exe)?['"]?(?:\s|$)/i.test(command) ? "powershell" : "bash", script: command };
}

// c52b02f3f Kn: the programs a summary may name.
const SUMMARY_PROGRAMS = new Set(
  [
    "bun bunx node npm npx pnpm pnpx yarn deno tsc tsx vitest jest eslint oxlint prettier oxfmt turbo vite next",
    "playwright python python3 pip pip3 uv uvx poetry pytest ruff mypy black go cargo rustc rustup make cmake",
    "bazel gradle mvn swift xcodebuild dotnet git gh docker docker-compose kubectl helm ls cat head tail wc find",
    "fd rg grep sed awk jq tree du stat file diff sort uniq cut tr date sleep which mkdir rm mv cp touch chmod",
    "ln pwd cd get-childitem get-content select-string set-location push-location test-path new-item",
    "remove-item copy-item move-item dir",
  ]
    .join(" ")
    .split(" "),
);
const CD_PREFIX = /^(?:cd +(?:'[^']*'|"[^"$`\\]*"|[\w./~:+,%-]+) *(?:&&|;) *)+(?=\S)/;
const SUMMARY_WORD = /^(?!-)[A-Za-z0-9._/~:+,@%-]+$/;
const HOST = "(?:[\\w-]+(?:\\.[\\w-]+)*\\.[a-z]{2,}|\\d{1,3}(?:\\.\\d{1,3}){3}|localhost)\\.?";
const HOSTISH = new RegExp(
  [`^${HOST}(?::[^/]*)?/`, `^${HOST}:\\d+$`, "^[\\w-]+(?:\\.[\\w-]+)+\\.:", "^[\\w-]+(?:\\.[\\w-]+)*\\.?:\\d+\\/", "^//"].join("|"),
  "i",
);
const SECRET_FILE = /^(?:tokens?|passwords?|passwd|secrets?|apikeys?|credentials?)$/i;
// c52b02f3f er(): text that may carry a credential keeps the whole summary back.
const CREDENTIALS = [
  /:\/\/[^\s/?#@]+@/,
  /(?<![\w-])(?:-[a-z]*u|--(?:proxy-)?user)(?:=| *)["']?(?!\d+:\d+(?:[\s"']|$))(?=[\w.])[^\s"':]{1,256}:(?!\/\/)/i,
  /\b(?:authorization|bearer|sshpass)\b/i,
  /\b(?:mysql|mariadb)\w*\b.{0,512}\s-p\S/,
  /(?<![\w-])(?:npm_[A-Za-z0-9]{36}|hf_[A-Za-z0-9]{30,}|sntry[su]_[A-Za-z0-9+/=]{20}|glpat-[\w-]{20}|pypi-AgE[\w-]{50})/,
  /(?:^|[ :])(?:login|auth)(?=[ :]|$)/im,
  /(?<![\w-])-{1,2}[\w-]{0,64}(?:passw(?:or)?d|token|secret|credential)/i,
  /\bsudo +(?:-[A-Za-z]{1,16} +){0,16}-[A-Za-z]{0,16}S/,
  /(?<![\w-])-pass(?:in|out)(?![\w-])|(?<![\w$-])(?:pass|env):/i,
  /\bConvertTo-SecureString\b|\bidentified +by\b/i,
];
const NAMED_VALUE = /(?<![\w$-])(\$?[\w-]+)(["']? *[:=] *| +)(?=\S)/g;
const CREDENTIAL_NAME = /token|secret|passw(?:or)?d|passphrase|pass$|pwd|key|auth(?!ors?(?:\b|_))|credential|cookie|session/i;

function mayHoldCredential(text: string): boolean {
  const plain = text.replace(/\t/g, " ");
  for (const variant of new Set([plain, plain.replace(/["'`\\]/g, "")])) {
    if (CREDENTIALS.some((pattern) => pattern.test(variant))) return true;
    for (const [, name, separator] of variant.matchAll(NAMED_VALUE)) {
      const valued = name.startsWith("$")
        ? separator.includes("=")
        : separator.trim() !== "" || /^-|_|^passw(?:or)?d$/i.test(name) || /[a-z][A-Z]/.test(name);
      if (valued && CREDENTIAL_NAME.test(name)) return true;
    }
  }
  return false;
}

/** c52b02f3f sr(): every segment runs a known program, with no substitution or subshell. */
function knownPrograms(line: string): boolean {
  if (/\$\(|`|[<>]\(/.test(line)) return false;
  const segments: string[][] = [[]];
  let word = "";
  let quote: string | undefined;
  const flush = () => {
    if (word) segments[segments.length - 1].push(word);
    word = "";
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (quote) {
      word += ch;
      if (ch === quote) quote = undefined;
      else if (ch === "\\" && quote === '"' && next !== undefined) {
        word += next;
        i++;
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      word += ch;
    } else if (ch === "\\" && (next === "'" || next === '"')) {
      word += ch + next;
      i++;
    } else if (ch === " ") flush();
    else if (ch === "(" && (word === "" || word === "@")) return false;
    else if (ch === ";" || ch === "|" || (ch === "&" && line[i - 1] !== ">" && line[i - 1] !== "<" && next !== ">")) {
      flush();
      segments.push([]);
      if ((ch === "&" && next === "&") || (ch === "|" && (next === "|" || next === "&"))) i++;
    } else word += ch;
  }
  flush();
  return segments.every((words) => {
    const program = words.find((w) => !/^[A-Za-z_]\w*=/.test(w) && !/^(?:time|nice)$/i.test(w));
    return program === undefined || SUMMARY_PROGRAMS.has(fileName(program).toLowerCase().replace(/\.exe$/, ""));
  });
}

/** The word cannot name a host, a URL-encoded value, user info, a long token or a secret file. */
function plainWord(word: string): boolean {
  if (!SUMMARY_WORD.test(word) || word.includes("://") || HOSTISH.test(word) || /%[0-9A-F]{2}/i.test(word)) return false;
  if (word.includes("@")) {
    if (word.includes(":")) return false;
    const bare = word.replace(/(?:^|\/)@[\w-]+\//g, "/");
    if (bare.includes("@") && !/^[^@]+@(?:\d[\w.+~-]*|[A-Za-z][\w-]*)$/.test(bare)) return false;
  }
  if ((word.match(/[A-Za-z0-9]{20,}/g) ?? []).some((run) => /[A-Za-z]/.test(run) && /\d/.test(run))) return false;
  const parts = word.slice(word.lastIndexOf("/") + 1).split(/[-._]/);
  return !parts.some((part, index) => SECRET_FILE.test(part) || (/^api$/i.test(part) && /^keys?$/i.test(parts[index + 1] ?? "")));
}

/**
 * c52b02f3f cr(): what a command row says it ran when the call has no description: the first
 * line without leading `cd … &&`, at most four plain words, then "…" when cut. null (the row
 * says 一条命令) for substitutions, unknown programs and anything that may carry a credential.
 */
export function commandSummary(script: string, shell: "bash" | "powershell" = "bash"): string | null {
  const limit = (script.charCodeAt(8191) & 0xfc00) === 0xd800 ? 8191 : 8192;
  const text = script.slice(0, limit);
  const start = text.search(/[^ \t\r\n]/);
  if (start === -1 || mayHoldCredential(text)) return null;
  const end = text.indexOf("\n", start);
  let line = text
    .slice(start, end === -1 ? undefined : end)
    .replace(/\t/g, " ")
    .replace(/[ \r]+$/, "");
  const more = script.length > limit || (end !== -1 && /[^ \t\r\n]/.test(text.slice(end)));
  // A continued first line drops its trailing `\` (bash) or backtick (PowerShell).
  const continued = shell === "powershell" ? /(?:^|[^`])(?:``)*`$/ : /(?:^|[^\\])(?:\\\\)*\\$/;
  if (more && continued.test(line) && line.at(-2) === " ") line = line.slice(0, -1).replace(/ +$/, "");
  if (!line || /[^\S ]/.test(line) || /[\u202a-\u202e\u2066-\u2069]/.test(line) || !knownPrograms(line)) return null;
  const words = line.replace(CD_PREFIX, "").split(/ +/);
  if (end === -1 && script.length > limit) words.pop();
  const kept: string[] = [];
  for (const word of words) {
    if (kept.length === 4 || !plainWord(word)) break;
    kept.push(word);
  }
  if (!kept.length) return null;
  return more || kept.length < words.length ? `${kept.join(" ")}…` : kept.join(" ");
}

/** CSI / OSC / two-character escapes out of terminal output. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g, "");
}

/** c52b02f3f pr(): an MCP tool reads `{server}: {tool}`, underscores as spaces. */
export function mcpLabel(server: string, tool: string): string {
  return `${server.replace(/_+/g, " ")}: ${tool.replace(/_+/g, " ")}`;
}

// ---------------------------------------------------------------------------
// Hooks (c96d752d0 jz / Hz): a tool hook that said something annotates the tool row it ran
// around. HookRunSummary carries no item id, so the row nearest in time takes it.

interface HookLike {
  eventName: string;
  startedAt: number | bigint;
  entries: { kind: string; text: string }[];
}

const FEEDBACK_KINDS = new Set(["feedback", "warning", "error"]);

/** Tool item id -> the hook texts to list under it. `spans` are the tool rows' [start, end] in ms. */
export function hookFeedback(hooks: HookLike[], spans: { id: string; start: number; end?: number }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!spans.length) return out;
  for (const run of hooks) {
    if (run.eventName !== "preToolUse" && run.eventName !== "postToolUse") continue;
    const texts = run.entries.filter((entry) => FEEDBACK_KINDS.has(entry.kind) && entry.text.trim()).map((entry) => entry.text);
    if (!texts.length) continue;
    // startedAt is whole seconds.
    const at = Number(run.startedAt) * 1000;
    let best = spans[0];
    let gap = Infinity;
    for (const span of spans) {
      const distance = at < span.start ? span.start - at : span.end !== undefined && at > span.end + 1000 ? at - span.end : 0;
      if (distance < gap) [best, gap] = [span, distance];
    }
    out.set(best.id, [...(out.get(best.id) ?? []), ...texts]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// File references (U24): a click on a path asks the preview pane to open it.

const FILE_EXTENSIONS = new Set(
  (
    "ts tsx js jsx mjs cjs json jsonc md mdx txt log py rs go java kt kts swift rb php c h cc cpp hpp cs " +
    "css scss less html htm xml svg yml yaml toml ini cfg conf env sh bash zsh fish ps1 bat cmd sql " +
    "vue svelte dart lua scala proto graphql gql csv tsv lock gradle png jpg jpeg gif webp pdf"
  ).split(" "),
);

/** `src/a.ts:12`, `src/a.ts:12:3` or `src/a.ts#L12` -> the path and its line. */
export function parseFileRef(text: string): { path: string; line?: number } {
  const ref = text.trim();
  const match = /^(.+?)(?::(\d+)(?::\d+)?|#L(\d+)(?:-L?\d+)?)$/.exec(ref);
  return match ? { path: match[1], line: Number(match[2] ?? match[3]) } : { path: ref };
}

/**
 * Inline code reads as a file when its name has a known extension (or is a Dockerfile /
 * Makefile). ponytail: an extension list, so `obj.ts`-style property chains can still match.
 */
export function looksLikePath(text: string): boolean {
  const { path } = parseFileRef(text);
  if (!path || /\s|:\/\/|^[-@$#]/.test(path)) return false;
  const name = path.split(/[\\/]/).pop() ?? "";
  if (/^(dockerfile|makefile)$/i.test(name)) return true;
  const ext = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1];
  return !!ext && name.length > ext.length + 1 && FILE_EXTENSIONS.has(ext.toLowerCase());
}

/** Absolute against the session folder, in that folder's separator style. */
export function resolvePath(path: string, cwd: string): string {
  if (!cwd || /^(?:[A-Za-z]:[\\/]|[\\/])/.test(path)) return path;
  const sep = cwd.includes("\\") ? "\\" : "/";
  const rel = path.replace(/^\.[\\/]/, "").replace(/[\\/]/g, sep);
  return cwd.endsWith(sep) ? cwd + rel : cwd + sep + rel;
}

// ---------------------------------------------------------------------------
// Streaming text

/**
 * Delay of the n-th word that just arrived; each fades in over 200ms (_fadeInText, c19e90103).
 * ponytail: the original's per-word schedule is computed in JS we did not trace; 20ms
 * apart, capped so a long delta lands within .3s.
 */
export function wordDelay(index: number): number {
  return Math.min(index * 20, 300);
}
