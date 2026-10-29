// The 资料库 page: the ChatGPT app's /library (library-page lo: the title or breadcrumb and the
// toolbar over the storage banner, the tabs and the results; library-trash-banner Dt / jt / Rt
// for the results and their states) in Claude's parts: Plugins' page shell, the Artifacts
// gallery's grid and list rows (c230724a2 Kc, $c, Ec). This is browsing; acting on items, uploads
// and the file's panel come on top of it.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { newChat } from "../lib/codex";
import { fileSize } from "../lib/files";
import {
  canUpgrade,
  dateKind,
  filtersShown,
  gridOnly,
  imagesRoot,
  libraryContentUrl,
  loadLibrary,
  loadPath,
  loadStorage,
  loadTrashEmpty,
  nextSort,
  nodeDate,
  setLibraryPrefs,
  sortable,
  sortNodes,
  storageLevel,
  typesShown,
  useLibrary,
  useLibraryList,
  type DateKind,
  type LibraryAvailability,
  type LibraryCategory,
  type LibraryList,
  type LibraryNode,
  type LibraryQuery,
  type LibrarySort,
  type LibrarySource,
  type LibraryView as ViewMode,
} from "../lib/library";
import { readJson, record, setState, useStore, writeJson, type LibraryRoute, type LibraryTab } from "../lib/store";
import { quietMenu, useLiftSlot } from "./Main";
import { SearchField } from "./SettingsConnectors";
import { Button, fileGlyph, Icon, MenuItem, MenuSection, MenuSep, Popover, Segmented, Skeleton, Spinner, type IconName } from "./ui";

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
  const open = (node: LibraryNode) => (node.kind === "directory" ? go({ tab: route.tab, directoryId: node.id }) : go({ ...route, fileId: node.id }));
  const searchLabel = deleted ? "在回收站中搜索" : directoryId ? "在当前文件夹中搜索" : "搜索资料库";
  const setTypes = (categories: LibraryCategory[]) => setFilters({ ...filters, categories });
  const setSources = (sources: LibrarySource[]) => setFilters({ ...filters, sources });

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

  return (
    <div className="main-col" data-testid="library-page" onContextMenu={quietMenu}>
      {slot ? createPortal(bar, slot) : bar}
      <div className="plugins-scroll">
        <div className="plugins-page library-page">
          {gates.storageBanner && <StorageBanner onManage={() => go({ tab: "all", storageCleanup: true })} />}
          {deleted && trashEmpty === false && <p className="library-notice">恢复最近删除的文件。这些文件将在 30 天后永久删除。</p>}
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
          {body}
        </div>
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
              <button type="button" className="plugins-crumb" onClick={() => select(item.id)}>
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
  // ponytail: Lt's 上传文件 button comes with uploads.
  if (query.directoryId) return <Empty icon="Folder" title="暂无文件" note="上传文件，开始构建你的资料库" />;
  if (query.tab === "images") return <Empty icon="Image" title="暂无图像" note="使用 ChatGPT 创建图像。" />;
  if (query.tab === "folders") return <Empty icon="Folder" title="创建你的第一个文件夹" note="创建文件夹以整理资料库中的项目" />;
  return <Empty icon="Collection" title="创建新内容" note="你使用 ChatGPT 创建的内容（如图像和文档）将显示在这里" />;
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
function Loading({ view, square = false }: { view: ViewMode; square?: boolean }) {
  return (
    <div aria-busy="true">
      <span className="sr-only">正在加载资料库</span>
      {view === "list" ? (
        <div className="library-rows">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="library-row library-row-skeleton">
              <span className="library-row-icon" />
              <Skeleton lines={1} />
            </div>
          ))}
        </div>
      ) : (
        <div className={square ? "library-folders" : "library-grid"}>
          {Array.from({ length: 6 }, (_, index) => (
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
    const observer = new IntersectionObserver((entries) => entries.at(-1)?.isIntersecting && latest.current(), { root: node.closest(".plugins-scroll"), rootMargin: "200px" });
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
    <button type="button" className="library-card" data-library-cell="" data-shape={shape} data-open={open || undefined} title={node.name} onClick={onOpen && (() => onOpen(node))}>
      <span className="library-card-cover" style={free ? { aspectRatio: String(loaded ?? aspect(node.width, node.height)) } : undefined}>
        <Thumb node={node} size={shape === "square" ? 40 : 32} onAspect={free ? setLoaded : undefined} />
      </span>
      <span className="library-card-text">
        <span className="library-card-title">{node.name}</span>
        {shape !== "square" && <span className="library-card-meta">{activity(node, kind, false)}</span>}
      </span>
    </button>
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
        cell.style.transform = `translateY(${heights[column]}px)`;
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
  return (
    <div className="library-list" aria-label="资料库文件">
      <div className="library-list-head">
        {head("name", "名称", "library-col-name")}
        {columns(head("date", DATE_HEADINGS[kind], "library-col-date"), head("size", "大小", "library-col-size"))}
      </div>
      <ul className="library-rows">
        {items.map((node) => (
          <li key={node.id}>
            <button type="button" className="library-row" data-library-cell="" data-open={node.id === openId || undefined} onClick={onOpen && (() => onOpen(node))}>
              <span className="library-row-icon">
                <Thumb node={node} size={20} />
              </span>
              <span className="library-col-name library-row-name">{node.name}</span>
              {columns(
                <span key="date" className="library-col-date">{activity(node, kind, true) || "—"}</span>,
                <span key="size" className="library-col-size">{node.kind === "directory" || node.size === null ? "—" : fileSize(node.size)}</span>,
              )}
            </button>
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
