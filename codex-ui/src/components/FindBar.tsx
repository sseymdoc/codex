// The desktop find bar (W15; Claude Desktop find_in_page, FindInPage-CfNQSgeo.js): 320 × 40 in
// the Code tab, 12px in from the window's right edge and max(58, title bar − 12) + 12 from its
// top, unscaled by the page zoom (shell.css). It searches the open session on the server
// (thread/searchOccurrences), so history that is not loaded yet counts too; the transcript
// scrolls to and highlights the active hit from the `codex:find` event.

import { useEffect, useRef, useState } from "react";
import { findInThread, revealTurn, type ThreadSearchOccurrence } from "../lib/codex";
import { MAC } from "../lib/shortcut";
import { useStore } from "../lib/store";
import { Icon } from "./ui";

// lzaSYO3Q PHr(): three Latin characters, or any CJK one, before searching.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const searchable = (term: string) => term.length > 2 || CJK.test(term);

/** `codex:find` detail: the hit to scroll to and highlight, or null to clear. */
export interface FindHit {
  threadId: string;
  term: string;
  turnId: string;
  itemId: string;
}

function announce(hit: FindHit | null) {
  window.dispatchEvent(new CustomEvent<FindHit | null>("codex:find", { detail: hit }));
}

// The mounted bar's handler for the app menu's 查找… (0), 查找下一个 (1) and 查找上一个 (-1).
let command: ((step: 0 | 1 | -1) => void) | undefined;

/** The app menu (App.tsx): open the bar or select its text (0), or step through the hits, opening it first. */
export function findCommand(step: 0 | 1 | -1): void {
  command?.(step);
}

/** {label}（{shortcut}） (zh-Hans pU6Pzn7NcO): the buttons' native tooltip. */
const hint = (label: string, shortcut: string) => `${label}（${shortcut}）`;

export function FindBar() {
  const threadId = useStore((s) => s.activeId);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<ThreadSearchOccurrence[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const query = term.trim();

  // Debounced 250ms (find_in_page); a new session or query starts again from the first hit.
  useEffect(() => {
    setHits([]);
    setNext(null);
    setIndex(0);
    setDone(false);
    if (!open || !threadId || !searchable(query)) return;
    let live = true;
    const timer = setTimeout(() => {
      findInThread(threadId, query)
        .then((page) => {
          if (!live) return;
          setHits(page.hits);
          setNext(page.next);
          setDone(true);
        })
        .catch(() => live && setDone(true));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, threadId, query]);

  // Bring the active hit's turn in (older history pages in on demand), then let the transcript show it.
  useEffect(() => {
    const hit = hits[index];
    if (!open || !threadId || !hit) return announce(null);
    let live = true;
    void revealTurn(threadId, hit.turnId).then(() => live && announce({ threadId, term: query, turnId: hit.turnId, itemId: hit.itemId }));
    return () => {
      live = false;
    };
  }, [open, threadId, hits, index, query]);

  const show = () => {
    setOpen(true);
    requestAnimationFrame(() => input.current?.select());
  };
  // The query empties 100ms after closing, so the next find starts blank (FindInPage p2).
  const close = () => {
    announce(null);
    setOpen(false);
    setTimeout(() => setTerm(""), 100);
  };
  const go = async (step: number) => {
    if (!hits.length || !threadId) return;
    if (step > 0 && index === hits.length - 1 && next) {
      const page = await findInThread(threadId, query, next).catch(() => null);
      if (page?.hits.length) {
        setHits((current) => [...current, ...page.hits]);
        setNext(page.next);
        setIndex(index + 1);
        return;
      }
    }
    setIndex((index + step + hits.length) % hits.length);
  };

  // Keys anywhere in the window, ahead of the page's own (lzaSYO3Q kwi / Nwi / PUr): Ctrl+F opens
  // the bar or selects its text, F3 / Ctrl+G and Shift+F3 / Ctrl+Shift+G step (opening it first),
  // and while it is open a bare Esc closes it. A Mac uses ⌘ for Ctrl.
  useEffect(() => {
    command = (step) => (open && step ? void go(step) : show());
    const onKey = (event: KeyboardEvent) => {
      const [primary, other] = MAC ? [event.metaKey, event.ctrlKey] : [event.ctrlKey, event.metaKey];
      if (event.isComposing || event.altKey || other) return;
      const key = event.key.toLowerCase();
      let step: 0 | 1 | -1;
      if (primary && !event.shiftKey && key === "f") step = 0;
      else if ((!primary && key === "f3") || (primary && key === "g")) step = event.shiftKey ? -1 : 1;
      else if (open && !primary && !event.shiftKey && key === "escape" && !event.repeat) {
        event.preventDefault();
        event.stopPropagation();
        return close();
      } else return;
      event.preventDefault();
      event.stopPropagation();
      command?.(step);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      command = undefined;
      window.removeEventListener("keydown", onKey, true);
    };
  });

  if (!open) return null;

  const count = hits.length ? `${index + 1}/${hits.length}${next ? "+" : ""}` : done ? "0/0" : "";
  return (
    <div
      className="find-bar"
      role="search"
      // A click anywhere but the buttons puts the caret in the field (FindInPage clickToFocusProps).
      onMouseDown={(event) => {
        if ((event.target as Element).closest("button, input")) return;
        event.preventDefault();
        input.current?.focus();
      }}
    >
      <div className="find-field">
        <input
          ref={input}
          autoFocus
          value={term}
          placeholder="在页面中查找"
          aria-label="在页面中查找"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void go(event.shiftKey ? -1 : 1);
          }}
        />
        <span className="find-count tabular" role="status">
          {count}
        </span>
      </div>
      <span className="find-sep" aria-hidden="true" />
      <div className="find-actions">
        <button type="button" className="find-btn" disabled={!hits.length} onClick={() => void go(-1)} aria-label="上一个匹配项" title={hint("上一个匹配项", "Shift+F3")}>
          <Icon name="ArrowUp" size={16} />
        </button>
        <button type="button" className="find-btn" disabled={!hits.length} onClick={() => void go(1)} aria-label="下一个匹配项" title={hint("下一个匹配项", "F3")}>
          <Icon name="ArrowDown" size={16} />
        </button>
        <button type="button" className="find-btn" onClick={close} aria-label="关闭查找栏" title={hint("关闭查找栏", "Esc")}>
          <Icon name="X" size={16} />
        </button>
      </div>
    </div>
  );
}
