// The desktop find bar (W15; Claude Desktop find_in_page: 320 × 40 in the Code tab, 12px in
// from the window's right edge, 58 + 12px from its top). It searches the open session on
// the server (thread/searchOccurrences), so history that is not loaded yet counts too; the
// transcript scrolls to and highlights the active hit from the `codex:find` event.

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { findInThread, revealTurn, type ThreadSearchOccurrence } from "../lib/codex";
import { useStore } from "../lib/store";

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

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => input.current?.select());
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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

  if (!open) return null;

  const close = () => {
    announce(null);
    setOpen(false);
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
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if ((event.key === "Enter" && event.target === input.current) || event.key === "F3") {
      event.preventDefault();
      void go(event.shiftKey ? -1 : 1);
    }
  };
  const count = hits.length ? `${index + 1}/${hits.length}${next ? "+" : ""}` : done ? "0/0" : "";

  return (
    <div className="find-bar" role="search" aria-label="在会话中查找" onKeyDown={onKeyDown}>
      <input
        ref={input}
        autoFocus
        value={term}
        placeholder="在会话中查找"
        aria-label="在会话中查找"
        onChange={(event) => setTerm(event.target.value)}
      />
      <span className="find-count tabular" aria-live="polite">
        {count}
      </span>
      <span className="find-sep" aria-hidden="true" />
      <button type="button" className="find-btn" disabled={!hits.length} onClick={() => void go(-1)} data-tip="上一个匹配" data-tip-kbd="Shift+F3" aria-label="上一个匹配">
        <ChevronUp size={14} />
      </button>
      <button type="button" className="find-btn" disabled={!hits.length} onClick={() => void go(1)} data-tip="下一个匹配" data-tip-kbd="F3" aria-label="下一个匹配">
        <ChevronDown size={14} />
      </button>
      <button type="button" className="find-btn" onClick={close} data-tip="关闭查找栏" data-tip-kbd="Esc" aria-label="关闭查找栏">
        <X size={14} />
      </button>
    </div>
  );
}
