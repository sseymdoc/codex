// Comments on the plan pane's text, anchored as Claude Desktop 3.6556 anchors them (cccc2cf0a xb, bb,
// Sb: offsets into the rendered text, code blocks left out) and sent with the plan card's 修订
// (cc32965c2 As).

/** c4d199b75 S: the line breaks a quoted selection splits on (CR LF, CR, LF, LS, PS). */
const LINES = new RegExp(`\r\n?|[\n${String.fromCharCode(0x2028, 0x2029)}]`);

export interface Anchored {
  startOffset: number;
  endOffset: number;
  selectedText: string;
  comment: string;
}

/** cc32965c2 As: each comment under its quoted text, in text order, then the feedback after two blank lines. */
export function feedbackText(comments: readonly Anchored[], feedback: string): string {
  const text = feedback.trim();
  if (!comments.length) return text;
  const quoted = comments
    .toSorted((a, b) => a.startOffset - b.startOffset)
    .map((c) => `On selected text:\n${c.selectedText.split(LINES).map((line) => `> ${line}`).join("\n")}\n${c.comment}`);
  return text ? `${quoted.join("\n\n")}\n\n\n${text}` : quoted.join("\n\n");
}

/** cccc2cf0a Sb: the occurrence of `text` nearest `near`; -1 when there is none. */
export function nearest(flat: string, text: string, near: number): number {
  if (!text) return -1;
  let best = -1;
  for (let at = flat.indexOf(text); at !== -1; at = flat.indexOf(text, at + 1)) if (best === -1 || Math.abs(at - near) < Math.abs(best - near)) best = at;
  return best;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * cccc2cf0a bb: where each comment's text is now. Its offsets while they still hold its text,
 * else the nearest place the text appears; a comment whose text is gone is left out.
 */
export function anchor<T extends Anchored & { id: string }>(flat: string, comments: readonly T[]): { id: string; start: number; end: number }[] {
  return comments.flatMap((c) => {
    if (squash(flat.slice(c.startOffset, c.endOffset)) === squash(c.selectedText)) return [{ id: c.id, start: c.startOffset, end: c.endOffset }];
    const at = nearest(flat, c.selectedText, c.startOffset);
    return at === -1 ? [] : [{ id: c.id, start: at, end: at + c.selectedText.length }];
  });
}

/** Whether a span overlaps a comment already there (cc32965c2 ks). */
export const overlaps = (comments: readonly Anchored[], start: number, end: number): boolean => comments.some((c) => start < c.endOffset && c.startOffset < end);

// ---------------------------------------------------------------------------
// The DOM side: the plan's rendered Markdown.

/** Text outside the plan's own words: code blocks (cccc2cf0a data-plan-comment-skip on pre), buttons, hidden text. */
const SKIP = "pre, button, [aria-hidden='true'], .sr-only";

/** cccc2cf0a xb's walker: the plan's text nodes in order, each with where it starts in the text. */
export function textNodes(root: Node): { node: Text; start: number }[] {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: { node: Text; start: number }[] = [];
  let at = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    nodes.push({ node, start: at });
    at += node.data.length;
  }
  return nodes;
}

export const flatText = (nodes: { node: Text }[]): string => nodes.map(({ node }) => node.data).join("");

/**
 * cccc2cf0a xb: a selection as offsets into the plan's text, and the text between them (a boundary
 * in skipped text moves to the next text that counts); null when it holds none.
 */
export function rangeOffsets(root: Node, range: Range): { start: number; end: number; selectedText: string } | null {
  const nodes = textNodes(root);
  const total = nodes.reduce((sum, { node }) => sum + node.data.length, 0);
  const offset = (container: Node, at: number) => {
    const own = nodes.find(({ node }) => node === container);
    if (own) return own.start + at;
    const point = (root.ownerDocument ?? (root as Document)).createRange();
    point.setEnd(container, at);
    point.collapse(false);
    return nodes.find(({ node }) => point.comparePoint(node, 0) >= 0)?.start ?? total;
  };
  const start = offset(range.startContainer, range.startOffset);
  const end = offset(range.endContainer, range.endOffset);
  if (end <= start) return null;
  let selectedText = "";
  for (const { node, start: from } of nodes) {
    const a = Math.max(0, start - from);
    const b = Math.min(node.data.length, end - from);
    if (b > a) selectedText += node.data.slice(a, b);
  }
  return { start, end, selectedText };
}

/** Table structure keeps its whitespace nodes unwrapped (cccc2cf0a gb). */
const TABLE = new Set(["TABLE", "THEAD", "TBODY", "TFOOT", "TR"]);

/** Takes the marks out again, so the text is as rendered. */
export function unmark(root: Element): void {
  for (const mark of root.querySelectorAll("mark[data-plan-comment-id]")) mark.replaceWith(...mark.childNodes);
  root.normalize();
}

/** cccc2cf0a bb on the DOM: each span's text wrapped in <mark data-plan-comment-id>; marks never nest. */
export function markSpans(root: Element, spans: readonly { id: string; start: number; end: number }[]): void {
  if (!spans.length) return;
  const doc = root.ownerDocument;
  for (const { node, start } of textNodes(root).reverse()) {
    const end = start + node.data.length;
    if (node.parentElement && TABLE.has(node.parentElement.tagName) && !node.data.trim()) continue;
    const hits = spans.filter((span) => span.start < end && span.end > start).toSorted((a, b) => a.start - b.start);
    if (!hits.length) continue;
    const pieces: Node[] = [];
    let done = 0;
    for (const span of hits) {
      const a = Math.max(0, span.start - start);
      const b = Math.min(node.data.length, span.end - start);
      if (a < done || b <= a) continue;
      if (a > done) pieces.push(doc.createTextNode(node.data.slice(done, a)));
      const mark = doc.createElement("mark");
      mark.dataset.planCommentId = span.id;
      mark.textContent = node.data.slice(a, b);
      pieces.push(mark);
      done = b;
    }
    if (!done) continue;
    if (done < node.data.length) pieces.push(doc.createTextNode(node.data.slice(done)));
    node.replaceWith(...pieces);
  }
}
