// The files pane's tree (Claude 4.4212 c9bd7af9c: 显示文件树, "Filter, or ? to search in files"):
// the session folder's entries, folders first, each folder read when it opens (fs/readDirectory),
// .git left out. Typing filters by file name (fuzzyFileSearch); a leading ? searches the files'
// contents (files.ts searchFiles, rg) with 区分大小写, 全字匹配 and 使用正则表达式.

import { useEffect, useRef, useState } from "react";
import { call, errorMessage, readDirectory } from "../lib/codex";
import { searchFiles, type ContentHits } from "../lib/files";
import { joinPath, relativePath } from "../lib/format";
import { Button, Icon, Spinner, fileGlyph } from "./ui";

type Entry = { name: string; path: string; dir: boolean };
type Found = { kind: "names"; paths: string[] } | { kind: "contents"; files: ContentHits[]; truncated: boolean } | { kind: "error"; message: string };

const sorted = (entries: Entry[]) => entries.toSorted((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));

export function FileTree({ cwd, reveal, onOpen }: { cwd: string; reveal?: { path: string; nonce: number } | null; onOpen(path: string, line?: number): void }) {
  const [children, setChildren] = useState<Map<string, Entry[] | "error">>(new Map());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [options, setOptions] = useState({ caseSensitive: false, wholeWord: false, regex: false });
  const [found, setFound] = useState<Found | null>(null);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  const read = (dir: string) =>
    void readDirectory(dir).then(
      (entries) => setChildren((map) => new Map(map).set(dir, sorted(entries.filter((e) => e.fileName !== ".git").map((e) => ({ name: e.fileName, path: joinPath(dir, e.fileName), dir: e.isDirectory }))))),
      () => setChildren((map) => new Map(map).set(dir, "error")),
    );
  useEffect(() => {
    setChildren(new Map());
    setOpen(new Set());
    read(cwd);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new folder starts over
  }, [cwd]);

  // 在文件树中显示: every folder between the session's and the file's opens.
  useEffect(() => {
    if (!reveal) return;
    const rel = relativePath(reveal.path, cwd);
    if (rel === reveal.path) return;
    const parts = rel.split(/[\\/]/).slice(0, -1);
    // Joined one step at a time, as the tree's own keys are (joinPath keeps a Windows folder's separator).
    const dirs = parts.reduce<string[]>((list, part) => [...list, joinPath(list.at(-1) ?? cwd, part)], []);
    setFilter("");
    setOpen((current) => new Set([...current, ...dirs]));
    for (const dir of dirs) if (!children.has(dir)) read(dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the nonce asks again
  }, [reveal?.nonce]);

  const contents = filter.startsWith("?");
  const query = contents ? filter.slice(1).trim() : filter.trim();
  useEffect(() => {
    if (!query) return void setFound(null);
    const mine = ++seq.current;
    setSearching(true);
    const timer = setTimeout(() => {
      const done = (next: Found) => mine === seq.current && (setFound(next), setSearching(false));
      if (contents)
        searchFiles(cwd, query, options).then((result) => done({ kind: "contents", ...result }), (error) => done({ kind: "error", message: errorMessage(error) }));
      else
        call("fuzzyFileSearch", { query, roots: [cwd], cancellationToken: "file-tree" }).then(
          (result) => done({ kind: "names", paths: result.files.filter((file) => file.match_type !== "directory").slice(0, 200).map((file) => joinPath(file.root, file.path)) }),
          (error) => done({ kind: "error", message: errorMessage(error) }),
        );
    }, 200);
    return () => clearTimeout(timer);
  }, [cwd, query, contents, options]);

  const toggle = (dir: string) => {
    const next = new Set(open);
    if (next.has(dir)) next.delete(dir);
    else {
      next.add(dir);
      // Read again on every opening: files made since (by Codex, say) show up.
      read(dir);
    }
    setOpen(next);
  };

  const rows = (dir: string, depth: number): React.ReactNode => {
    const list = children.get(dir);
    if (list === undefined) return <div className="file-tree-note" style={{ paddingInlineStart: 8 + depth * 12 }}><Spinner size={12} /></div>;
    if (list === "error") return <div className="file-tree-note" style={{ paddingInlineStart: 8 + depth * 12 }}>无法读取此文件夹</div>;
    return list.map((entry) => (
      <div key={entry.path} role="none">
        <button
          type="button"
          className="file-tree-row"
          style={{ paddingInlineStart: 6 + depth * 12 }}
          aria-expanded={entry.dir ? open.has(entry.path) : undefined}
          title={relativePath(entry.path, cwd)}
          onClick={() => (entry.dir ? toggle(entry.path) : onOpen(entry.path))}
        >
          {entry.dir ? <Icon name="CaretRight" size="xs" className="file-tree-caret" /> : <span className="file-tree-caret" />}
          <Icon name={entry.dir ? "Folder" : fileGlyph(entry.name)} size="xs" />
          <span className="file-tree-name">{entry.name}</span>
        </button>
        {entry.dir && open.has(entry.path) && rows(entry.path, depth + 1)}
      </div>
    ));
  };

  const optionKey = (key: keyof typeof options, label: string, icon: string) => (
    <Button variant="ghost" size="xs" label={label} tipSide="bottom" active={options[key]} aria-pressed={options[key]} icon={<span className="file-tree-option">{icon}</span>} onClick={() => setOptions({ ...options, [key]: !options[key] })} />
  );

  return (
    <div className="file-tree">
      <div className="file-tree-filter">
        <input
          className="input"
          value={filter}
          placeholder="筛选，或输入 ? 搜索文件内容"
          aria-label="筛选文件"
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && filter && (event.stopPropagation(), setFilter(""))}
        />
        {contents && (
          <div className="file-tree-options">
            {optionKey("caseSensitive", "区分大小写", "Aa")}
            {optionKey("wholeWord", "全字匹配", "ab")}
            {optionKey("regex", "使用正则表达式", ".*")}
          </div>
        )}
      </div>
      <div className="file-tree-body scroll-fade-y" role="tree" aria-label="文件">
        {!query ? (
          contents ? <div className="file-tree-note">在 ? 后输入内容以搜索文件</div> : rows(cwd, 0)
        ) : searching && !found ? (
          <div className="file-tree-note"><Spinner size={12} /></div>
        ) : found?.kind === "error" ? (
          <div className="file-tree-note" role="alert">{found.message}</div>
        ) : found?.kind === "names" ? (
          found.paths.length ? found.paths.map((path) => (
            <button key={path} type="button" className="file-tree-row" title={path} onClick={() => onOpen(path)}>
              <Icon name={fileGlyph(path)} size="xs" />
              <span className="file-tree-name">{relativePath(path, cwd)}</span>
            </button>
          )) : <div className="file-tree-note">没有匹配的文件</div>
        ) : found?.kind === "contents" ? (
          found.files.length ? (
            <>
              {found.files.map((file) => (
                <div key={file.path} className="file-tree-hits">
                  <button type="button" className="file-tree-row" title={file.path} onClick={() => onOpen(joinPath(cwd, file.path))}>
                    <Icon name={fileGlyph(file.path)} size="xs" />
                    <span className="file-tree-name">{file.path}</span>
                  </button>
                  {file.matches.map((match) => (
                    <button key={match.line} type="button" className="file-tree-hit" onClick={() => onOpen(joinPath(cwd, file.path), match.line)}>
                      <span className="file-tree-ln">{match.line}</span>
                      <span className="file-tree-text">{match.text.trim()}</span>
                    </button>
                  ))}
                  {file.more && <div className="file-tree-note">此文件中还有更多匹配项。</div>}
                </div>
              ))}
              {found.truncated && <div className="file-tree-note">仅显示 200 个匹配项。请继续输入以缩小范围。</div>}
            </>
          ) : <div className="file-tree-note">文件内容中没有匹配项</div>
        ) : null}
      </div>
    </div>
  );
}
