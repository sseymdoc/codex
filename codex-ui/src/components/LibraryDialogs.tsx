// The 资料库's dialogs and its 新建 menu, in codex-ui's Dialog and Popover: the ChatGPT app's
// library-item-dialogs (RenameLibraryItemDialog ze, ConfirmLibraryItemsDialog q with its shared
// body Qe), library-move-dialog (je), library-create-dialog (A), library-empty-trash (J) and
// slate-create-menu (Kn, Xn) without what opens a ChatGPT chat. The words are the zh-CN catalogue's,
// its ICU selects spelled out. The sidebar's + uses the same menu (Claude's Library row cZ).

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import {
  createLibraryFolder,
  deleteLibraryItems,
  deletesInBatch,
  emptyLibraryTrash,
  extensionOf,
  fetchMoveFolders,
  folderNameError,
  isRootLevel,
  libraryPrefs,
  loadLibraryRoot,
  moveLibraryItems,
  renameError,
  renameLibraryItem,
  restoreLibraryItems,
  uploadAllowed,
  uploadToLibrary,
  useLibrary,
  type Crumb,
  type LibraryNode,
  type LibraryQuery,
} from "../lib/library";
import { newNote } from "../lib/library-preview";
import { getState, setState, toast } from "../lib/store";
import { Button, Dialog, Icon, MenuItem, MenuSection, MenuSep, Popover, Spinner } from "./ui";

// ---------------------------------------------------------------------------
// Names (library-name-validation t; item-dialogs ze)

/** A name field with its label over it (the dialogs' label.flex-col.gap-2) and its problem under it. */
function NameField({ label, value, suffix, error, onChange }: { label: string; value: string; suffix?: string; error: string | null; onChange(value: string): void }) {
  const errorId = useId();
  return (
    <>
      <label className="library-field">
        <span className="library-field-label">{label}</span>
        <span className="library-name">
          <input
            className="input"
            data-autofocus=""
            autoComplete="off"
            value={value}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? errorId : undefined}
            // The suffix sits inside the field's end (trailingInlineControl): the text stops short of it.
            style={suffix ? { paddingInlineEnd: `calc(${suffix.length}ch + 20px)` } : undefined}
            onChange={(event) => onChange(event.target.value)}
          />
          {suffix && (
            <span className="library-name-suffix" aria-hidden="true">
              {suffix}
            </span>
          )}
        </span>
      </label>
      {error && (
        <p id={errorId} className="library-field-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * 重命名文件 / 重命名文件夹 (ze): a file keeps its extension (QI's, from the last dot) as a grey
 * suffix the field does not edit, and refuses one typed into the name; a folder's name may not
 * start with ".". A file of the account's own closes at once (its new name shows while the rename
 * runs, BTo); a folder waits, and stays open when the server refuses (409, in its words).
 */
export function RenameDialog({ node, onClose }: { node: LibraryNode; onClose(): void }) {
  const busy = useLibrary((s) => !!s.busy[node.id]);
  const suffix = node.kind === "file" && extensionOf(node.name) ? node.name.slice(node.name.lastIndexOf(".")) : "";
  const [stem, setStem] = useState(() => node.name.slice(0, node.name.length - suffix.length));
  const [pending, setPending] = useState(false);
  const name = `${stem.trim()}${suffix}`;
  const error = stem.trim() ? renameError(node, name) : null;
  const waiting = pending || busy;
  const disabled = !stem.trim() || name === node.name || !!error || waiting;
  const formId = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    const run = renameLibraryItem(node, name);
    if (node.kind === "file" && node.own) return onClose();
    setPending(true);
    void run.then((ok) => (ok ? onClose() : setPending(false)));
  };
  return (
    <Dialog
      title={node.kind === "directory" ? "重命名文件夹" : "重命名文件"}
      size="sm"
      closeButton={false}
      onClose={() => !waiting && onClose()}
      footer={
        <>
          <Button variant="secondary" disabled={waiting} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={disabled}>
            {pending ? "正在重命名…" : "重命名"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit}>
        <NameField label={node.kind === "directory" ? "文件夹名称" : "文件名"} value={stem} suffix={suffix} error={error} onChange={setStem} />
      </form>
    </Dialog>
  );
}

/**
 * 新建文件夹 (create-dialog A): a name not starting with "."; a refusal toasts (409 in the server's
 * words) and keeps what was typed. `onCreated` hears the folder.
 */
export function NewFolderDialog({ parentId, onCreated, onClose }: { parentId: string | null; onCreated?(folder: LibraryNode): void; onClose(): void }) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const error = folderNameError(name);
  const disabled = !name.trim() || !!error || pending;
  const formId = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    setPending(true);
    void createLibraryFolder(name, parentId).then((folder) => {
      if (!folder) return setPending(false);
      onClose();
      onCreated?.(folder);
    });
  };
  return (
    <Dialog
      title="新建文件夹"
      size="sm"
      closeButton={false}
      onClose={() => !pending && onClose()}
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={disabled}>
            {pending ? "正在创建…" : "创建"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit}>
        <NameField label="文件夹名称" value={name} error={error} onChange={setName} />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Confirmations (item-dialogs q / Qe, Ne; empty-trash J)

/**
 * Qe: the title, what happens (under it as a confirmation's description, as codex-ui's other
 * confirmations put it), 取消 and the action (primary to restore, danger otherwise); no ✕, nothing
 * closes it while it runs.
 */
function ConfirmShell({ title, children, confirm, restore = false, pending, disabled = false, onConfirm, onClose }: {
  title: string;
  children: ReactNode;
  confirm: string;
  restore?: boolean;
  pending: boolean;
  disabled?: boolean;
  onConfirm(): void;
  onClose(): void;
}) {
  return (
    <Dialog
      alert
      size="sm"
      title={title}
      description={<span className="library-confirm">{children}</span>}
      onClose={() => !pending && onClose()}
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            取消
          </Button>
          <Button variant={restore ? "primary" : "danger"} data-autofocus="" disabled={disabled || pending} onClick={onConfirm}>
            {pending && <Spinner size={12} inherit />}
            {confirm}
          </Button>
        </>
      }
    />
  );
}

export type ConfirmAction = "delete" | "deleteForever" | "restore";

/**
 * Ne, a selection's sentence: files to the trash, folders for good, or the mixed one
 * (mixedSelectionWithSitesDescription with no sites, pages or favorites here) that also says what
 * stays because it is not the account's own.
 */
function selectionText(files: number, folders: number, retained: boolean): string {
  if (!folders && !retained) return "所选文件将移至回收站，并在 30 天后永久删除";
  if (!files && !retained) return `${folders} 个文件夹及其中的所有文件和子文件夹将被永久删除`;
  return [
    files ? `${files} 个文件将被移至回收站，并在 30 天后永久删除。` : "",
    folders ? `${folders} 个文件夹及其所有文件和子文件夹将被永久删除。` : "",
    retained ? "你无权删除的项目将保留在你的资料库中。" : "",
  ].filter(Boolean).join(" ");
}

/**
 * 删除 / 永久删除 / 恢复 (ConfirmLibraryItemsDialog q). Only the account's own items go; the rest
 * stay and the sentence says so. When every item is a file going to the trash through
 * delete-batch (PCs, deletesInBatch) the dialog closes at once, the files out of the lists while it runs;
 * otherwise it waits, and keeps just what failed. `onDone` hears the ids that went.
 */
export function ConfirmItemsDialog({ nodes, action, bulk = false, onDone, onClose }: { nodes: LibraryNode[]; action: ConfirmAction; bulk?: boolean; onDone(ids: string[]): void; onClose(): void }) {
  const [entries, setEntries] = useState(nodes);
  const [pending, setPending] = useState(false);
  const restore = action === "restore";
  const forever = action === "deleteForever";
  const own = entries.filter((node) => node.own);
  const files = own.filter((node) => node.kind === "file").length;
  const folders = own.length - files;
  const singleFolder = !bulk && folders > 0 && entries.length === 1;
  const name = entries[0]?.name ?? "";
  const title = restore ? (entries.length === 1 ? "恢复项目" : "恢复所选项目")
    : forever ? "永久删除"
      : folders ? (entries.length === 1 ? "删除文件夹" : "删除所选项目")
        : bulk ? `删除 ${files} 个文件？` : "删除文件？";
  // Inside the dialog's description paragraph: a second paragraph is a block line of its own.
  const body = restore ? (entries.length === 1 ? `“${name}”将被恢复到你的资料库` : `所选的 ${entries.length} 个文件将恢复到你的资料库`)
    : forever ? (entries.length === 1 ? `“${name}”将被永久删除。此操作无法撤消。` : `所选的 ${entries.length} 个项目将被永久删除。此操作无法撤销。`)
      : singleFolder ? (
        <>
          <span className="library-confirm-line">“{name}”及其所有文件和子文件夹将被永久删除。</span>
          <span className="library-confirm-line">此操作无法撤销。</span>
        </>
      ) : bulk || entries.length > 1 ? selectionText(files, folders, own.length < entries.length)
        : <>“<strong>{name}</strong>”将移至回收站，并在 30 天后永久删除。</>;
  const submit = () => {
    if (pending || !own.length) return;
    setPending(true);
    const optimistic = action === "delete" && own.every(deletesInBatch);
    const run = restore ? restoreLibraryItems(own) : deleteLibraryItems(own, { permanently: forever });
    if (optimistic) {
      onDone(own.map((node) => node.id));
      onClose();
    }
    void run.then((done) => {
      onDone(done);
      if (optimistic) return;
      const rest = entries.filter((node) => !done.includes(node.id));
      if (!rest.some((node) => node.own)) return onClose();
      setEntries(rest);
      setPending(false);
    });
  };
  return (
    <ConfirmShell
      title={title}
      confirm={restore ? "恢复" : forever ? "永久删除" : singleFolder ? "删除文件夹" : "删除"}
      restore={restore}
      pending={pending}
      disabled={!own.length}
      onConfirm={submit}
      onClose={onClose}
    >
      {body}
    </ConfirmShell>
  );
}

/** 清空文件回收站 (empty-trash J): kept open when the trash did not empty (未成功清空回收站 / 部分项目无法删除). */
export function EmptyTrashDialog({ onClose }: { onClose(): void }) {
  const [pending, setPending] = useState(false);
  return (
    <ConfirmShell
      title="要永久删除吗？"
      confirm="永久删除"
      pending={pending}
      onConfirm={() => {
        setPending(true);
        void emptyLibraryTrash().then((emptied) => (emptied ? onClose() : setPending(false)));
      }}
      onClose={onClose}
    >
      回收站中的文件将被永久删除。此操作无法撤销。
    </ConfirmShell>
  );
}

// ---------------------------------------------------------------------------
// Moving (library-move-dialog je)

type Level = { at: string | null; folders?: LibraryNode[]; failed?: boolean };

/**
 * 移动到… (je): the account's folders a level at a time from `path` (the place the items are
 * in; root left out), 资料库 / … as the way back. 移至此处 moves the items not already there;
 * never into a moved folder or under it, and at the root only once the root's id says which
 * items are there already (无法识别资料库根目录 otherwise). 新建文件夹 goes into the folder it
 * makes. A move that fails in part keeps just those items. `onMoved` hears the ids now there.
 */
export function MoveDialog({ nodes, path: start, onMoved, onClose }: { nodes: LibraryNode[]; path: Crumb[]; onMoved(ids: string[]): void; onClose(): void }) {
  const root = useLibrary((s) => s.root);
  const [path, setPath] = useState(start);
  const [entries, setEntries] = useState(nodes);
  const [pending, setPending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [level, setLevel] = useState<Level>({ at: null });
  const [retry, setRetry] = useState(0);
  const [rootFailed, setRootFailed] = useState(false);
  const here = path.at(-1)?.id ?? null;
  // FEo: at the root, an item there may name the root's id as its parent.
  const needsRoot = here === null && root === undefined && entries.some((node) => node.parentId !== null);
  useEffect(() => {
    if (needsRoot) loadLibraryRoot().then(() => setRootFailed(false), () => setRootFailed(true));
  }, [needsRoot, retry]);
  useEffect(() => {
    let live = true;
    setLevel({ at: here });
    fetchMoveFolders(here).then(
      (folders) => live && setLevel({ at: here, folders }),
      () => live && setLevel({ at: here, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [here, retry]);
  const moved = new Set(entries.filter((node) => node.kind === "directory").map((node) => node.id));
  const inside = path.some((crumb) => moved.has(crumb.id));
  const moving = entries.filter((node) => (isRootLevel(node, root) ? null : node.parentId) !== here);
  const canMove = entries.every((node) => node.own) && moving.length > 0 && !inside && !needsRoot;
  const loading = level.at !== here || (!level.folders && !level.failed);
  const submit = () => {
    if (pending || !canMove) return;
    setPending(true);
    void moveLibraryItems(moving, here).then((done) => {
      onMoved([...done, ...entries.filter((node) => !moving.includes(node)).map((node) => node.id)]);
      const failed = moving.filter((node) => !done.includes(node.id));
      setPending(false);
      if (failed.length) return setEntries(failed);
      if (done.length) toast("neutral", path.length ? `已移至“${path.at(-1)!.name}”` : "已移动至资料库");
      onClose();
    });
  };
  const crumbs: { id: string | null; name: string }[] = [{ id: null, name: "资料库" }, ...path];
  return (
    <>
      <Dialog
        title="移动到…"
        closeButton={false}
        focusPanel
        onClose={() => !pending && onClose()}
        footer={
          <>
            <Button variant="secondary" className="dialog-foot-start" disabled={pending || creating || inside} onClick={() => setCreating(true)}>
              新建文件夹
            </Button>
            <Button variant="secondary" disabled={pending} onClick={onClose}>
              取消
            </Button>
            <Button variant="primary" disabled={!canMove || pending} onClick={submit}>
              {pending && <Spinner size={12} inherit />}
              移至此处
            </Button>
          </>
        }
      >
        <nav className="library-move-crumbs" aria-label="移动目标位置">
          <ol>
            {crumbs.map((crumb, index) => (
              <li key={crumb.id ?? "root"}>
                {index > 0 && <span className="library-move-sep">/</span>}
                {index === path.length ? (
                  <span aria-current="page" title={crumb.name}>
                    {crumb.name}
                  </span>
                ) : (
                  <Button variant="ghost" size="sm" disabled={pending || creating} onClick={() => setPath(path.slice(0, index))}>
                    {crumb.name}
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <div className="library-move-list" role="list">
          {loading ? (
            <div className="library-move-status">
              <Spinner size={16} />
              正在加载文件夹…
            </div>
          ) : (
            level.folders?.map((folder) => (
              <div key={folder.id} role="listitem">
                <button type="button" className="library-move-row" disabled={pending || creating || moved.has(folder.id)} onClick={() => setPath([...path, { id: folder.id, name: folder.name }])}>
                  <Icon name="Folder" size="sm" />
                  <span className="library-move-name">{folder.name}</span>
                  <Icon name="CaretRight" size="sm" />
                </button>
              </div>
            ))
          )}
          {!loading && level.folders?.length === 0 && <p className="library-move-status">此文件夹为空</p>}
          {(level.failed || rootFailed) && !loading && (
            <div className="library-move-status" role="alert">
              {level.failed ? "未成功加载文件。" : "无法识别资料库根目录"}
              <Button variant="ghost" size="sm" onClick={() => setRetry(retry + 1)}>
                重试
              </Button>
            </div>
          )}
        </div>
      </Dialog>
      {creating && <NewFolderDialog parentId={here ?? root ?? null} onCreated={(folder) => setPath([...path, { id: folder.id, name: folder.name }])} onClose={() => setCreating(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// New (slate-create-menu Kn / Xn)

/** $n: the hidden file input 上传文件 opens; what is chosen goes up into `directoryId`. */
function UploadInput({ inputRef, directoryId }: { inputRef: RefObject<HTMLInputElement | null>; directoryId: string | null }) {
  return (
    <input
      ref={inputRef}
      type="file"
      multiple
      hidden
      aria-label="上传文件"
      onChange={(event) => {
        const files = [...(event.target.files ?? [])];
        event.target.value = "";
        void uploadToLibrary(files, directoryId);
      }}
    />
  );
}

/**
 * Kn's onCreated: a folder made at the root on a tab that does not list folders shows on 全部, if
 * the page is still where it was when the dialog opened.
 */
function showCreated(from: ReturnType<typeof getState>["libraryRoute"]) {
  return () => {
    const route = getState().libraryRoute;
    if (route && route === from && !route.directoryId && route.tab !== "all" && route.tab !== "folders") setState({ libraryRoute: { tab: "all" } });
  };
}

/**
 * 新建 → 笔记 (Qn): an empty editor in the panel for the folder shown (the root elsewhere), nothing
 * made until its first save with text; a new note whose changes could not be saved opens instead.
 */
function openNewNote(directoryId: string | null) {
  const session = newNote(directoryId);
  const route = getState().libraryRoute ?? { tab: libraryPrefs().lastTab };
  setState({ libraryRoute: { ...route, note: session.key, fileId: session.state.file?.id } });
}

/**
 * 新建 (Kn, its ChatGPT chats left out): under 创建新内容, 笔记 when the account has notes
 * (writing_blocks_document_mode), 文件夹, then 上传文件, the last two open where the page can take
 * them and no batch is under way (ir, U). `anchor` draws the trigger; `onAct` runs before any does
 * (the sidebar's + opens the library first).
 */
export function LibraryNewMenu({ query, anchor, placement = "bottom-end", onAct, onOpenChange }: {
  query: LibraryQuery;
  anchor(open: boolean, toggle: () => void): ReactNode;
  placement?: "bottom-start" | "bottom-end" | "inline-end";
  onAct?(): void;
  onOpenChange?(open: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<{ from: ReturnType<typeof getState>["libraryRoute"] } | null>(null);
  const uploading = useLibrary((s) => s.uploading);
  const notes = useLibrary((s) => !!s.available?.notes);
  const input = useRef<HTMLInputElement>(null);
  const show = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  const act = (run: () => void) => () => {
    show(false);
    onAct?.();
    run();
  };
  return (
    <>
      <Popover open={open} onClose={() => show(false)} placement={placement} anchor={anchor(open, () => show(!open))}>
        <MenuSection title="创建新内容" />
        {notes && <MenuItem label="笔记" disabled={query.deleted} onClick={act(() => openNewNote(query.directoryId))} />}
        <MenuItem label="文件夹" disabled={!uploadAllowed(query, uploading)} onClick={act(() => setCreating({ from: getState().libraryRoute }))} />
        <MenuSep />
        <MenuItem label="上传文件" disabled={!uploadAllowed(query, uploading)} onClick={act(() => input.current?.click())} />
      </Popover>
      <UploadInput inputRef={input} directoryId={query.directoryId} />
      {creating && <NewFolderDialog parentId={query.directoryId} onCreated={showCreated(creating.from)} onClose={() => setCreating(null)} />}
    </>
  );
}

/** Xn: an empty folder's 上传文件, a primary button over the same hidden input. */
export function UploadButton({ query }: { query: LibraryQuery }) {
  const uploading = useLibrary((s) => s.uploading);
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button variant="primary" size="sm" disabled={!uploadAllowed(query, uploading)} onClick={() => input.current?.click()}>
        上传文件
      </Button>
      <UploadInput inputRef={input} directoryId={query.directoryId} />
    </>
  );
}

/** Yn's 创建文件夹: the empty 文件夹 tab's primary button into the new-folder dialog, shut while a batch is under way (ir). */
export function NewFolderButton({ query }: { query: LibraryQuery }) {
  const [creating, setCreating] = useState<{ from: ReturnType<typeof getState>["libraryRoute"] } | null>(null);
  const uploading = useLibrary((s) => s.uploading);
  return (
    <>
      <Button variant="primary" size="sm" disabled={!uploadAllowed(query, uploading)} onClick={() => setCreating({ from: getState().libraryRoute })}>
        创建文件夹
      </Button>
      {creating && <NewFolderDialog parentId={query.directoryId} onCreated={showCreated(creating.from)} onClose={() => setCreating(null)} />}
    </>
  );
}
