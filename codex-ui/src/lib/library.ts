// The ChatGPT app's 资料库 (/library): the account's files and folders on ChatGPT, read through the
// bridge's /api/cloud (server/cloud.mjs) as the Codex desktop app's library page reads them
// (app-initial OX and the calls it dispatches to). Whether this login has it, and its gated parts,
// comes from /api/library/available (server/library.mjs); file bytes from /api/library/content.
// Lists, folder paths and storage live in this module's store, kept per account; so do the
// changes under way (app-initial MCs / NCs) and the upload queue, which outlives the page.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { CloudError, cloudCall, list, obj, query, str } from "./cloud";
import { connectionId, openLibrary } from "./codex";
import { actionToast, getState, readJson, setState, toast, useStore, writeJson, type LibraryTab } from "./store";

export type LibraryCategory = "images" | "documents" | "spreadsheets" | "presentations" | "pdfs";
export type LibrarySource = "uploaded" | "generated";
export type LibraryView = "grid" | "list";
/** Which date a list shows and sorts by (vTo): last activity, deleted, saved to favorites, modified. */
export type DateKind = "suggested" | "deleted" | "saved" | "modified";

/**
 * A file or folder as the page draws it. The library answers in two shapes: nodes (kind, name,
 * parent_directory_id) and /files/library's files (no kind; file_name, directory_id), which the
 * desktop app turns into nodes (AX); search results and favorites carry either.
 */
export interface LibraryNode {
  id: string;
  kind: "file" | "directory";
  name: string;
  parentId: string | null;
  /** The file service id behind a library file (its current version's). */
  fileId: string | null;
  mime: string | null;
  /** bytes */
  size: number | null;
  /** library_file_category: image, video, text, pdf, other… */
  category: string | null;
  /** library_artifact_type: null for an upload, else what ChatGPT made (image, report, writing_block…). */
  artifact: string | null;
  /** ms */
  updatedAt: number | null;
  lastUsedAt: number | null;
  trashedAt: number | null;
  /** When it was added to favorites (the favorites list only). */
  savedAt: number | null;
  /** The node names a thumbnail (thumbnail_url: the web's /library/files/<id>/thumbnail route). */
  thumbnail: boolean;
  width: number | null;
  height: number | null;
  /**
   * This account's own native item (N5 and j5): not a root, a share, a site, a page or a favorite's
   * saved entity. Rename, move, delete and restore take only these.
   */
  own: boolean;
  /** A favorite's saved entity or saved chat message (P5), not a file of the library's own. */
  saved: boolean;
  /** The favorite it is listed as (the favorites list's favorite_id), null elsewhere. */
  favoriteId: string | null;
  /** file_extension, as the item gives it (the preview's kind goes by it before the name). */
  extension: string | null;
  /** access_kind: owned, shared… (a note or a flashcard set is read-only unless owned). */
  access: string | null;
  /** record_creation_time, else file_upload_time (ms). */
  createdAt: number | null;
  /** The chat that made it (origination_thread_id). */
  threadId: string | null;
  /** current_version_number, when the answer has it (a save's, a restore's; list items do not). */
  version: number | null;
}

/** What the page shows: a tab, a folder, the trash, and the search and filters over it. */
export interface LibraryQuery {
  tab: LibraryTab;
  directoryId: string | null;
  deleted: boolean;
  search: string;
  categories: LibraryCategory[];
  sources: LibrarySource[];
}

export interface LibraryList {
  items: LibraryNode[];
  cursor: string | null;
  loading: boolean;
  /**
   * The last fetch failed: its status (0 without one) and the cursor it was for (null: the first
   * page, or a cursor the server dropped again, so that 重试 starts over as the desktop app's does).
   */
  failed: { status: number; cursor: string | null } | null;
  /** Started over once already on a dropped cursor; cleared when a next page comes. */
  restarted: boolean;
  /** Each search source's (and its providers') last word across the pages: true where it answered in part. */
  sources: Record<string, boolean>;
  /**
   * 部分搜索结果无法加载 is due (Dt's ce): a source answered in part (xJi: a status other than ok, an
   * error code, incomplete reasons), unless the last page says partial_results itself.
   */
  incomplete: boolean;
  /** When the first page came (ms); 0 once a change made it stale. */
  at: number;
}

/** What /api/library/available says of this login. */
export interface LibraryAvailability {
  available: boolean;
  favorites: boolean;
  storageBanner: boolean;
  notes: boolean;
  /** The login's account user id (the token's chatgpt_account_user_id), when it names one. */
  accountUserId?: string;
}

export interface StorageUsage {
  usedBytes: number;
  allowedBytes: number;
  remainingBytes: number;
  overLimit: boolean;
  limitTier: string | null;
  planType: string | null;
}

export interface LibraryPrefs {
  viewMode: LibraryView;
  lastTab: LibraryTab;
}

export interface Crumb {
  id: string;
  name: string;
}

/** A favorite's status (hSs): its favorite id, null when the file is none; unavailable ones cannot be one. */
export interface FavoriteStatus {
  favoriteId: string | null;
  unavailable: boolean;
  /** When it was known (ms); 0 for what a favorites list said. */
  at: number;
}

/** library-uploads' row states: 已加入队列 / 正在上传… / 处理中… / 已上传 / 无法上传. */
export type UploadStatus = "queued" | "uploading" | "processing" | "uploaded" | "failed";

/** One file of the upload queue (actions R). */
export interface LibraryUpload {
  id: string;
  name: string;
  directoryId: string | null;
  status: UploadStatus;
  /** The processing stream's progress (0–100) while processing; the bytes' own is not known. */
  progress: number;
  /** Why it failed, in words (the bridge's, or 上传可能已完成。重试前请先查看资料库 once processing began). */
  error: string | null;
  /** 重试 is offered: the failure may pass, and the file is still at hand. */
  retryable: boolean;
  /** The library file it became (uploaded; null when the stream named none). */
  libraryFileId: string | null;
}

interface LibraryState {
  /** The ChatGPT login's email ("" without one), null when not signed in with ChatGPT; undefined until told. */
  account: string | null | undefined;
  available: LibraryAvailability | null;
  prefs: LibraryPrefs;
  lists: Record<string, LibraryList>;
  /** A folder's path from the library's root (root left out), and when it came (ms). */
  paths: Record<string, { crumbs: Crumb[]; at: number }>;
  storage: StorageUsage | null;
  /** The trash holds nothing (vEo); null until asked, then the last answer while it is asked again. */
  trashEmpty: boolean | null;
  /** Bumped by every change to the library: what is on screen reads anew. */
  generation: number;
  /** Items an action is under (B5: their menus wait), and a folder a drop moves into (正在更新 {name}). */
  busy: Readonly<Record<string, true>>;
  /** Items out of the lists while their delete or dropped move is under way (W4); back if it fails. */
  hidden: Readonly<Record<string, true>>;
  /** A file's new name shown while its rename is under way (BTo). */
  renamed: Readonly<Record<string, string>>;
  /** Favorite status by library file id, kept 30 s (hSs). */
  favorites: Readonly<Record<string, FavoriteStatus>>;
  /** The library's root folder id (FEo), null when it names none; undefined until asked. */
  root: string | null | undefined;
  /** The upload queue, newest first: it outlives the page and an account change. */
  uploads: readonly LibraryUpload[];
  /** A batch of uploads is under way (actions z): no other starts until it ends. */
  uploading: boolean;
  /** The page's selection toolbar is up: the upload panel, in the same corner, rises over it. */
  selecting: boolean;
}

const TABS: readonly LibraryTab[] = ["suggested", "favorites", "folders", "images", "all"];
const DEFAULT_PREFS: LibraryPrefs = { viewMode: "grid", lastTab: "suggested" };
const EMPTY: Omit<LibraryState, "account" | "prefs" | "generation" | "uploads" | "uploading" | "selecting"> = {
  available: null, lists: {}, paths: {}, storage: null, trashEmpty: null, busy: {}, hidden: {}, renamed: {}, favorites: {}, root: undefined,
};
const EMPTY_LIST: LibraryList = { items: [], cursor: null, loading: false, failed: null, restarted: false, sources: {}, incomplete: false, at: 0 };
/** The desktop app's staleTime for a list (Q4). */
const STALE_MS = 30_000;
/** And for a folder's path (PEo). */
const PATH_STALE_MS = 60_000;
const PAGE = 50;
const SEARCH_PAGE = 20;

let state: LibraryState = { ...EMPTY, account: undefined, prefs: DEFAULT_PREFS, generation: 0, uploads: [], uploading: false, selecting: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<LibraryState>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

/** `pick` must return a part of the state as it is (no new objects). */
export function useLibrary<T>(pick: (s: LibraryState) => T): T {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => pick(state));
}

export const libraryState = () => state;

const call = <T>(method: string, path: string, body?: unknown) => cloudCall<T>(method, path, body, "ChatGPT");
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
/** An ISO time, or epoch seconds / ms, as ms. */
const time = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  const at = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : null;
};

// ---------------------------------------------------------------------------
// The account and what it has

/**
 * Signed in as someone else (or out): nothing of the old account's library stays. Its uploads
 * under way stop, and they and the failed ones wait to be chosen again (the desktop app's
 * accountChanged), not retried into the new account.
 */
export function resetLibrary(account: string | null): void {
  if (account === state.account) return;
  checkedAt = 0;
  rootAsk = null;
  rootAt = 0;
  const uploads = state.uploads.map((item) => {
    if (item.status === "uploaded" || (item.status === "failed" && !item.retryable)) return item;
    aborts.get(item.id)?.abort();
    held.delete(item.id);
    return { ...item, status: "failed" as const, error: ACCOUNT_CHANGED, retryable: false };
  });
  set({ ...EMPTY, account, prefs: readPrefs(account), generation: state.generation + 1, uploads });
}

let checkedAt = 0;
/** server/library.mjs's reasons for a call upstream that failed, not a verdict on the account. */
const UNANSWERED = new Set(["unreachable", "accounts_unavailable", "statsig_unavailable", "settings_unavailable"]);

/**
 * /api/library/available, at most once a minute unless `force`d (a new connection, a new account).
 * Only a verdict (the plan, the gate, the country: the desktop app's TL) takes the library from an
 * account that has it; a blip (the bridge or ChatGPT not answering, say on waking) leaves it be.
 */
export async function refreshLibraryAvailable(force = false): Promise<void> {
  const id = connectionId();
  if (!id || (!force && Date.now() - checkedAt < 60_000)) return;
  checkedAt = Date.now();
  const account = state.account;
  let answer: Record<string, unknown> | null = null;
  try {
    const response = await fetch(`/api/library/available?c=${encodeURIComponent(id)}`);
    if (response.ok) answer = obj(await response.json());
  } catch {
    // Unreachable: no answer.
  }
  if (state.account !== account) return;
  if (state.available?.available && (!answer || (answer.available !== true && UNANSWERED.has(str(answer.reason))))) return;
  // Never known: the entry hides, as Dots' does.
  answer ??= {};
  set({ available: { available: answer.available === true, favorites: answer.favorites === true, storageBanner: answer.storageBanner === true, notes: answer.notes === true, ...(str(answer.accountUserId) ? { accountUserId: str(answer.accountUserId) } : {}) } });
}

/**
 * The sidebar's 资料库 entry: only for a ChatGPT login whose account has the library (the desktop
 * app's TL), asked as the connection comes up and the account changes, and again when the window
 * gets focus (at most once a minute).
 */
export function useLibraryEntry(): LibraryAvailability | null {
  const ready = useStore((s) => s.conn.status === "ready");
  const account = useStore((s) => (s.account?.account?.type === "chatgpt" ? (s.account.account.email ?? "") : null));
  const available = useLibrary((s) => s.available);
  useEffect(() => resetLibrary(account), [account]);
  useEffect(() => {
    if (!ready || account === null) return;
    void refreshLibraryAvailable(true);
    const again = () => void refreshLibraryAvailable();
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [ready, account]);
  return account !== null && available?.available ? available : null;
}

// The desktop app keeps these per account and user (library-display-preferences); codex-ui per login.
const prefsKey = (account: string | null | undefined) => `codex-ui:library:${account ?? ""}`;

function readPrefs(account: string | null | undefined): LibraryPrefs {
  const saved = obj(readJson(prefsKey(account)));
  return {
    viewMode: saved.viewMode === "list" ? "list" : "grid",
    lastTab: TABS.includes(saved.lastTab as LibraryTab) ? (saved.lastTab as LibraryTab) : "suggested",
  };
}

/** The view and the tab last chosen (sba viewMode / lastTab). */
export const libraryPrefs = (): LibraryPrefs => state.prefs;

export function setLibraryPrefs(patch: Partial<LibraryPrefs>): void {
  const prefs = { ...state.prefs, ...patch };
  writeJson(prefsKey(state.account), prefs);
  set({ prefs });
}

// ---------------------------------------------------------------------------
// What a location shows (library-page)

const atRoot = (q: Pick<LibraryQuery, "directoryId" | "deleted">) => q.directoryId === null && !q.deleted;

/** The filter menu (NTo): not on 文件夹's own root. */
export const filtersShown = (q: Pick<LibraryQuery, "tab" | "directoryId" | "deleted" | "search">) => q.directoryId !== null || q.deleted || q.tab !== "folders" || !!q.search;
/** Its file types (PTo): nor on 图像's own root. Sources (FTo) go with the menu: every folder here is the account's own. */
export const typesShown = (q: Pick<LibraryQuery, "tab" | "directoryId" | "deleted" | "search">) => filtersShown(q) && (!atRoot(q) || !!q.search || q.tab !== "images");
/** 图像's root is a grid, its search too (rEo): no view toggle. */
export const gridOnly = (q: Pick<LibraryQuery, "tab" | "directoryId" | "deleted">) => q.tab === "images" && atRoot(q);
/** Unsearched, it is the image wall. */
export const imagesRoot = (q: Pick<LibraryQuery, "tab" | "directoryId" | "deleted" | "search">) => gridOnly(q) && !q.search;
const favoritesRoot = (q: Pick<LibraryQuery, "tab" | "directoryId" | "deleted">) => q.tab === "favorites" && atRoot(q);

/** vTo. */
export function dateKind(q: Pick<LibraryQuery, "tab" | "directoryId" | "deleted" | "search">): DateKind {
  if (q.deleted) return "deleted";
  if (q.directoryId === null && q.tab === "favorites") return "saved";
  return q.directoryId === null && (!!q.search || q.tab === "suggested") ? "suggested" : "modified";
}

/** The list's headers sort (ZTo): not the trash, the favorites' root or a search, which keep the server's order. */
export const sortable = (q: Pick<LibraryQuery, "tab" | "directoryId" | "deleted" | "search">) => !q.deleted && !favoritesRoot(q) && !q.search;

/** The search lanes the library page asks for (dJi). */
const LANES = ["image", "document", "folder"];
// ponytail: native files only, the desktop app's library_providers / providers with no cloud drive
// shown. Connected drives (Google Drive, OneDrive…) are left out of codex-ui altogether.
const NATIVE = ["native", "native_shared"];

const defined = (body: Record<string, unknown>) => Object.fromEntries(Object.entries(body).filter((entry) => entry[1] !== undefined));

/**
 * The call that lists `q` from `cursor` (OX): the trash, then the favorites' root (filtered
 * here, kX), then a search (/global/search, 20 a page), then a folder or 全部 / 文件夹 (nodes), else
 * 推荐 or 图像 (/files/library). File types go out as chosen (plural); 图像's root asks for the
 * `image` category. A source goes out only when just one is chosen (the desktop app's
 * `sources.length === 1`): the server takes one string.
 */
export function libraryRequest(q: LibraryQuery, cursor: string | null): { method: "GET" | "POST"; path: string; body?: Record<string, unknown> } {
  const search = q.search.trim();
  const source = q.sources.length === 1 ? q.sources[0] : undefined;
  const categories = !search && q.tab === "images" ? ["image"] : q.categories.length ? q.categories : undefined;
  const page = cursor ?? undefined;
  if (q.deleted) {
    return { method: "POST", path: "/files/library", body: defined({ cursor: page, limit: PAGE, q: search || undefined, categories, source, include_saved_entities: true, include_sites: false, trashed_only: true }) };
  }
  if (favoritesRoot(q)) return { method: "GET", path: `/files/library/favorites${query({ cursor: page, limit: PAGE, include_sites: false })}` };
  if (search) {
    // In a folder, that folder's own provider (dJi's [FX(directoryId)]: every folder here is native).
    const filters = defined({ lanes: LANES, library_providers: q.directoryId === null ? NATIVE : ["native"], file_types: q.categories.length ? q.categories : undefined, source, directory_id: q.directoryId ?? undefined });
    return { method: "POST", path: "/global/search", body: defined({ query: search, cursor: page, limit: SEARCH_PAGE, entrypoint: "library_page", source_requests: [{ type: "library", filters }] }) };
  }
  if (q.directoryId !== null || q.tab === "all" || q.tab === "folders") {
    // ponytail: no hydrate_folder_thumbnails; folder cards draw the folder glyph (Library.tsx).
    const params = {
      entry_surface: "library",
      parent_directory_id: q.directoryId ?? undefined,
      cursor: page,
      categories,
      source,
      include_hidden_files: false,
      include_files: q.tab !== "folders" || q.directoryId !== null,
      include_saved_entities: true,
      include_sites: false,
      include_folder_counts: false,
      include_onedrive: false,
    };
    return { method: "GET", path: `/files/library/nodes${query(params)}` };
  }
  const suggested = q.tab === "suggested";
  return {
    method: "POST",
    path: "/files/library",
    body: defined({ cursor: page, limit: PAGE, categories, source, include_saved_entities: true, include_sites: false, ranking: suggested ? "suggested" : undefined, providers: suggested ? [] : undefined }),
  };
}

/**
 * A library item as the page draws it, either shape. ponytail: cloud drives' items (access_kind
 * mounted, and any `external-…:…` / `library:…` id) are dropped: codex-ui has no drives or
 * sharing, and the bridge refuses ids with a colon anyway.
 */
export function parseNode(raw: unknown): LibraryNode | null {
  const node = obj(raw);
  const id = str(node.id);
  if (!id || id.includes(":") || node.access_kind === "mounted") return null;
  const kind = node.kind === "directory" ? "directory" : "file";
  // A file's directory_id is its folder; a folder's (a search result's payload) is its own id (bJi).
  const parentId = str(node.parent_directory_id) || (kind === "file" ? str(node.directory_id) : "") || null;
  const artifact = typeof node.library_artifact_type === "string" ? node.library_artifact_type : null;
  const saved = node.saved_entity != null || artifact === "saved_entity" || artifact === "chat_message_snapshot";
  // aSs: shared with this account, one way or another.
  const shared = node.access_kind === "shared" || node.shared_by != null || node.direct_share_id != null || node.has_opened_shared_membership === true || !!parentId?.startsWith("library:");
  return {
    id,
    kind,
    name: str(node.name) || str(node.file_name),
    parentId,
    fileId: str(node.file_id) || null,
    mime: str(node.mime_type) || null,
    size: num(node.file_size_bytes),
    category: str(node.library_file_category) || null,
    artifact,
    updatedAt: time(node.updated_at) ?? time(node.file_upload_time) ?? time(node.record_creation_time),
    lastUsedAt: time(node.last_used_at),
    trashedAt: time(node.trashed_at),
    savedAt: null,
    thumbnail: kind === "file" && (!!str(node.thumbnail_url) || !!str(node.thumbnail_preview_url) || node.library_file_category === "image"),
    width: num(node.width),
    height: num(node.height),
    // N5 without the favorites it lets through (codex-ui has no saved-entities route): j5.
    own: !saved && !shared && node.is_root !== true && node.site == null && node.space == null && artifact !== "site" && artifact !== "page"
      && (str(node.provider) || str(node.library_provider) || "native") === "native",
    saved,
    favoriteId: null,
    extension: str(node.file_extension) || null,
    access: str(node.access_kind) || null,
    createdAt: time(node.record_creation_time) ?? time(node.file_upload_time),
    threadId: str(node.origination_thread_id) || null,
    version: num(node.current_version_number),
  };
}

/** A /global/search result (bJi): a folder or a file of the library; its update_time is in seconds. */
export function parseSearchResult(raw: unknown): LibraryNode | null {
  const result = obj(raw);
  if (result.source_type !== "library") return null;
  const payload = obj(result.payload);
  const fields = "library_file" in payload ? obj(payload.library_file) : payload;
  const shape = { ...fields, name: str(result.title), parent_directory_id: fields.parent_directory_id ?? null, updated_at: num(result.update_time) === null ? null : num(result.update_time)! * 1000 };
  if ("directory_id" in fields) return parseNode({ ...shape, id: fields.directory_id, kind: "directory" });
  if ("library_item_id" in fields) return parseNode({ ...shape, id: fields.library_item_id, kind: "file" });
  return null;
}

/** A favorite (uJi): its file, by the name a saved entity shows, when it is available. */
function parseFavorite(raw: unknown): LibraryNode | null {
  const favorite = obj(raw);
  if (favorite.availability !== "available" || !favorite.item) return null;
  const item = obj(favorite.item);
  const node = parseNode({ ...item, kind: "file", name: str(obj(obj(item.saved_entity).display_data).name) || str(item.file_name) });
  return node && { ...node, savedAt: time(favorite.created_at), favoriteId: str(favorite.favorite_id) || null };
}

// ponytail: the desktop app's file kinds (lge) by extension and type; good enough for filtering favorites.
const KINDS: [LibraryCategory, RegExp][] = [
  ["images", /\.(png|jpe?g|gif|webp|avif|heic|heif|bmp|svg|tiff?)$/i],
  ["documents", /\.(docx?|odt|rtf|pages|txt|md|markdown)$/i],
  ["spreadsheets", /\.(xlsx?|xlsm|ods|numbers|csv|tsv)$/i],
  ["presentations", /\.(pptx?|odp|key)$/i],
  ["pdfs", /\.pdf$/i],
];

/** kX: the favorites' root is filtered here, by name, source and file type. */
export function favoriteMatches(node: LibraryNode, q: Pick<LibraryQuery, "search" | "categories" | "sources">): boolean {
  if (!node.name.toLocaleLowerCase().includes(q.search.trim().toLocaleLowerCase())) return false;
  const source = q.sources.length === 1 ? q.sources[0] : null;
  if (source !== null && (source === "generated") !== (node.artifact !== null)) return false;
  return !q.categories.length || q.categories.some((category) =>
    category === "images" ? node.category === "image" || !!node.mime?.startsWith("image/") || KINDS[0][1].test(node.name)
      : category === "documents" ? node.artifact === "deep_research_report" || KINDS[1][1].test(node.name)
        : category === "pdfs" ? node.mime === "application/pdf" || KINDS[4][1].test(node.name)
          : KINDS.find(([kind]) => kind === category)![1].test(node.name));
}

/** xJi's maps for one page: by source key, and by source and provider, whether it answered in part. */
function searchStatuses(body: Record<string, unknown>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const raw of list(body.source_statuses)) {
    const status = obj(raw);
    const key = str(status.source_key);
    out[key] = status.status !== "ok" || status.error_code != null || list(status.incomplete_reasons).length > 0;
    for (const entry of list(status.provider_statuses)) {
      const provider = obj(entry);
      out[`${key}:${str(provider.library_provider) || str(provider.provider)}`] = provider.status === "error" || provider.error_code != null;
    }
  }
  return out;
}

/** One page of `q`. */
export async function fetchLibraryPage(q: LibraryQuery, cursor: string | null): Promise<{ items: LibraryNode[]; cursor: string | null; sources: Record<string, boolean>; partial: boolean }> {
  const { method, path, body } = libraryRequest(q, cursor);
  const answer = obj(await call<unknown>(method, path, body));
  const next = str(answer.cursor) || null;
  if (favoritesRoot(q)) {
    return { items: list(answer.items).map(parseFavorite).filter((node): node is LibraryNode => !!node && favoriteMatches(node, q)), cursor: next, sources: {}, partial: false };
  }
  if (q.search.trim() && !q.deleted) return { items: list(answer.items).map(parseSearchResult).filter((node) => node !== null), cursor: next, sources: searchStatuses(answer), partial: answer.partial_results === true };
  return { items: list(answer.items).map(parseNode).filter((node) => node !== null), cursor: next, sources: {}, partial: false };
}

/** A cursor the server wants dropped (mJi / hJi): the list starts over. */
export function cursorRestart(error: unknown): boolean {
  if (!(error instanceof CloudError) || (error.status !== 400 && error.status !== 409)) return false;
  const body = obj(error.body);
  return ["page_cursor_restart_required", "invalid_cursor"].includes(str(body.detail)) || ["catalog_cursor_restart_required", "catalog_invalid_cursor"].includes(str(body.code));
}

export const listKey = (q: LibraryQuery) => JSON.stringify([state.account ?? "", q.tab, q.directoryId, q.deleted, q.search.trim(), q.categories, q.sources]);

const patchList = (key: string, patch: Partial<LibraryList>) => set({ lists: { ...state.lists, [key]: { ...(state.lists[key] ?? EMPTY_LIST), ...patch } } });

/**
 * `q` into the store: its first page unless one under 30 s old is there ("first"), its first page
 * anew ("refresh"), or its next page ("more"). A cursor the server drops restarts the list, once
 * until a next page comes: dropped again, it fails, and 重试 starts over (the desktop app only
 * ever does that on 重试; once on its own spares a click without a loop of first pages). The
 * favorites' root, filtered here, reads on while a filter leaves pages short.
 */
export async function loadLibrary(q: LibraryQuery, mode: "first" | "refresh" | "more" = "first"): Promise<void> {
  const key = listKey(q);
  const known = state.lists[key];
  if (known?.loading) return;
  if (mode === "more" ? !known?.cursor : mode === "first" && known && !known.failed && Date.now() - known.at < STALE_MS) return;
  const cursor = mode === "more" ? known!.cursor : null;
  const { account, generation } = state;
  patchList(key, { loading: true });
  try {
    const page = await fetchLibraryPage(q, cursor);
    if (state.account !== account) return;
    const fresh = state.generation === generation;
    const before = state.lists[key]?.items ?? [];
    const items = cursor ? [...before, ...page.items.filter((node) => !before.some((seen) => seen.id === node.id))] : page.items;
    // A later page's word on a source replaces an earlier one's (xJi).
    const sources = cursor ? { ...state.lists[key]?.sources, ...page.sources } : page.sources;
    const incomplete = !page.partial && Object.values(sources).includes(true);
    patchList(key, { items, cursor: page.cursor, loading: false, failed: null, sources, incomplete, at: fresh ? Date.now() : 0, ...(cursor ? { restarted: false } : {}) });
    // Changed meanwhile: read once more.
    if (!fresh) return loadLibrary(q);
    if (page.cursor && favoritesRoot(q) && (q.search.trim() || q.categories.length || q.sources.length)) return loadLibrary(q, "more");
  } catch (error) {
    if (state.account !== account) return;
    const dropped = !!cursor && cursorRestart(error);
    if (dropped && !state.lists[key]?.restarted) {
      patchList(key, { ...EMPTY_LIST, restarted: true });
      return loadLibrary(q);
    }
    patchList(key, { loading: false, failed: { status: error instanceof CloudError ? error.status : 0, cursor: dropped ? null : cursor } });
  }
}

/**
 * The list for `q` (null: none), read as it shows and after every change, as it stands while
 * changes are under way: hidden items left out, renamed ones under their new names.
 */
export function useLibraryList(q: LibraryQuery | null): LibraryList | undefined {
  const key = q && listKey(q);
  const generation = useLibrary((s) => s.generation);
  useEffect(() => {
    if (q) void loadLibrary(q);
  }, [key, generation]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useLibrary((s) => (key ? s.lists[key] : undefined));
  const hidden = useLibrary((s) => s.hidden);
  const renamed = useLibrary((s) => s.renamed);
  return useMemo(() => overlay(shown, hidden, renamed), [shown, hidden, renamed]);
}

/** MEo's W4 filter and BTo's names over a list; the list itself when neither touches it. */
export function overlay(shown: LibraryList | undefined, hidden: LibraryState["hidden"], renamed: LibraryState["renamed"]): LibraryList | undefined {
  if (!shown?.items.some((node) => hidden[node.id] || renamed[node.id] !== undefined)) return shown;
  return { ...shown, items: shown.items.flatMap((node) => (hidden[node.id] ? [] : renamed[node.id] === undefined ? [node] : [{ ...node, name: renamed[node.id] }])) };
}

/**
 * Something in the library changed (a rename, a move, a delete…): every list, path, the storage
 * and the trash read anew (the desktop app invalidates ["library-api", account], ICs). Lists keep
 * what they show until the new pages come.
 */
export function invalidateLibrary(): void {
  set({
    lists: Object.fromEntries(Object.entries(state.lists).map(([key, value]) => [key, { ...value, at: 0 }])),
    paths: {},
    storage: null,
    trashEmpty: null,
    generation: state.generation + 1,
  });
}

const asking = new Map<string, Promise<void>>();

/**
 * `ask` for the account, unless the same `what` is being asked already (an effect runs twice in
 * StrictMode): then that ask, so a caller that waits (the move's folder check) hears its answer.
 */
function askOnce(what: string, ask: (account: string | null | undefined) => Promise<void>): Promise<void> {
  const key = JSON.stringify([state.account ?? null, what]);
  const known = asking.get(key);
  if (known) return known;
  const asked = ask(state.account).finally(() => asking.delete(key));
  asking.set(key, asked);
  return asked;
}

/**
 * A folder's path from the root (PEo: directories/path, root to the folder; the root itself left
 * out), kept a minute. A failure keeps nothing: the next visit asks again.
 */
export function loadPath(directoryId: string): Promise<void> {
  const known = state.paths[directoryId];
  if (known && Date.now() - known.at < PATH_STALE_MS) return Promise.resolve();
  return askOnce(`path:${directoryId}`, async (account) => {
    try {
      const answer = obj(await call<unknown>("GET", `/files/library/directories/path${query({ directory_id: directoryId })}`));
      const crumbs = list(answer.items).map(obj).filter((item) => item.is_root !== true && str(item.id)).map((item) => ({ id: str(item.id), name: str(item.name) }));
      if (state.account === account) set({ paths: { ...state.paths, [directoryId]: { crumbs, at: Date.now() } } });
    } catch {
      // The breadcrumb stays at 资料库 (or the path it had) until then.
    }
  });
}

/** The account's storage (Iqr), each time the page shows (staleTime 0). */
export async function loadStorage(): Promise<void> {
  const { account } = state;
  try {
    const usage = obj(await call<unknown>("GET", "/files/library/storage/usage"));
    if (state.account !== account) return;
    set({
      storage: {
        usedBytes: num(usage.used_bytes) ?? 0,
        allowedBytes: num(usage.allowed_bytes) ?? 0,
        remainingBytes: num(usage.remaining_bytes) ?? 0,
        overLimit: usage.is_over_limit === true,
        limitTier: str(usage.limit_tier) || null,
        planType: str(usage.plan_type) || null,
      },
    });
  } catch {
    // No banner then.
  }
}

/** Full (over the limit or nothing left), almost full (a tenth or less left), else null (Ja). */
export function storageLevel(usage: StorageUsage | null): "full" | "almostFull" | null {
  if (!usage) return null;
  if (usage.overLimit || usage.remainingBytes <= 0) return "full";
  return usage.allowedBytes > 0 && usage.remainingBytes / usage.allowedBytes <= 0.1 ? "almostFull" : null;
}

/** A plan with more storage above it (Ga): the banner offers 升级. */
export const canUpgrade = (usage: StorageUsage) =>
  usage.limitTier === "free" ? usage.planType === "free" || usage.planType === "free_workspace" : ["go", "plus", "prolite"].includes(usage.limitTier ?? "");

/**
 * Whether the trash holds anything, hidden files included (vEo): asked each time the trash shows
 * (refetchOnMount always), what was last known standing until the answer comes.
 */
export function loadTrashEmpty(): Promise<void> {
  return askOnce("trash", async (account) => {
    let empty = false;
    try {
      empty = list(obj(await call<unknown>("POST", "/files/library", { limit: 1, trashed_only: true, include_hidden_files: true })).items).length === 0;
    } catch {
      // Unknown: the trash shows its list, which says what it can.
    }
    if (state.account === account) set({ trashEmpty: empty });
  });
}

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export interface LibrarySort {
  key: "name" | "date" | "size";
  direction: "asc" | "desc";
}

/** The date a list shows for `node` (Zwo): last activity is the later of its use and its change. */
export function nodeDate(node: LibraryNode, kind: DateKind): number | null {
  if (kind === "deleted") return node.trashedAt;
  if (kind === "saved") return node.savedAt ?? node.updatedAt;
  if (kind === "suggested" && node.lastUsedAt !== null) return node.updatedAt === null || node.lastUsedAt > node.updatedAt ? node.lastUsedAt : node.updatedAt;
  return node.updatedAt;
}

/** A header's next order (Kwo): names A–Z first, dates and sizes newest / largest first, then reversed, then the server's. */
export function nextSort(current: LibrarySort | null, key: LibrarySort["key"]): LibrarySort | null {
  const first = key === "name" ? "asc" : "desc";
  if (current?.key !== key) return { key, direction: first };
  return current.direction === first ? { key, direction: first === "asc" ? "desc" : "asc" } : null;
}

/** qwo / Ywo: folders before files (not in the trash), then the key, unknowns last, ties by name. */
export function sortNodes(items: LibraryNode[], sort: LibrarySort, kind: DateKind): LibraryNode[] {
  return [...items].sort((a, b) => {
    const folders = kind === "deleted" ? 0 : Number(b.kind === "directory") - Number(a.kind === "directory");
    if (folders) return folders;
    let diff: number;
    if (sort.key === "name") diff = COLLATOR.compare(a.name, b.name);
    else {
      const x = sort.key === "size" ? a.size : nodeDate(a, kind);
      const y = sort.key === "size" ? b.size : nodeDate(b, kind);
      const xMissing = x === null || (sort.key === "size" && x < 0);
      const yMissing = y === null || (sort.key === "size" && y < 0);
      if (xMissing !== yMissing) return xMissing ? 1 : -1;
      diff = xMissing || yMissing ? 0 : x! - y!;
    }
    return (sort.direction === "asc" ? diff : -diff) || COLLATOR.compare(a.name, b.name);
  });
}

/**
 * A library file's bytes through the bridge: /api/library/content/<name> (the PDF viewer titles a
 * document by it) for the node, or one of its versions (that version's file id).
 */
export function libraryContentUrl(node: Pick<LibraryNode, "id" | "name" | "fileId">, kind: "content" | "download" | "thumbnail" | "html", versionFileId?: string): string {
  const id = connectionId();
  if (!id) return "";
  const params = new URLSearchParams({ c: id, id: node.id, kind });
  const fileId = versionFileId ?? node.fileId;
  if (fileId) params.set("fileId", fileId);
  return `/api/library/content/${encodeURIComponent(node.name || "file")}?${params}`;
}

// ---------------------------------------------------------------------------
// Changing the library (app-initial MCs one item at a time, NCs for a selection)

/** What the ⋯ menu (and the context menu) offers for an item (La, without sites, sharing or saved chats). */
export interface LibraryItemActions {
  restore: boolean;
  deleteForever: boolean;
  rename: boolean;
  download: boolean;
  /** 添加到收藏夹 / 从收藏夹中移除 (qxs), with the account's favorites gate on. */
  favorite: boolean;
  /** 移至文件夹 at the root (isRootLevel), else 移动. */
  move: boolean;
  /** 删除, or 删除文件夹 for a folder: that one goes for good with all it holds. */
  delete: boolean;
}

/** eSs: a file of the library's own, not a flashcard set (Bxs). */
const downloadable = (node: LibraryNode) => node.kind === "file" && !node.saved && node.artifact !== "site" && node.artifact !== "flashcards";

/** La's conditions: in the trash only 恢复 and 永久删除 (files: folders never go there), elsewhere the rest. */
export function itemActions(node: LibraryNode, deleted: boolean): LibraryItemActions {
  const file = node.kind === "file";
  const trashed = deleted && file && node.own;
  return {
    restore: trashed,
    deleteForever: trashed,
    rename: !deleted && node.own,
    download: !deleted && downloadable(node),
    favorite: !deleted && file && node.artifact !== "site" && node.artifact !== "chat_message_snapshot" && node.trashedAt === null,
    move: !deleted && node.own,
    delete: !deleted && node.own,
  };
}

/** At the library's root (no folder, or the root's own id): the menu's 移至文件夹, the move dialog's start. */
export const isRootLevel = (node: Pick<LibraryNode, "parentId">, root: string | null | undefined) => node.parentId === null || node.parentId === root;

/** A folder name's problem (library-name-validation t): one starting with "." would be hidden. */
export const folderNameError = (name: string): string | null => (name.trim().startsWith(".") ? "文件夹名称不能以“.”开头。" : null);

/** A file name's extension (QI): after the last dot, lower-cased, when that dot neither starts nor ends the name. */
export function extensionOf(name: string): string | null {
  const base = name.toLowerCase().split(/[/\\]/).pop()!;
  const dot = base.lastIndexOf(".");
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1) : null;
}

/** Rename's problem with the whole new name (item-dialogs ze): a folder's as above; a file keeps its extension, none added. */
export function renameError(node: Pick<LibraryNode, "kind" | "name">, next: string): string | null {
  if (node.kind === "directory") return folderNameError(next);
  return next.trim() && extensionOf(next.trim()) !== extensionOf(node.name) ? "无法更改文件扩展名" : null;
}

/** What ChatGPT said in a failure (TN): `error` or its message, else `detail`, its message, first msg or description. */
export function serverMessage(error: unknown): string | null {
  if (!(error instanceof CloudError)) return null;
  const said = (value: unknown) => (typeof value === "string" ? value : Array.isArray(value) ? str(obj(value[0]).msg) : str(obj(value).message) || str(obj(value).description));
  const body = obj(error.body);
  return (said(body.error) || said(body.detail)).trim() || null;
}

type Change = { type: "delete"; permanently: boolean } | { type: "restore" } | { type: "move"; directoryId: string | null };

/** RCs: the failure toast, a folder's refused rename (409) in the server's own words. */
function changeFailed(node: LibraryNode, type: Change["type"] | "rename", error?: unknown): void {
  const said = type === "rename" && node.kind === "directory" && error instanceof CloudError && error.status === 409 ? serverMessage(error) : null;
  toast("danger", said ?? (type === "restore" ? "无法恢复文件"
    : type === "move" ? `无法移动 ${node.name}`
      : type === "rename" ? (node.kind === "directory" ? "文件夹重命名未成功。" : `重命名 ${node.name} 未成功。`)
        : node.kind === "directory" ? "删除文件夹未成功。" : "删除文件未成功。"));
}

const withIds = (record: Readonly<Record<string, true>>, ids: readonly string[]) => (ids.length ? { ...record, ...Object.fromEntries(ids.map((id) => [id, true as const])) } : record);
const withoutIds = <T>(record: Readonly<Record<string, T>>, ids: readonly string[]) => (ids.some((id) => id in record) ? Object.fromEntries(Object.entries(record).filter(([id]) => !ids.includes(id))) : record);

/** Every list without `ids` (EZi / DZi: gone where they showed, until the lists read anew). */
function pruned(ids: readonly string[]): LibraryState["lists"] {
  if (!ids.length) return state.lists;
  const gone = new Set(ids);
  return Object.fromEntries(Object.entries(state.lists).map(([key, value]) => [key, value.items.some((node) => gone.has(node.id)) ? { ...value, items: value.items.filter((node) => !gone.has(node.id)) } : value]));
}

const libraryPath = (node: LibraryNode) => `/files/library/${node.kind === "directory" ? "directories" : "files"}/${encodeURIComponent(node.id)}`;

/**
 * One item's change (MCs), refused while another is under way for it. A folder deleted goes for
 * good with what it holds (DELETE directories); a file to the trash or for good as `permanently`
 * says, soft_delete always spelled out. Deleted and restored items leave every list at once; a
 * failure toasts, unless the account changed meanwhile.
 */
async function change(node: LibraryNode, action: Change): Promise<boolean> {
  if (state.busy[node.id]) return false;
  const { account } = state;
  set({ busy: withIds(state.busy, [node.id]) });
  let done = false;
  try {
    if (action.type === "move") {
      if (node.kind === "directory") await call("PATCH", libraryPath(node), { parent_directory_id: action.directoryId });
      else if (obj(await call("PATCH", `${libraryPath(node)}/move`, { directory_id: action.directoryId })).success !== true) throw new Error("Library move was not completed");
    } else if (action.type === "restore") await call("POST", `${libraryPath(node)}/restore`);
    else {
      const path = node.kind === "directory" ? libraryPath(node)
        : `${libraryPath(node)}${query({ file_id: node.fileId ?? undefined, parent_directory_id: node.parentId ?? undefined, file_name: node.name, soft_delete: !action.permanently })}`;
      if (obj(await call("DELETE", path)).success !== true) throw new Error("Library deletion was not completed");
    }
    done = true;
  } catch (error) {
    if (state.account === account) changeFailed(node, action.type, error);
  }
  if (state.account === account) set({ busy: withoutIds(state.busy, [node.id]), ...(done && action.type !== "move" ? { lists: pruned([node.id]) } : {}) });
  return done;
}

/**
 * `nodes` changed one after another (NCs' MCs loop): the ids done. Signed in as someone else
 * meanwhile, the rest stay: the bridge would send them with the new login.
 */
async function changeEach(nodes: readonly LibraryNode[], action: Change, account: string | null | undefined): Promise<string[]> {
  const done: string[] = [];
  for (const node of nodes) {
    if (state.account !== account) break;
    if (await change(node, action)) done.push(node.id);
  }
  return done;
}

const DELETE_BATCH = 25;

/**
 * A file 删除 sends through delete-batch (PCs): with a file id, no action under way for it. The
 * confirmation closes at once only when every item is one; the rest go one by one, and wait.
 */
export const deletesInBatch = (node: LibraryNode) => node.kind === "file" && node.fileId !== null && !state.busy[node.id];

/**
 * Delete (NCs `delete`): what the confirmation said. Not `permanently`: the files with a file id go
 * to the trash through delete-batch, 25 at a time, out of the lists while it runs (W4) and gone
 * from them once it says so; a batch that fails in part toasts once, and only its failures come
 * back. Folders (for good, with what they hold) and files without a file id go one by one.
 * `permanently` (the trash's 永久删除): each file for good, one by one. Only this account's own
 * items are touched. Resolves to the ids deleted; the dialog keeps the rest.
 */
export async function deleteLibraryItems(nodes: readonly LibraryNode[], { permanently = false }: { permanently?: boolean } = {}): Promise<string[]> {
  const { account } = state;
  const items = nodes.filter((node) => node.own);
  const batch = permanently ? [] : items.filter(deletesInBatch);
  const ids = batch.map((node) => node.id);
  const done: string[] = [];
  let failed = false;
  set({ busy: withIds(state.busy, ids), hidden: withIds(state.hidden, ids) });
  try {
    for (let at = 0; at < batch.length; at += DELETE_BATCH) {
      const chunk = batch.slice(at, at + DELETE_BATCH);
      const answer = obj(await call<unknown>("POST", "/files/library/files/delete-batch", {
        files: chunk.map((node) => ({ library_file_id: node.id, file_id: node.fileId, parent_directory_id: node.parentId, file_name: node.name })),
      }));
      const deleted = new Set(list(answer.files).map(obj).filter((file) => file.success === true).map((file) => str(file.library_file_id)));
      const gone = chunk.filter((node) => deleted.has(node.id)).map((node) => node.id);
      done.push(...gone);
      if (state.account !== account) return done;
      // In one change: the deleted out of every list, the rest of the batch back.
      set({ lists: pruned(gone), hidden: withoutIds(state.hidden, chunk.map((node) => node.id)) });
      failed ||= gone.length < chunk.length;
    }
  } catch {
    failed = true;
  } finally {
    if (state.account === account) set({ busy: withoutIds(state.busy, ids), hidden: withoutIds(state.hidden, ids) });
  }
  if (state.account !== account) return done;
  if (failed) changeFailed(batch[0], "delete");
  done.push(...(await changeEach(items.filter((node) => !ids.includes(node.id)), { type: "delete", permanently }, account)));
  if (done.length && state.account === account) invalidateLibrary();
  return done;
}

/** The trash's 恢复 (MCs `restore`): each of this account's own files back, one by one. Resolves to the ids restored. */
export async function restoreLibraryItems(nodes: readonly LibraryNode[]): Promise<string[]> {
  const { account } = state;
  const done = await changeEach(nodes.filter((node) => node.kind === "file" && node.own), { type: "restore" }, account);
  if (done.length && state.account === account) invalidateLibrary();
  return done;
}

/**
 * Move into `directoryId` (null: the root), one by one (MCs `move`: a folder by its parent, a file
 * through …/move). An item already there counts as moved, as the move dialog counts it, and a
 * folder never goes into itself; keeping a folder out of its own subfolders is the dialog's (it
 * knows the path). `optimistic` (a drop on a folder): the moved items leave the lists at once and
 * the folder shows as busy; a failure brings them back. Resolves to the ids now there.
 */
export async function moveLibraryItems(nodes: readonly LibraryNode[], directoryId: string | null, { optimistic = false }: { optimistic?: boolean } = {}): Promise<string[]> {
  const { account } = state;
  const there = (node: LibraryNode) => (directoryId === null ? isRootLevel(node, state.root) : node.parentId === directoryId);
  const items = nodes.filter((node) => node.own && node.id !== directoryId);
  const moving = items.filter((node) => !there(node));
  const ids = moving.map((node) => node.id);
  const target = optimistic && directoryId ? [directoryId] : [];
  if (optimistic) set({ hidden: withIds(state.hidden, ids), busy: withIds(state.busy, target) });
  let done: string[] = [];
  try {
    done = await changeEach(moving, { type: "move", directoryId }, account);
  } finally {
    if (optimistic && state.account === account) set({ lists: pruned(done), hidden: withoutIds(state.hidden, ids), busy: withoutIds(state.busy, target) });
  }
  if (done.length && state.account === account) invalidateLibrary();
  return [...items.filter(there).map((node) => node.id), ...done];
}

/**
 * Rename (MCs `rename`): a folder by PATCH directories {name}, a file by PATCH files {file_name}
 * under its new name at once (BTo), the old one back if it fails. Validating the name is the
 * dialog's (renameError). Resolves to whether it took.
 */
export async function renameLibraryItem(node: LibraryNode, name: string): Promise<boolean> {
  name = name.trim();
  if (!node.own || !name || name === node.name || state.busy[node.id]) return false;
  const { account } = state;
  set({ busy: withIds(state.busy, [node.id]), ...(node.kind === "file" ? { renamed: { ...state.renamed, [node.id]: name } } : {}) });
  let named: string | null = null;
  try {
    const answer = obj(await call<unknown>("PATCH", libraryPath(node), node.kind === "directory" ? { name } : { file_name: name }));
    named = str(node.kind === "directory" ? answer.name : answer.file_name) || name;
  } catch (error) {
    if (state.account === account) changeFailed(node, "rename", error);
  }
  if (state.account !== account) return false;
  // In one change: the name the server took into every list, the shown one gone (FCs).
  const lists = named === null ? state.lists : Object.fromEntries(Object.entries(state.lists).map(([key, value]) => [key, value.items.some((item) => item.id === node.id) ? { ...value, items: value.items.map((item) => (item.id === node.id ? { ...item, name: named! } : item)) } : value]));
  set({ lists, busy: withoutIds(state.busy, [node.id]), renamed: withoutIds(state.renamed, [node.id]) });
  if (named === null) return false;
  invalidateLibrary();
  return true;
}

/**
 * 新建文件夹 (create-dialog A): POST directories {name, parent_directory_id}. A name starting
 * with "." is refused here too; a failure toasts the server's word on a 409 (a name taken), else
 * 未成功创建文件夹, and resolves to null so the dialog keeps what was typed. Resolves to the folder
 * (the move dialog goes into it).
 */
export async function createLibraryFolder(name: string, parentId: string | null): Promise<LibraryNode | null> {
  name = name.trim();
  if (!name || folderNameError(name)) return null;
  const { account } = state;
  try {
    const answer = obj(await call<unknown>("POST", "/files/library/directories", { name, parent_directory_id: parentId }));
    const node = parseNode({ name, parent_directory_id: parentId, updated_at: Date.now(), ...answer, kind: "directory" });
    if (!node) throw new Error("The folder came back without an id");
    if (state.account === account) invalidateLibrary();
    return node;
  } catch (error) {
    if (state.account === account) toast("danger", (error instanceof CloudError && error.status === 409 && serverMessage(error)) || "未成功创建文件夹");
    return null;
  }
}

/**
 * 清空文件回收站 (empty-trash J): DELETE /files/library/trash, then 回收站已清空, or 部分项目无法删除。请重试。
 * when some stayed (failed_count), or 未成功清空回收站 when the call itself failed. Resolves to
 * whether the trash is empty now (the confirmation closes).
 */
export async function emptyLibraryTrash(): Promise<boolean> {
  const { account } = state;
  let answer: Record<string, unknown>;
  try {
    answer = obj(await call<unknown>("DELETE", "/files/library/trash"));
  } catch {
    if (state.account === account) toast("danger", "未成功清空回收站");
    return false;
  }
  if (state.account !== account) return false;
  const failed = (num(answer.failed_count) ?? 0) > 0;
  invalidateLibrary();
  if (!failed) set({ trashEmpty: true });
  if (failed) toast("danger", "部分项目无法删除。请重试。");
  else toast("neutral", "回收站已清空");
  return !failed;
}

/**
 * 下载: each file one after another (NCs `download`), through the bridge's kind=download (a
 * Content-Disposition attachment, as FileMenu saves an image); folders and what eSs keeps from
 * downloading are skipped. Returns the ids sent off (Ca takes them out of the selection).
 */
export function downloadLibraryFiles(nodes: readonly LibraryNode[]): string[] {
  const sent: string[] = [];
  for (const node of nodes) {
    const href = downloadable(node) ? libraryContentUrl(node, "download") : "";
    if (!href) continue;
    const link = document.createElement("a");
    link.href = href;
    link.download = node.name;
    document.body.append(link);
    link.click();
    link.remove();
    sent.push(node.id);
  }
  return sent;
}

/** A file opened tells the library (lCs: POST …/opened, for 推荐's order); nothing waits on it. */
export function markLibraryFileOpened(node: Pick<LibraryNode, "id" | "kind">): void {
  if (node.kind === "file") void call("POST", `/files/library/files/${encodeURIComponent(node.id)}/opened`).catch(() => {});
}

let rootAsk: Promise<string | null> | null = null;
let rootAt = 0;

/**
 * The library's root folder id (FEo: directories/path with no folder, its is_root item), kept a
 * minute in `root`, one call at a time. A failure rejects: the move dialog says 无法识别资料库根目录.
 */
export function loadLibraryRoot(): Promise<string | null> {
  if (state.root !== undefined && Date.now() - rootAt < PATH_STALE_MS) return Promise.resolve(state.root);
  if (rootAsk) return rootAsk;
  const { account } = state;
  const ask: Promise<string | null> = call<unknown>("GET", "/files/library/directories/path").then((answer) => {
    const id = str(list(obj(answer).items).map(obj).find((item) => item.is_root === true)?.id) || null;
    if (state.account === account) {
      rootAt = Date.now();
      set({ root: id });
    }
    return id;
  }).finally(() => {
    if (rootAsk === ask) rootAsk = null;
  });
  rootAsk = ask;
  return ask;
}

/**
 * The folders a move can go into under `parentId` (null: the root), every page (move-dialog Be:
 * nodes without files or saved entities, until no new cursor): this account's own (N5).
 * ponytail: asked anew on each visit, the dialog's own state holding a level; Be keeps one 30 s.
 */
export async function fetchMoveFolders(parentId: string | null): Promise<LibraryNode[]> {
  const folders: LibraryNode[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const answer = obj(await call<unknown>("GET", `/files/library/nodes${query({ parent_directory_id: parentId ?? undefined, cursor, include_files: false, include_saved_entities: false })}`));
    folders.push(...list(answer.items).map(parseNode).filter((node): node is LibraryNode => node?.kind === "directory" && node.own));
    const next = str(answer.cursor);
    if (!next || seen.has(next)) return folders;
    seen.add(next);
    cursor = next;
  }
}

const FAVORITE_STALE_MS = 30_000;
const FAVORITE_BATCH = 50;

/** Favorite status for `ids` not known in the last 30 s (hSs: favorites/status, 50 at a time); with the favorites gate only. */
export async function loadFavoriteStatus(ids: readonly string[]): Promise<void> {
  const now = Date.now();
  const asked = [...new Set(ids)].filter((id) => !(now - (state.favorites[id]?.at ?? 0) < FAVORITE_STALE_MS));
  if (!asked.length || !state.available?.favorites) return;
  const { account } = state;
  const chunks = Array.from({ length: Math.ceil(asked.length / FAVORITE_BATCH) }, (_, index) => asked.slice(index * FAVORITE_BATCH, (index + 1) * FAVORITE_BATCH));
  try {
    const pages = await Promise.all(chunks.map((chunk) => call<unknown>("POST", "/files/library/favorites/status", { target_refs: chunk.map((id) => ({ type: "library_file", library_file_id: id })) })));
    if (state.account !== account) return;
    const at = Date.now();
    const favorites = { ...state.favorites };
    for (const item of pages.flatMap((page) => list(obj(page).items)).map(obj)) {
      const id = str(obj(item.target_ref).library_file_id);
      const available = item.availability === "available";
      if (id) favorites[id] = { favoriteId: available ? str(obj(item.favorite).favorite_id) || null : null, unavailable: item.availability === "unavailable", at };
    }
    set({ favorites });
  } catch {
    // Unknown: the item waits until asked again.
  }
}

/**
 * What 添加到收藏夹 / 从收藏夹中移除 knows of `node` (the item menu's Fi), asked when it shows:
 * its status, else the favorite it was listed as; undefined (the item waits) until known.
 */
export function useFavoriteStatus(node: LibraryNode): FavoriteStatus | undefined {
  const status = useLibrary((s) => s.favorites[node.id]);
  useEffect(() => {
    void loadFavoriteStatus([node.id]);
  }, [node.id]);
  return status ?? (node.favoriteId ? { favoriteId: node.favoriteId, unavailable: false, at: 0 } : undefined);
}

/**
 * Add a file to the favorites or take it out (lSs): POST favorites / DELETE favorites/<id>, no
 * optimistic change; then 已添加到收藏夹 with 查看 (the 收藏 tab) or 已从收藏夹中移除, else
 * 无法更新收藏. Resolves to whether it took.
 */
export async function setLibraryFavorite(node: LibraryNode, on: boolean): Promise<boolean> {
  if (!on && !(state.favorites[node.id]?.favoriteId ?? node.favoriteId)) await loadFavoriteStatus([node.id]);
  const favoriteId = state.favorites[node.id]?.favoriteId ?? node.favoriteId;
  if (!state.available?.favorites || state.busy[node.id] || (!on && !favoriteId)) return false;
  const { account } = state;
  set({ busy: withIds(state.busy, [node.id]) });
  let next: string | null | undefined;
  try {
    if (on) next = str(obj(await call<unknown>("POST", "/files/library/favorites", { target_ref: { type: "library_file", library_file_id: node.id } })).favorite_id) || null;
    else {
      await call("DELETE", `/files/library/favorites/${encodeURIComponent(favoriteId!)}`);
      next = null;
    }
  } catch {
    if (state.account === account) toast("danger", "无法更新收藏");
  }
  if (state.account !== account) return false;
  set({ busy: withoutIds(state.busy, [node.id]), ...(next === undefined ? {} : { favorites: { ...state.favorites, [node.id]: { favoriteId: next, unavailable: false, at: Date.now() } } }) });
  if (next === undefined) return false;
  invalidateLibrary();
  if (on) actionToast("已添加到收藏夹", { label: "查看", run: () => openLibrary({ tab: "favorites" }) });
  else toast("neutral", "已从收藏夹中移除");
  return true;
}

// ---------------------------------------------------------------------------
// Uploads (actions Ee / J / ke; the panel is library-uploads)

/** At most this many at a time, a batch's and retries' together (J's semaphore B). */
const MAX_UPLOADS = 5;
/** hBr, the bridge's MAX_UPLOAD_BYTES. */
const MAX_UPLOAD_BYTES = 536870912;
const UPLOAD_FAILED = "无法上传";
const ACCOUNT_CHANGED = "账户已切换。请重新选择此文件进行上传";
const UPLOAD_UNCERTAIN = "上传可能已完成。重试前请先查看资料库";

/** The files of rows that may still go (queued, running, or failed with 重试). */
const held = new Map<string, File>();
const aborts = new Map<string, AbortController>();
let running = 0;
const waiting: (() => void)[] = [];

async function uploadSlot(): Promise<void> {
  while (running >= MAX_UPLOADS) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
}

function freeUploadSlot(): void {
  running--;
  waiting.shift()?.();
}

const uploadOf = (id: string) => state.uploads.find((item) => item.id === id);
const patchUpload = (id: string, patch: Partial<LibraryUpload>) => set({ uploads: state.uploads.map((item) => (item.id === id ? { ...item, ...patch } : item)) });

/** What the bridge refuses anyway, refused before sending (ke; the bridge's libraryUpload). */
function refusal(file: File): string | null {
  if (file.name.trim().startsWith(".")) return "文件名不能以“.”开头";
  if (file.size > MAX_UPLOAD_BYTES) return "此文件过大，无法上传。请尝试上传较小的文件";
  return file.size ? null : "无法上传空文件";
}

/** The bridge's NDJSON, a JSON object a line (Oot). */
async function* ndjsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (let done = false; !done; ) {
    const chunk = await reader.read();
    done = chunk.done;
    buffer += decoder.decode(chunk.value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop()!;
    for (const line of lines) {
      let value: unknown;
      try {
        value = line.trim() ? JSON.parse(line) : undefined;
      } catch {
        // Not a line of the bridge's.
      }
      if (value !== undefined) yield obj(value);
    }
  }
}

type UploadAnswer = { done: true; libraryFileId: string | null } | { done: false; error: string; uncertain: boolean; retryable: boolean };

/**
 * One file through POST /api/library/upload (the raw bytes in, NDJSON out: `{stage}` lines, then
 * `{done, libraryFileId}` or `{error, code, retryable, uncertain?}`, whose `retryable` is ke's
 * verdict from the HTTP status the bridge saw). Throws when the bridge cannot be reached or the
 * stream stops before its last line.
 */
async function sendUpload(file: File, directoryId: string | null, signal: AbortSignal, stage: (line: Record<string, unknown>) => void): Promise<UploadAnswer> {
  const id = connectionId();
  if (!id) throw new Error("未连接到 app-server");
  const params = new URLSearchParams({ c: id, name: file.name, type: file.type, size: String(file.size) });
  if (directoryId) params.set("directoryId", directoryId);
  const response = await fetch(`/api/library/upload?${params}`, { method: "POST", body: file, signal });
  // The bridge's own refusals (400, 413) stand; the rest (a closed connection, a 5xx) may pass.
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return { done: false, error: response.status === 413 ? "此文件过大，无法上传。请尝试上传较小的文件" : UPLOAD_FAILED, uncertain: false, retryable: response.status !== 400 && response.status !== 413 };
  }
  for await (const line of ndjsonLines(response.body)) {
    if (typeof line.stage === "string") stage(line);
    else if (line.done === true) return { done: true, libraryFileId: str(line.libraryFileId) || null };
    else if (typeof line.error === "string") return { done: false, error: line.error || UPLOAD_FAILED, uncertain: line.uncertain === true, retryable: line.retryable === true };
  }
  throw new Error("The upload stream stopped early");
}

type UploadOutcome = "uploaded" | "uncertain" | "failed";

/**
 * A queued row through the bridge, once a slot is free (J, then ke): 正在上传…, 处理中… as the
 * stream says, then 已上传 or 无法上传. A failure once processing began is uncertain (the file
 * may be in) and gets no 重试. A row cancelled or failed meanwhile (an account change) is left be.
 */
async function runUpload(id: string, account: string | null | undefined): Promise<UploadOutcome> {
  await uploadSlot();
  const abort = new AbortController();
  let processing = false;
  try {
    const file = held.get(id);
    const item = uploadOf(id);
    if (!file || item?.status !== "queued") return "failed";
    if (state.account !== account) {
      held.delete(id);
      patchUpload(id, { status: "failed", error: ACCOUNT_CHANGED, retryable: false });
      return "failed";
    }
    aborts.set(id, abort);
    patchUpload(id, { status: "uploading", progress: 0, error: null, retryable: false });
    const answer = await sendUpload(file, item.directoryId, abort.signal, (line) => {
      if (abort.signal.aborted) return;
      if (line.stage !== "processing") return patchUpload(id, { status: "uploading" });
      processing = true;
      patchUpload(id, { status: "processing", progress: num(line.progress) ?? uploadOf(id)?.progress ?? 0 });
    });
    if (abort.signal.aborted) return "failed";
    if (answer.done) {
      held.delete(id);
      patchUpload(id, { status: "uploaded", progress: 100, libraryFileId: answer.libraryFileId });
      return "uploaded";
    }
    if (!answer.retryable) held.delete(id);
    patchUpload(id, { status: "failed", progress: 0, error: answer.error, retryable: answer.retryable });
    return answer.uncertain ? "uncertain" : "failed";
  } catch {
    if (abort.signal.aborted) return "failed";
    if (processing) held.delete(id);
    patchUpload(id, { status: "failed", progress: 0, error: processing ? UPLOAD_UNCERTAIN : UPLOAD_FAILED, retryable: !processing });
    return processing ? "uncertain" : "failed";
  } finally {
    aborts.delete(id);
    freeUploadSlot();
  }
}

/**
 * Whether 上传文件 and dropping files are open where `q` is (actions U): no batch under way, not
 * the trash, a search, a source filter or a file type filter (图像's own aside). Every folder
 * here is the account's own.
 */
export const uploadAllowed = (q: LibraryQuery, uploading: boolean) =>
  !uploading && !q.deleted && !q.search.trim() && (q.tab === "images" || !q.categories.length) && !q.sources.length;

/** The page's search and filters as it shows them (its own state, not the route): `showLibrarySearch` keeps it. */
let shownSearch = "";
export const showLibrarySearch = (key: string): void => {
  shownSearch = key;
};

/**
 * A batch of files into `directoryId` (null: the root), the newest rows first (Ee): at most five
 * at a time, none while another batch is under way. Names starting with "." and empty or
 * over-512-MiB files fail at once. When it ends, the library reads anew if anything may have gone
 * in; if a file did and the page still shows where the batch began (the route as it was, the
 * same object, and the same search and filters: actions compares pathname and search), it goes
 * to that folder's 全部.
 */
export async function uploadToLibrary(files: readonly File[], directoryId: string | null): Promise<void> {
  if (!files.length || state.uploading) return;
  const { account } = state;
  const route = getState().libraryRoute;
  const search = shownSearch;
  const items = files.map((file): LibraryUpload => {
    const refused = refusal(file);
    return { id: crypto.randomUUID(), name: file.name, directoryId, status: refused ? "failed" : "queued", progress: 0, error: refused, retryable: false, libraryFileId: null };
  });
  items.forEach((item, index) => item.status === "queued" && held.set(item.id, files[index]));
  set({ uploading: true, uploads: [...items, ...state.uploads] });
  try {
    const outcomes = await Promise.all(items.map((item) => (item.status === "queued" ? runUpload(item.id, account) : "failed")));
    if (state.account !== account) return;
    if (outcomes.some((outcome) => outcome !== "failed")) invalidateLibrary();
    if (route && outcomes.includes("uploaded") && getState().libraryRoute === route && shownSearch === search) setState({ libraryRoute: { tab: "all", ...(directoryId ? { directoryId } : {}) } });
  } finally {
    set({ uploading: false });
  }
}

/** 重试 on a failed row that offers it (De): queued again, outside any batch; the library reads anew if it may have gone in. */
export async function retryLibraryUpload(id: string): Promise<void> {
  const item = uploadOf(id);
  if (item?.status !== "failed" || !item.retryable || !held.has(id)) return;
  const { account } = state;
  patchUpload(id, { status: "queued", error: null, retryable: false });
  if ((await runUpload(id, account)) !== "failed" && state.account === account) invalidateLibrary();
}

/** 移除 on a failed row; with no id, every finished row (the panel closed: Oe). */
export function removeLibraryUpload(id?: string): void {
  const gone = (item: LibraryUpload) => (id === undefined ? item.status === "uploaded" || item.status === "failed" : item.id === id && item.status === "failed");
  for (const item of state.uploads) if (gone(item)) held.delete(item.id);
  set({ uploads: state.uploads.filter((item) => !gone(item)) });
}

/**
 * Cancel a row still queued or uploading: the request is aborted (the bridge stops with it) and the
 * row goes. Once processing, the bytes are ChatGPT's and the row stays.
 */
export function cancelLibraryUpload(id: string): void {
  const item = uploadOf(id);
  if (item?.status !== "queued" && item?.status !== "uploading") return;
  aborts.get(id)?.abort();
  held.delete(id);
  set({ uploads: state.uploads.filter((entry) => entry.id !== id) });
}

/** The upload queue and whether a batch is under way, for the panel and the upload entries. */
export function useLibraryUploads(): { uploads: readonly LibraryUpload[]; uploading: boolean } {
  return { uploads: useLibrary((s) => s.uploads), uploading: useLibrary((s) => s.uploading) };
}

/** The selection toolbar came or went (the upload panel measures again). */
export const setLibrarySelecting = (selecting: boolean) => set({ selecting });
