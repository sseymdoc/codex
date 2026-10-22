// Claude's file menu (c856385e2 On → Q; an image's c26fb8b6b Re puts 复制图片 / 保存图片 first):
// 作为上下文附加, 复制 ▸ (绝对路径, 相对路径 inside the session folder, 文件名), then, while the
// file is there, 打开方式 ▸ (the editors installed; a reply's file link adds 文件面板 and 默认应用)
// and 在资源管理器中显示. Opened at the pointer by openFileMenu; mounted once by App, with the
// prompt Claude asks before a file opens in its default app.

import { Fragment, useEffect, useLayoutEffect, useState } from "react";
import { basename, relativePath } from "../lib/format";
import { fileExists, installedEditors, openIn, openWithDefaultApp, revealFile, type Editor } from "../lib/files";
import { toast } from "../lib/store";
import { appendComposerText } from "./Composer";
import { openFile, sessionFolder } from "./content";
import { Confirm } from "./Settings";
import { PointerMenu } from "./Sidebar";
import { MenuItem, MenuSep, Submenu } from "./ui";

export interface FileTarget {
  /** Absolute; an image with none (the lightbox's from a reply) offers only 复制图片 / 保存图片. */
  path?: string;
  line?: number;
  /** "transcript": a file link in a reply; "attachment": a file the reply sends. */
  surface: "attachment" | "transcript";
  /** An image's data URL, for 复制图片 / 保存图片. */
  image?: string;
}

type Menu = { target: FileTarget; at: { x: number; y: number } };

let show: ((menu: Menu | null) => void) | null = null;
let ask: ((path: string) => void) | null = null;
let shown = false;

export function openFileMenu(target: FileTarget, at: { x: number; y: number }): void {
  show?.({ target, at });
}

/**
 * Opens a file of the session's folder in its default app once the user allows it, as Claude's
 * main process asks each time (sessionOpenConsent: "Allow Claude to open this file?", Cancel first).
 */
export function askDefaultApp(path: string): void {
  ask?.(path);
}

/** A menu is up: a click outside only closes it (the lightbox keeps that click to itself). */
export const fileMenuShown = () => shown;

export function FileMenuHost() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [asking, setAsking] = useState<{ path: string; root: string } | null>(null);
  useLayoutEffect(() => {
    show = setMenu;
    ask = (path) => setAsking({ path, root: sessionFolder() });
    return () => {
      show = ask = null;
    };
  }, []);
  useLayoutEffect(() => {
    shown = !!menu;
  }, [menu]);
  const close = () => setMenu(null);
  return (
    <>
      {menu && (
        <PointerMenu key={`${menu.at.x},${menu.at.y}`} at={menu.at} onClose={close}>
          {menu.target.path === undefined ? <ImageItems src={menu.target.image ?? ""} name="" close={close} /> : <FileMenuItems target={{ ...menu.target, path: menu.target.path }} close={close} />}
        </PointerMenu>
      )}
      {asking && (
        <Confirm
          title="允许 Codex 打开此文件？"
          description={
            <>
              <code className="inline-code">{asking.path}</code>
              <br />
              这将使用默认应用打开该文件。
            </>
          }
          confirm="允许"
          onConfirm={() => openWithDefaultApp(asking.path, asking.root).then((ok) => ok || toast("warning", "无法使用默认应用打开此文件。"))}
          onClose={() => setAsking(null)}
        />
      )}
    </>
  );
}

const copied = (text: string) =>
  navigator.clipboard.writeText(text).then(
    () => toast("neutral", "已复制到剪贴板。"),
    () => toast("warning", "复制失败"),
  );

/** The page's CSP (connect-src 'self') refuses fetch() of a data: URL, so decode one here. */
async function imageBlob(src: string): Promise<Blob> {
  const data = /^data:([^;,]*)((?:;[^,]*)*),/.exec(src);
  if (!data) return (await fetch(src)).blob();
  const body = src.slice(data[0].length);
  if (!/;base64/i.test(data[2])) return new Blob([decodeURIComponent(body)], { type: data[1] });
  return new Blob([Uint8Array.from(atob(body), (char) => char.charCodeAt(0))], { type: data[1] });
}

/** c26fb8b6b Pe: the image as a PNG on the clipboard. */
async function copyImage(src: string): Promise<void> {
  let blob = await imageBlob(src);
  if (blob.type !== "image/png") {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("toBlob"))), "image/png"));
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

/** c26fb8b6b Ie: downloaded under its own name, or image-<time>.<type> for a name that is no file name. */
async function saveImage(src: string, name: string): Promise<void> {
  const blob = await imageBlob(src);
  const type = blob.type.split("/")[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg") || "png";
  const file = /^[^\\/:*?"<>|]+$/.test(name) ? name : `image-${Date.now()}.${type}`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = /\.[a-z0-9]+$/i.test(file) ? file : `${file}.${type}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function ImageItems({ src, name, close }: { src: string; name: string; close(): void }) {
  const act = (run: () => Promise<unknown>) => () => {
    close();
    void run();
  };
  return (
    <>
      <MenuItem label="复制图片" onClick={act(() => copyImage(src).then(() => toast("neutral", "图片已复制到剪贴板。"), () => toast("warning", "无法复制图片。")))} />
      <MenuItem label="保存图片" onClick={act(() => saveImage(src, name).catch(() => toast("warning", "无法保存图片。")))} />
    </>
  );
}

function FileMenuItems({ target, close }: { target: FileTarget & { path: string }; close(): void }) {
  const { path, line, surface, image } = target;
  const relative = relativePath(path, sessionFolder());
  const inside = relative !== path;
  const [there, setThere] = useState(false);
  const [editors, setEditors] = useState<Editor[]>([]);
  useEffect(() => {
    let live = true;
    void fileExists(path).then((found) => live && setThere(found));
    void installedEditors().then((found) => live && setEditors(found));
    return () => {
      live = false;
    };
  }, [path]);
  const act = (run: () => unknown) => () => {
    close();
    void run();
  };
  const opens = [
    ...editors.map((editor) => ({ label: editor.name, run: () => openIn(path, editor.id, line).then((ok) => ok || toast("warning", `无法在 ${editor.name} 中打开此内容。`)) })),
    ...(surface === "transcript"
      ? [
          { label: "文件面板", run: () => openFile(path, line) },
          ...(inside ? [{ label: "默认应用", run: () => askDefaultApp(path) }] : []),
        ]
      : []),
  ];
  return (
    <>
      {image && (
        <>
          <ImageItems src={image} name={basename(path)} close={close} />
          <MenuSep />
        </>
      )}
      <MenuItem
        label="作为上下文附加"
        onClick={act(() => {
          const mention = inside ? relative : path;
          appendComposerText(`${mention.includes(" ") ? `"${mention}"` : mention} `);
        })}
      />
      <Submenu label="复制" className="submenu-fit">
        <MenuItem label="绝对路径" onClick={act(() => copied(path))} />
        {inside && <MenuItem label="相对路径" onClick={act(() => copied(relative))} />}
        <MenuItem label="文件名" onClick={act(() => copied(basename(path)))} />
      </Submenu>
      {there && (
        <>
          <MenuSep />
          {opens.length > 0 && (
            <Submenu label="打开方式" className="submenu-fit">
              {opens.map((open, index) => (
                <Fragment key={open.label}>
                  {index > 0 && index === editors.length && <MenuSep />}
                  <MenuItem label={open.label} onClick={act(open.run)} />
                </Fragment>
              ))}
            </Submenu>
          )}
          <MenuItem label="在资源管理器中显示" onClick={act(() => revealFile(path).then((ok) => ok || toast("warning", "无法在所在文件夹中显示此文件。")))} />
        </>
      )}
    </>
  );
}
