// The 资料库 page: the ChatGPT app's /library (library-page lo: the title or breadcrumb and the
// toolbar over the storage banner, the tabs and the results; library-trash-banner Dt / jt / Rt
// for the results and their states) in Claude's parts: Plugins' page shell, the Artifacts
// gallery's grid and list rows (c230724a2 Kc, $c, Ec). On top of browsing: each item's ⋯ and
// context menu (library-item-menu La), picking several (selectable-library-item, the marquee of
// library-marquee-selection Wr) with their toolbar (library-selection-toolbar We), dragging items
// onto folders and files onto the page, and the upload panel (library-uploads re), which App
// keeps up after the page is left. A file opens in its panel beside the list (LibraryFile).

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { newChat, openLibrary } from "../lib/codex";
import { fileSize } from "../lib/files";
import {
  cancelLibraryUpload,
  canUpgrade,
  dateKind,
  downloadLibraryFiles,
  filtersShown,
  gridOnly,
  imagesRoot,
  isRootLevel,
  itemActions,
  libraryContentUrl,
  libraryDockChanged,
  libraryState,
  loadLibrary,
  loadLibraryRoot,
  loadPath,
  loadStorage,
  loadTrashEmpty,
  moveLibraryItems,
  nextSort,
  nodeDate,
  removeLibraryUpload,
  retryLibraryUpload,
  setLibraryFavorite,
  setLibraryPrefs,
  showLibrarySearch,
  sortable,
  sortNodes,
  storageLevel,
  typesShown,
  uploadAllowed,
  uploadToLibrary,
  useFavoriteStatus,
  useLibrary,
  useLibraryList,
  useLibraryUploads,
  type Crumb,
  type DateKind,
  type LibraryAvailability,
  type LibraryCategory,
  type LibraryList,
  type LibraryNode,
  type LibraryQuery,
  type LibrarySort,
  type LibrarySource,
  type LibraryUpload,
  type LibraryView as ViewMode,
} from "../lib/library";
import { fetchPickerPage, startChatRefusal, startChatWithLibraryFiles } from "../lib/library-chat";
import { actionToast, getState, readJson, record, setState, toast, useStore, writeJson, type LibraryRoute, type LibraryTab } from "../lib/store";
import { ConfirmItemsDialog, EmptyTrashDialog, LibraryNewMenu, MoveDialog, NewFolderButton, RenameDialog, UploadButton, type ConfirmAction } from "./LibraryDialogs";
import { LibraryFile } from "./LibraryFile";
import { quietMenu, useLiftSlot } from "./Main";
import { SearchField } from "./SettingsConnectors";
import { menuPoint, PointerMenu } from "./Sidebar";
import { Button, Checkbox, Dialog, DropScrim, fileGlyph, Icon, MenuItem, MenuSection, MenuSep, Popover, Segmented, Skeleton, Spinner, useDockClearance, usePageDrop, type IconName } from "./ui";

const TABS: { value: LibraryTab; label: string }[] = [
  { value: "suggested", label: "推荐" },
  { value: "favorites", label: "收藏" },
  { value: "folders", label: "文件夹" },
  { value: "images", label: "图像" },
  { value: "all", label: "全部" },
];
const TYPES: { value: LibraryCategory; label: string; clear: string }[] = [
  { value: "images", label: "图像", clear: "移除图像筛选条件" },
  { value: "documents", label: "文档", clear: "移除文档筛选条件" },
  { value: "spreadsheets", label: "电子表格", clear: "移除电子表格筛选条件" },
  { value: "presentations", label: "演示文稿", clear: "移除演示文稿筛选条件" },
  { value: "pdfs", label: "PDF 文件", clear: "移除 PDF 筛选条件" },
];
const SOURCES: { value: LibrarySource; label: string; clear: string }[] = [
  { value: "uploaded", label: "已上传", clear: "清除“已上传”筛选条件" },
  { value: "generated", label: "生成的文件", clear: "清除“已生成”筛选条件" },
];
/** libraryNext.results.dateHeadingWithSaved. */
const DATE_HEADINGS: Record<DateKind, string> = { suggested: "最近活动时间", deleted: "删除日期", saved: "保存日期", modified: "修改日期" };
const NO_FILTERS = { categories: [] as LibraryCategory[], sources: [] as LibrarySource[] };
/** storage_cleanup's order: the largest first. */
const BY_SIZE: LibrarySort = { key: "size", direction: "desc" };
const STORAGE_DISMISSED = "codex-ui:library-storage-dismissed";
const WEEK = 6048e5;
const UPGRADE_URL = "https://chatgpt.com/#pricing";

const go = (route: LibraryRoute) => setState({ libraryRoute: route });

/**
 * A key for one stay at `value`: it changes when `value` does, and again when `value` comes back
 * after a change (leaving a place and returning starts it afresh, as a new location does there).
 */
function useVisit(value: string): string {
  const seen = useRef({ value, count: 0 });
  if (seen.current.value !== value) seen.current = { value, count: seen.current.count + 1 };
  return `${seen.current.count}:${value}`;
}

/** State kept for one visit: read in another it is `initial` again (no effect, so no stale fetch first). */
function useScoped<T>(scope: string, initial: T): [T, (value: T) => void] {
  const [held, setHeld] = useState({ scope, value: initial });
  return [held.scope === scope ? held.value : initial, (value) => setHeld({ scope, value })];
}

export function LibraryView() {
  const route = useStore((s) => s.libraryRoute);
  const account = useLibrary((s) => s.account);
  const gates = useLibrary((s) => s.available);
  // Signed out of ChatGPT, or the account has no library: the page goes (the desktop app's IA redirect).
  const closed = account === null || gates?.available === false;
  useEffect(() => {
    document.title = "资料库 - Codex";
  }, []);
  useEffect(() => {
    if (closed) newChat();
  }, [closed]);
  return route && gates?.available ? <LibraryPage route={route} gates={gates} /> : <div className="main-col" />;
}

function LibraryPage({ route, gates }: { route: LibraryRoute; gates: LibraryAvailability }) {
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const slot = useLiftSlot();
  const prefs = useLibrary((s) => s.prefs);
  const trashEmpty = useLibrary((s) => s.trashEmpty);
  const generation = useLibrary((s) => s.generation);
  const directoryId = route.directoryId ?? null;
  const deleted = !!route.deleted;
  // Search, the sort and a storage cleanup's own view last while the place does; filters while the
  // tab does, into its folders too (La clears them on a tab, MTo keeps them in a folder).
  const place = useVisit(JSON.stringify([route.tab, directoryId, deleted, !!route.storageCleanup]));
  const [input, setInput] = useScoped(place, "");
  const [search, setSearch] = useScoped(place, "");
  const [filters, setFilters] = useScoped(useVisit(JSON.stringify([route.tab, deleted])), NO_FILTERS);
  const [cleanupView, setCleanupView] = useScoped<ViewMode>(place, "list");
  const [sort, setSort] = useScoped<LibrarySort | null>(place, null);
  const cleanup = !!route.storageCleanup;
  useEffect(() => {
    const timer = setTimeout(() => input.trim() !== search && setSearch(input.trim()), 250);
    return () => clearTimeout(timer);
  }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  const at = { tab: route.tab, directoryId, deleted, search };
  const showFilters = filtersShown(at);
  const showTypes = typesShown(at);
  const query: LibraryQuery = { ...at, categories: showTypes ? filters.categories : [], sources: showFilters ? filters.sources : [] };
  // A filter the place cannot show is gone, not waiting for the next folder or search (MTo drops it).
  useEffect(() => {
    if (query.categories.length !== filters.categories.length || query.sources.length !== filters.sources.length) setFilters({ categories: query.categories, sources: query.sources });
  }, [showTypes, showFilters]); // eslint-disable-line react-hooks/exhaustive-deps
  // An upload batch goes to its folder's 全部 only if these stayed as they were (actions' search).
  const searchKey = JSON.stringify([search, query.categories, query.sources]);
  useEffect(() => showLibrarySearch(searchKey), [searchKey]);
  const favoritesOff = route.tab === "favorites" && directoryId === null && !deleted && !gates.favorites;
  // The trash is asked whether it holds anything first (vEo); an empty one shows no toolbar or banner.
  const data = useLibraryList(favoritesOff || (deleted && trashEmpty !== false) ? null : query);
  useEffect(() => {
    if (deleted) void loadTrashEmpty();
  }, [deleted, generation]);
  useEffect(() => {
    if (directoryId) void loadPath(directoryId);
  }, [directoryId, generation]);

  const forcedGrid = gridOnly(at);
  const view: ViewMode = forcedGrid ? "grid" : cleanup ? cleanupView : prefs.viewMode;
  const kind = dateKind(at);
  // A search keeps the server's order, a storage cleanup's included (QTo).
  const order = sort ?? (cleanup ? BY_SIZE : null);
  const items = data && order && sortable(at) ? sortNodes(data.items, order, kind) : data?.items;
  const open = (node: LibraryNode) => (node.kind === "directory" ? go({ tab: route.tab, directoryId: node.id }) : go({ ...route, fileId: node.id, note: undefined }));
  const searchLabel = deleted ? "在回收站中搜索" : directoryId ? "在当前文件夹中搜索" : "搜索资料库";
  const setTypes = (categories: LibraryCategory[]) => setFilters({ ...filters, categories });
  const setSources = (sources: LibrarySource[]) => setFilters({ ...filters, sources });
  // le: files dragged onto the page go up into the place shown, where 上传文件 could take them
  // (U); folders among them stay out.
  const uploading = useLibrary((s) => s.uploading);
  const dropping = usePageDrop(uploadAllowed(query, uploading), (files, transfer) => {
    const entries = [...transfer.items].filter((item) => item.kind === "file");
    void uploadToLibrary([...files].filter((_, index) => !entries[index]?.webkitGetAsEntry()?.isDirectory), directoryId);
  });

  const bar = (
    <header className="chat-header library-bar" data-tip-group="" data-density="compact" data-collapsed={(!sidebarOpen && !slot) || undefined}>
      <h1 className="draft-title cloud-title library-title">
        {deleted || directoryId ? <Crumbs route={route} /> : <span className="cloud-title-text">{search ? "搜索" : "资料库"}</span>}
      </h1>
      <span className="spacer" />
      {!(deleted && trashEmpty) && (
        <div className="header-actions library-actions">
          {showFilters && (
            <>
              {/* Ea: what is on, each to clear on its own. */}
              {SOURCES.filter((entry) => filters.sources.includes(entry.value)).map((entry) => (
                <Chip key={entry.value} entry={entry} onClear={() => setSources(filters.sources.filter((value) => value !== entry.value))} />
              ))}
              {showTypes &&
                TYPES.filter((entry) => filters.categories.includes(entry.value)).map((entry) => (
                  <Chip key={entry.value} entry={entry} onClear={() => setTypes(filters.categories.filter((value) => value !== entry.value))} />
                ))}
              <FilterMenu types={showTypes} categories={filters.categories} sources={filters.sources} onTypes={setTypes} onSources={setSources} />
            </>
          )}
          {!forcedGrid && (
            <Button
              variant="ghost"
              icon={<Icon name={view === "grid" ? "ListBullet" : "Grid"} />}
              label={view === "grid" ? "列表视图" : "网格视图"}
              tip={view === "grid" ? "列表" : "网格"}
              onClick={() => {
                const next = view === "grid" ? "list" : "grid";
                if (cleanup) setCleanupView(next);
                else setLibraryPrefs({ viewMode: next });
              }}
            />
          )}
          <SearchField id="library-search" value={input} placeholder={searchLabel} onChange={setInput} />
          {!deleted && (
            <LibraryNewMenu
              query={query}
              anchor={(shown, toggle) => (
                // Short of room, Add alone (PageHeader's primaryActionCompactIcon), its name kept.
                <Button variant="primary" size="sm" className="library-new" aria-label="新建" active={shown} onClick={toggle}>
                  <Icon name="Add" size="sm" className="library-new-icon" />
                  <span className="library-new-text">新建</span>
                  <Icon name="CaretDown" size="sm" className="library-new-caret" />
                </Button>
              )}
            />
          )}
          <SettingsMenu onTrash={() => go({ tab: "all", deleted: true })} />
        </div>
      )}
    </header>
  );

  let body: ReactNode;
  if (favoritesOff) body = <Empty title="此账户无法使用收藏夹" />;
  else if (deleted && trashEmpty === null) body = <Loading view={view} />;
  else if (deleted && trashEmpty) body = <Empty title="回收站中没有文件" note="移至回收站的文件将在 30 天后被永久删除" />;
  else
    body = (
      <Results
        query={query}
        data={data}
        items={items}
        view={view}
        kind={kind}
        sort={sortable(at) ? order : undefined}
        onSort={(key) => setSort(nextSort(order, key))}
        openId={route.fileId}
        onOpen={deleted ? undefined : open}
      />
    );

  // The file's panel beside the list (its own node when the list has it), or a new note's (keyed by
  // its note while its first save gives it a file); closing hands focus back to the item it opened
  // from, once the list shows again (a narrow window hides it meanwhile).
  const { fileId, note } = route;
  const closeFile = () => {
    const hit = document.querySelector<HTMLElement>("[data-library-item][data-open] > .library-hit");
    go({ ...route, fileId: undefined, note: undefined });
    requestAnimationFrame(() => hit?.focus());
  };

  return (
    <>
      <div className="main-col" data-testid="library-page" onContextMenu={quietMenu}>
        {/* What is picked lasts while the place does; the titlebar's breadcrumb takes drops too, so
            it sits inside (not keyed: the titlebar and the tabs stay as the place changes). */}
        <Selection place={place} query={query} route={route} items={items ?? []}>
          {slot ? createPortal(bar, slot) : bar}
          <div className="plugins-scroll">
            <div className="plugins-page library-page">
              {gates.storageBanner && <StorageBanner onManage={() => go({ tab: "all", storageCleanup: true })} />}
              {deleted && <TrashNotice />}
              {!deleted && !search && directoryId === null && (
                <div className="plugins-tabs">
                  <Segmented<LibraryTab>
                    label="资料库分区"
                    value={route.tab}
                    options={TABS.filter((tab) => tab.value !== "favorites" || gates.favorites)}
                    onChange={(tab) => {
                      setLibraryPrefs({ lastTab: tab });
                      go({ tab });
                    }}
                  />
                </div>
              )}
              <Marquee>{body}</Marquee>
            </div>
          </div>
        </Selection>
        {dropping && <DropScrim label="添加任意内容" note="将任意文件拖放到此处，即可添加到你的资料库" />}
      </div>
      {(fileId || note) && (
        <LibraryFile
          key={note ?? fileId}
          id={fileId}
          note={note}
          known={items?.find((node) => node.id === fileId)}
          onClose={closeFile}
          onCreated={(id) => {
            const now = getState().libraryRoute;
            if (now && now.note === note) go({ ...now, fileId: id });
          }}
        />
      )}
    </>
  );
}

/**
 * mi: the trash's note and 清空文件回收站 (the trash holds something: vEo said so). Its confirmation
 * outlives the note, which goes while the trash is asked again after the call.
 */
function TrashNotice() {
  const [asking, setAsking] = useState(false);
  const trashEmpty = useLibrary((s) => s.trashEmpty);
  return (
    <>
      {trashEmpty === false && (
        <div className="library-notice library-trash">
          <p className="library-notice-text">恢复最近删除的文件。这些文件将在 30 天后永久删除。</p>
          <Button variant="secondary" size="sm" onClick={() => setAsking(true)}>
            清空文件回收站
          </Button>
        </div>
      )}
      {asking && <EmptyTrashDialog onClose={() => setAsking(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Picking several (item-menu ya: Z the ids, _a the anchor), the dialogs, dragging onto folders

type PageDialog =
  | { type: "rename"; node: LibraryNode }
  | { type: ConfirmAction; nodes: LibraryNode[]; bulk: boolean }
  /** `followers`: picked items under a picked folder, which go with it (xa's r2: item, folder). */
  | { type: "move"; nodes: LibraryNode[]; path: Crumb[]; followers: [string, string][] };

/** Where a drag can drop: a folder, or the library's root (id null, the breadcrumb's 资料库). */
type DropTarget = { id: string | null; name: string };

interface Page {
  query: LibraryQuery;
  /** Items here can be picked (Q's E2): not on the favorites' root. */
  selectable: boolean;
  selected: ReadonlySet<string>;
  /**
   * Something shown is picked (ma): clicks pick, checkboxes stay, items' own ⋯ and context menus
   * give way to the toolbar. What a search hides stays picked but does not count.
   */
  selecting: boolean;
  pick(id: string, on: boolean, range: boolean): void;
  /** The list header's 全选 / 清除选择 over `ids` (la). */
  pickAll(ids: string[], on: boolean): void;
  /** The marquee's picks, as they are (Wr). */
  setPicked(ids: ReadonlySet<string>): void;
  act(dialog: PageDialog): void;
  move(nodes: LibraryNode[]): void;
  /** The results' box, whose [data-library-selection-id] cells give the order a range runs in. */
  area: RefObject<HTMLDivElement | null>;
  drag: {
    /** Items can be dragged onto folders here (qe). */
    on: boolean;
    /** The folder a drag is over (X); "" for the root. */
    over: string | null;
    start(node: LibraryNode, event: DragEvent<HTMLElement>): void;
    end(): void;
    hover(target: DropTarget, event: DragEvent<HTMLElement>): void;
    leave(target: DropTarget, event: DragEvent<HTMLElement>): void;
    drop(target: DropTarget, event: DragEvent<HTMLElement>): void;
  };
}

const PageContext = createContext<Page | null>(null);
const usePage = () => useContext(PageContext)!;
const NONE: ReadonlySet<string> = new Set();

/** ra: `ids` with `span` set to `on`. */
const withSpan = (ids: ReadonlySet<string>, span: readonly string[], on: boolean) => {
  const next = new Set(ids);
  for (const id of span) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
};

type Picks = { ids: ReadonlySet<string>; anchor: string | null };
const NO_PICKS: Picks = { ids: NONE, anchor: null };

/**
 * The selection and what acts on it. The selection is `place`'s (another starts empty, as
 * useScoped's state does; a late update from one left is dropped). `items` are the ones shown
 * (the selection counts those, so an item that leaves the list leaves it too).
 */
function Selection({ place, query, route, items, children }: { place: string; query: LibraryQuery; route: LibraryRoute; items: LibraryNode[]; children: ReactNode }) {
  const [held, setHeld] = useState<Picks & { place: string }>({ ...NO_PICKS, place });
  const current = useRef(place);
  current.current = place;
  const selection = held.place === place ? held : NO_PICKS;
  const setSelection = (next: (s: Picks) => Picks) => setHeld((h) => (place !== current.current ? h : { ...next(h.place === place ? h : NO_PICKS), place }));
  const [dialog, setDialog] = useState<PageDialog | null>(null);
  // Q: xa's folder check is under way; R: a drop's move is.
  const [checking, setChecking] = useState(false);
  const [dropMoving, setDropMoving] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const dragged = useRef<LibraryNode[] | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const root = useLibrary((s) => s.root);
  const busy = useLibrary((s) => s.busy);
  const favoritesRoot = query.tab === "favorites" && query.directoryId === null && !query.deleted;
  const picked = items.filter((node) => selection.ids.has(node.id));
  const selecting = picked.length > 0;
  const deselect = (ids: readonly string[]) => setSelection((s) => ({ ...s, ids: withSpan(s.ids, ids, false) }));
  const there = (node: LibraryNode, target: string | null) => (target === null ? isRootLevel(node, root) : node.parentId === target);

  // qe: items go onto folders where the page lists a place's own: not the trash, a search or the
  // favorites' root, nor while a drop's move runs.
  const dragOn = !query.deleted && !query.search.trim() && !favoritesRoot && !dropMoving;
  // Ue: a folder (or the root) that is not one of them, not busy, and not where all of them are.
  const accepts = (target: DropTarget) => {
    const nodes = dragged.current;
    if (!dragOn || !nodes || (target.id !== null && (busy[target.id] || nodes.some((node) => node.id === target.id)))) return false;
    return nodes.some((node) => !there(node, target.id));
  };
  /** Ge: out of the lists and the selection at once, back if the move fails; 已移至“{name}” with 查看. */
  const dropOnto = async (nodes: LibraryNode[], target: DropTarget) => {
    const moving = nodes.filter((node) => !there(node, target.id));
    const ids = moving.map((node) => node.id);
    const had = ids.filter((id) => selection.ids.has(id));
    deselect(ids);
    setDropMoving(true);
    const done = await moveLibraryItems(moving, target.id, { optimistic: true });
    setDropMoving(false);
    const back = had.filter((id) => !done.includes(id));
    if (back.length) setSelection((s) => ({ ...s, ids: withSpan(s.ids, back, true) }));
    if (done.length)
      actionToast(target.id === null ? "已移动至资料库" : `已移至“${target.name}”`, {
        label: "查看",
        // The toast outlives the page: opened as the sidebar opens it, whatever shows by then.
        run: () => openLibrary(target.id === null ? { tab: route.tab } : { tab: route.tab, directoryId: target.id }),
      });
  };

  /**
   * xa: with folders picked from more than one place, each place's path says which picked items
   * sit under a picked folder; those go with their folder, not on their own (无法检查所选文件夹 when
   * a path cannot be read). The dialog starts where the page is.
   */
  const move = async (nodes: LibraryNode[]) => {
    if (checking) return;
    const folders = new Set(nodes.filter((node) => node.kind === "directory").map((node) => node.id));
    const parents = [...new Set(nodes.flatMap((node) => (node.parentId === null ? [] : [node.parentId])))];
    const followers: [string, string][] = [];
    if (folders.size && new Set(nodes.map((node) => node.parentId)).size > 1) {
      setChecking(true);
      await Promise.all(parents.map(loadPath));
      setChecking(false);
      const { paths } = libraryState();
      if (parents.some((id) => !paths[id])) return toast("danger", "无法检查所选文件夹。请重试");
      for (const node of nodes) {
        const folder = node.parentId === null ? undefined : paths[node.parentId].crumbs.find((crumb) => folders.has(crumb.id));
        if (folder) followers.push([node.id, folder.id]);
      }
    }
    const at = query.directoryId;
    const path = at ? (libraryState().paths[at]?.crumbs ?? [{ id: at, name: "当前文件夹" }]) : [];
    setDialog({ type: "move", nodes: nodes.filter((node) => !followers.some(([id]) => id === node.id)), path, followers });
  };

  const page: Page = {
    query,
    selectable: !favoritesRoot,
    selected: selection.ids,
    selecting,
    pick(id, on, range) {
      // ca: a range runs from the anchor to `id` in the order shown (a sectioned grid's folders
      // first), once something is picked; the anchor stays for the next one.
      const order = [...(area.current?.querySelectorAll<HTMLElement>("[data-library-selection-id]") ?? [])].map((cell) => cell.dataset.librarySelectionId!);
      setSelection((s) => {
        const from = range && s.ids.size && s.anchor !== null ? order.indexOf(s.anchor) : -1;
        const to = order.indexOf(id);
        const span = from >= 0 && to >= 0 ? order.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
        return { ids: withSpan(s.ids, span, on), anchor: range && span.length > 1 ? s.anchor : id };
      });
    },
    pickAll: (ids, on) => setSelection((s) => ({ ...s, ids: withSpan(s.ids, ids, on) })),
    setPicked: (ids) => setSelection((s) => ({ ...s, ids })),
    act: setDialog,
    move: (nodes) => void move(nodes),
    area,
    drag: {
      on: dragOn,
      over,
      start(node, event) {
        // He: the selection when the item is in it, else the item alone; all movable, none busy.
        const nodes = selecting ? picked : [node];
        if (!dragOn || !nodes.some((each) => each.id === node.id) || !nodes.every((each) => each.own) || nodes.some((each) => busy[each.id])) return event.preventDefault();
        dragged.current = nodes;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", JSON.stringify(nodes.map((each) => each.id)));
      },
      end() {
        dragged.current = null;
        setOver(null);
      },
      hover(target, event) {
        if (!accepts(target)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setOver(target.id ?? "");
      },
      leave(target, event) {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setOver((current) => (current === (target.id ?? "") ? null : current));
      },
      drop(target, event) {
        if (!accepts(target)) return;
        event.preventDefault();
        event.stopPropagation();
        const nodes = dragged.current!;
        dragged.current = null;
        setOver(null);
        void dropOnto(nodes, target);
      },
    },
  };

  const close = () => setDialog(null);
  return (
    <PageContext.Provider value={page}>
      {children}
      <SelectionBar picked={picked} pending={checking} onDeselect={deselect} onClear={() => setSelection((s) => ({ ...s, ids: NONE }))} />
      {dialog?.type === "rename" && <RenameDialog node={dialog.node} onClose={close} />}
      {(dialog?.type === "delete" || dialog?.type === "deleteForever" || dialog?.type === "restore") && (
        <ConfirmItemsDialog
          nodes={dialog.nodes}
          action={dialog.type}
          bulk={dialog.bulk}
          onDone={(ids) => {
            deselect(ids);
            // The panel's file went with them: it closes, as the panel's own 删除 closes it.
            const now = getState().libraryRoute;
            if (now?.fileId && ids.includes(now.fileId)) go({ ...now, fileId: undefined });
          }}
          onClose={close}
        />
      )}
      {dialog?.type === "move" && (
        <MoveDialog
          nodes={dialog.nodes}
          path={dialog.path}
          onMoved={(ids) => deselect([...ids, ...dialog.followers.filter(([, folder]) => ids.includes(folder)).map(([id]) => id)])}
          onClose={close}
        />
      )}
    </PageContext.Provider>
  );
}

/** MARQUEE_SKIP (Yr): where a press is something's own, not the start of a marquee. */
const MARQUEE_SKIP = [
  "[data-library-item]", "a", "button", "input", "select", "textarea", "label", "summary", "[contenteditable]:not([contenteditable='false'])", "[draggable='true']",
  "[role='button']", "[role='checkbox']", "[role='link']", "[role='menu']", "[role='menuitem']", "[role='alert']", "[role='status']", "[tabindex]",
].join(",");

/**
 * Wr: a left-button mouse press on the page's blank part (not an item, a control or the
 * scrollbar) that moves 5px draws a box, and picks what it crosses; Ctrl, ⌘ or Shift add to what
 * was picked. By the scroller's top or bottom (48px) it scrolls, up to 24px a frame. It ends with
 * the button, the pointer capture or the window's focus.
 */
function Marquee({ children }: { children: ReactNode }) {
  const page = usePage();
  const [box, setBox] = useState<CSSProperties | null>(null);
  const latest = useRef(page);
  latest.current = page;
  useEffect(() => {
    const content = latest.current.area.current;
    const scroller = content?.closest<HTMLElement>(".plugins-scroll");
    if (!content || !scroller) return;
    let drag: { pointer: number; start: { x: number; y: number }; origin: { x: number; y: number }; at: { x: number; y: number }; base: ReadonlySet<string>; active: boolean } | null = null;
    let frame = 0;
    const paint = () => {
      if (!drag?.active) return;
      const c = content.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      const x = c.left + drag.origin.x;
      const y = c.top + drag.origin.y;
      const [left, right, top, bottom] = [Math.min(x, drag.at.x), Math.max(x, drag.at.x), Math.min(y, drag.at.y), Math.max(y, drag.at.y)];
      const next = new Set(drag.base);
      for (const cell of content.querySelectorAll<HTMLElement>("[data-library-selection-id]")) {
        const r = cell.getBoundingClientRect();
        if (left < r.right && right > r.left && top < r.bottom && bottom > r.top) next.add(cell.dataset.librarySelectionId!);
      }
      const now = latest.current.selected;
      if (next.size !== now.size || [...next].some((id) => !now.has(id))) latest.current.setPicked(next);
      const clipLeft = Math.max(c.left, left);
      const clipTop = Math.max(s.top, top);
      setBox({ left: clipLeft - c.left, top: clipTop - c.top, width: Math.max(0, Math.min(c.right, right) - clipLeft), height: Math.max(0, Math.min(s.bottom, bottom) - clipTop) });
    };
    const tick = () => {
      if (!drag?.active) return;
      const s = scroller.getBoundingClientRect();
      const edge = Math.min(48, s.height / 2);
      const past = drag.at.y < s.top + edge ? drag.at.y - s.top - edge : Math.max(0, drag.at.y - s.bottom + edge);
      scroller.scrollTop += Math.max(-1, Math.min(1, past / edge)) * 24;
      paint();
      frame = requestAnimationFrame(tick);
    };
    const end = () => {
      if (!drag) return;
      cancelAnimationFrame(frame);
      if (scroller.hasPointerCapture(drag.pointer)) scroller.releasePointerCapture(drag.pointer);
      drag = null;
      setBox(null);
    };
    const down = (event: PointerEvent) => {
      if (event.defaultPrevented || event.button !== 0 || !event.isPrimary || event.pointerType !== "mouse" || drag || !(event.target instanceof Element)) return;
      if (!latest.current.selectable || !content.querySelector("[data-library-selection-id]")) return;
      const hit = event.target.closest(MARQUEE_SKIP);
      if (hit && scroller.contains(hit)) return;
      if (event.clientX >= scroller.getBoundingClientRect().left + scroller.clientWidth) return;
      const c = content.getBoundingClientRect();
      const at = { x: event.clientX, y: event.clientY };
      drag = { pointer: event.pointerId, start: at, at, origin: { x: at.x - c.left, y: at.y - c.top }, base: event.metaKey || event.ctrlKey || event.shiftKey ? latest.current.selected : NONE, active: false };
      event.preventDefault();
    };
    const move = (event: PointerEvent) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      if (!(event.buttons & 1)) return end();
      drag.at = { x: event.clientX, y: event.clientY };
      if (!drag.active) {
        if (Math.hypot(drag.at.x - drag.start.x, drag.at.y - drag.start.y) < 5) return;
        drag.active = true;
        scroller.setPointerCapture(event.pointerId);
        frame = requestAnimationFrame(tick);
      }
      event.preventDefault();
      paint();
    };
    const up = (event: PointerEvent) => {
      if (drag?.pointer === event.pointerId) end();
    };
    scroller.addEventListener("pointerdown", down);
    scroller.addEventListener("lostpointercapture", up);
    scroller.addEventListener("scroll", paint);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", end);
    return () => {
      end();
      scroller.removeEventListener("pointerdown", down);
      scroller.removeEventListener("lostpointercapture", up);
      scroller.removeEventListener("scroll", paint);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", end);
    };
  }, []);
  return (
    <div ref={page.area} className="library-area">
      {children}
      {box && <div className="library-marquee" aria-hidden="true" style={box} />}
    </div>
  );
}

/** A button the toolbar dims, its reason as its tip (and its name, for the keyboard: We's aria-disabled span). */
function BarAction({ reason, children }: { reason: string | undefined; children: ReactNode }) {
  if (!reason) return children;
  return (
    <span className="library-reason" data-tip-reason="" data-tip={reason} role="button" tabIndex={0} aria-disabled="true" aria-label={reason}>
      {children}
    </span>
  );
}

/**
 * We: what is picked, as a pill floating over the page's foot: 已选择 # 个, 开始聊天 (a new
 * session's draft with the files attached, as a local chat takes them: startChatRefusal), 下载,
 * 恢复 (the trash), 移动, 删除 / 永久删除, 清除选择; each dimmed with its reason when it cannot
 * act on the whole selection (ga, sa). With three primary buttons or more (j), 移动 folds into
 * 更多操作. Esc clears it, also from #library-search but not from another field. What 下载
 * sends off leaves the selection (Ca). The upload panel rises over it while it shows.
 */
function SelectionBar({ picked, pending, onDeselect, onClear }: { picked: LibraryNode[]; pending: boolean; onDeselect(ids: string[]): void; onClear(): void }) {
  const page = usePage();
  const bar = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const [starting, setStarting] = useState(false);
  const deleted = page.query.deleted;
  const count = picked.length;
  const shown = count > 0;
  useLayoutEffect(() => {
    if (!shown) return;
    libraryDockChanged();
    return libraryDockChanged;
  }, [shown]);
  useEffect(() => {
    if (!count || pending) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || !(target instanceof Element)) return;
      // The page (its scroller, and its titlebar, which codex-ui lifts out of it), the toolbar, or nothing.
      const doc = target.ownerDocument;
      const search = target.id === "library-search";
      const scroller = page.area.current?.closest(".plugins-scroll");
      if (!scroller?.contains(target) && !target.closest(".library-bar") && !bar.current?.contains(target) && target !== doc.body && target !== doc.documentElement) return;
      if (!search && (target.closest("input:not([type='checkbox']):not([type='radio']), select, textarea, [contenteditable]:not([contenteditable='false'])") || (target as HTMLElement).isContentEditable)) return;
      event.preventDefault();
      onClear();
      if (target instanceof HTMLElement && (target.closest("[data-library-item]") || target.getAttribute("role") === "checkbox")) target.blur();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  if (!count) return null;
  const some = (test: (node: LibraryNode) => boolean) => picked.some(test);
  const every = (test: (node: LibraryNode) => boolean) => picked.every(test);
  const showDownload = !deleted && !some((node) => node.saved) && some((node) => itemActions(node, false).download);
  const canDownload = showDownload && !some((node) => node.kind === "directory");
  const canDelete = deleted ? every((node) => itemActions(node, true).deleteForever) : some((node) => itemActions(node, false).delete);
  const canRestore = every((node) => itemActions(node, true).restore);
  const canMove = every((node) => node.own);
  const why = (ok: boolean, reason: string) => (pending ? "请等待当前操作完成" : ok ? undefined : reason);
  const downloadWhy = why(canDownload, "请选择文件进行下载，其中不能包含文件夹");
  const restoreWhy = why(canRestore, "所选内容包含只读项目");
  const moveWhy = why(canMove, "请仅选择页面，或仅选择文件和文件夹，并确保有权移动所有所选项目");
  const deleteWhy = why(canDelete, "你无权删除所选项目");
  // sa: offered unless a favorite's saved entity is among them (a folder says why it cannot go).
  const showChat = !deleted && !some((node) => node.saved);
  const chatRefusal = startChatRefusal(picked);
  const chatWhy = why(!chatRefusal, chatRefusal ?? "");
  const folded = [showChat, showDownload, deleted, true].filter(Boolean).length >= 3;
  const startChat = () => {
    setStarting(true);
    void startChatWithLibraryFiles(picked)
      .then((outcome) => outcome === "unavailable" && toast("danger", "无法使用这些项目开始聊天"))
      .finally(() => setStarting(false));
  };
  return (
    <div ref={bar} className="library-selection" data-density="compact">
      <div className="library-toolbar" role="toolbar" aria-label="所选项目的操作">
        <span className="library-toolbar-count">已选择 {count} 个</span>
        {showChat && (
          <BarAction reason={chatWhy}>
            <Button variant="primary" size="lg" icon={starting ? <Spinner size={16} inherit /> : <Icon name="ChatSimple" />} disabled={!!chatWhy || starting} onClick={startChat}>
              {starting ? "正在开始聊天…" : "开始聊天"}
            </Button>
          </BarAction>
        )}
        {showDownload && (
          <BarAction reason={downloadWhy}>
            <Button variant="secondary" size="lg" icon={<Icon name="Download" />} disabled={!!downloadWhy} onClick={() => onDeselect(downloadLibraryFiles(picked))}>
              下载
            </Button>
          </BarAction>
        )}
        {deleted && (
          <BarAction reason={restoreWhy}>
            <Button variant="primary" size="lg" icon={<Icon name="ArrowCounterClockwise" />} disabled={!!restoreWhy} onClick={() => page.act({ type: "restore", nodes: picked, bulk: true })}>
              恢复
            </Button>
          </BarAction>
        )}
        {!deleted && !folded && (
          <BarAction reason={moveWhy}>
            <Button variant="secondary" size="lg" icon={<Icon name="Folder" />} disabled={!!moveWhy} onClick={() => page.move(picked)}>
              移动
            </Button>
          </BarAction>
        )}
        <BarAction reason={deleteWhy}>
          <Button variant="danger" size="lg" icon={<Icon name="Trash" />} disabled={!!deleteWhy} onClick={() => page.act({ type: deleted ? "deleteForever" : "delete", nodes: picked, bulk: true })}>
            {deleted ? "永久删除" : "删除"}
          </Button>
        </BarAction>
        {!deleted && folded && (
          <Popover
            open={more}
            onClose={() => setMore(false)}
            placement="top-end"
            anchor={<Button variant="ghost" size="lg" icon={<Icon name="DotsHorizontal" />} label="更多操作" active={more} disabled={pending} onClick={() => setMore(!more)} />}
          >
            <MenuItem
              icon={<Icon name="Folder" />}
              label="移动"
              hint={canMove ? undefined : moveWhy}
              disabled={!canMove}
              onClick={() => {
                setMore(false);
                page.move(picked);
              }}
            />
          </Popover>
        )}
        <Button variant="ghost" size="lg" icon={<Icon name="X" />} label="清除选择" disabled={pending} onClick={onClear} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The toolbar

function Chip({ entry, onClear }: { entry: { label: string; clear: string }; onClear(): void }) {
  return (
    <Button variant="secondary" size="sm" className="library-chip" aria-label={entry.clear} onClick={onClear}>
      {entry.label}
      <Icon name="X" size="sm" />
    </Button>
  );
}

/** Ca: file types and sources, checked in place; the trigger takes the accent while one is on (Claude's dt). */
function FilterMenu({ types, categories, sources, onTypes, onSources }: { types: boolean; categories: LibraryCategory[]; sources: LibrarySource[]; onTypes(next: LibraryCategory[]): void; onSources(next: LibrarySource[]): void }) {
  const [open, setOpen] = useState(false);
  const count = (types ? categories.length : 0) + sources.length;
  const flip = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      anchor={
        <Button
          variant="ghost"
          className={count ? "connectors-filter-on" : undefined}
          icon={<Icon name="Filter" />}
          label={count ? `打开筛选器，${count} 个筛选器已开启` : "打开筛选器"}
          tip="筛选"
          active={open}
          onClick={() => setOpen(!open)}
        />
      }
    >
      {types && (
        <>
          <MenuSection title="文件类型" />
          {TYPES.map((type) => (
            <MenuItem key={type.value} label={type.label} checked={categories.includes(type.value)} toggle onClick={() => onTypes(flip(categories, type.value))} />
          ))}
          <MenuSep />
        </>
      )}
      <MenuSection title="来源" />
      {SOURCES.map((source) => (
        <MenuItem key={source.value} label={source.label} checked={sources.includes(source.value)} toggle onClick={() => onSources(flip(sources, source.value))} />
      ))}
    </Popover>
  );
}

/** ja / Ma: the settings gear, whose one entry here is 管理 › 回收站 (cloud drives' switches stay out). */
function SettingsMenu({ onTrash }: { onTrash(): void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onClose={() => setOpen(false)} placement="bottom-end" anchor={<Button variant="ghost" icon={<Icon name="Settings" />} label="设置" active={open} onClick={() => setOpen(!open)} />}>
      <MenuSection title="管理" />
      <MenuItem
        icon={<Icon name="Trash" />}
        label="回收站"
        onClick={() => {
          setOpen(false);
          onTrash();
        }}
      />
    </Popover>
  );
}

/**
 * Ra / pa: 资料库 › the folders down to this one (or › 回收站). The middle ones fold into a … menu
 * when the row runs out of room, measured on an invisible copy of the whole row: the first, the
 * current one and as many before it as fit stay out.
 */
function Crumbs({ route }: { route: LibraryRoute }) {
  const { drag } = usePage();
  const path = useLibrary((s) => (route.directoryId ? s.paths[route.directoryId] : undefined));
  const items = [{ id: null as string | null, name: "资料库" }, ...(route.deleted ? [{ id: "trash", name: "回收站" }] : (path?.crumbs ?? []))];
  const box = useRef<HTMLSpanElement>(null);
  const ruler = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(Number.MAX_SAFE_INTEGER);
  const [menu, setMenu] = useState(false);
  const names = items.map((item) => item.name).join("\n");
  useLayoutEffect(() => {
    const outer = box.current;
    const inner = ruler.current;
    if (!outer || !inner) return;
    const fit = () => {
      const widths = Array.from(inner.children, (child) => child.getBoundingClientRect().width);
      const more = widths.pop() ?? 0;
      const room = outer.getBoundingClientRect().width;
      if (widths.reduce((sum, width) => sum + width, 0) <= room) return setShown(widths.length - 1);
      // The current one always stays (cut short if it must), so the way up never goes.
      let used = widths[0] + more + widths[widths.length - 1];
      let count = 1;
      for (let at = widths.length - 2; at > 0 && (used += widths[at]) <= room; at--) count++;
      setShown(count);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    observer.observe(inner);
    fit();
    return () => observer.disconnect();
  }, [names]);
  const count = Math.min(shown, Math.max(0, items.length - 1));
  const hidden = count > 0 ? items.slice(1, items.length - count) : [];
  const visible = count === 0 ? items.slice(-1) : [items[0], ...items.slice(-count)];
  const select = (id: string | null) => {
    if (id === null) go({ tab: route.tab });
    else if (id !== "trash") go({ tab: route.tab, directoryId: id });
  };
  const sep = <Icon name="CaretRight" size={12} className="plugins-crumb-sep" />;
  return (
    <span ref={box} className="library-crumbs">
      <span className="library-crumbs-row">
        {visible.map((item, index) => (
          <span key={item.id ?? "root"} className="library-crumb" data-last={index === visible.length - 1 || undefined}>
            {index > 0 && sep}
            {index === 1 && hidden.length > 0 && (
              <>
                <Popover open={menu} onClose={() => setMenu(false)} anchor={<Button variant="ghost" size="xs" icon={<Icon name="DotsHorizontal" size="sm" />} label="打开上级文件夹菜单" active={menu} onClick={() => setMenu(!menu)} />}>
                  {hidden.map((entry) => (
                    <MenuItem
                      key={entry.id ?? "root"}
                      label={entry.name}
                      onClick={() => {
                        setMenu(false);
                        select(entry.id);
                      }}
                    />
                  ))}
                </Popover>
                {sep}
              </>
            )}
            {item === items[items.length - 1] && item.id !== null ? (
              <span className="cloud-title-text" aria-current="page" title={item.name}>
                {item.name}
              </span>
            ) : (
              // A folder above (or the root) takes items dropped on it, as a folder's card does.
              <button
                type="button"
                className="plugins-crumb library-crumb-target"
                data-drop={item.id !== "trash" && drag.over === (item.id ?? "") ? "" : undefined}
                onClick={() => select(item.id)}
                {...(item.id === "trash"
                  ? {}
                  : {
                      onDragEnter: (event: DragEvent<HTMLElement>) => drag.hover(item, event),
                      onDragOver: (event: DragEvent<HTMLElement>) => drag.hover(item, event),
                      onDragLeave: (event: DragEvent<HTMLElement>) => drag.leave(item, event),
                      onDrop: (event: DragEvent<HTMLElement>) => drag.drop(item, event),
                    })}
              >
                {item.name}
              </button>
            )}
          </span>
        ))}
      </span>
      <span className="library-crumbs-ruler" aria-hidden="true">
        <span ref={ruler}>
          {items.map((item, index) => (
            <span key={item.id ?? "root"} className="library-crumb">
              {index > 0 && sep}
              <span>{item.name}</span>
            </span>
          ))}
          <span className="library-crumb">
            {sep}
            <Button variant="ghost" size="xs" tabIndex={-1} icon={<Icon name="DotsHorizontal" size="sm" />} />
          </span>
        </span>
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// The storage banner (qa / Ja / Ya)

function StorageBanner({ onManage }: { onManage(): void }) {
  const usage = useLibrary((s) => s.storage);
  const generation = useLibrary((s) => s.generation);
  const [dismissed, setDismissed] = useState(() => record(readJson(STORAGE_DISMISSED)));
  useEffect(() => void loadStorage(), [generation]);
  const level = storageLevel(usage);
  // Ja: room again (known, and not full) forgets 已满's dismissal, so filling up again shows it.
  useEffect(() => {
    if (!usage || level === "full" || dismissed.full === undefined) return;
    const rest = { ...dismissed };
    delete rest.full;
    writeJson(STORAGE_DISMISSED, rest);
    setDismissed(rest);
  }, [usage]); // eslint-disable-line react-hooks/exhaustive-deps
  const since = level ? dismissed[level] : undefined;
  // Dismissed for seven days, each level on its own.
  if (!usage || !level || (typeof since === "number" && Date.now() < since + WEEK)) return null;
  const upgrade = canUpgrade(usage);
  const lead = level === "full" ? "你的存储空间已满。" : "你的存储空间快满了。";
  const rest =
    level === "full" ? (upgrade ? "请释放空间或升级套餐以获得更多存储空间后，再添加新文件。" : "请释放空间，以便继续添加文件。") : upgrade ? "请管理你的存储空间，或升级套餐以获取更多空间。" : "请管理你的存储空间。";
  return (
    // Claude's Banner (shared-frame Ik): the icon, the words with their actions wrapping under
    // them, and the close button in a column of its own by the first line.
    <div className="library-notice library-storage" role="status">
      <Icon name="Warning" size="sm" className="library-notice-icon" />
      <div className="library-notice-body">
        <p className="library-notice-text">
          <strong>{lead}</strong>
          {rest}
        </p>
        <Button variant="secondary" size="sm" onClick={onManage}>
          管理
        </Button>
        {upgrade && (
          <a className="btn btn-secondary btn-sm" href={UPGRADE_URL} target="_blank" rel="noopener noreferrer">
            升级
          </a>
        )}
      </div>
      <Button
        className="library-notice-close"
        variant="ghost"
        size="sm"
        icon={<Icon name="X" size="sm" />}
        label="忽略存储空间警告"
        onClick={() => {
          const next = { ...dismissed, [level]: Date.now() };
          writeJson(STORAGE_DISMISSED, next);
          setDismissed(next);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results (Dt): their states, then the grid, the image wall or the list

interface ResultsProps {
  query: LibraryQuery;
  data: LibraryList | undefined;
  items: LibraryNode[] | undefined;
  view: ViewMode;
  kind: DateKind;
  /** The order the list's headers set; undefined where they do not sort. */
  sort?: LibrarySort | null;
  onSort(key: LibrarySort["key"]): void;
  openId?: string;
  /** Opening an item (none in the trash, where an item is only picked). */
  onOpen?(node: LibraryNode): void;
}

function Results({ query, data, items, view, kind, sort, onSort, openId, onOpen }: ResultsProps) {
  const favorites = query.tab === "favorites" && query.directoryId === null && !query.deleted;
  const square = query.tab === "folders" && !query.search;
  const path = useLibrary((s) => (query.directoryId ? s.paths[query.directoryId] : undefined));
  // A page can come back empty with more after it (every item on it a drive's): the next one is read on.
  const more = data?.cursor && !data.failed ? <Sentinel key={data.cursor} busy={data.loading} onVisible={() => void loadLibrary(query, "more")} /> : null;
  if (!data || !items || (!items.length && (data.loading || more)))
    return (
      <>
        <Loading view={view} square={square} />
        {more}
      </>
    );
  const failed = data.failed;
  const retry = () => void loadLibrary(query, failed?.cursor ? "more" : "refresh");
  if (!items.length && failed) {
    if (query.directoryId && (failed.status === 403 || failed.status === 404)) {
      const parent = path?.crumbs.at(-2)?.id;
      return (
        <Empty title="此文件夹不存在或你没有访问权限" alert>
          <Button variant="secondary" size="sm" onClick={() => go(parent ? { tab: query.tab, directoryId: parent } : { tab: query.tab })}>
            返回
          </Button>
        </Empty>
      );
    }
    return (
      <Empty title={favorites ? "未成功加载收藏" : "文件加载失败。"} alert>
        <Button variant="secondary" size="sm" onClick={retry}>
          重试
        </Button>
      </Empty>
    );
  }
  if (!items.length) return <EmptyResults query={query} />;

  const cell = (node: LibraryNode, shape?: "square" | "free") => <Card key={node.id} node={node} kind={kind} shape={shape} open={node.id === openId} onOpen={onOpen} />;
  const folders = items.filter((node) => node.kind === "directory");
  const files = items.filter((node) => node.kind === "file");
  let shown: ReactNode;
  if (view === "list") shown = <ListView items={items} kind={kind} sort={sort} onSort={onSort} openId={openId} onOpen={onOpen} />;
  else if (!query.search && !query.deleted && (query.tab === "all" || query.directoryId) && folders.length && files.length)
    // jt: 全部 and a folder split their folders from their items.
    shown = (
      <div className="library-sections">
        <section className="library-section">
          <h2 className="plugins-section-title">文件夹</h2>
          <div className="library-folders">{folders.map((node) => cell(node, "square"))}</div>
        </section>
        <section className="library-section">
          <h2 className="plugins-section-title">项目</h2>
          <div className="library-grid">{files.map((node) => cell(node))}</div>
        </section>
      </div>
    );
  else if (!files.length) shown = <div className="library-folders">{folders.map((node) => cell(node, "square"))}</div>;
  else if (imagesRoot(query)) shown = <Masonry items={items} render={(node) => cell(node, "free")} />;
  else shown = <div className="library-grid">{items.map((node) => cell(node))}</div>;

  return (
    <div className="library-results" onKeyDown={moveFocus}>
      {shown}
      {failed ? (
        <div className="library-status" role="alert">
          <span>{favorites ? "未成功加载收藏" : "文件加载失败。"}</span>
          <Button variant="secondary" size="sm" onClick={retry}>
            重试
          </Button>
        </div>
      ) : query.search && !data.loading && !data.cursor && data.incomplete ? (
        <div className="library-status" role="status">
          <span>部分搜索结果无法加载</span>
          <Button variant="secondary" size="sm" onClick={() => void loadLibrary(query, "refresh")}>
            重试
          </Button>
        </div>
      ) : (
        more
      )}
    </div>
  );
}

/** It / Lt: what an empty place says (cloud drives' and shared folders' own words stay out with them). */
function EmptyResults({ query }: { query: LibraryQuery }) {
  const filtered = !!query.search || query.categories.length > 0 || query.sources.length > 0;
  if (query.tab === "favorites" && query.directoryId === null && !query.deleted) return <Empty title={filtered ? "未找到收藏" : "暂无收藏"} />;
  if (filtered) return <Empty icon="Search" title="未找到文件" />;
  if (query.deleted) return <Empty title="回收站中没有文件" note="移至回收站的文件将在 30 天后被永久删除" />;
  // Lt's ft and Yn's buttons; 图像's 创建图像 opens a ChatGPT chat, so it stays out.
  if (query.directoryId)
    return (
      <Empty icon="Folder" title="暂无文件" note="上传文件，开始构建你的资料库">
        <UploadButton query={query} />
      </Empty>
    );
  if (query.tab === "images") return <Empty icon="Image" title="暂无图像" note="使用 ChatGPT 创建图像。" />;
  if (query.tab === "folders")
    return (
      <Empty icon="Folder" title="创建你的第一个文件夹" note="创建文件夹以整理资料库中的项目">
        <NewFolderButton query={query} />
      </Empty>
    );
  return (
    <Empty icon="Collection" title="创建新内容" note="你使用 ChatGPT 创建的内容（如图像和文档）将显示在这里">
      <LibraryNewMenu
        query={query}
        placement="bottom-start"
        anchor={(shown, toggle) => (
          <Button variant="primary" size="sm" active={shown} onClick={toggle}>
            开始创建
            <Icon name="CaretDown" size="sm" />
          </Button>
        )}
      />
    </Empty>
  );
}

/** Claude's empty state (cbef3b9e7 za): the bare glyph over the words, each at most max-w-xs. */
function Empty({ icon, title, note, alert, children }: { icon?: IconName; title: string; note?: string; alert?: boolean; children?: ReactNode }) {
  return (
    <div className="plugins-empty library-empty" role={alert ? "alert" : "status"}>
      {icon && <Icon name={icon} size={24} className="library-empty-icon" />}
      <p className="plugins-empty-title">{title}</p>
      {note && <p className="plugins-note">{note}</p>}
      {children}
    </div>
  );
}

/** Kc's placeholders: six cards (square ones on 文件夹), eight rows in a list. */
function Loading({ view, square = false, label = "正在加载资料库", count }: { view: ViewMode; square?: boolean; label?: string; count?: number }) {
  return (
    <div aria-busy="true">
      <span className="sr-only">{label}</span>
      {view === "list" ? (
        <div className="library-rows">
          {Array.from({ length: count ?? 8 }, (_, index) => (
            <div key={index} className="library-row library-row-skeleton">
              <span className="library-row-icon" />
              <Skeleton lines={1} />
            </div>
          ))}
        </div>
      ) : (
        <div className={square ? "library-folders" : "library-grid"}>
          {Array.from({ length: count ?? 6 }, (_, index) => (
            <div key={index} className="library-card library-card-skeleton" data-shape={square ? "square" : undefined}>
              <span className="library-card-cover" />
              <span className="library-card-text">
                <Skeleton lines={square ? 1 : 2} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Kc's load-more sentinel: the next page as it comes within 200px; a new one per cursor reports at once. */
function Sentinel({ busy, onVisible }: { busy: boolean; onVisible(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(onVisible);
  latest.current = onVisible;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => entries.at(-1)?.isIntersecting && latest.current(), { root: node.closest(".plugins-scroll, .library-picker-scroll"), rootMargin: "200px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="library-sentinel" data-testid="library-load-more-sentinel">
      {busy && <Spinner size={16} label="加载中" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Items

const glyphOf = (node: LibraryNode): IconName =>
  node.kind === "directory" ? "Folder" : node.category === "image" || node.mime?.startsWith("image/") ? "Image" : fileGlyph(node.name);

/** library-item-pin en: a width over a height, 1 without both, never under 1/2 (taller is cropped). */
const aspect = (width: number | null, height: number | null) => (width && height && width > 0 && height > 0 ? Math.max(0.5, width / height) : 1);

/**
 * The node's thumbnail through the bridge, as it scrolls near; its type's glyph without one.
 * `onAspect` hears the shape it came in (en of its natural size), or 1 when it failed.
 */
function Thumb({ node, size, onAspect }: { node: LibraryNode; size: number; onAspect?(ratio: number): void }) {
  const [failed, setFailed] = useState(false);
  if (!node.thumbnail || failed) return <Icon name={glyphOf(node)} size={size} />;
  return (
    <img
      className="library-thumb"
      src={libraryContentUrl(node, "thumbnail")}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={onAspect && ((event) => onAspect(aspect(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)))}
      onError={() => {
        setFailed(true);
        onAspect?.(1);
      }}
    />
  );
}

/** Ft's calendar label: the time today, 昨天, the weekday within this week, else the date (its year when another). */
function calendar(ms: number): string {
  const at = new Date(ms);
  const now = new Date();
  const days = (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(at.getFullYear(), at.getMonth(), at.getDate())) / 864e5;
  if (days === 0) return at.toLocaleTimeString("zh-CN", { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "昨天";
  if (days > 0 && days <= now.getDay()) return at.toLocaleDateString("zh-CN", { weekday: "long" });
  return at.toLocaleDateString("zh-CN", { month: "short", day: "numeric", ...(at.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

/** rUn's elapsed duration (the compact 3 小时 / 2 天 / 1 周, without wham's 前: the sentence has its own). */
function elapsed(ms: number): string {
  const minutes = Math.max(1, Math.floor((Date.now() - ms) / 6e4));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days} 天` : days < 30 ? `${Math.floor(days / 7)} 周` : days < 365 ? `${Math.floor(days / 30)} 个月` : `${Math.floor(days / 365)} 年`;
}

/**
 * Yt / Ft: the date `node` shows. Last activity says whether it was opened or changed: relative in
 * the list (relativeActivity: 3 天前修改), on the calendar on a card (calendarActivity: 已打开 ·
 * 昨天); every other kind is its calendar label alone.
 */
function activity(node: LibraryNode, kind: DateKind, relative: boolean): string {
  const ms = nodeDate(node, kind);
  if (ms === null) return "";
  if (kind !== "suggested") return calendar(ms);
  const opened = node.lastUsedAt !== null && (node.updatedAt === null || node.lastUsedAt > node.updatedAt);
  if (!relative) return `${opened ? "已打开" : "已修改"} · ${calendar(ms)}`;
  return Date.now() - ms < 6e4 ? (opened ? "刚刚打开" : "刚刚修改") : `${elapsed(ms)}前${opened ? "打开" : "修改"}`;
}

/**
 * A gallery card ($c's ro): the cover (thumbnail or glyph) over the name and when. A folder's is
 * square. ponytail: a folder draws the folder glyph, not the desktop app's collage of its first
 * three thumbnails: those are the node's own addresses (thumbnail_urls), which the bridge does
 * not resolve; only a file's id is asked for its thumbnail.
 */
function Card({ node, kind, shape, open, onOpen }: { node: LibraryNode; kind: DateKind; shape?: "square" | "free"; open: boolean; onOpen?(node: LibraryNode): void }) {
  // On the wall the cover takes the node's size until its thumbnail says its own (library-item-pin:
  // the library's items mostly come without one).
  const [loaded, setLoaded] = useState<number | null>(null);
  const free = shape === "free";
  return (
    <Item node={node} className="library-card" shape={shape} open={open} onOpen={onOpen}>
      <span className="library-card-cover" style={free ? { aspectRatio: String(loaded ?? aspect(node.width, node.height)) } : undefined}>
        <Thumb node={node} size={shape === "square" ? 40 : 32} onAspect={free ? setLoaded : undefined} />
      </span>
      <span className="library-card-text">
        <span className="library-card-title">
          <span className="library-card-name">{node.name}</span>
          <Updating node={node} />
        </span>
        {shape !== "square" && <span className="library-card-meta">{activity(node, kind, false)}</span>}
      </span>
    </Item>
  );
}

/** A folder a drop is moving items into (oe: 正在更新 {name}). */
function Updating({ node }: { node: LibraryNode }) {
  const busy = useLibrary((s) => !!s.busy[node.id]);
  if (!busy || node.kind !== "directory") return null;
  return (
    <span className="library-updating" role="status" aria-label={`正在更新 ${node.name}`}>
      <Spinner size={12} />
    </span>
  );
}

/**
 * One item, a card or a row (selectable-library-item Q): the whole of it is a button under the
 * rest, which opens it, or picks it while something is picked (and always in the trash): Shift
 * for a range, Ctrl / ⌘ for the one item. Its checkbox shows under the pointer or focus, and stays
 * on a picked card or, in a list, while anything is picked. Its ⋯ (and a right click) opens its
 * menu, unless an action is under way for it; while something is picked it has none (the toolbar
 * acts). Its own items drag onto folders (the selection when it is in it); a folder takes them.
 */
function Item({ node, className, shape, open, onOpen, children }: { node: LibraryNode; className: string; shape?: "square" | "free"; open: boolean; onOpen?(node: LibraryNode): void; children: ReactNode }) {
  const page = usePage();
  const busy = useLibrary((s) => !!s.busy[node.id]);
  const favorites = useLibrary((s) => !!s.available?.favorites);
  const [menu, setMenu] = useState(false);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const picked = page.selected.has(node.id);
  const deleted = page.query.deleted;
  const actions = itemActions(node, deleted);
  // While something is picked the toolbar acts, not an item's own menu (Q's actions: none then).
  const hasMenu = !page.selecting && (actions.restore || actions.deleteForever || actions.rename || actions.download || (actions.favorite && favorites) || actions.move || actions.delete);
  const target = node.kind === "directory" && node.own && page.drag.on ? { id: node.id, name: node.name } : null;
  const click = (event: MouseEvent) => {
    if (busy) return;
    const selectable = page.selectable;
    if (selectable && event.shiftKey) page.pick(node.id, true, true);
    else if (selectable && (deleted || page.selecting || event.ctrlKey || event.metaKey)) page.pick(node.id, !picked, false);
    else onOpen?.(node);
  };
  const body = (close: () => void) => <ItemMenu node={node} close={close} />;
  return (
    <div
      className={className}
      data-library-item=""
      data-library-selection-id={page.selectable ? node.id : undefined}
      data-shape={shape}
      data-open={open || undefined}
      data-selected={picked || undefined}
      data-selecting={page.selecting || undefined}
      data-drop={page.drag.over === node.id || undefined}
      data-menu-open={menu || at ? "" : undefined}
      aria-busy={busy || undefined}
      draggable={page.drag.on && !busy && node.own && (!page.selecting || picked) ? true : undefined}
      onDragStart={(event) => page.drag.start(node, event)}
      onDragEnd={page.drag.end}
      onDragEnter={target ? (event) => page.drag.hover(target, event) : undefined}
      onDragOver={target ? (event) => page.drag.hover(target, event) : undefined}
      onDragLeave={target ? (event) => page.drag.leave(target, event) : undefined}
      onDrop={target ? (event) => page.drag.drop(target, event) : undefined}
      onContextMenu={(event) => {
        // A right click inside its own open menu (a portal, so React brings it here) is the menu's.
        if (!hasMenu || busy || !event.currentTarget.contains(event.target as Node)) return;
        event.preventDefault();
        setMenu(false);
        setAt(menuPoint(event));
      }}
    >
      <button type="button" className="library-hit" data-library-cell="" title={node.name} aria-label={node.name} onClick={click} />
      {children}
      {page.selectable && (
        <span className="library-check">
          <Checkbox checked={picked} aria-label={`选择${node.name}`} onChange={(on, event) => page.pick(node.id, on, event.shiftKey)} />
        </span>
      )}
      {hasMenu && (
        <span className="library-menu">
          <Popover
            open={menu}
            onClose={() => setMenu(false)}
            placement="bottom-end"
            anchor={<Button variant="ghost" size="sm" icon={<Icon name="DotsHorizontal" size="sm" />} label={`打开 ${node.name} 的操作菜单`} tip="" disabled={busy} onClick={() => setMenu(!menu)} />}
          >
            {body(() => setMenu(false))}
          </Popover>
        </span>
      )}
      {at && (
        <PointerMenu at={at} onClose={() => setAt(null)}>
          {body(() => setAt(null))}
        </PointerMenu>
      )}
    </div>
  );
}

/**
 * La's items, in its order: 恢复 and 永久删除 (the trash); 重命名, 下载; 添加到收藏夹 or 从收藏夹中移除;
 * 移至文件夹 at the root, else 移动; 删除 (删除文件夹 for a folder, which goes for good with what it
 * holds). Sites, sharing and saved chats are not codex-ui's.
 */
function ItemMenu({ node, close }: { node: LibraryNode; close(): void }) {
  const page = usePage();
  const favorites = useLibrary((s) => !!s.available?.favorites);
  const root = useLibrary((s) => s.root);
  const actions = itemActions(node, page.query.deleted);
  const favorite = actions.favorite && favorites;
  // kt: whether an item with a parent is at the root takes the root's id.
  useEffect(() => {
    if (actions.move && node.parentId !== null) loadLibraryRoot().catch(() => {});
  }, [actions.move, node.parentId]);
  const act = (run: () => void) => () => {
    close();
    run();
  };
  const first = actions.rename || actions.download;
  const second = favorite || actions.move;
  return (
    <>
      {actions.restore && <MenuItem label="恢复" onClick={act(() => page.act({ type: "restore", nodes: [node], bulk: false }))} />}
      {actions.deleteForever && <MenuItem label="永久删除" danger onClick={act(() => page.act({ type: "deleteForever", nodes: [node], bulk: false }))} />}
      {actions.rename && <MenuItem label="重命名" onClick={act(() => page.act({ type: "rename", node }))} />}
      {actions.download && <MenuItem label="下载" onClick={act(() => downloadLibraryFiles([node]))} />}
      {first && second && <MenuSep />}
      {favorite && <FavoriteItem node={node} close={close} />}
      {actions.move && <MenuItem label={isRootLevel(node, root) ? "移至文件夹" : "移动"} onClick={act(() => page.move([node]))} />}
      {(first || second) && actions.delete && <MenuSep />}
      {actions.delete && <MenuItem label={node.kind === "directory" ? "删除文件夹" : "删除"} danger onClick={act(() => page.act({ type: "delete", nodes: [node], bulk: false }))} />}
    </>
  );
}

/** Ri: 添加到收藏夹 / 从收藏夹中移除 once the file's status is known (asked as the menu opens); dimmed while it is not. */
function FavoriteItem({ node, close }: { node: LibraryNode; close(): void }) {
  const status = useFavoriteStatus(node);
  const busy = useLibrary((s) => !!s.busy[node.id]);
  const on = !!status?.favoriteId;
  return (
    <MenuItem
      label={on ? "从收藏夹中移除" : "添加到收藏夹"}
      disabled={!status || status.unavailable || busy}
      onClick={() => {
        close();
        void setLibraryFavorite(node, !on);
      }}
    />
  );
}

/**
 * 图像's wall (library-masonry): each card to the shortest column, placed again as the column
 * count (the page's width) or a card's height changes.
 */
function Masonry({ items, render }: { items: LibraryNode[]; render(node: LibraryNode): ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const ids = items.map((node) => node.id).join("\n");
  useLayoutEffect(() => {
    const grid = box.current;
    if (!grid) return;
    const cells = Array.from(grid.children) as HTMLElement[];
    let frame = 0;
    const layout = () => {
      const style = getComputedStyle(grid);
      const columns = Number(style.getPropertyValue("--masonry-columns")) || 1;
      const gap = parseFloat(style.rowGap) || 0;
      const heights: number[] = Array(columns).fill(0);
      for (const cell of cells) {
        const column = heights.indexOf(Math.min(...heights));
        cell.style.gridColumn = String(column + 1);
        // `top` on a relative cell moves it as a translate would, without making it the containing
        // block of its context menu's fixed anchor.
        cell.style.top = `${heights[column]}px`;
        heights[column] += cell.offsetHeight + gap;
      }
      grid.style.height = `${Math.max(0, Math.max(...heights) - (cells.length ? gap : 0))}px`;
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    });
    observer.observe(grid);
    for (const cell of cells) observer.observe(cell);
    layout();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ids]);
  return (
    <div ref={box} className="library-masonry">
      {items.map((node) => (
        <div key={node.id} className="library-masonry-item">
          {render(node)}
        </div>
      ))}
    </div>
  );
}

/**
 * Rt's list in Claude's Ec rows: 名称, the date the place goes by, 大小 (before the date in the
 * trash, Ut's sizeBeforeDate); the headers sort where they may (qwo).
 */
function ListView({ items, kind, sort, onSort, openId, onOpen }: { items: LibraryNode[]; kind: DateKind; sort?: LibrarySort | null; onSort(key: LibrarySort["key"]): void; openId?: string; onOpen?(node: LibraryNode): void }) {
  const head = (key: LibrarySort["key"], label: string, className: string) => {
    if (sort === undefined)
      return (
        <span key={key} className={className}>
          {label}
        </span>
      );
    const on = sort?.key === key ? sort.direction : null;
    return (
      <button key={key} type="button" className={`library-head ${className}`} aria-sort={on === "asc" ? "ascending" : on === "desc" ? "descending" : undefined} onClick={() => onSort(key)}>
        {label}
        {on && <Icon name={on === "asc" ? "ArrowUp" : "ArrowDown"} size={12} />}
      </button>
    );
  };
  const sizeFirst = kind === "deleted";
  const columns = (date: ReactNode, size: ReactNode) => (sizeFirst ? [size, date] : [date, size]);
  // Ye / va: 全选 over what is listed, mixed while part of it is picked (a press then clears it).
  const page = usePage();
  const count = items.filter((node) => page.selected.has(node.id)).length;
  const all = count === 0 ? false : count === items.length || "mixed";
  return (
    <div className="library-list" aria-label="资料库文件" data-selecting={page.selecting || undefined}>
      <div className="library-list-head">
        {page.selectable && (
          <span className="library-check">
            <Checkbox checked={all} aria-label={all === "mixed" ? "清除选择" : "全选"} onChange={(on) => page.pickAll(items.map((node) => node.id), all !== "mixed" && on)} />
          </span>
        )}
        {head("name", "名称", "library-col-name")}
        {columns(head("date", DATE_HEADINGS[kind], "library-col-date"), head("size", "大小", "library-col-size"))}
      </div>
      <ul className="library-rows">
        {items.map((node) => (
          <li key={node.id}>
            <Item node={node} className="library-row" open={node.id === openId} onOpen={onOpen}>
              <span className="library-row-icon">
                <Thumb node={node} size={20} />
              </span>
              <span className="library-col-name library-row-name">
                <span className="library-row-title">{node.name}</span>
                <Updating node={node} />
              </span>
              {columns(
                <span key="date" className="library-col-date">{activity(node, kind, true) || "—"}</span>,
                <span key="size" className="library-col-size">{node.kind === "directory" || node.size === null ? "—" : fileSize(node.size)}</span>,
              )}
            </Item>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Arrow keys move between cells by where they sit, so the grid, the image wall and the list alike. */
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  const step = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[event.key];
  const from = (event.target as HTMLElement).closest<HTMLElement>("[data-library-cell]");
  if (!step || !from) return;
  const a = from.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let score = Infinity;
  for (const cell of event.currentTarget.querySelectorAll<HTMLElement>("[data-library-cell]")) {
    const b = cell.getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const along = dx * step[0] + dy * step[1];
    if (cell === from || along < 1) continue;
    const off = along + 2 * Math.abs(step[0] ? dy : dx);
    if (off < score) [best, score] = [cell, off];
  }
  if (!best) return;
  event.preventDefault();
  best.focus();
  best.scrollIntoView({ block: "nearest" });
}

// ---------------------------------------------------------------------------
// 从资料库添加: the composer's picker (library-file-picker-dialog-content pn)

/** Hn: when a file came in (its upload time, month day hour minute), — without one (library.filePicker.missingUploadDate). */
const uploadedAt = (node: LibraryNode) =>
  node.createdAt === null ? "—" : new Date(node.createdAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

interface PickerList {
  search: string;
  items: LibraryNode[];
  /** The next page's, or (failed) the one that did not come. */
  cursor: string | null;
  loading: boolean;
  failed: boolean;
}

/**
 * 从资料库添加 as a local chat's composer opens it (pn without onAttachItems or providers: ready
 * native files only, no folders or attachment quota; those `attached` already left out, as pn's
 * attachedLibraryFileIds): the search, 300 ms after typing stops (cleared, the recent files at
 * once); the list (first, as pn's) or the grid; 25 files a page as it scrolls; what is picked stays
 * picked across searches, and 添加到聊天 hands it over. In Claude's dialog with the page's own
 * cards and rows.
 */
export function LibraryPicker({ attached, onAdd, onClose }: { attached: ReadonlySet<string>; onAdd(nodes: LibraryNode[]): void; onClose(): void }) {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("list");
  const [shown, setShown] = useState<PickerList | null>(null);
  const [picked, setPicked] = useState<ReadonlyMap<string, LibraryNode>>(() => new Map());
  const latest = useRef(0);
  useEffect(() => {
    const query = input.trim();
    if (!query) return setSearch("");
    const timer = setTimeout(() => setSearch(query), 300);
    return () => clearTimeout(timer);
  }, [input]);
  // One page at a time, the last asked for winning.
  const load = (query: string, cursor: string | null, items: LibraryNode[]) => {
    const ask = ++latest.current;
    setShown({ search: query, items, cursor, loading: true, failed: false });
    fetchPickerPage(query, cursor).then(
      (page) => ask === latest.current && setShown({ search: query, items: [...items, ...page.items.filter((node) => !items.some((held) => held.id === node.id))], cursor: page.cursor, loading: false, failed: false }),
      () => ask === latest.current && setShown({ search: query, items, cursor, loading: false, failed: true }),
    );
  };
  useEffect(() => load(search, null, []), [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (node: LibraryNode) =>
    setPicked((current) => {
      const next = new Map(current);
      if (!next.delete(node.id)) next.set(node.id, node);
      return next;
    });
  const list = shown?.search === search && input.trim() === search ? shown : null;
  const items = list ? list.items.filter((node) => !attached.has(node.id)) : [];
  const next = () => list && !list.loading && load(search, list.cursor, list.items);
  // A page can come back empty with more after it (every file on it one a chat cannot take).
  const more = list?.cursor && !list.failed ? <Sentinel key={list.cursor} busy={list.loading} onVisible={next} /> : null;
  let body: ReactNode;
  if (!list || (!items.length && (list.loading || more)))
    body = (
      <>
        {/* pn's In: 6 cards or rows for the recent files, 3 for a search. */}
        <Loading view={view} label="正在加载最近的文件…" count={search ? 3 : 6} />
        {more}
      </>
    );
  else if (!items.length && list.failed)
    body = (
      <Empty title="无法加载资料库文件" note="请稍后重试" alert>
        <Button variant="secondary" size="sm" onClick={() => load(search, list.cursor, [])}>
          重试
        </Button>
      </Empty>
    );
  else if (!items.length) body = <Empty title={search ? "没有匹配的文件" : "暂无最近的文件"} />;
  else {
    const cell = (node: LibraryNode) => {
      const on = picked.has(node.id);
      const parts = (
        <>
          <button type="button" className="library-hit" data-library-cell="" title={node.name} aria-label={node.name} aria-pressed={on} onClick={() => toggle(node)} />
          <span className="library-check">
            <Checkbox checked={on} aria-label={`选择 ${node.name}`} onChange={() => toggle(node)} />
          </span>
        </>
      );
      return view === "grid" ? (
        <div key={node.id} className="library-card" data-selected={on || undefined}>
          {parts}
          <span className="library-card-cover">
            <Thumb node={node} size={32} />
          </span>
          <span className="library-card-text">
            <span className="library-card-title">{node.name}</span>
            <span className="library-card-meta">{uploadedAt(node)}</span>
          </span>
        </div>
      ) : (
        <li key={node.id}>
          <div className="library-row" data-selected={on || undefined}>
            {parts}
            <span className="library-row-icon">
              <Thumb node={node} size={20} />
            </span>
            <span className="library-col-name library-row-name">
              <span className="library-row-title">{node.name}</span>
            </span>
            <span className="library-col-date">{uploadedAt(node)}</span>
            <span className="library-col-size">{node.size === null ? "—" : fileSize(node.size)}</span>
          </div>
        </li>
      );
    };
    body = (
      <div className="library-results" onKeyDown={moveFocus}>
        {view === "grid" ? (
          <div className="library-grid">{items.map(cell)}</div>
        ) : (
          <div className="library-list">
            <ul className="library-rows">{items.map(cell)}</ul>
          </div>
        )}
        {list.failed ? (
          <div className="library-status" role="alert">
            <span>部分结果可能已过期</span>
            <Button variant="secondary" size="sm" onClick={() => load(search, list.cursor, list.items)}>
              重试
            </Button>
          </div>
        ) : (
          more
        )}
      </div>
    );
  }
  const count = picked.size;
  return (
    <Dialog
      title="从资料库添加"
      size="lg"
      onClose={onClose}
      footer={
        count > 0 && (
          <>
            <span className="library-picker-count" aria-live="polite">
              已选择 {count} 个
            </span>
            <Button variant="ghost" onClick={() => setPicked(new Map())}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                onAdd([...picked.values()]);
                onClose();
              }}
            >
              添加到聊天
            </Button>
          </>
        )
      }
    >
      <div className="library-picker">
        <div className="library-picker-bar">
          <SearchField value={input} placeholder="搜索资料库" onChange={setInput} />
          <Button variant="ghost" icon={<Icon name={view === "grid" ? "ListBullet" : "Grid"} />} label={view === "grid" ? "列表视图" : "网格视图"} onClick={() => setView(view === "grid" ? "list" : "grid")} />
        </div>
        <div className="library-picker-scroll scroll-fade-y" aria-busy={!list || list.loading}>
          {body}
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// The upload panel (library-uploads re / se)

const UPLOAD_STATUS: Record<Exclude<LibraryUpload["status"], "failed">, string> = { queued: "已加入队列", uploading: "正在上传…", processing: "处理中…", uploaded: "已上传" };

/**
 * re: the uploads at the window's bottom right (w-96), mounted by App beside the toasts so they
 * stay up once the page is left. The title says how the batch stands (正在上传 # 个文件 while any
 * is under way; the three end states are not in the zh-CN catalogue, so worded here). It folds to
 * its head, and closes (clearing the finished rows) once nothing runs. A failed row offers 重试
 * where that may pass and 移除; one still queued or sending can be cancelled. It rises over a
 * session's composer, the selection toolbar and a file panel's 询问此文件 as the toasts do (re
 * itself stays put in its corner), the toasts over it.
 */
export function LibraryUploads() {
  const { uploads } = useLibraryUploads();
  const [folded, setFolded] = useState(false);
  const titleId = useId();
  const listId = useId();
  const panel = useRef<HTMLElement>(null);
  // The view says which docks there are (a composer, the toolbar): measured again as it changes.
  const view = useStore((s) => [s.activeId, !!(s.activeId && s.threads[s.activeId]), s.splitId, s.cloudTaskId, s.dotsOpen, !!s.customizeRoute, !!s.libraryRoute].join());
  const docks = useLibrary((s) => s.docks);
  const clearance = useDockClearance(panel, ".dock, .library-selection, .library-ask", uploads.length ? `${view}:${docks}` : "");
  if (!uploads.length) return null;
  const done = uploads.filter((item) => item.status === "uploaded").length;
  const active = uploads.filter((item) => item.status === "queued" || item.status === "uploading" || item.status === "processing").length;
  const title = active ? `正在上传 ${active} 个文件` : done === uploads.length ? `已上传 ${done} 个文件` : done ? `已上传 ${done}/${uploads.length} 个文件` : "上传失败";
  return (
    <section ref={panel} className="library-uploads" aria-labelledby={titleId} data-density="compact" style={{ "--upload-clearance": `${clearance}px` } as CSSProperties}>
      <div className="library-uploads-card">
        <div className="library-uploads-head">
          <h2 id={titleId} className="library-uploads-title">
            {title}
          </h2>
          <span className="library-uploads-progress" role="img" aria-label={`已上传 ${done}/${uploads.length} 个文件`}>
            {done}/{uploads.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={<Icon name="CaretDown" size="sm" style={folded ? { rotate: "180deg" } : undefined} />}
            label={folded ? "展开上传进度" : "折叠上传进度"}
            aria-expanded={!folded}
            aria-controls={listId}
            onClick={() => setFolded(!folded)}
          />
          {!active && <Button variant="ghost" size="sm" icon={<Icon name="X" size="sm" />} label="关闭上传进度" onClick={() => removeLibraryUpload()} />}
        </div>
        <div id={listId} className="library-uploads-list" role="list" hidden={folded}>
          {uploads.map((item) => (
            <UploadRow key={item.id} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}

function UploadRow({ item }: { item: LibraryUpload }) {
  const failed = item.status === "failed";
  const glyph = failed ? <Icon name="WarningCircle" size="sm" />
    : item.status === "uploaded" ? <Icon name="CheckCircle" size="sm" />
      : item.status === "queued" ? <Icon name="Placeholder" size="sm" />
        : <Spinner size={14} />;
  return (
    <div className="library-upload" role="listitem" data-status={item.status}>
      <span className="library-upload-icon">{glyph}</span>
      <span className="library-upload-text">
        <span className="library-upload-name" title={item.name}>
          {item.name}
        </span>
        <span className="library-upload-status">{item.status === "failed" ? (item.error ?? "无法上传") : UPLOAD_STATUS[item.status]}</span>
      </span>
      {failed && item.retryable && <Button variant="ghost" size="sm" icon={<Icon name="ArrowClockwise" size="sm" />} label={`重试上传 ${item.name}`} onClick={() => void retryLibraryUpload(item.id)} />}
      {failed && <Button variant="ghost" size="sm" icon={<Icon name="X" size="sm" />} label={`移除未成功上传的 ${item.name}`} onClick={() => removeLibraryUpload(item.id)} />}
      {(item.status === "queued" || item.status === "uploading") && (
        <Button variant="ghost" size="sm" icon={<Icon name="X" size="sm" />} label={`取消上传 ${item.name}`} onClick={() => cancelLibraryUpload(item.id)} />
      )}
    </div>
  );
}
