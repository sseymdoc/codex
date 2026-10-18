// Pure helpers behind the Code transcript (no DOM, no store), so `pnpm test` runs them
// directly. Values come from Claude Desktop 2.42304.0.0; the chunk each one was read from
// is named next to it.

// ---------------------------------------------------------------------------
// Working line: retries

/**
 * codex core notify_stream_error() sends "Reconnecting... 2/5" (or "... waiting for
 * network") with a codexErrorInfo; the Code working line reads
 * `{reason} · Retrying ({attempt}/{maxRetries}) · {elapsed}` (c96d752d0 w8).
 */
const RETRY_REASONS: Record<string, string> = {
  serverOverloaded: "服务器繁忙",
  rateLimitExceeded: "请求过多",
  usageLimitExceeded: "用量已达上限",
  internalServerError: "服务器出错",
  unauthorized: "需要重新登录",
  httpConnectionFailed: "网络连接失败",
  responseStreamConnectionFailed: "连接失败",
  responseStreamDisconnected: "连接中断",
  responseTooManyFailedAttempts: "多次重试失败",
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
    reason: /waiting for network/i.test(message) ? "等待网络" : (key && RETRY_REASONS[key]) || "连接中断",
    attempt: count ? Number(count[1]) : null,
    max: count ? Number(count[2]) : null,
  };
}

// ---------------------------------------------------------------------------
// Thinking

/** c96d752d0 BZ(): the thinking block copied as a Markdown quote, tokens ≈ chars / 4. */
export function quoteThinking(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => (line ? `> ${line}` : ">"));
  return `> **思考** (~${Math.round(text.length / 4)} tok)\n>\n${lines.join("\n")}`;
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
  /** The turn whose reply was pinned; the heading sits between its prompt and its reply. */
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
  const line = (text.split("\n").find((part) => part.trim()) ?? text).trim();
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

/** The session start first (when the session has a title), then the pins in transcript order. */
export function chapterList(title: string | null, anchors: string[], store: ChapterStore): Chapter[] {
  const order = new Map(anchors.map((id, index) => [id, index]));
  const pins: Chapter[] = store.userChapters
    .filter((chapter) => order.has(chapter.afterId))
    .sort((a, b) => order.get(a.afterId)! - order.get(b.afterId)!)
    .map((chapter) => ({ id: chapter.id, title: chapter.title, source: "user", anchor: chapter.afterId }));
  return title && anchors.length ? [{ id: SESSION_CHAPTER, title, source: "session", anchor: anchors[0] }, ...pins] : pins;
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
// Sub-agents: the workflow agent grid (c96d752d0 inline CSS c1bc4f7a0)

export type AgentCell = "done" | "running" | "stalled" | "pending" | "error";

/** CollabAgentStatus → grid cell. */
export function agentCell(status: string): AgentCell {
  switch (status) {
    case "running":
      return "running";
    case "pendingInit":
      return "pending";
    case "interrupted":
      return "stalled";
    case "errored":
    case "notFound":
      return "error";
    default:
      return "done";
  }
}

export function agentTally(cells: AgentCell[]): Record<AgentCell, number> {
  const tally: Record<AgentCell, number> = { done: 0, running: 0, stalled: 0, pending: 0, error: 0 };
  for (const cell of cells) tally[cell]++;
  return tally;
}

/** I0e(): a golden-ratio spread so a grid of running agents never pulses in step. */
export function agentPulse(index: number): { duration: number; delay: number } {
  const duration = 2.4 + ((index * 0.7548776662) % 1) * 1.4;
  return { duration, delay: -((index * 0.61803398875) % 1) * duration };
}

// ---------------------------------------------------------------------------
// Hooks

export const HOOK_EVENTS: Record<string, string> = {
  preToolUse: "工具调用前",
  permissionRequest: "权限请求",
  postToolUse: "工具调用后",
  preCompact: "压缩前",
  postCompact: "压缩后",
  sessionStart: "会话开始",
  sessionEnd: "会话结束",
  userPromptSubmit: "提交消息",
  subagentStart: "子代理启动",
  subagentStop: "子代理结束",
  stop: "停止",
  interrupt: "中断",
};

/** A hook earns a row only when it is still running, did not simply succeed, or said something. */
export function hookVisible(run: { status: string; entries: unknown[] }): boolean {
  return run.status !== "completed" || run.entries.length > 0;
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
