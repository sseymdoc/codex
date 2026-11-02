// 资料库 files in a Codex session, as the desktop app hands them to a local chat (local-file-selection
// b; the picker library-file-picker-dialog-content, the toolbar's 开始聊天, the preview's 询问此文件):
// the bridge saves each one on this machine (/api/library/attach) and the message names its path
// in the desktop's file block (questions.ts requestText). A draft's files live here, per draft as
// the composer's images do (keptAttachments), so that a download outlives the composer's remount on
// a session switch; the ready ones in localStorage too. The composer listens for composer-library
// (files picked elsewhere) and composer-restore (a message's words and files back: rewind, fork).
import { useSyncExternalStore } from "react";
import type { UserInput } from "@protocol/v2/UserInput";
import { cloudCall, list, obj, str } from "./cloud";
import { connectionId, environmentKind, newChat, openLibrary } from "./codex";
import type { EnvironmentKind } from "./environments";
import { basename, joinPath, parentDir, samePath } from "./format";
import { attachLibraryFile, detachLibraryFile, itemActions, libraryPrefs, parseNode, type LibraryNode } from "./library";
import { ATTACH_MAX_BYTES, PREVIEW_MAX_BYTES } from "./library-preview";
import { fileLines, requestText, splitRequest, type RequestFile } from "./questions";
import { getState, readJson, toast, writeJson } from "./store";

const TOO_LARGE = "此文件太大，无法作为附件添加到本地聊天";
const ATTACH_ERROR = "无法附加此资料库文件";
const UNSUPPORTED_CHAT = "所选内容无法作为附件添加到聊天中";
const CHAT_LIMIT = "请减少所选项数量后再开始聊天";
const ASK_LIMIT = `本地聊天仅支持大小已知且不超过 ${PREVIEW_MAX_BYTES / 1048576} MB 的文件。请改用 ChatGPT 或下载此文件`;
const CLOUD_TEXT_ONLY = "云端任务只能发送文字消息";
const LOCAL_ONLY = "资料库文件会保存在本机，只能添加到本地会话";
/** 开始聊天 takes this many files at most. */
const MAX_CHAT_FILES = 10;
/** The picker's page (library-file-picker-dialog-content Jn). */
const PICKER_PAGE = 25;
/** The composer's image types (its IMAGE_TYPES): such a file goes as a localImage too. */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// ---------------------------------------------------------------------------
// Which files

/**
 * A file the picker offers and a chat takes (the picker's pr for a chat, which asks nothing of its
 * access: a share goes as the account's own does): one that downloads (no folder, favorite's saved
 * entity, site or flashcard set), with a file id for its metadata line. Cloud drives' items never
 * get this far (parseNode).
 */
export const attachable = (node: LibraryNode): boolean => itemActions(node, false).download && node.fileId !== null;

/** Of no known size, or over what the bridge saves (local-file-selection b). */
const tooLarge = (node: Pick<LibraryNode, "size">) => node.size === null || node.size > ATTACH_MAX_BYTES;

const imageFile = (node: Pick<LibraryNode, "mime" | "name">) => (node.mime ? IMAGE_TYPES.includes(node.mime) : /\.(png|jpe?g|gif|webp)$/i.test(node.name));

/** 开始聊天's reason to wait, for its tooltip (null: it can start one): files only, ten at most, each of a known size within 45 MiB. */
export function startChatRefusal(nodes: readonly LibraryNode[]): string | null {
  if (!nodes.length || !nodes.every(attachable)) return UNSUPPORTED_CHAT;
  if (nodes.length > MAX_CHAT_FILES) return CHAT_LIMIT;
  return nodes.some(tooLarge) ? TOO_LARGE : null;
}

/** 询问此文件's reason to wait (library-cloud-file-preview Ea's O; null: it can ask): a size known and within 40 MiB. */
export function askRefusal(node: LibraryNode): string | null {
  if (!attachable(node)) return UNSUPPORTED_CHAT;
  return node.size === null || node.size > PREVIEW_MAX_BYTES ? ASK_LIMIT : null;
}

/** Why a session in `kind` takes no library files (null: it does): they are saved on this machine, which an SSH host cannot read, and a cloud task takes text. */
export function environmentRefusal(kind: EnvironmentKind | null): string | null {
  return kind === "local" ? null : kind === "cloud" ? CLOUD_TEXT_ONLY : LOCAL_ONLY;
}

/** 在资料库中打开 (artifactViewer.openInLibrary): the file's preview on the library page. */
export const openInLibrary = (libraryFileId: string): void => openLibrary({ tab: libraryPrefs().lastTab, fileId: libraryFileId });

/**
 * One page of the picker (KNa with native files only): POST /files/library for ready files, saved
 * responses left out, 25 a page from `cursor`, `search` as q; what a chat cannot take left out.
 */
export async function fetchPickerPage(search: string, cursor: string | null): Promise<{ items: LibraryNode[]; cursor: string | null }> {
  const answer = obj(await cloudCall<unknown>("POST", "/files/library", { limit: PICKER_PAGE, cursor, exclude_saved_responses: true, state: "ready", q: search.trim() || null }, "ChatGPT"));
  return { items: list(answer.items).map(parseNode).filter((node): node is LibraryNode => node !== null && attachable(node)), cursor: str(answer.cursor) || null };
}

// ---------------------------------------------------------------------------
// A draft's files (the composer's file chips)

export interface LibraryChip {
  key: string;
  /** The name shown, and the heading's label once saved (the bridge's). */
  name: string;
  /** Where the copy is, once ready (a restored chip's: the message's own). */
  path?: string;
  /** The library file, null for one a restored message named without (another client's file). */
  libraryFileId: string | null;
  fileId: string | null;
  /** The version it was attached at, when the item said (list items do not). */
  currentVersion?: number;
  isImage: boolean;
  /** A restored mention's line range, written back after its path (RequestFile.lines). */
  lines?: string;
  state: "pending" | "ready" | "error";
  /** Why it failed (error). */
  error?: string;
  /** Stops a pending download. */
  abort?: AbortController;
  /** This draft saved the copy, so dropping the chip deletes it; a restored chip's belongs to a sent message. */
  owned?: boolean;
}

/** Where a draft's ready chips are kept across reloads; the composer wipes them with its drafts on an install. */
export const DRAFT_FILES = "codex-ui:draft-files:";

const keptFiles = new Map<string, readonly LibraryChip[]>();
const fileListeners = new Set<() => void>();

/**
 * A draft's ready chips as stored. ponytail: the bridge knows the folders it made only while it
 * runs, so once codex-ui restarts, dropping a stored chip it owned asks a DELETE that is refused
 * (404) and the copy stays under attachments; a registry of codex-ui's own folders kept on disk
 * (as Codex keeps pasted-text-attachments.json) would let it go.
 */
function storedFiles(draftId: string): LibraryChip[] {
  return list(readJson(DRAFT_FILES + draftId)).flatMap((raw): LibraryChip[] => {
    const chip = obj(raw);
    const path = str(chip.path);
    if (!path) return [];
    const version = chip.currentVersion;
    return [{
      key: str(chip.key) || crypto.randomUUID(),
      name: str(chip.name) || "attachment",
      path,
      libraryFileId: str(chip.libraryFileId) || null,
      fileId: str(chip.fileId) || null,
      ...(Number.isInteger(version) && (version as number) >= 0 ? { currentVersion: version as number } : {}),
      isImage: chip.isImage === true,
      ...(fileLines(chip.lines) ? { lines: chip.lines } : {}),
      state: "ready",
      ...(chip.owned === true ? { owned: true } : {}),
    }];
  });
}

/** A draft's chips: in memory, else the ready ones stored; the same array until they change. */
export function draftFiles(draftId: string): readonly LibraryChip[] {
  let chips = keptFiles.get(draftId);
  if (!chips) keptFiles.set(draftId, (chips = storedFiles(draftId)));
  return chips;
}

/** A draft's chips replaced as given (none deleted: discardDraftFiles does that), the ready ones stored. */
export function setDraftFiles(draftId: string, chips: readonly LibraryChip[]): void {
  keptFiles.set(draftId, chips);
  const ready = chips.flatMap(({ key, name, path, libraryFileId, fileId, currentVersion, isImage, lines, state, owned }) => (state === "ready" && path ? [{ key, name, path, libraryFileId, fileId, currentVersion, isImage, lines, owned }] : []));
  if (ready.length) writeJson(DRAFT_FILES + draftId, ready);
  else {
    try {
      localStorage.removeItem(DRAFT_FILES + draftId);
    } catch {
      // Private mode: nothing was stored.
    }
  }
  for (const listener of fileListeners) listener();
}

/** The composer's chips for its draft, kept up as downloads end. */
export function useDraftFiles(draftId: string): readonly LibraryChip[] {
  return useSyncExternalStore((listener) => {
    fileListeners.add(listener);
    return () => fileListeners.delete(listener);
  }, () => draftFiles(draftId));
}

/** The chip `key` changed, if the draft still holds it. */
function patchChip(draftId: string, key: string, patch: Partial<LibraryChip>): boolean {
  const chips = draftFiles(draftId);
  if (!chips.some((chip) => chip.key === key)) return false;
  setDraftFiles(draftId, chips.map((chip) => (chip.key === key ? { ...chip, ...patch } : chip)));
  return true;
}

/**
 * Library files into a draft (local-file-selection b): each one a chat takes and the draft does not
 * hold yet (by library file; a failed chip gives way) is pending while the bridge saves it, then
 * ready, or failed with 无法附加此资料库文件, which a toast says too (b's catch). One of no known
 * size or over 45 MiB stays out, with a toast. A copy that comes for a chip no longer there goes
 * again. Resolves once all have ended.
 */
export async function attachDraftFiles(draftId: string, nodes: readonly LibraryNode[]): Promise<void> {
  let chips = draftFiles(draftId);
  const started: { chip: LibraryChip; node: LibraryNode; abort: AbortController }[] = [];
  let refused = false;
  for (const node of nodes) {
    if (!attachable(node) || chips.some((chip) => chip.libraryFileId === node.id && chip.state !== "error")) continue;
    if (tooLarge(node)) {
      refused = true;
      continue;
    }
    const abort = new AbortController();
    const chip: LibraryChip = {
      key: crypto.randomUUID(),
      name: node.name,
      libraryFileId: node.id,
      fileId: node.fileId,
      ...(node.version === null ? {} : { currentVersion: node.version }),
      isImage: imageFile(node),
      state: "pending",
      abort,
    };
    chips = [...chips.filter((held) => held.libraryFileId !== node.id), chip];
    started.push({ chip, node, abort });
  }
  if (refused) toast("danger", TOO_LARGE);
  if (!started.length) return;
  setDraftFiles(draftId, chips);
  await Promise.all(started.map(async ({ chip, node, abort }) => {
    try {
      const { path, label } = await attachLibraryFile(node, abort.signal);
      if (!patchChip(draftId, chip.key, { name: label, path, state: "ready", abort: undefined, owned: true })) void detachLibraryFile(path);
    } catch {
      if (!abort.signal.aborted && patchChip(draftId, chip.key, { state: "error", error: ATTACH_ERROR, abort: undefined })) toast("danger", ATTACH_ERROR);
    }
  }));
}

/**
 * Files from the user's disk that are not images (Claude 4.4212 c4a9ee384 Td): on the desktop the
 * chip names the file where it is; in a browser its bytes go to POST /api/attachments and the chip
 * names the saved copy, which this draft then owns. A copy for a chip no longer there goes again.
 */
export async function attachDiskFiles(draftId: string, files: readonly { file: File; path?: string }[]): Promise<void> {
  await Promise.all(files.map(async ({ file, path: own }) => {
    const name = file.name || "附件";
    const abort = new AbortController();
    const chip: LibraryChip = { key: `upload:${crypto.randomUUID()}`, name, libraryFileId: null, fileId: null, isImage: false, ...(own ? { path: own, state: "ready" } : { state: "pending", abort }) };
    setDraftFiles(draftId, [...draftFiles(draftId), chip]);
    if (own) return;
    try {
      const response = await fetch(`/api/attachments?${new URLSearchParams({ c: connectionId() ?? "", name })}`, { method: "POST", body: file, signal: abort.signal });
      if (!response.ok) throw new Error((await response.text()) || `上传失败（${response.status}）`);
      const answer = obj(await response.json());
      const path = str(answer.path);
      if (!path) throw new Error("The attachment came back without a path");
      if (abort.signal.aborted || !patchChip(draftId, chip.key, { name: str(answer.label) || name, path, state: "ready", abort: undefined, owned: true })) void detachLibraryFile(path);
    } catch (error) {
      if (abort.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      if (patchChip(draftId, chip.key, { state: "error", error: message, abort: undefined })) toast("warning", `无法附加“${name}”`, message);
    }
  }));
}

/** A chip given up: its download stops, and its copy goes when this draft saved it. */
function dropChip(chip: LibraryChip): void {
  chip.abort?.abort();
  if (chip.owned && chip.path) void detachLibraryFile(chip.path);
}

/** A chip's ✕ (or 取消 while it downloads). */
export function removeDraftFile(draftId: string, key: string): void {
  const chips = draftFiles(draftId);
  const chip = chips.find((held) => held.key === key);
  if (!chip) return;
  setDraftFiles(draftId, chips.filter((held) => held !== chip));
  dropChip(chip);
}

/** A draft's chips thrown away with it, each as its ✕ would. Once sent, they are the message's: handOverDraftFiles instead. */
export function discardDraftFiles(draftId: string): void {
  const chips = draftFiles(draftId);
  if (!chips.length) return;
  setDraftFiles(draftId, []);
  chips.forEach(dropChip);
}

/**
 * The copies a draft saved that went with a message which may still come back to it: a queued one
 * taken back (在输入框中编辑, ↑) makes them the draft's again, one removed from the queue deletes
 * them. A path sent again from a chip the draft did not own (a recalled prompt's) leaves: that
 * copy is a sent message's. ponytail: in memory, so after a reload a queued message's copies stay.
 */
const queuedCopies = new Set<string>();

/**
 * A draft's chips going with a message, out of the draft before it goes (no ✕ can take a copy the
 * message names while it is on its way); the copies are the message's now. On a failure the
 * composer puts the chips back as they were.
 */
export function handOverDraftFiles(draftId: string, chips: readonly LibraryChip[]): void {
  for (const chip of chips) if (chip.path) chip.owned ? queuedCopies.add(chip.path) : queuedCopies.delete(chip.path);
  if (chips.length) setDraftFiles(draftId, draftFiles(draftId).filter((held) => !chips.includes(held)));
}

/** A queued message removed (从队列中移除, 全部清除): the copies a draft saved for it go. */
export function dropQueuedFiles(input: readonly UserInput[]): void {
  for (const part of input) {
    if (part.type !== "text") continue;
    for (const { path } of splitRequest(part.text).files) if (queuedCopies.delete(path)) void detachLibraryFile(path);
  }
}

/**
 * A message's files (as splitRequest read them) back in a draft as ready chips whose copies stay
 * the message's: in place of the draft's, which are discarded (rewind, fork, ↑ history), or after
 * them, a path already there skipped (`queued`: a queued message taken back, the copies the draft
 * saved for it its own again).
 */
export function restoreDraftFiles(draftId: string, files: readonly RequestFile[], { queued = false } = {}): void {
  const kept = queued ? draftFiles(draftId) : [];
  if (!queued) discardDraftFiles(draftId);
  const back = files.filter((file) => !kept.some((chip) => chip.path === file.path)).map((file): LibraryChip => ({
    key: crypto.randomUUID(),
    name: file.label,
    path: file.path,
    libraryFileId: file.library?.libraryFileId ?? null,
    fileId: file.library?.fileId ?? null,
    ...(file.library?.currentVersion === undefined ? {} : { currentVersion: file.library.currentVersion }),
    isImage: file.isImage,
    ...(file.lines ? { lines: file.lines } : {}),
    state: "ready",
    ...(queued && queuedCopies.delete(file.path) ? { owned: true } : {}),
  }));
  if (back.length || !queued) setDraftFiles(draftId, [...kept, ...back]);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A copy where Codex and the bridge save attachments, <codexHome>/attachments/<uuid>/<name> (as
 * the bridge's libraryDetach tells its own), with no "." or ".." on the way.
 */
function savedAttachment(path: string): boolean {
  const home = getState().server.info?.codexHome;
  const dir = parentDir(path);
  return !!home && !/(?:^|[\\/])\.\.?(?:[\\/]|$)/.test(path) && UUID.test(basename(dir)) && samePath(parentDir(dir), joinPath(home, "attachments"));
}

/**
 * What a draft's ready chips make of `body` (the words after any slash command ran): the file block
 * ahead of them, and each image once more as a localImage. That is codex-ui's own: the desktop app
 * writes the Image attachment line and the localImage (rin / mD) for its pasted pictures, not for
 * the picker's library files (local-file-selection b), whose model would have to open them itself.
 * `images` false (a model without image input): neither. Only a copy the draft saved, or one under
 * Codex's attachments, goes as a picture: app-server reads a localImage itself, outside the turn's
 * sandbox, and a restored chip's path is whatever its message's text said (a brief, a pasted one).
 */
export function libraryMessage(chips: readonly LibraryChip[], body: string, images = true): { text: string; images: Extract<UserInput, { type: "localImage" }>[] } {
  const files = chips.flatMap((chip): RequestFile[] => (chip.state === "ready" && chip.path ? [{
    label: chip.name,
    path: chip.path,
    isImage: images && chip.isImage && (chip.owned === true || savedAttachment(chip.path)),
    library: chip.libraryFileId && chip.fileId ? { currentVersion: chip.currentVersion, fileId: chip.fileId, libraryFileId: chip.libraryFileId } : null,
    ...(chip.lines ? { lines: chip.lines } : {}),
  }] : []));
  return { text: requestText(files, body), images: files.filter((file) => file.isImage).map((file) => ({ type: "localImage", path: file.path })) };
}

// ---------------------------------------------------------------------------
// From outside the composer

/** composer-library's detail: files picked outside the composer, and words to go with them. */
export interface ComposerLibraryAsk {
  files: readonly LibraryNode[];
  /** In place of the draft's words when not empty (询问此文件's question); "" leaves them. */
  text: string;
  /** "unavailable" until a composer (the focused column's: ColumnFocus) takes them: then "filled". */
  outcome: "unavailable" | "filled";
}

/** composer-restore's detail: a message's words in place of the draft's, and its files when it had any. */
export interface ComposerRestore {
  text: string;
  files: readonly RequestFile[];
}

/** A message back in the open composer (rewind, fork, 编辑提示词): its words and files as splitRequest read them, in place of the draft's (a message without files leaves the draft's). */
export function restoreComposerDraft(text: string, files: readonly RequestFile[]): void {
  window.dispatchEvent(new CustomEvent<ComposerRestore>("composer-restore", { detail: { text, files } }));
}

/** Composer's nextFrames: long enough for the new-session page's composer to mount and listen. */
const nextFrames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/**
 * 开始聊天 and 询问此文件 (tryPlugin's way): a new session whose composer takes `nodes`, attaching
 * them, and `text`; nothing is sent. The new session must run here (environmentKind local), else a
 * toast says why and that is all. Resolves to "filled", "not_local", or "unavailable" (no composer).
 */
export async function startChatWithLibraryFiles(nodes: readonly LibraryNode[], text = ""): Promise<ComposerLibraryAsk["outcome"] | "not_local"> {
  newChat();
  await nextFrames();
  const refused = environmentRefusal(environmentKind(null));
  if (refused) {
    toast("warning", refused);
    return "not_local";
  }
  const ask: ComposerLibraryAsk = { files: nodes, text, outcome: "unavailable" };
  window.dispatchEvent(new CustomEvent<ComposerLibraryAsk>("composer-library", { detail: ask }));
  return ask.outcome;
}
