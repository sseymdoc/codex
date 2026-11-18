// Comments on the plan pane's text (Claude Desktop 3.6556 cccc2cf0a Ob / kb / Db, c96d752d0 Tot over
// c82eca2bd ke): select some of the plan and leave a comment in the floating box under it; commented
// text stays underlined, a click opens its comment to edit or delete. The plan card's 修订 sends them
// (Approvals.tsx PlanApproval).

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { anchor, flatText, markSpans, overlaps, rangeOffsets, textNodes, unmark } from "../lib/planComments";
import { planComments, useStore, type PlanComment } from "../lib/store";
import { Markdown } from "./content";
import { Icon } from "./ui";

const NONE: readonly PlanComment[] = [];

type Pop =
  | { mode: "idle" }
  | { mode: "selection"; range: Range; text: string; start: number; end: number }
  | { mode: "editing"; range: Range; comment: PlanComment };

/**
 * The plan's Markdown with its comments (cccc2cf0a zb / Ob). Comments can be added while the plan
 * waits on the card or the session is in plan mode (Gb); existing ones stay clickable either way.
 */
export function PlanDoc({ threadId, text, enabled, boundary }: { threadId: string; text: string; enabled: boolean; boundary: RefObject<HTMLElement | null> }) {
  const comments = useStore((s) => s.planComments[threadId] ?? NONE);
  const body = useRef<HTMLDivElement>(null);
  const [pop, setPop] = useState<Pop>({ mode: "idle" });
  const [hovered, setHovered] = useState<string | null>(null);
  const draft = useRef({ opened: "", current: "" });
  const latest = useRef({ pop, comments, enabled });
  latest.current = { pop, comments, enabled };
  const clicked = useRef<HTMLElement | null>(null);

  // bb: the marks follow the text and the comments; the Markdown's own HTML is left as rendered.
  useLayoutEffect(() => {
    const root = body.current;
    if (!root) return;
    unmark(root);
    markSpans(root, anchor(flatText(textNodes(root)), comments));
    for (const mark of root.querySelectorAll<HTMLElement>("mark[data-plan-comment-id]")) {
      mark.tabIndex = 0;
      mark.setAttribute("role", "button");
    }
  }, [text, comments]);
  useLayoutEffect(() => {
    for (const mark of body.current?.querySelectorAll<HTMLElement>("mark[data-plan-comment-id]") ?? []) mark.toggleAttribute("data-hovered", mark.dataset.planCommentId === hovered);
  }, [hovered, text, comments]);

  const dismiss = () => {
    setPop({ mode: "idle" });
    window.getSelection()?.removeAllRanges();
  };
  // Back in idle, focus goes back to the mark that was opened (Ob j).
  useEffect(() => {
    if (pop.mode !== "idle") return;
    const mark = clicked.current;
    clicked.current = null;
    if (mark?.isConnected && document.activeElement === document.body) mark.focus();
  }, [pop.mode]);
  useEffect(() => {
    draft.current = pop.mode === "editing" ? { opened: pop.comment.comment, current: pop.comment.comment } : { opened: "", current: "" };
  }, [pop]);
  // The plan rewritten under an open box: its range is gone, and so is the box.
  useEffect(() => {
    if (latest.current.pop.mode !== "idle") setPop({ mode: "idle" });
  }, [text]);

  // Ob L: a mouse selection inside the plan opens the box, after a double click's word settles.
  useEffect(() => {
    let pressed = false;
    let changed = false;
    let timer = 0;
    const check = () => {
      const root = body.current;
      const { pop: open, comments: all, enabled: on } = latest.current;
      if (!root || !on || (open.mode !== "idle" && draft.current.current !== draft.current.opened)) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      let range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) {
        if (!root.contains(selection.anchorNode)) return;
        range = range.cloneRange();
        if (!root.contains(range.startContainer)) range.setStart(root, 0);
        if (!root.contains(range.endContainer)) range.setEnd(root, root.childNodes.length);
      }
      const at = rangeOffsets(root, range);
      if (!at || !at.selectedText.trim() || overlaps(all, at.start, at.end)) return;
      setPop({ mode: "selection", range: range.cloneRange(), text: at.selectedText, start: at.start, end: at.end });
    };
    const down = (event: MouseEvent) => {
      clearTimeout(timer);
      pressed = !!(event.target instanceof Node && (boundary.current ?? body.current)?.contains(event.target));
      changed = false;
    };
    const change = () => {
      changed = true;
    };
    const up = (event: MouseEvent) => {
      clearTimeout(timer);
      if (!pressed || !changed) return;
      if (event.detail >= 2) timer = window.setTimeout(check, 250);
      else check();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("selectionchange", change);
    document.addEventListener("mouseup", up);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", down);
      document.removeEventListener("selectionchange", change);
      document.removeEventListener("mouseup", up);
    };
  }, [boundary]);

  // Ob U: a mark opens its comment.
  const openMark = (mark: HTMLElement) => {
    const comment = comments.find((entry) => entry.id === mark.dataset.planCommentId);
    if (!comment) return;
    window.getSelection()?.removeAllRanges();
    clicked.current = mark;
    const range = document.createRange();
    range.selectNodeContents(mark);
    setPop({ mode: "editing", range, comment });
  };
  const markOf = (target: EventTarget) => (target instanceof Element ? target.closest<HTMLElement>("mark[data-plan-comment-id]") : null);
  const submit = (value: string) => {
    if (pop.mode === "selection") planComments.add(threadId, { selectedText: pop.text, startOffset: pop.start, endOffset: pop.end, comment: value });
    else if (pop.mode === "editing") planComments.update(threadId, pop.comment.id, value);
    dismiss();
  };

  return (
    <>
      {/* cccc2cf0a kb: what selecting does here, over the plan. */}
      <div className="plan-comment-hint">
        <Icon name="ChatSimple" size="xs" />
        <span>{enabled ? "选中任意文本，为 Codex 留下评论" : "您可以在计划模式下，或在 Codex 请您批准计划时，对计划进行评论。"}</span>
      </div>
      <div
        ref={body}
        className="plan-doc-body"
        onClick={(event) => {
          const mark = markOf(event.target);
          if (!mark) return;
          event.stopPropagation();
          openMark(mark);
        }}
        onKeyDown={(event) => {
          const mark = markOf(event.target);
          if (!mark || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          event.stopPropagation();
          openMark(mark);
        }}
        onMouseOver={(event) => setHovered(markOf(event.target)?.dataset.planCommentId ?? null)}
        onMouseLeave={() => setHovered(null)}
      >
        <Markdown text={text} className="plan-doc" />
      </div>
      {pop.mode !== "idle" && (
        <CommentBox
          key={pop.mode === "editing" ? pop.comment.id : `selection:${pop.start}:${pop.end}`}
          range={pop.range}
          initial={pop.mode === "editing" ? pop.comment.comment : ""}
          boundary={boundary}
          onChange={(value) => {
            draft.current.current = value;
          }}
          onSubmit={submit}
          onDelete={
            pop.mode === "editing"
              ? () => {
                  planComments.remove(threadId, pop.comment.id);
                  dismiss();
                }
              : undefined
          }
          onDismiss={dismiss}
        />
      )}
    </>
  );
}

const GAP = 8;

/**
 * c96d752d0 Tot with c82eca2bd ke (floating): a 320px box under the selection (over it when there
 * is no room), held inside the pane. Enter saves, Shift+Enter breaks the line, Esc closes, and so
 * does a press outside while nothing new was typed. While it is open the selection stays painted.
 */
function CommentBox({
  range,
  initial,
  boundary,
  onChange,
  onSubmit,
  onDelete,
  onDismiss,
}: {
  range: Range;
  initial: string;
  boundary: RefObject<HTMLElement | null>;
  onChange(value: string): void;
  onSubmit(value: string): void;
  onDelete?: () => void;
  onDismiss(): void;
}) {
  const [value, setValue] = useState(initial);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const side = useRef<"below" | "above" | null>(null);
  const latest = useRef({ value, onDismiss });
  latest.current = { value, onDismiss };

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // A new comment's selection (only an existing one can be deleted) stays painted while the focus is in the box.
  const editing = !!onDelete;
  useEffect(() => {
    const highlights = (CSS as { highlights?: Map<string, unknown> }).highlights;
    const Paint = (window as { Highlight?: new (range: Range) => unknown }).Highlight;
    if (editing || !highlights || !Paint) return;
    highlights.set("plan-selection", new Paint(range));
    return () => void highlights.delete("plan-selection");
  }, [range, editing]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    let frame = 0;
    const place = () => {
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 || rect.height > 0);
      const area = boundary.current?.getBoundingClientRect();
      const top = Math.max(0, area?.top ?? 0);
      const bottom = Math.min(window.innerHeight, area?.bottom ?? window.innerHeight);
      const left = Math.max(0, area?.left ?? 0);
      const right = Math.min(window.innerWidth, area?.right ?? window.innerWidth);
      const { width, height } = el.getBoundingClientRect();
      const half = width / 2 + GAP;
      const x = (at: number) => Math.round(right - left >= 2 * half ? Math.min(Math.max(at, left + half), right - half) : (left + right) / 2);
      const y = (at: number) => Math.round(Math.min(Math.max(at, top + GAP), Math.max(top + GAP, bottom - height - GAP)));
      if (!rects.length) return;
      const first = rects[0];
      const last = rects[rects.length - 1];
      if (!side.current) side.current = last.bottom + GAP + height <= bottom || first.top - GAP - height < top ? "below" : "above";
      const anchorRect = side.current === "above" ? first : last;
      const at = side.current === "above" ? anchorRect.top - GAP - height : anchorRect.bottom + GAP;
      el.style.transform = `translate(${x(anchorRect.left + anchorRect.width / 2)}px, ${y(at)}px) translateX(-50%)`;
    };
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    place();
    const resize = new ResizeObserver(soon);
    resize.observe(el);
    document.addEventListener("scroll", soon, { capture: true, passive: true });
    window.addEventListener("resize", soon);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      document.removeEventListener("scroll", soon, { capture: true });
      window.removeEventListener("resize", soon);
    };
  }, [range, boundary]);

  // Tot Be: a press outside closes it while nothing new is typed; Esc closes; Tab stays inside.
  useEffect(() => {
    const press = (event: PointerEvent) => {
      const { value: typed, onDismiss: dismiss } = latest.current;
      if (event.button === 0 && box.current && !box.current.contains(event.target as Node) && (!typed.trim() || typed === initial)) dismiss();
    };
    const key = (event: KeyboardEvent) => {
      const el = box.current;
      if (!el?.contains(event.target as Node)) return;
      if (event.isComposing || event.keyCode === 229) {
        if (event.key === "Escape") event.stopPropagation();
        return;
      }
      if (event.key === "Tab") {
        const stops = [...el.querySelectorAll<HTMLElement>("textarea, button:not([disabled])")];
        if (!stops.length) return;
        event.preventDefault();
        const at = stops.indexOf(event.target as HTMLElement);
        stops[event.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at + 1) % stops.length].focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        latest.current.onDismiss();
      }
    };
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [initial]);

  const save = () => {
    const text = value.trim();
    if (text) onSubmit(text);
  };
  return createPortal(
    <div ref={box} role="dialog" tabIndex={-1} aria-label="评论所选内容" className="popover plan-comment-box">
      <div className="plan-comment-row">
        <textarea
          ref={input}
          className="plan-comment-input"
          value={value}
          rows={1}
          aria-label="计划备注"
          placeholder="添加评论"
          onChange={(event) => {
            setValue(event.target.value);
            onChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.key !== "Enter" || event.shiftKey || event.altKey) return;
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) save();
          }}
        />
        <div className="plan-comment-actions">
          {onDelete && (
            <button type="button" className="plan-comment-key plan-comment-delete" aria-label="删除评论" title="删除评论" onClick={onDelete}>
              <Icon name="Trash" size={14} />
            </button>
          )}
          <button type="button" className="plan-comment-key" aria-label="保存评论" title="保存评论" disabled={!value.trim()} onClick={save}>
            <Icon name="ChatAdd" size="sm" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
