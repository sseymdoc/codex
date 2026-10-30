// The 资料库 preview's data, for LibraryFile.tsx: which renderer a file gets and whether it is small
// enough (library-file-preview-kind, library-cloud-file-preview), a file's node, versions and
// details, a deep research report's text, a note's autosave (preview-7136203c296a) and a flashcard
// set's reads and queued writes (data / persistence / preview chunks), as the Codex desktop app's
// library makes them. The note session and the flashcard queue are small state machines with no
// React in them: the panel subscribes. Bytes come through the bridge's /api/library/content.
import { Lexer, Parser, TextRenderer, type Token } from "marked";
import { CloudError, cloudCall, errorCode, list, obj, query, str } from "./cloud";
import { openWithDefaultApp } from "./files";
import { parentDir } from "./format";
import { attachLibraryFile, detachLibraryFile, extensionOf, invalidateLibrary, itemActions, libraryContentUrl, libraryState, parseNode, type LibraryAvailability, type LibraryNode } from "./library";
import { actionToast, dismissToast, toast } from "./store";

const call = <T>(method: string, path: string, body?: unknown) => cloudCall<T>(method, path, body, "ChatGPT");
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const time = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  const at = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : null;
};
const filePath = (id: string) => `/files/library/files/${encodeURIComponent(id)}`;

/** A preview's bytes at most (library-cloud-file-preview aa; the bridge's MAX_PREVIEW_BYTES). */
export const PREVIEW_MAX_BYTES = 41_943_040;
/** What the bridge saves for a chat or the system's app at most (local-file-selection b). */
export const ATTACH_MAX_BYTES = 47_185_920;
/** Text and HTML shown at most, in characters (library-cloud-file-preview's 5e6). */
export const TEXT_MAX_CHARS = 5_000_000;
/** An Office file's (a zip's) contents inflated at most before a renderer gets it. */
export const UNZIP_MAX_BYTES = 200 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Which preview (library-file-preview-kind s / f, the route's Jxs)

export type LibraryPreviewKind = "deep-research" | "image" | "pdf" | "csv" | "tsv" | "xlsx" | "docx" | "pptx" | "ipynb" | "markdown" | "html" | "text" | "unsupported";
/** A preview kind, or the route's own: a note's editor, a flashcard set's grid. */
export type LibraryRenderer = LibraryPreviewKind | "note" | "flashcards";

type Typed = Pick<LibraryNode, "artifact" | "category" | "mime" | "name" | "extension">;

/** y: the Office, notebook and table types by MIME type. */
const ARTIFACT_MIMES = new Map<string, LibraryPreviewKind>([
  ["application/x-ipynb+json", "ipynb"],
  ["application/vnd.ms-excel.sheet.macroenabled.12", "xlsx"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["text/csv", "csv"],
  ["text/tab-separated-values", "tsv"],
]);
/** WCr (eL): an extension's artifact type; pdf and tex are none (f's switch). */
const ARTIFACT_EXTENSIONS = new Map<string, LibraryPreviewKind | "tex">([["csv", "csv"], ["docx", "docx"], ["ipynb", "ipynb"], ["pdf", "pdf"], ["pptx", "pptx"], ["tex", "tex"], ["tsv", "tsv"], ["xlsm", "xlsx"], ["xlsx", "xlsx"]]);
/** TCr. */
const MARKDOWN_EXTENSIONS = new Set(["markdown", "md", "mdown", "mdx", "mkd"]);
/** v and _: text by MIME type and by extension. */
const TEXT_MIMES = new Set(["application/javascript", "application/json", "application/ld+json", "application/x-javascript", "application/x-ndjson", "application/xml", "application/yaml", "application/yml", "text/javascript"]);
const TEXT_EXTENSIONS = new Set(["c", "conf", "cpp", "css", "go", "h", "hpp", "java", "js", "json", "jsonl", "jsx", "log", "py", "rb", "rs", "sh", "ts", "tsx", "txt", "xml", "yaml", "yml"]);

const mimeOf = (node: Pick<LibraryNode, "mime">) => node.mime?.split(";")[0]?.trim().toLowerCase() || null;
const artifactByName = (name: string) => ARTIFACT_EXTENSIONS.get(extensionOf(name) ?? "") ?? null;

/** s: a file's preview by its type, MIME type and name, in the desktop app's order. */
export function previewKind(node: Typed): LibraryPreviewKind {
  if (node.artifact === "deep_research_report") return "deep-research";
  const mime = mimeOf(node);
  if (node.category === "image" || mime?.startsWith("image/")) return "image";
  if (node.category === "pdf" || mime === "application/pdf" || extensionOf(node.name) === "pdf") return "pdf";
  // f: the MIME type first, then file_extension, then the name; a pdf or tex extension ends the search.
  const byMime = mime === null ? undefined : ARTIFACT_MIMES.get(mime);
  if (byMime) return byMime;
  const byName = (node.extension ? artifactByName(`file.${node.extension}`) : null) ?? artifactByName(node.name);
  if (byName && byName !== "pdf" && byName !== "tex") return byName;
  const extension = extensionOf(node.name);
  if (MARKDOWN_EXTENSIONS.has(extension ?? "") || mime === "text/markdown") return "markdown";
  if (extension === "html" || extension === "htm" || mime === "text/html") return "html";
  if (node.category === "text" || mime?.startsWith("text/") || (mime !== null && TEXT_MIMES.has(mime)) || TEXT_EXTENSIONS.has(extension ?? "")) return "text";
  return "unsupported";
}

/** Rxs. */
const NOTE_MIMES = new Set(["text/markdown", "text/x-markdown", "application/markdown", "application/x-markdown"]);
/** Lxs: a .txt this small opens as a note. */
const NOTE_TXT_MAX_BYTES = 200_000;

/**
 * Jxs: a file that opens in the note editor: this account's own, not in the trash or an automation
 * plan, and a writing block, Markdown (Fxs: .md / .markdown, or a Markdown MIME type) or a .txt of
 * at most 200 000 bytes (Ixs; Pxs takes the name's last dot part).
 */
export function isLibraryNote(node: Pick<LibraryNode, "kind" | "trashedAt" | "artifact" | "own" | "name" | "mime" | "size">): boolean {
  if (node.kind !== "file" || node.trashedAt !== null || node.artifact === "automation_plan" || !node.own) return false;
  const extension = node.name.split(".").pop()?.toLowerCase();
  return node.artifact === "writing_block" || extension === "md" || extension === "markdown" || NOTE_MIMES.has(node.mime?.toLowerCase() ?? "")
    || (node.size !== null && node.size <= NOTE_TXT_MAX_BYTES && extension === "txt");
}

/**
 * The renderer for a file (the route's J, then library-cloud-file-preview's Ji): the note editor,
 * a flashcard grid, else its preview kind; automation plans, sites and app blocks (and files that
 * cannot be downloaded) get the fallback card.
 */
export function libraryRenderer(node: LibraryNode): LibraryRenderer {
  if (isLibraryNote(node)) return "note";
  if (node.artifact === "flashcards") return "flashcards";
  if (["automation_plan", "site", "site_preview", "app_block"].includes(node.artifact ?? "") || !itemActions(node, false).download) return "unsupported";
  return previewKind(node);
}

/**
 * Why a renderer that reads the file's bytes cannot (checked before it does): its size unknown
 * (the fallback card) or over 40 MiB (文件过大，无法预览, with 下载). The note, flashcard and deep
 * research renderers read the library's JSON or a small text, the fallback nothing: never.
 */
export function previewBlock(node: Pick<LibraryNode, "size">, renderer: LibraryRenderer): "unknown" | "tooLarge" | null {
  if (renderer === "note" || renderer === "flashcards" || renderer === "deep-research" || renderer === "unsupported") return null;
  if (node.size === null) return "unknown";
  return node.size > PREVIEW_MAX_BYTES ? "tooLarge" : null;
}

/** What the preview header offers for a file. */
export interface PreviewActions {
  /** 下载 (eSs / Bxs: not a flashcard set). */
  download: boolean;
  /** 版本历史 (da's versionHistoryEnabled: not an automation plan, a deep research report or a page). */
  versionHistory: boolean;
  /** 在系统应用中打开: downloadable, its size known and within what the bridge saves (45 MiB). */
  openInApp: boolean;
  /** 删除, on an image, a deep research report or a note only (enableDelete), when it is the account's own. */
  delete: boolean;
}

export function previewActions(node: LibraryNode, renderer: LibraryRenderer): PreviewActions {
  const actions = itemActions(node, false);
  return {
    download: actions.download,
    versionHistory: node.kind === "file" && !["automation_plan", "deep_research_report", "page"].includes(node.artifact ?? ""),
    openInApp: actions.download && node.size !== null && node.size <= ATTACH_MAX_BYTES,
    delete: actions.delete && (renderer === "image" || renderer === "deep-research" || renderer === "note"),
  };
}

/** A note or a flashcard set is read-only unless the account owns it (data g); an old version always is. */
export const libraryReadOnly = (node: Pick<LibraryNode, "access">, version?: Pick<LibraryVersion, "current"> | null) => node.access !== "owned" || version?.current === false;

/**
 * 文件类型 (FileInfoPanel B / W, in part): Word, Excel and PowerPoint by extension, else the
 * extension itself, else the category's word. ponytail: idn's per-format names (PDF document…)
 * are left out; the extension stands in for them.
 */
export function fileTypeLabel(node: Pick<LibraryNode, "name" | "extension" | "category" | "mime">): string {
  const extension = (node.extension ? extensionOf(`file.${node.extension}`) : null) ?? extensionOf(node.name);
  if (extension === "ppt" || extension === "pptx") return "PowerPoint";
  if (extension === "doc" || extension === "docx") return "Word 文档";
  if (extension === "xls" || extension === "xlsx" || extension === "xlsm") return "Excel 表格";
  if (extension) return extension.toUpperCase();
  const mime = mimeOf(node) ?? "";
  if (node.category === "image" || mime.startsWith("image/")) return "图像";
  if (mime.startsWith("audio/")) return "音频";
  if (mime.startsWith("video/")) return "视频";
  return node.category === "text" || mime.startsWith("text/") ? "文本" : "文件";
}

// ---------------------------------------------------------------------------
// A file, its versions and details

/**
 * A file by id when no list has it (library-file-metadata d): …/node (the bare files/<id> answers
 * 404); an own image with no type takes its newest version's. ponytail: no shared canonical id
 * (tat) and no page-by-page search of the library: codex-ui has no sharing.
 */
export async function fetchLibraryNode(id: string): Promise<LibraryNode> {
  const node = parseNode(await call<unknown>("GET", `${filePath(id)}/node`));
  if (!node) throw new CloudError(404, "无法打开此文件");
  if (node.access !== "owned" || node.category !== "image" || node.artifact !== null) return node;
  try {
    const artifact = (await fetchLibraryVersions(id, null, 1)).items[0]?.artifact;
    return artifact ? { ...node, artifact } : node;
  } catch {
    return node;
  }
}

/** One version of a file (versions' items). */
export interface LibraryVersion {
  number: number;
  current: boolean;
  /** The file service id its bytes are under: a version previews by it. */
  fileId: string | null;
  name: string;
  mime: string | null;
  size: number | null;
  category: string | null;
  artifact: string | null;
  /** version_created_at, else file_upload_time (ms). */
  createdAt: number | null;
  /** version_provenance: create / restore / edit, by whom (agent: ChatGPT; actor_id: the person), and why. */
  action: string | null;
  actor: string | null;
  actorId: string | null;
  reason: string | null;
}

/**
 * Who a version names (artifact-accessories te): ChatGPT for the agent, 协作者 for someone other
 * than `me`, else no one: a person's name or email is not shown there, as their identity is not
 * verified for display. te compares actor_id with the login's accountUserId (user-…__<account>);
 * the real account's actor_id is the user id (user-…, chatgpt_user_id), so either is this login.
 */
export function versionAuthor(version: Pick<LibraryVersion, "actor" | "actorId">, me: Pick<LibraryAvailability, "userId" | "accountUserId"> | null): string | null {
  if (version.actor === "agent") return "ChatGPT";
  const mine = [me?.userId, me?.accountUserId].filter(Boolean);
  return version.actorId !== null && mine.length > 0 && !mine.includes(version.actorId) ? "协作者" : null;
}

/** What a version was (te's f): its own action, else 已创建 for version 0 and 已编辑 for the rest. */
export const versionAction = (version: Pick<LibraryVersion, "action" | "number">) => version.action ?? (version.number === 0 ? "create" : "edit");

function parseVersion(raw: unknown): LibraryVersion | null {
  const item = obj(raw);
  const number = num(item.version_number);
  if (number === null) return null;
  const provenance = obj(item.version_provenance);
  return {
    number,
    current: item.is_current === true,
    fileId: str(item.file_id) || null,
    name: str(item.file_name),
    mime: str(item.mime_type) || null,
    size: num(item.file_size_bytes),
    category: str(item.library_file_category) || null,
    artifact: str(item.library_artifact_type) || null,
    createdAt: time(item.version_created_at) ?? time(item.file_upload_time),
    action: str(provenance.action) || null,
    actor: str(provenance.actor) || null,
    actorId: str(provenance.actor_id).trim() || null,
    reason: str(provenance.reason) || null,
  };
}

/** A page of a file's versions, newest first (context O: versions?limit=20, then its cursor; the newest alone: limit 1). */
export async function fetchLibraryVersions(id: string, cursor: string | null = null, limit = 20): Promise<{ items: LibraryVersion[]; cursor: string | null }> {
  const answer = obj(await call<unknown>("GET", `${filePath(id)}/versions${query({ cursor: cursor ?? undefined, limit })}`));
  return { items: list(answer.items).map(parseVersion).filter((item) => item !== null), cursor: str(answer.cursor) || null };
}

/** Versions by day as the list groups them: today, yesterday, else the day (its local midnight, ms). */
export function versionDays(items: readonly LibraryVersion[], now = Date.now()): { day: number; kind: "today" | "yesterday" | "date"; items: LibraryVersion[] }[] {
  const midnight = (at: number) => new Date(at).setHours(0, 0, 0, 0);
  const today = midnight(now);
  const yesterday = new Date(today).setDate(new Date(today).getDate() - 1);
  const days: { day: number; kind: "today" | "yesterday" | "date"; items: LibraryVersion[] }[] = [];
  for (const item of items) {
    const day = item.createdAt === null ? 0 : midnight(item.createdAt);
    const last = days.at(-1);
    if (last?.day === day) last.items.push(item);
    else days.push({ day, kind: day === today ? "today" : day === yesterday ? "yesterday" : "date", items: [item] });
  }
  return days;
}

/** A version as the file it was (previewVersion): its name, type and size, its bytes by its file id. */
export const versionNode = (node: LibraryNode, version: LibraryVersion): LibraryNode => ({
  ...node,
  fileId: version.fileId,
  name: version.name || node.name,
  mime: version.mime,
  size: version.size,
  category: version.category ?? node.category,
  artifact: version.artifact ?? node.artifact,
  version: version.number,
});

/**
 * 恢复此版本 (context O's H): POST …/versions/<n>/restore {expected_current_version}, the current
 * version as the list has it, so an edit since fails it. The file comes back as restored (its
 * new version and file id; the library reads anew), or null after 文件已更改，或无法恢复此版本。请重试.
 */
export async function restoreLibraryVersion(node: LibraryNode, version: LibraryVersion, current: LibraryVersion): Promise<LibraryNode | null> {
  if (version.current || version.number === current.number) return null;
  const { account } = libraryState();
  try {
    const answer = obj(await call<unknown>("POST", `${filePath(node.id)}/versions/${version.number}/restore`, { expected_current_version: current.number }));
    const restored = parseNode({ ...answer, kind: "file" });
    if (!restored || restored.version === null) throw new Error("The restored Library file revision is unavailable");
    if (libraryState().account === account) invalidateLibrary();
    return restored;
  } catch {
    if (libraryState().account === account) toast("danger", "文件已更改，或无法恢复此版本。请重试");
    return null;
  }
}

/** 文件详情's own reads (query l): when it last changed (its newest version), and the chat that made it, with that chat's title. */
export interface LibraryFileInfo {
  updatedAt: number | null;
  /** 关联聊天, shown by its title (未命名聊天 without one); null when the file names none or it cannot be read. */
  chat: { id: string; title: string | null } | null;
}

export async function fetchLibraryFileInfo(node: LibraryNode): Promise<LibraryFileInfo> {
  const [latest, chat] = await Promise.all([
    fetchLibraryVersions(node.id, null, 1).then((page) => page.items[0] ?? null, () => null),
    node.threadId
      ? call<unknown>("GET", `/conversation/${encodeURIComponent(node.threadId)}`).then((answer) => ({ id: node.threadId!, title: str(obj(answer).title) || null }), () => null)
      : null,
  ]);
  return { updatedAt: latest?.createdAt ?? node.updatedAt, chat };
}

// ---------------------------------------------------------------------------
// Bytes, and the system's app

async function content(node: Pick<LibraryNode, "id" | "name" | "fileId">, versionFileId?: string | null, kind: "content" | "note" = "content"): Promise<Response> {
  const url = libraryContentUrl(node, kind, versionFileId ?? undefined);
  if (!url) throw new Error("未连接到 app-server");
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    await response.body?.cancel();
    throw new CloudError(response.status, response.status === 413 ? "文件过大，无法预览" : "无法打开此文件");
  }
  return response;
}

/** A file's text (a version's, by its file id; a note's old version as `note`), cut at 5 000 000 characters. */
export async function fetchLibraryText(node: Pick<LibraryNode, "id" | "name" | "fileId">, versionFileId?: string | null, kind?: "content" | "note"): Promise<{ text: string; truncated: boolean }> {
  const text = await (await content(node, versionFileId, kind)).text();
  return text.length > TEXT_MAX_CHARS ? { text: text.slice(0, TEXT_MAX_CHARS), truncated: true } : { text, truncated: false };
}

/** A file's bytes (a version's, by its file id), for the Office, sheet and notebook renderers. */
export const fetchLibraryBytes = async (node: Pick<LibraryNode, "id" | "name" | "fileId">, versionFileId?: string | null): Promise<ArrayBuffer> => (await content(node, versionFileId)).arrayBuffer();

/**
 * 在系统应用中打开: the bridge saves the file under CODEX_HOME/attachments (/api/library/attach),
 * then it opens there as files.ts opens one (the same gate: an executable type is refused, and
 * the copy goes again; the panel says to download it instead). "failed": not saved at all.
 */
export async function openLibraryFileInApp(node: LibraryNode): Promise<"opened" | "refused" | "failed"> {
  if (node.size === null || node.size > ATTACH_MAX_BYTES) return "failed";
  let path: string;
  try {
    ({ path } = await attachLibraryFile(node));
  } catch {
    return "failed";
  }
  // ponytail: a copy that opened stays under attachments (the app may still have it open).
  if (await openWithDefaultApp(path, parentDir(path))) return "opened";
  await detachLibraryFile(path);
  return "refused";
}

// ---------------------------------------------------------------------------
// Deep research (library-deep-research-preview)

const REPORT_KEY = /^(?:report(?:_markdown|_text)?|markdown|content|text|body)$/i;

/**
 * The longest non-empty string under a report-ish key in `value`, a few levels down. ponytail: the
 * report's key tree is unverified (no sample on the probed account, and the desktop app hands
 * get_state's answer to its deep-research widget unread); upgrade once a real one is seen.
 */
export function reportText(value: unknown, depth = 0): string | null {
  let best: string | null = null;
  const consider = (text: string | null) => {
    if (text?.trim() && (best === null || text.length > best.length)) best = text;
  };
  if (depth > 6) return null;
  if (Array.isArray(value)) value.forEach((item) => consider(reportText(item, depth + 1)));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) consider(typeof item === "string" ? (REPORT_KEY.test(key) ? item : null) : reportText(item, depth + 1));
  }
  return best;
}

/**
 * A saved deep research report as Markdown: GET …/deep-research ({widget_state, tool_output,
 * tool_response_metadata}), then its widget's tools/get_state ({isError, structuredContent,
 * meta}); the text from get_state, else from tool_output (reportText). Null: none found (the
 * fallback card with 重试预览). Throws when the report cannot be read at all.
 */
export async function fetchDeepResearch(id: string): Promise<string | null> {
  const path = `${filePath(id)}/deep-research`;
  const saved = obj(await call<unknown>("GET", path));
  const state = obj(await call<unknown>("POST", `${path}/tools/get_state`, { args: {} }).catch(() => null));
  return (state.isError === true ? null : reportText(state.structuredContent)) ?? reportText(saved.tool_output);
}

// ---------------------------------------------------------------------------
// Notes (preview-7136203c296a)

const UNTITLED = "Untitled.md";
/** Lt. */
const NAME_GRAPHEMES = 50;

/** B5 in part: the entities a line's text may spell (numeric ones, and the common names). */
function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: String.fromCharCode(0xa0) };
  return text.replace(/&(#(?:\d+|[xX][\da-fA-F]+)|[a-zA-Z][a-zA-Z0-9]+);/g, (whole, name: string) => {
    if (!name.startsWith("#")) return named[name] ?? whole;
    const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    try {
      return String.fromCodePoint(code);
    } catch {
      return whole;
    }
  });
}

/** Mt: inline tokens as plain text (emphasis and links by their text, HTML dropped). */
function plainInline(tokens: readonly Token[]): string {
  return tokens.map((token) => {
    if (token.type === "text" && typeof token.text === "string") return decodeEntities(token.text);
    if (["strong", "em", "del", "link", "image"].includes(token.type) && "tokens" in token && token.tokens) return plainInline(token.tokens);
    if (token.type === "html") return "";
    return new Parser().parseInline([token], new TextRenderer());
  }).join("");
}

/** Pt: a line's first block as plain text, when it is a paragraph, heading, list, quote or code. */
function plainBlock(token: Token | undefined): string {
  if (!token) return "";
  switch (token.type) {
    case "heading":
    case "paragraph":
      return plainInline(token.tokens ?? []);
    case "list":
      return token.items[0] ? plainInline(Lexer.lexInline(token.items[0].text)) : "";
    case "blockquote":
      return plainBlock(token.tokens?.[0]);
    case "code":
      return token.text;
    default:
      return "";
  }
}

/** Ft: the note's first line with text, as plain text (a task's box and spacing gone), or null. */
function firstLine(content: string): string | null {
  for (const line of content.split(/\r\n?|\n/)) {
    if (line.trim() === "") continue;
    const text = plainBlock(Lexer.lex(line, { gfm: true })[0]).replace(/^\[[ xX]\]\s+/, "").replaceAll(/\s+/g, " ").replaceAll(/\p{Cc}/gu, "").trim();
    if (text !== "") return text;
  }
  return null;
}

/** It: at most 50 graphemes, cut back to a word's end when that falls mid-word. */
function clipName(name: string): string {
  const graphemes = typeof Intl.Segmenter === "function" ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name), ({ segment }) => segment) : Array.from(name);
  if (graphemes.length <= NAME_GRAPHEMES) return name;
  const cut = graphemes.slice(0, NAME_GRAPHEMES).join("");
  if (graphemes[NAME_GRAPHEMES] === " ") return cut;
  const space = cut.lastIndexOf(" ");
  return space === -1 ? cut : cut.slice(0, space);
}

/**
 * At: a new note's file name from its first line with text: Markdown marks gone, a trailing .md
 * dropped, / and \ as -, at most 50 graphemes, then .md; Untitled.md when there is none.
 */
export function noteFileName(content: string): string {
  const line = firstLine(content);
  if (line === null) return UNTITLED;
  const name = line.replace(/\.md$/i, "").replaceAll(/[\\/]/g, "-").trim();
  return name === "" ? UNTITLED : `${clipName(name)}.md`;
}

/** What failed a note's save (the catch in Gt's R2): ChatGPT's storage full, the note too large (413), else anything (409 too). */
export type NoteFailure = "storage" | "size" | "save";

export function noteFailure(error: unknown): NoteFailure {
  if (errorCode(error) === "library_storage_limit_exceeded") return "storage";
  return error instanceof CloudError && error.status === 413 ? "size" : "save";
}

export interface NoteState {
  /** The editor's text. */
  content: string;
  /** What the library holds, as last saved or read. */
  savedContent: string;
  /** The name it saves under: an existing note's own; a new one's follows its first line all session (At). */
  fileName: string;
  /** The note's file; null until a new note's first save creates it. */
  file: LibraryNode | null;
  saving: boolean;
  /** The last save's failure: autosave waits until 重试 (flush) or a close. */
  failure: NoteFailure | null;
  versionNumber: number | null;
  /** A restored version's text loading, or failed to load (editing waits until reload succeeds). */
  restore: "pending" | "failed" | null;
}

/** Ht: there is something to save: a new note with any text, an existing one changed or renamed. */
export const noteDirty = (state: Pick<NoteState, "file" | "content" | "savedContent" | "fileName">) =>
  state.file === null ? !!state.content.trim() : state.content !== state.savedContent || state.fileName !== state.file.name;

/** A note being edited (Gt): its autosave, shared by every view of it, kept until a view lets go with nothing left to save. */
export interface NoteSession {
  /** A new note's create_key (library-note:<uuid>, Qn's noteId: its first save is idempotent), else its file's id. */
  readonly key: string;
  readonly state: NoteState;
  subscribe(listener: () => void): () => void;
  /** The editor changed: saved 500 ms after the last change, unless a save failed (then only on 重试 / flush). */
  edit(content: string): void;
  /**
   * Saves now (blur, 下载, 版本历史, close, 重试): one save at a time, which keeps saving until the text
   * stops changing. Resolves to whether all is saved.
   */
  flush(): Promise<boolean>;
  /** 关闭: flushes first; false (stay open) when that failed, unless on a full storage. */
  close(): Promise<boolean>;
  /**
   * A view of it mounted; the returned detach flushes (not on a full storage, nor when another
   * view attaches at once), and with no view left either lets the note go (saved) or toasts
   * 笔记更改未能保存… (it stays, for 新建 → 笔记 and the panel opened again).
   */
  attach(): () => void;
  /**
   * After 恢复此版本: the restored file's text, read anew (content_url), replaces what is shown, when
   * nothing is waiting to save; else, or if it cannot be read, `restore` is failed (重试: again).
   */
  reload(file?: LibraryNode): Promise<boolean>;
  /**
   * The note renamed elsewhere (the list's 重命名, beside the panel): an existing note's name, which
   * it saves under, becomes `file`'s, so its next save does not name it back. A new note's name
   * follows its first line instead (At), and a rename of its own still waiting to go out stays.
   */
  adopt(file: Pick<LibraryNode, "id" | "name">): void;
}

const notes = new Map<string, NoteSession>();
/** The new note last typed into and not yet let go (Le): 新建 → 笔记 opens it again. */
let draft: { account: string | null | undefined; session: NoteSession } | null = null;
const noteKey = (account: string | null | undefined, id: string) => `${account ?? ""}\n${id}`;
/** The bridge takes at most 1 MiB a call (/api/cloud): a note past that fails as too large, not as 请重试 forever. */
const BRIDGE_BODY_BYTES = 1024 * 1024 - 4096;

/** A note's text as the library holds it now: by its own id (content_url), never a file id's older bytes. */
export async function fetchNoteText(file: Pick<LibraryNode, "id" | "name">): Promise<string> {
  return (await content({ id: file.id, name: file.name, fileId: null })).text();
}

/** The note held under `key` (新建 → 笔记's create_key, or a file id) on this account, if any. */
export const noteSessionOf = (key: string): NoteSession | null => notes.get(noteKey(libraryState().account, key)) ?? null;

/** The session for an existing note, `content` its text as just read (a session still saving keeps its own). */
export function openNote(file: LibraryNode, content: string): NoteSession {
  const account = libraryState().account;
  return notes.get(noteKey(account, file.id)) ?? noteSession(account, file.id, { file, content }, null);
}

/**
 * 新建 → 笔记: an empty note in `directoryId` (null: the root), created on its first save with text
 * (POST inline-content, writing_block); closed with none, nothing is made. A new note whose changes
 * could not be saved is opened again instead (its draft).
 */
export function newNote(directoryId: string | null): NoteSession {
  const account = libraryState().account;
  if (draft && draft.account === account) return draft.session;
  return noteSession(account, `library-note:${crypto.randomUUID()}`, null, directoryId);
}

function noteSession(account: string | null | undefined, key: string, init: { file: LibraryNode; content: string } | null, directoryId: string | null): NoteSession {
  let state: NoteState = { content: init?.content ?? "", savedContent: init?.content ?? "", fileName: init?.file.name ?? UNTITLED, file: init?.file ?? null, saving: false, failure: null, versionNumber: init?.file.version ?? null, restore: null };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<NoteState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const active = () => libraryState().account === account;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<boolean> | null = null;
  /** A new note's first save, as it first went (_2): a retry sends the same, under the same create_key. */
  let creating: { content: string; fileName: string } | null = null;
  let storageToast: number | null = null;
  let views = 0;
  let restored: LibraryNode | null = null;

  async function save(): Promise<boolean> {
    if (storageToast !== null) dismissToast(storageToast);
    storageToast = null;
    set({ saving: true, failure: null });
    try {
      for (;;) {
        const now = state;
        if (!noteDirty(now) && (now.file !== null || creating === null)) return true;
        if (!active()) {
          set({ failure: "save" });
          return false;
        }
        const create = now.file === null;
        if (create) creating ??= { content: now.content, fileName: now.fileName };
        const { content, fileName } = create ? creating! : now;
        const body = create
          ? { content: content || "\n", file_name: fileName, create_key: key, directory_id: directoryId, library_file_info: { library_artifact_type: "writing_block" } }
          : { inline_content: content || "\n", file_name: fileName };
        if (new TextEncoder().encode(JSON.stringify(body)).length > BRIDGE_BODY_BYTES) throw new CloudError(413, "此笔记过大，请缩短内容后重试");
        const answer = obj(await call<unknown>(create ? "POST" : "PATCH", create ? "/files/library/files/inline-content" : filePath(now.file!.id), body));
        const file = str(answer.id) && str(answer.file_id) ? parseNode({ ...answer, kind: "file" }) : null;
        if (!file) throw new CloudError(502, "Created Library note is missing its file id", "missing_library_file");
        set({ file, savedContent: content, versionNumber: file.version, fileName: state.fileName === fileName ? file.name || fileName : state.fileName });
        // Opened again later by its file, it is this session still.
        if (create) notes.set(noteKey(account, file.id), session);
        invalidateLibrary();
      }
    } catch (error) {
      const failure = noteFailure(error);
      if (failure !== "save") creating = null;
      set({ failure });
      if (failure === "storage") storageToast = actionToast(state.file ? "未成功保存笔记" : "未成功创建笔记", { label: "重试", run: () => void session.flush() }, "danger", Infinity);
      return false;
    } finally {
      clearTimeout(timer);
      set({ saving: false });
    }
  }

  const session: NoteSession = {
    key,
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    edit(content) {
      if (!init) draft = { account, session };
      set({ content, fileName: init ? state.fileName : noteFileName(content) });
      clearTimeout(timer);
      if (state.failure === null) timer = setTimeout(() => void session.flush(), 500);
    },
    flush() {
      clearTimeout(timer);
      return (running ??= save().finally(() => {
        running = null;
      }));
    },
    async close() {
      if (state.failure === "storage") return true;
      // A save that ran out of storage meanwhile closes too (the toast keeps its 重试).
      return (await session.flush()) || session.state.failure === "storage";
    },
    attach() {
      views++;
      let attached = true;
      return () => {
        if (!attached) return;
        attached = false;
        views--;
        if (state.failure === "storage") return void clearTimeout(timer);
        // Let go for good, not handed at once to a view taking over (a panel mounted anew, StrictMode's
        // second mount): that one keeps it as it is, a failed save still waiting for 重试.
        queueMicrotask(() => {
          if (views > 0) return;
          void session.flush().then((saved) => {
            if (views > 0) return;
            if (!saved) {
              if (state.failure !== "storage") toast("danger", "笔记更改未能保存。请返回资料库重试；如果是新建的笔记，请选择“新建”→“笔记”重新打开草稿", undefined, Infinity);
              return;
            }
            for (const [id, known] of notes) if (known === session) notes.delete(id);
            if (draft?.session === session) draft = null;
          });
        });
      };
    },
    async reload(file = restored ?? undefined) {
      if (!file) return false;
      restored = file;
      set({ restore: "pending" });
      try {
        const text = await fetchNoteText(file);
        if (running === null && !noteDirty(state) && state.file?.id === file.id) {
          set({ content: text, savedContent: text, file, fileName: file.name, saving: false, failure: null, versionNumber: file.version, restore: null });
          restored = null;
          return true;
        }
      } catch {
        // As below: 重试 reads again.
      }
      set({ restore: "failed" });
      return false;
    },
    adopt(file) {
      const now = state.file;
      if (!init || !now || file.id !== now.id || !file.name || file.name === state.fileName || state.fileName !== now.name) return;
      set({ file: { ...now, name: file.name }, fileName: file.name });
    },
  };
  notes.set(noteKey(account, key), session);
  return session;
}

// ---------------------------------------------------------------------------
// Flashcards (data-e359fea3806f, persistence-85a6a812644e, preview-ac3b052303f6)

export interface Flashcard {
  id: string;
  front: string;
  back: string;
}

/** A flashcard set as the library keeps it (data C). */
export interface FlashcardDeck {
  schema_version: 1;
  artifact_type: "flashcards";
  title: string;
  cards: Flashcard[];
}

/** One change to a set (persistence's edit): a card added (no previousCard), changed, or deleted. */
export interface FlashcardEdit {
  id: string;
  card: Flashcard;
  /** The card as it was when its editor opened; null for a new card. */
  previousCard: Flashcard | null;
  delete?: boolean;
}

/** A side's limit, in code points (v; the editor's 每面的内容请勿超过 {limit} 个字符). */
export const FLASHCARD_SIDE_MAX = 400;
export const FLASHCARDS_MAX = 100;

/** v: a side past 400 code points. */
export function flashcardSideTooLong(text: string): boolean {
  let count = 0;
  for (const _ of text) if (++count > FLASHCARD_SIDE_MAX) return true;
  return false;
}

const side = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && !flashcardSideTooLong(value);

/**
 * data C: schema_version 1, artifact_type flashcards, a title of 1–120 characters, 1–100 cards
 * with distinct ids (1–128 characters) and sides of 1–400; null for anything else. Like zod's
 * object, only those fields are kept.
 */
export function parseFlashcards(raw: unknown): FlashcardDeck | null {
  const deck = obj(raw);
  if (deck.schema_version !== 1 || deck.artifact_type !== "flashcards" || typeof deck.title !== "string" || deck.title.length < 1 || deck.title.length > 120) return null;
  if (!Array.isArray(deck.cards) || deck.cards.length < 1 || deck.cards.length > FLASHCARDS_MAX) return null;
  const cards: Flashcard[] = [];
  for (const entry of deck.cards) {
    const card = obj(entry);
    if (typeof card.id !== "string" || card.id.length < 1 || card.id.length > 128 || !side(card.front) || !side(card.back)) return null;
    cards.push({ id: card.id, front: card.front, back: card.back });
  }
  return new Set(cards.map((card) => card.id)).size === cards.length ? { schema_version: 1, artifact_type: "flashcards", title: deck.title, cards } : null;
}

/**
 * A set's version and whether this account may change it (data g, by …/node: the bare files/<id>
 * answers 404): read-only unless owned; one in the trash, or not a set, is unavailable (throws).
 */
export async function fetchFlashcardsMeta(id: string): Promise<{ version: number | null; readOnly: boolean }> {
  const node = obj(await call<unknown>("GET", `${filePath(id)}/node`));
  if (node.trashed_at || (node.library_artifact_type !== "flashcards" && !(node.access_kind === "owned" && node.library_artifact_type == null))) throw new Error("Flashcard deck is unavailable");
  return { version: num(node.current_version_number), readOnly: node.access_kind == null || node.access_kind !== "owned" };
}

/** A set's cards (data b): the current one's by its id (content_url), an old version's by that version's file id. Throws when invalid. */
export async function fetchFlashcards(node: Pick<LibraryNode, "id" | "name">, versionFileId?: string | null): Promise<FlashcardDeck> {
  const deck = parseFlashcards(JSON.parse(await (await content({ id: node.id, name: node.name, fileId: null }, versionFileId)).text()));
  if (!deck) throw new Error("This flashcard deck couldn’t be loaded");
  return deck;
}

/** data x, before each write: the set and its version as they are now; no version on the node, the current one in versions. */
async function freshFlashcards(id: string): Promise<{ deck: FlashcardDeck; version: number }> {
  const meta = await fetchFlashcardsMeta(id);
  if (meta.readOnly) throw new Error("Flashcard editing is unavailable");
  const version = meta.version ?? (await fetchLibraryVersions(id, null, 1)).items.find((item) => item.current)?.number ?? null;
  if (version === null) throw new Error("Flashcard editing is unavailable");
  return { deck: await fetchFlashcards({ id, name: "flashcards.json" }), version };
}

/** Each card's last review (progress's card_progress[id].reviews.at(-1).outcome), the grid's 已掌握 / 未掌握. */
export async function fetchFlashcardProgress(id: string): Promise<Record<string, "known" | "missed">> {
  const answer = obj(await call<unknown>("GET", `/learning/flashcards/${encodeURIComponent(id)}/progress`));
  const outcomes: Record<string, "known" | "missed"> = {};
  for (const [card, entry] of Object.entries(obj(answer.card_progress))) {
    const outcome = obj(list(obj(entry).reviews).at(-1)).outcome;
    if (outcome === "known" || outcome === "missed") outcomes[card] = outcome;
  }
  return outcomes;
}

/** persistence C: the set with `edit` in it (a deleted card out, a changed one in place, a new one last). */
export function applyFlashcardEdit(deck: FlashcardDeck, edit: FlashcardEdit): FlashcardDeck {
  if (edit.delete) return { ...deck, cards: deck.cards.filter((card) => card.id !== edit.card.id) };
  return { ...deck, cards: deck.cards.some((card) => card.id === edit.card.id) ? deck.cards.map((card) => (card.id === edit.card.id ? edit.card : card)) : [...deck.cards, edit.card] };
}

/**
 * persistence T: whether `edit` still fits the set as the library has it: a new card's id is not
 * there; a changed or deleted card is there as its editor opened it (a deletion of one gone fits;
 * of the last card does not).
 */
export function flashcardEditApplies(edit: FlashcardEdit, deck: FlashcardDeck): boolean {
  const there = deck.cards.find((card) => card.id === edit.card.id);
  if ((edit.delete && (there === undefined || deck.cards.length <= 1)) || edit.previousCard === null) return there === undefined;
  return there !== undefined && there.front === edit.previousCard.front && there.back === edit.previousCard.back;
}

export interface FlashcardQueueState {
  /** Edits waiting or being written, in order. */
  pending: readonly FlashcardEdit[];
  /** Edits that failed, a card's latest: its draft (恢复草稿, the editor's saveError). */
  failed: readonly FlashcardEdit[];
  /** The current set as last loaded, read before a write or written (the desktop app's query cache); null before any. */
  deck: FlashcardDeck | null;
}

/** The grid's cards: the set with the pending edits in it (preview je's Se reduce); null until loaded. */
export const flashcardView = (state: FlashcardQueueState): FlashcardDeck | null => state.deck && state.pending.reduce(applyFlashcardEdit, state.deck);

/**
 * A current set's reads and writes (persistence E), kept per account and set; an old version is
 * read on its own (fetchFlashcards with its file id), never written.
 */
export interface FlashcardQueue {
  readonly state: FlashcardQueueState;
  subscribe(listener: () => void): () => void;
  /** Reads the current set into `deck` (重试 after loadError reads again); rejects when it cannot be read or is invalid. */
  load(): Promise<FlashcardDeck>;
  /**
   * Queues `edit` (its card's old failure cleared). Each write reads the set anew, checks the edit
   * still fits (flashcardEditApplies), and PATCHes /learning/flashcards/<id> {artifact,
   * expected_current_version} under the version just read; a 409 reads and checks again and is
   * sent once more. Saved: the library reads anew, then `onSaved`. Failed: the edit is kept, and
   * 未能保存你对闪卡的更改 stays up, with 恢复草稿 (`onRecover`) while that edit is still the failed one.
   */
  enqueue(edit: FlashcardEdit, options?: { onSaved?(): void; onRecover?(edit: FlashcardEdit): void }): void;
  clearFailure(cardId: string): void;
}

const queues = new Map<string, FlashcardQueue>();

export function flashcardQueue(id: string): FlashcardQueue {
  const account = libraryState().account;
  const known = queues.get(noteKey(account, id));
  if (known) return known;
  let state: FlashcardQueueState = { pending: [], failed: [], deck: null };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<FlashcardQueueState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const active = () => libraryState().account === account;
  const others = (edits: readonly FlashcardEdit[], edit: FlashcardEdit) => edits.filter((entry) => entry.card.id !== edit.card.id);
  const patch = (artifact: FlashcardDeck, version: number) =>
    call<unknown>("PATCH", `/learning/flashcards/${encodeURIComponent(id)}`, { artifact, expected_current_version: version });
  let chain = Promise.resolve();

  async function write(edit: FlashcardEdit, onSaved?: () => void, onRecover?: (edit: FlashcardEdit) => void): Promise<void> {
    let saved = false;
    try {
      if (!active()) return;
      let fresh = await freshFlashcards(id);
      if (!active()) return;
      set({ deck: fresh.deck });
      if (!flashcardEditApplies(edit, fresh.deck)) throw new Error("This flashcard changed while it was being edited");
      let next = applyFlashcardEdit(fresh.deck, edit);
      try {
        await patch(next, fresh.version);
      } catch (error) {
        if (!(error instanceof CloudError && error.status === 409) || !active()) throw error;
        fresh = await freshFlashcards(id);
        if (!active()) return;
        set({ deck: fresh.deck });
        if (!flashcardEditApplies(edit, fresh.deck)) throw error;
        next = applyFlashcardEdit(fresh.deck, edit);
        await patch(next, fresh.version);
      }
      saved = true;
      if (!active()) return;
      set({ deck: next });
      invalidateLibrary();
      onSaved?.();
    } catch {
      if (saved || !active()) return;
      set({ failed: [...others(state.failed, edit), edit] });
      const title = "未能保存你对闪卡的更改";
      if (!onRecover) toast("danger", title, undefined, Infinity);
      else actionToast(title, { label: "恢复草稿", run: () => active() && state.failed.some((entry) => entry.id === edit.id) && onRecover(edit) }, "danger", Infinity);
    } finally {
      set({ pending: state.pending.filter((entry) => entry.id !== edit.id) });
    }
  }

  const queue: FlashcardQueue = {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async load() {
      const deck = await fetchFlashcards({ id, name: "flashcards.json" });
      if (active()) set({ deck });
      return deck;
    },
    enqueue(edit, { onSaved, onRecover } = {}) {
      if (!active()) return;
      set({ failed: others(state.failed, edit), pending: [...state.pending, edit] });
      chain = chain.then(() => write(edit, onSaved, onRecover));
    },
    clearFailure(cardId) {
      if (state.failed.some((entry) => entry.card.id === cardId)) set({ failed: state.failed.filter((entry) => entry.card.id !== cardId) });
    },
  };
  queues.set(noteKey(account, id), queue);
  return queue;
}

/**
 * The preview's CSV (Oe / G): 标题.csv (characters a file name cannot hold as -, a .flashcards or
 * .csv end dropped; Flashcards.csv with none left), Front,Back, CRLF, every value quoted, one
 * starting with = + - @ (after spaces or controls) or a tab or line break led by ' so a sheet does not run it.
 */
export function flashcardsCsv(deck: Pick<FlashcardDeck, "title" | "cards">): { name: string; text: string } {
  const title = deck.title.replace(/[<>:"/\\|?*\p{Cc}]/gu, "-").replace(/\.(flashcards|csv)$/i, "").trim();
  const cell = (value: string) => `"${(/^[\t\r\n]|^[\s\p{Cc}]*[=+\-@]/u.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
  return { name: `${title || "Flashcards"}.csv`, text: `${["Front,Back", ...deck.cards.map((card) => `${cell(card.front)},${cell(card.back)}`)].join("\r\n")}\r\n` };
}

/** Saves the set's CSV (ue: a Blob through a link). */
export function downloadFlashcardsCsv(deck: Pick<FlashcardDeck, "title" | "cards">): void {
  const { name, text } = flashcardsCsv(deck);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ---------------------------------------------------------------------------
// Office files are zips

type Streamable = import("jszip").JSZipObject & { internalStream(type: "uint8array"): import("jszip").JSZipStreamHelper<Uint8Array> };

/**
 * A docx / pptx / xlsx opened as a zip with every entry inflated and counted first, a chunk at a
 * time (internalStream), stopping once the total passes `limit`: an entry's declared size in the
 * central directory is the file's word, not a fact. Resolves to the zip (pptx reads it on), or null
 * past the limit; rejects when it is no zip.
 */
export async function unzipWithin(data: ArrayBuffer | Uint8Array, limit = UNZIP_MAX_BYTES): Promise<import("jszip") | null> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  let total = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const over = await new Promise<boolean>((resolve, reject) => {
      const stream = (entry as Streamable).internalStream("uint8array");
      stream
        .on("data", (chunk) => {
          total += chunk.length;
          if (total <= limit) return;
          stream.pause();
          resolve(true);
        })
        .on("error", reject)
        .on("end", () => resolve(false))
        .resume();
    });
    if (over) return null;
  }
  return zip;
}

/**
 * The counted zip written out again, uncompressed, for a reader with its own zip parser (SheetJS):
 * it then gets only what unzipWithin counted. Read as it came, the file's central directory could
 * hand it entries JSZip drops (a name given twice keeps its last, a directory's data none),
 * inflated past the limit.
 */
export const storedZip = (zip: import("jszip")): Promise<Uint8Array> => zip.generateAsync({ type: "uint8array", compression: "STORE" });
