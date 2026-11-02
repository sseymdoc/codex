// 突出显示更改的字词 drawn over the highlighted code without touching its markup: each code span
// carries its ranges (`data-words="s-e,…"`, `data-word-kind`), and they join two page-wide CSS
// highlights, ::highlight(diff-word-add) and ::highlight(diff-word-del) (cc8da1d42 [data-diff-span]).

export const wordsAttr = (ranges: [number, number][] | undefined): string | undefined => ranges?.map(([start, end]) => `${start}-${end}`).join(",");

/** Adds the ranges under `root` to the page's highlights; the returned function takes them out again. */
export function markWords(root: HTMLElement | null): () => void {
  if (!root || !("highlights" in CSS)) return () => {};
  const made: [Highlight, Range][] = [];
  for (const el of root.querySelectorAll<HTMLElement>("[data-words]")) {
    const name = `diff-word-${el.dataset.wordKind === "del" ? "del" : "add"}`;
    let highlight = CSS.highlights.get(name);
    if (!highlight) CSS.highlights.set(name, (highlight = new Highlight()));
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
    // The text node and offset a character offset falls in.
    const at = (offset: number): [Text, number] | undefined => {
      for (const node of nodes) {
        if (offset <= node.length) return [node, offset];
        offset -= node.length;
      }
      return undefined;
    };
    for (const pair of el.dataset.words!.split(",")) {
      const [start, end] = pair.split("-").map(Number);
      const from = at(start), to = at(end);
      if (!from || !to || start >= end) continue;
      const range = new Range();
      range.setStart(...from);
      range.setEnd(...to);
      highlight.add(range);
      made.push([highlight, range]);
    }
  }
  return () => {
    for (const [highlight, range] of made) highlight.delete(range);
  };
}
