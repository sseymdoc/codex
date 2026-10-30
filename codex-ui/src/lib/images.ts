// The 图像 page (the Codex desktop app 26.1023's /images, sidebarElectron.imagesRouteNavLink): its
// sidebar entry, the page's draft, the images generated on this machine, and how a prompt becomes
// an image. ChatGPT's own path (/f/conversation behind Sentinel) is not taken: every send starts a
// local Codex session that runs the imagegen skill and opens it, as the desktop app's own panel
// for local images sends [image, mask] and text into a Codex session. ChatGPT's side is read only
// (server/cloud.mjs): the prompt catalog, the generated history, recent uploads and saved
// references, as the desktop app's prompts / draft-state / recent-uploads chunks read them; no
// account was probed, so every field is read defensively. Strings are the desktop app's zh-CN ones
// (images.*, imageSidePanel.*, composer.imageComments.*).
import { useEffect, useSyncExternalStore } from "react";
import type { FsGetMetadataResponse } from "@protocol/v2/FsGetMetadataResponse";
import type { Model } from "@protocol/v2/Model";
import type { UserInput } from "@protocol/v2/UserInput";
import { cloudCall, list, obj, query, str } from "./cloud";
import { call, connectionId, errorMessage, listSkills, openThread, readDirectory, sendMessage, startThread } from "./codex";
import { dotContentUrl } from "./dots";
import { joinPath } from "./format";
import { libraryContentUrl } from "./library";
import { getState, useStore, type AppState } from "./store";

/** An image the imagegen skill saved under $CODEX_HOME/generated_images/<session id>/. */
export interface LocalImage {
  path: string;
  name: string;
  threadId: string;
  /** Last modified (ms), 0 when the host does not say. */
  time: number;
}

/** An image the page's composer holds: a picked, pasted or dropped file as a data URL. */
export interface DraftImage {
  key: string;
  name: string;
  url: string;
  /** The ChatGPT upload it was read from (the reference picker's recent photos). */
  fileId?: string;
}

/**
 * A ChatGPT read that failed: `desktop` where only the desktop app reaches ChatGPT (in the browser
 * the bridge's Node fetch meets Cloudflare's 403), else `error`.
 */
export type CloudFailure = "desktop" | "error";

/** What a prompt card asks for (its action's input_requirements and strategy). */
export interface PromptAction {
  /** camera_or_gallery (the default), prompt_only, sketch, styles …, as the server names it. */
  source: string;
  strategy: string;
  /** The photos it takes: min_count, else one unless it is prompt_only; max_count, null for any. */
  min: number;
  max: number | null;
}

export interface PromptItem {
  id: string;
  title: string;
  /** The photo dialog's title before the card's own; "" for none. */
  description: string;
  prompt: string;
  /** Its example artwork's address as ChatGPT gives it (imageSrc shows it); "" for none. */
  image: string;
  alt: string;
  /** "" is 热门. */
  section: string;
  action: PromptAction;
}

export interface PromptGroup {
  id: string;
  title: string;
  /** image_card (portrait and anything unknown too), text_pill or icon_pill. */
  presentation: "image_card" | "text_pill" | "icon_pill";
  items: PromptItem[];
}

/**
 * An image in ChatGPT's history (/my/recent/image_gen). Addresses stay as ChatGPT gives them:
 * the bridge's carry the connection's id, so cloudThumb / cloudSrc make them as the page renders.
 */
export interface CloudImage {
  id: string;
  title: string;
  /** The tile's picture (its thumbnail, else the image) and the image; "" for none or a blocked one. */
  thumb: string;
  url: string;
  /** The file behind asset_pointer: the viewer's source and an edit's bytes. */
  fileId: string | null;
  conversationId: string | null;
  blocked: boolean;
  /** ms; null when the item carries no time. */
  time: number | null;
}

interface CloudHistory {
  /** Newest first, deduplicated by id; null until the first page. */
  items: CloudImage[] | null;
  /** The next page's; null at the end. */
  cursor: string | null;
  /** A page on its way: the first or the next. */
  loading: "first" | "more" | null;
  /** The last page's failure, and whether it was a next page (重试 asks for that one again). */
  error: { kind: CloudFailure; more: boolean } | null;
}

/** The page's statsig switches as /api/images/available says them (server/images.mjs). */
export interface ImagesGates {
  /** A card opens its preview (layer 2724553558); off, it takes the composer's way (cardRoute). */
  preview: boolean;
  /** A styles card sends at once with the composer's images (layer 3360722522). */
  autoSendWithAttachments: boolean;
  /** The catalog's tabs in this order (dynamic config 3939855767), "trending" for 热门. */
  sectionOrder: string[];
  promptShare: boolean;
  promptShareLabel: "prompt_with_image" | "image_with_prompt";
  /** The preview's saved references (QKa). */
  savedReferences: boolean;
}

interface ImagesState {
  /** The sidebar's 图像 row: true shown, null hidden, undefined not yet known (useImagesEntry). */
  entry: true | null | undefined;
  /** The last switches heard; these until /api/images/available first answers. */
  gates: ImagesGates;
  /** /api/images/available did not answer the last time it was asked (the preview's 无法检查是否可用). */
  availabilityError: boolean;
  /** The card whose prompt the composer holds (a prefilled one, the desktop app's selected template); the draft's send clears it. */
  template: PromptItem | null;
  /** This machine's generated images, newest first; null until listed. */
  local: LocalImage[] | null;
  localError: string | null;
  draft: { text: string; images: DraftImage[] };
  /** The prompt catalog: null until /images/init answered once; `error` when either read failed. */
  catalog: { groups: PromptGroup[] | null; error: CloudFailure | null };
  history: CloudHistory;
}

const EMPTY_DRAFT: ImagesState["draft"] = { text: "", images: [] };
const EMPTY_CATALOG: ImagesState["catalog"] = { groups: null, error: null };
const EMPTY_HISTORY: CloudHistory = { items: null, cursor: null, loading: null, error: null };
const DEFAULT_GATES: ImagesGates = { preview: true, autoSendWithAttachments: false, sectionOrder: [], promptShare: false, promptShareLabel: "prompt_with_image", savedReferences: false };
let state: ImagesState = {
  entry: undefined, gates: DEFAULT_GATES, availabilityError: false, template: null, local: null, localError: null, draft: EMPTY_DRAFT, catalog: EMPTY_CATALOG, history: EMPTY_HISTORY,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<ImagesState>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

/** `pick` must return a part of the state as it is (no new objects). */
export function useImages<T>(pick: (s: ImagesState) => T): T {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => pick(state));
}

export const imagesState = () => state;

// ---------------------------------------------------------------------------
// Entry and channel

/** A feature the server reports off (experimentalFeature/list: aliases, profile and requirements applied); on until listed, as pluginsOff. */
const featureOff = (s: AppState, name: string) => s.features.some((feature) => feature.name === name && !feature.enabled);

/**
 * The page's side of the desktop app's `d` (b && d && f && !r): a ChatGPT login with in_app_chat
 * not switched off. The account's side (workspace permissions, the free holdout) is the bridge's:
 * /api/images/available.
 */
export function imagesEntryOn(s: AppState): boolean {
  return s.account?.account?.type === "chatgpt" && !featureOff(s, "in_app_chat");
}

const gatesOf = (answer: Record<string, unknown>): ImagesGates => ({
  preview: answer.preview !== false,
  autoSendWithAttachments: answer.autoSendWithAttachments === true,
  sectionOrder: list(answer.sectionOrder).filter((section): section is string => typeof section === "string"),
  promptShare: answer.promptShare === true,
  promptShareLabel: answer.promptShareLabel === "image_with_prompt" ? "image_with_prompt" : "prompt_with_image",
  savedReferences: answer.savedReferences === true,
});

let checkedAt = 0;
let checkRun = 0;
/** server/images.mjs's reasons for an answer with no switches read (a blip upstream), not new ones. */
const UNREAD = new Set(["accounts_unavailable", "statsig_unavailable"]);

/**
 * /api/images/available, at most once a minute unless `force`d: the entry and the page's switches.
 * Meanwhile the last answer stands; one that does not come (the bridge down, an old one without the
 * route) shows the entry, keeps the last switches and says so in the preview (重试 asks again); one
 * whose switches were not read keeps the last ones too. An answer that comes after the login
 * stopped counting is dropped.
 * ponytail: the switches kept are the last login's after an account change; key them by account if that matters.
 */
export async function refreshImagesAvailable(force = false): Promise<void> {
  const id = connectionId();
  if (!id || (!force && Date.now() - checkedAt < 60_000)) return;
  checkedAt = Date.now();
  const run = ++checkRun;
  let answer: Record<string, unknown> | null = null;
  try {
    const response = await fetch(`/api/images/available?c=${encodeURIComponent(id)}`);
    if (response.ok) answer = obj(await response.json());
  } catch {
    // Unreachable: no answer.
  }
  if (run !== checkRun || !imagesEntryOn(getState())) return;
  if (!answer) return set({ entry: true, availabilityError: true });
  set({ entry: answer.available === false ? null : true, availabilityError: false, ...(UNREAD.has(str(answer.reason)) ? {} : { gates: gatesOf(answer) }) });
}

/**
 * The sidebar's 图像 row (only the sidebar calls this): asked as a ready connection comes up for a
 * login the page's side lets in, as the account changes, and on focus (at most once a minute);
 * held while it reconnects, so an open page does not leave meanwhile. The page reads `entry` and
 * goes to the new-session page once it is null.
 */
export function useImagesEntry(): boolean {
  const ready = useStore((s) => s.conn.status === "ready");
  const on = useStore(imagesEntryOn);
  const account = useStore((s) => (s.account?.account?.type === "chatgpt" ? (s.account.account.email ?? "") : null));
  useEffect(() => {
    if (!ready) return;
    if (!on) {
      checkRun++;
      set({ entry: null });
      return;
    }
    void refreshImagesAvailable(true);
    const again = () => void refreshImagesAvailable();
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [ready, on, account]);
  return useImages((s) => s.entry) === true;
}

const takesImages = (model: Model) => model.inputModalities.includes("image");

/**
 * The model a 图像 session runs on: the draft page's model (its pick, else config.toml's) when it
 * takes images (one the catalog does not list is trusted, as the composer does), else the default
 * or first model that does; undefined when none does. Null leaves config.toml's to the server, as
 * before the catalog loads.
 */
export function imageModel(): string | null | undefined {
  const { prefs, config, models, hiddenModels } = getState();
  if (!models.length) return prefs.model;
  const pick = prefs.model ?? config?.model ?? null;
  const picked = [...models, ...hiddenModels].find((model) => model.id === pick || model.model === pick);
  if (pick && (!picked || takesImages(picked))) return prefs.model;
  return (models.find((model) => model.isDefault && takesImages(model)) ?? models.find(takesImages))?.id;
}

/**
 * Whether imagegen runs for this login (core spec_plan.rs 824-859): ChatGPT auth on a paid plan,
 * a model that takes images and image_generation not switched off. Off, the page still shows and
 * its composer is disabled.
 */
export function imageChannel(): boolean {
  const s = getState();
  return s.account?.account?.type === "chatgpt" && s.account.account.planType !== "free" && imageModel() !== undefined && !featureOff(s, "image_generation");
}

/** The image_gen quota's reset time (s) once it is spent; null while images are left or the server sends no such bucket or time. */
export function imageQuotaReset(s: AppState): number | null {
  const quota = s.rateLimits?.rateLimitsByLimitId?.image_gen?.primary;
  return quota && quota.usedPercent >= 100 ? quota.resetsAt : null;
}

// ---------------------------------------------------------------------------
// Sending

/**
 * A prompt (with `images` first, the source image of an edit leading) as a new local session:
 * images, the imagegen skill when it is there and on, then the text, as the composer orders them.
 * The session opens before the message goes, as the desktop app moves to /c/<id>; a send that
 * fails there stays on the session page as its pending message with 重试.
 */
export async function imagesSend(text: string, images: UserInput[]): Promise<void> {
  const skill = (await listSkills("").catch(() => [])).flatMap((entry) => entry.skills).find((s) => s.name === "imagegen" && s.enabled);
  const id = await startThread(undefined, { model: imageModel() ?? null });
  await openThread(id);
  const input: UserInput[] = [...images, ...(skill ? [{ type: "skill" as const, name: skill.name, path: skill.path }] : [])];
  if (text) input.push({ type: "text", text, text_elements: [] });
  await sendMessage(id, input, { fresh: true }).catch(() => {});
}

/**
 * An edit of an image: the image first (one on this machine as its file, a ChatGPT one as its
 * bytes), then (移除, 标注) the mask or the marked-up copy as a data URL, as the desktop app's
 * [image, mask].
 */
export async function imagesEdit(source: { path: string } | { fileId: string }, text: string, second?: string): Promise<void> {
  const first: UserInput = "path" in source ? { type: "localImage", path: source.path } : { type: "image", url: await fileBytes(source.fileId) };
  await imagesSend(text, [first, ...(second ? [{ type: "image" as const, url: second }] : [])]);
}

let sending = false;
/**
 * A send from the page (the composer's 发送, a card that sends at once, the photo dialog): `text`
 * with `images`, the draft's unless given; the draft (and the card it holds) clears once a
 * session has it, as the desktop app moves on to a new conversation. One while another is on its
 * way does nothing (a card clicked twice).
 */
export async function sendDraft(text: string, images: UserInput[] = state.draft.images.map((image) => ({ type: "image", url: image.url }))): Promise<void> {
  if (sending) return;
  sending = true;
  try {
    await imagesSend(text, images);
    set({ draft: EMPTY_DRAFT, template: null });
  } finally {
    sending = false;
  }
}

export const setDraftText = (text: string) => set({ draft: { ...state.draft, text } });

/** A card's prompt in the composer in place of its text, the card held for the reference picker (suggestions' B). */
export const prefill = (item: PromptItem) => set({ template: item, draft: { ...state.draft, text: item.prompt } });

/** A card that takes photos (the reference picker's `oe`): any source but none, prompt_only and sketch. */
export const takesPhotos = (item: PromptItem) => !!item.action.source && item.action.source !== "prompt_only" && item.action.source !== "sketch";

/** A styles card that sends as soon as it has its photos (app-initial Tqa). */
export const autoSends = (item: PromptItem) => item.action.source === "styles" && item.action.strategy === "auto_send";

/**
 * Where a card goes (the desktop app's suggestions G on the 图像 page, once the composer can send):
 * a sketch card to 绘图; with the preview on, every other one to its preview; with it off, a
 * styles card sends at once with the composer's `attached` images when autoSendWithAttachments
 * lets it, else opens the photo dialog; any other card prefills the composer (whatever its
 * strategy: only the photo dialog's own surface stops at prefill_composer).
 */
export function cardRoute(item: PromptItem, gates: Pick<ImagesGates, "preview" | "autoSendWithAttachments">, attached: number): "sketch" | "preview" | "send" | "dialog" | "prefill" {
  if (item.action.source === "sketch") return "sketch";
  if (gates.preview) return "preview";
  if (autoSends(item)) return gates.autoSendWithAttachments && attached > 0 ? "send" : "dialog";
  return "prefill";
}

/** Adds images up to `max` in all; false when some did not fit. */
export function addDraftImages(images: Omit<DraftImage, "key">[], max: number): boolean {
  const room = Math.max(0, max - state.draft.images.length);
  set({ draft: { ...state.draft, images: [...state.draft.images, ...images.slice(0, room).map((image) => ({ ...image, key: crypto.randomUUID() }))] } });
  return images.length <= room;
}

export const removeDraftImage = (key: string) => set({ draft: { ...state.draft, images: state.draft.images.filter((image) => image.key !== key) } });

// ---------------------------------------------------------------------------
// Edit prompts (imageSidePanel.*, images.preview.aspectRatioInstruction, image-comment-prompt)

/** The viewer's 调整大小 stops (image-tools-toolbar). */
export const ASPECT_RATIOS = [
  { label: "正方形", ratio: "1:1" },
  { label: "竖向", ratio: "3:4" },
  { label: "故事版式", ratio: "9:16" },
  { label: "横向", ratio: "4:3" },
  { label: "宽屏", ratio: "16:9" },
] as const;

/** resizePrompt, removeBackgroundPrompt and removePrompt (the last sent with [image, mask]). */
export function editPrompt(edit: "removeBackground" | "remove" | { aspectRatio: string }): string {
  if (edit === "removeBackground") return "移除此图像的背景。保持所有前景主体不变且完整，边缘干净平滑。将背景设为透明。";
  if (edit === "remove") return "从第一张图像中移除第二张图像中标记的区域";
  return `将宽高比设为 ${edit.aspectRatio}`;
}

/**
 * 标注, sent with [image, the image with the strokes on it], then its note. The lead-in is our own:
 * the desktop app sends markup to /image-gen/markup-preview, so it has no wording to copy.
 */
export function markupPrompt(note: string): string {
  return note ? `按第二张图像中标出的位置修改第一张图像：${note}` : "按第二张图像中标出的位置修改第一张图像。";
}

/** A preview's prompt with its output aspect ratio after a blank line; unchanged for 自动 (null). */
export function aspectInstruction(text: string, ratio: string | null): string {
  return ratio ? `${text}\n\n输出宽高比：${ratio}。若上文中的宽高比或构图指令与此输出比例冲突，请以此比例为准。` : text;
}

const percent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });
const clamp = (value: number) => Math.min(Math.max(value, 0), 1);

/** 添加评论 on one image (x and y from 0 to 1): the heading and a numbered line each, nothing else. */
export function commentPrompt(comments: { x: number; y: number; text: string }[]): string {
  if (!comments.length) return "";
  return ["图像 1：", ...comments.map((comment, index) => `${index + 1}.（x：${percent.format(clamp(comment.x))}，y：${percent.format(clamp(comment.y))}）${comment.text}`)].join("\n");
}

// ---------------------------------------------------------------------------
// This machine's images

/** `run` over `items`, `limit` at a time, results in order. */
async function pooled<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  }));
  return results;
}

/**
 * $CODEX_HOME/generated_images/<session>/*.png, newest first; none while the folder is not there.
 * ponytail: every visit stats every file; page by session folder once there are thousands.
 */
export async function listLocal(): Promise<LocalImage[]> {
  const home = getState().server.info?.codexHome;
  if (!home) return [];
  const root = joinPath(home, "generated_images");
  const sessions = await readDirectory(root).catch(async (error) => {
    if (await call("fs/getMetadata", { path: root }).then(() => true, () => false)) throw error;
    return [];
  });
  const folders = await pooled(sessions.filter((entry) => entry.isDirectory), 8, async (entry) => {
    const dir = joinPath(root, entry.fileName);
    const files = await readDirectory(dir).catch(() => []);
    return files.filter((file) => file.isFile && /\.png$/i.test(file.fileName)).map((file) => ({ path: joinPath(dir, file.fileName), name: file.fileName, threadId: entry.fileName }));
  });
  const images = await pooled(folders.flat(), 8, async (image) => ({
    ...image,
    time: await call("fs/getMetadata", { path: image.path }).then((meta) => (meta as FsGetMetadataResponse).modifiedAtMs, () => 0),
  }));
  return images.sort((a, b) => b.time - a.time);
}

/** Lists this machine's images again; the last list stays on screen meanwhile. */
export async function loadLocal(): Promise<void> {
  set({ localError: null });
  try {
    set({ local: await listLocal() });
  } catch (error) {
    set({ localError: errorMessage(error) });
  }
}

// ---------------------------------------------------------------------------
// ChatGPT's side, read only

const get = (path: string) => cloudCall<unknown>("GET", path, undefined, "ChatGPT");
/** A read that failed: in the browser it is the desktop app's only, unless ChatGPT answered here before. */
const failure = (reached: boolean): CloudFailure => (reached || (typeof window !== "undefined" && window.codexDesktop) ? "error" : "desktop");
const count = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
/** An ISO time, or epoch seconds / ms, as ms (library.ts's `time`). */
const timeOf = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  const at = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : null;
};

/** Hosts whose image URLs need no login (CSP img-src in server/serve.mjs lets them in). */
const OPEN_HOST = /^(?:(?:[a-z0-9-]+\.)*oaiusercontent\.com|persistent\.oaistatic\.com|cdn\.openai\.com|images\.openai\.com)$/i;

/**
 * A ChatGPT image address as the page may show it: chatgpt.com's own (a bare /estuary/… under
 * /backend-api, as the desktop app's Vvr reads it) through the bridge under the login, at the
 * bridge's own ChatGPT base; https on OpenAI's open file and asset hosts as it is; nothing else ("").
 */
export function imageSrc(raw: unknown): string {
  const text = str(raw).trim();
  if (!text || text.includes("\\")) return "";
  let url: URL;
  try { url = new URL(text.startsWith("/estuary/") ? `/backend-api${text}` : text, "https://chatgpt.com"); } catch { return ""; }
  if (url.protocol !== "https:" || url.port || url.username || url.password) return "";
  if (url.hostname === "chatgpt.com") return dotContentUrl(url.pathname + url.search);
  return OPEN_HOST.test(url.hostname) ? url.href : "";
}

/** A file pointer's file id (sediment:// or file-service://, the desktop app's pI). */
const fileOf = (pointer: unknown): string | null => /^(?:sediment|file-service):\/\/(.+)$/.exec(str(pointer))?.[1] ?? null;

/** A ChatGPT file's bytes through the bridge, found as the library finds a file's (a /files/download address). */
export const cloudImageUrl = (fileId: string) => libraryContentUrl({ id: fileId, name: "image.png", fileId }, "content");

/**
 * An address the page may read the bytes of (下载: connect-src is 'self'): its own as it is, a
 * signed file host's through the bridge (dotsContent takes those without the login); "" for the rest.
 */
export function readableSrc(src: string): string {
  if (!src.startsWith("https:")) return src;
  return /(?:^|\.)oaiusercontent\.com$/i.test(new URL(src).hostname) ? dotContentUrl(src) : "";
}

/** A ChatGPT image as a data URL (a cloud image's edit, a picked photo). */
export async function fileBytes(fileId: string): Promise<string> {
  const url = cloudImageUrl(fileId);
  if (!url) throw new Error("未连接到 app-server");
  const response = await fetch(url);
  if (!response.ok) throw new Error((await response.text()) || `无法加载此图像（${response.status}）`);
  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return `data:${blob.type.startsWith("image/") ? blob.type : "image/png"};base64,${btoa(binary)}`;
}

// The prompt catalog (prompts chunk q / J / ie)

/** An item's action when neither it nor its group names one (the desktop app's default). */
const DEFAULT_ACTION = { input_requirements: { source: "camera_or_gallery" }, strategy: "auto_send" };

function parseItem(raw: unknown, groupAction: unknown): PromptItem[] {
  const item = obj(raw);
  const id = str(item.id);
  if (!id) return [];
  const action = obj(item.action ?? groupAction ?? DEFAULT_ACTION);
  const needs = obj(action.input_requirements);
  const source = str(needs.source);
  const image = [item.image_url, ...list(item.image_variant_urls), ...list(item.image_variants)].map(str).find((url) => url.trim());
  return [{
    id,
    title: str(item.title),
    description: str(item.description),
    prompt: str(item.prompt_text),
    image: image ?? "",
    alt: str(item.image_alt),
    section: str(item.section),
    action: { source, strategy: str(action.strategy) || "auto_send", min: count(needs.min_count) ?? Number(!!source && source !== "prompt_only"), max: count(needs.max_count) },
  }];
}

/**
 * The catalog's prompt collections (/images/init's groups) with the styles' image suggestions
 * in place of the first group that holds a style, as the desktop app merges them; groups left
 * with no items go.
 */
export function catalogGroups(init: unknown, styles: unknown): PromptGroup[] {
  const groups = list(obj(init).groups).map(obj).filter((group) => group.kind == null || group.kind === "prompt_collection");
  const suggestions = list(obj(styles).image_suggestions);
  const ids = new Set(list(obj(styles).styles).map((style) => str(obj(style).id)).filter(Boolean));
  const replaced = suggestions.length ? groups.find((group) => list(group.items).some((item) => ids.has(str(obj(item).id)))) : undefined;
  return groups.flatMap((group, index) => {
    const items = list(group === replaced ? suggestions : group.items).flatMap((item) => parseItem(item, group.action));
    const presentation = group.presentation === "text_pill" || group.presentation === "icon_pill" ? group.presentation : "image_card";
    return items.length ? [{ id: str(group.id) || String(index), title: str(group.title), presentation, items }] : [];
  });
}

/** The catalog's tabs (oe): each section once, in `order` (trending for ""), the rest after in the server's order. */
export function catalogSections(groups: PromptGroup[], order: string[] = []): string[] {
  const at = (section: string) => {
    const index = order.indexOf(section || "trending");
    return index === -1 ? order.length : index;
  };
  return [...new Set(groups.flatMap((group) => group.items.map((item) => item.section)))].sort((a, b) => at(a) - at(b));
}

/** A tab's name (imagesApp.promptSections.tab.*). */
export const sectionLabel = (section: string) => (section === "Templates" ? "模板" : section || "热门");

let catalogRaw: { init?: unknown; styles?: unknown } = {};
let catalogRun = 0;

/**
 * /images/init and /images/styles (with its image suggestions), read anew; what each last
 * answered stays while the other fails. The page reads it again every five minutes, on focus and
 * back online, as the desktop app's queries refetch.
 */
export async function loadCatalog(): Promise<void> {
  const run = ++catalogRun;
  const [init, styles] = await Promise.allSettled([get("/images/init"), get(`/images/styles${query({ include_image_suggestions: true })}`)]);
  if (run !== catalogRun) return;
  if (init.status === "fulfilled") catalogRaw.init = init.value;
  if (styles.status === "fulfilled") catalogRaw.styles = styles.value;
  const failed = init.status === "rejected" || styles.status === "rejected";
  set({ catalog: { groups: "init" in catalogRaw ? catalogGroups(catalogRaw.init, catalogRaw.styles) : null, error: failed ? failure("init" in catalogRaw || "styles" in catalogRaw) : null } });
}

// The generated history (draft-state L)

function parseImage(raw: unknown): CloudImage[] {
  const item = obj(raw);
  const id = str(item.id);
  if (!id || item.is_archived === true) return [];
  const blocked = item.output_blocked === true;
  const fileId = fileOf(item.asset_pointer);
  return [{
    id,
    title: str(item.title),
    thumb: blocked ? "" : str(obj(obj(item.encodings).thumbnail).path ?? item.url),
    url: blocked ? "" : str(item.url),
    fileId,
    conversationId: str(item.conversation_id) || null,
    blocked,
    // ponytail: no account was probed, so these two names are a guess; without either, this machine's images lead (gallery).
    time: timeOf(item.created_at ?? item.create_time),
  }];
}

/** A ChatGPT image's tile picture as the page may show it now; "" for none. */
export const cloudThumb = (image: CloudImage) => imageSrc(image.thumb);

/** Its viewer picture: its file through the bridge (same origin, so the edit tools paint on it), else its address; "" for none. */
export const cloudSrc = (image: CloudImage) => (image.blocked ? "" : image.fileId ? cloudImageUrl(image.fileId) : imageSrc(image.url));

let historyRun = 0;
let historyLoad: Promise<boolean> | null = null;

/**
 * /my/recent/image_gen: the first page (25) anew, or the next one (20, after the last page's
 * cursor); archived images left out, each id once. A next page that fails keeps what was read, so
 * 重试 asks for that page alone. While a page is on its way, asking again waits for it. True once
 * a page came in.
 */
export function loadHistory(more = false): Promise<boolean> {
  const { cursor } = state.history;
  if (historyLoad) return historyLoad;
  if (more && !cursor) return Promise.resolve(false);
  const run = ++historyRun;
  set({ history: { ...state.history, loading: more ? "more" : "first", error: null } });
  const load = (async () => {
    try {
      const page = obj(await get(`/my/recent/image_gen${query(more ? { limit: 20, after: cursor ?? undefined } : { limit: 25 })}`));
      if (run !== historyRun) return false;
      const items = [...(more ? state.history.items ?? [] : []), ...list(page.items).flatMap(parseImage)];
      const seen = new Set<string>();
      set({ history: { items: items.filter((image) => !seen.has(image.id) && !!seen.add(image.id)), cursor: str(page.cursor) || null, loading: null, error: null } });
      return true;
    } catch {
      if (run === historyRun) set({ history: { ...state.history, loading: null, error: { kind: failure(state.history.items !== null), more } } });
      return false;
    } finally {
      if (run === historyRun) historyLoad = null;
    }
  })();
  historyLoad = load;
  return load;
}

let visited: string | null | undefined;

/**
 * The page's visit: the catalog and the history read anew (the desktop app's refetchOnMount);
 * another login's go first, and their pages on the way are dropped.
 */
export function visitImages(account: string | null): void {
  if (account !== visited) {
    visited = account;
    catalogRaw = {};
    catalogRun++;
    historyRun++;
    historyLoad = null;
    set({ catalog: EMPTY_CATALOG, history: EMPTY_HISTORY });
  }
  void loadCatalog();
  void loadHistory();
}

export type GalleryImage = (LocalImage & { kind: "local"; key: string }) | (CloudImage & { kind: "cloud"; key: string });

/**
 * 我的图像: this machine's images and ChatGPT's, newest first. While ChatGPT has more pages, only
 * this machine's images no older than its oldest one read so far show (and `keep`, the one the
 * viewer holds), so a page that comes in never lands above them; when ChatGPT's images carry no
 * time, this machine's lead.
 */
export function gallery(local: LocalImage[], cloud: CloudImage[], more: boolean, keep: string | null = null): GalleryImage[] {
  const mine = local.map((image) => ({ ...image, kind: "local" as const, key: image.path }));
  const theirs = cloud.map((image) => ({ ...image, kind: "cloud" as const, key: `cloud:${image.id}` }));
  if (!theirs.every((image) => image.time !== null)) return [...mine, ...theirs];
  const floor = more && theirs.length ? Math.min(...theirs.map((image) => image.time!)) : -Infinity;
  return [...mine.filter((image) => image.time >= floor || image.key === keep), ...theirs].sort((a, b) => b.time! - a.time!);
}

// The preview's photos (recent-uploads, the reference-images query)

/** A photo tile's addresses as ChatGPT gives them (photoSrc shows them). */
export interface RecentPhoto {
  fileId: string;
  url: string;
}

/** The latest photos uploaded in ChatGPT's Images (/my/recent/uploaded_images, 25, images_app_only). */
export async function loadUploads(): Promise<RecentPhoto[]> {
  const page = obj(await get(`/my/recent/uploaded_images${query({ limit: 25, images_app_only: true })}`));
  return list(page.items).map(obj).flatMap((item) => (str(item.file_id) ? [{ fileId: str(item.file_id), url: str(item.download_url) }] : []));
}

export interface SavedReference {
  id: string;
  /** 我 for the account's own (entity_type self). */
  name: string;
  self: boolean;
  fileId: string | null;
  /** Its thumbnail's address, and the file to read when there is none (photoSrc). */
  url: string;
  thumbFileId: string | null;
}

/**
 * A photo tile's picture as the page may show it now: its address, else its file through the
 * bridge (the desktop app's Ve takes fallbackUrl before the pointer); "" for neither.
 * ponytail: an address that fails does not go on to the file, as Ve does.
 */
export const photoSrc = (url: string, fileId: string | null = null) => imageSrc(url) || (fileId ? cloudImageUrl(fileId) : "");

/**
 * The saved references (/files/library/reference-images), every page of 50 by next_cursor until
 * none comes or one comes again; the account's own first.
 */
export async function loadReferences(): Promise<SavedReference[]> {
  const items: unknown[] = [];
  const seen = new Set<string>();
  for (let cursor: string | undefined; ;) {
    const page = obj(await get(`/files/library/reference-images${query({ cursor, limit: 50 })}`));
    items.push(...list(page.items));
    const next = str(page.next_cursor);
    if (!next || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }
  return items.map(obj).flatMap((item) => {
    const self = item.entity_type === "self";
    const thumbFileId = fileOf(item.thumbnail_asset_pointer ?? item.asset_pointer);
    return str(item.id) ? [{ id: str(item.id), name: self ? "我" : str(item.entity_name), self, fileId: fileOf(item.asset_pointer), url: str(item.thumbnail_url ?? item.content_url), thumbFileId }] : [];
  }).sort((a, b) => Number(b.self) - Number(a.self));
}
