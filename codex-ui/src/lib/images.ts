// The 图像 page (the Codex desktop app 26.1023's /images, sidebarElectron.imagesRouteNavLink): its
// sidebar entry, the page's draft, the images generated on this machine, and how a prompt becomes
// an image. ChatGPT's own path (/f/conversation behind Sentinel) is not taken: every send starts a
// local Codex session that runs the imagegen skill and opens it, as the desktop app's own panel
// for local images sends [image, mask] and text into a Codex session. Strings are the desktop
// app's zh-CN ones (images.*, imageSidePanel.*, composer.imageComments.*).
import { useEffect, useSyncExternalStore } from "react";
import type { FsGetMetadataResponse } from "@protocol/v2/FsGetMetadataResponse";
import type { Model } from "@protocol/v2/Model";
import type { UserInput } from "@protocol/v2/UserInput";
import { call, errorMessage, listSkills, openThread, readDirectory, sendMessage, startThread } from "./codex";
import { joinPath } from "./format";
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
}

interface ImagesState {
  /** The sidebar's 图像 row: true shown, null hidden, undefined not yet known (useImagesEntry). */
  entry: true | null | undefined;
  /** This machine's generated images, newest first; null until listed. */
  local: LocalImage[] | null;
  localError: string | null;
  draft: { text: string; images: DraftImage[] };
}

const EMPTY_DRAFT: ImagesState["draft"] = { text: "", images: [] };
let state: ImagesState = { entry: undefined, local: null, localError: null, draft: EMPTY_DRAFT };
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
 * The desktop app's `d` (b && d && f && !r): a ChatGPT login with in_app_chat not switched off.
 * ponytail: no workspace permission or free holdout check yet (statsig and account settings),
 * so those accounts see the entry too until the server side reads them.
 */
export function imagesEntryOn(s: AppState): boolean {
  return s.account?.account?.type === "chatgpt" && !featureOff(s, "in_app_chat");
}

/**
 * The sidebar's 图像 row (only the sidebar calls this): decided on a ready connection and held
 * while it reconnects, so an open page does not leave meanwhile. The page reads `entry` and goes
 * to the new-session page once it is null.
 */
export function useImagesEntry(): boolean {
  const ready = useStore((s) => s.conn.status === "ready");
  const on = useStore(imagesEntryOn);
  useEffect(() => {
    if (ready) set({ entry: on || null });
  }, [ready, on]);
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

/** The composer's 发送: the draft's images and `text`; the draft clears once a session has it. */
export async function sendDraft(text: string): Promise<void> {
  await imagesSend(text, state.draft.images.map((image) => ({ type: "image", url: image.url })));
  set({ draft: EMPTY_DRAFT });
}

export const setDraftText = (text: string) => set({ draft: { ...state.draft, text } });

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
