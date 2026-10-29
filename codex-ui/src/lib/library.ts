// The ChatGPT app's 资料库 (/library): the account's files and folders on ChatGPT, read through the
// bridge's /api/cloud (server/cloud.mjs) as the Codex desktop app's library page reads them
// (app-initial OX and the calls it dispatches to). Whether this login has it, and its gated parts,
// comes from /api/library/available (server/library.mjs); file bytes from /api/library/content.
// Lists, folder paths and storage live in this module's store, kept per account.
import { useEffect, useSyncExternalStore } from "react";
import { CloudError, cloudCall, list, obj, query, str } from "./cloud";
import { connectionId } from "./codex";
import { readJson, useStore, writeJson, type LibraryTab } from "./store";

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
}

const TABS: readonly LibraryTab[] = ["suggested", "favorites", "folders", "images", "all"];
const DEFAULT_PREFS: LibraryPrefs = { viewMode: "grid", lastTab: "suggested" };
const EMPTY: Omit<LibraryState, "account" | "prefs" | "generation"> = { available: null, lists: {}, paths: {}, storage: null, trashEmpty: null };
const EMPTY_LIST: LibraryList = { items: [], cursor: null, loading: false, failed: null, restarted: false, sources: {}, incomplete: false, at: 0 };
/** The desktop app's staleTime for a list (Q4). */
const STALE_MS = 30_000;
/** And for a folder's path (PEo). */
const PATH_STALE_MS = 60_000;
const PAGE = 50;
const SEARCH_PAGE = 20;

let state: LibraryState = { ...EMPTY, account: undefined, prefs: DEFAULT_PREFS, generation: 0 };
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

/** Signed in as someone else (or out): nothing of the old account's library stays. */
export function resetLibrary(account: string | null): void {
  if (account === state.account) return;
  checkedAt = 0;
  set({ ...EMPTY, account, prefs: readPrefs(account), generation: state.generation + 1 });
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
  set({ available: { available: answer.available === true, favorites: answer.favorites === true, storageBanner: answer.storageBanner === true, notes: answer.notes === true } });
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
  return {
    id,
    kind,
    name: str(node.name) || str(node.file_name),
    parentId: str(node.parent_directory_id) || str(node.directory_id) || null,
    fileId: str(node.file_id) || null,
    mime: str(node.mime_type) || null,
    size: num(node.file_size_bytes),
    category: str(node.library_file_category) || null,
    artifact: typeof node.library_artifact_type === "string" ? node.library_artifact_type : null,
    updatedAt: time(node.updated_at) ?? time(node.file_upload_time) ?? time(node.record_creation_time),
    lastUsedAt: time(node.last_used_at),
    trashedAt: time(node.trashed_at),
    savedAt: null,
    thumbnail: kind === "file" && (!!str(node.thumbnail_url) || !!str(node.thumbnail_preview_url) || node.library_file_category === "image"),
    width: num(node.width),
    height: num(node.height),
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
  return node && { ...node, savedAt: time(favorite.created_at) };
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

/** The list for `q` (null: none), read as it shows and after every change. */
export function useLibraryList(q: LibraryQuery | null): LibraryList | undefined {
  const key = q && listKey(q);
  const generation = useLibrary((s) => s.generation);
  useEffect(() => {
    if (q) void loadLibrary(q);
  }, [key, generation]); // eslint-disable-line react-hooks/exhaustive-deps
  return useLibrary((s) => (key ? s.lists[key] : undefined));
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

const asking = new Set<string>();

/** `ask` for the account, unless the same `what` is being asked already (an effect runs twice in StrictMode). */
async function askOnce(what: string, ask: (account: string | null | undefined) => Promise<void>): Promise<void> {
  const key = JSON.stringify([state.account ?? null, what]);
  if (asking.has(key)) return;
  asking.add(key);
  try {
    await ask(state.account);
  } finally {
    asking.delete(key);
  }
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
