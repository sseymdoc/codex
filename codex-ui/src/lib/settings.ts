// Settings search ranking (ion-dist cc011544b SettingsNavSearch: Jt ranks a label, Zt groups the
// hits by page; c1914a919 normalizes). Settings.tsx supplies the pages and their rows.

/** A row as the search sees it: its label, or one of its search phrases (matched more strictly). */
export interface SearchRow {
  text: string;
  /** The row's visible label; a page lists each label once. */
  display: string;
  anchor?: string;
  phrase?: boolean;
}

/** A settings page. An `open` page (Customize) also lists labels another page already showed. */
export interface SearchSection {
  id: string;
  name: string;
  rows: SearchRow[];
  keywords?: string[];
  open?: boolean;
}

export type SearchHit =
  | { kind: "hit"; section: string; via?: string; anchor?: string }
  | { kind: "child"; section: string; via: string; anchor?: string }
  | { kind: "more"; section: string; count: number };

// Vt, Ht, Ut, Wt and the keyword score.
const CHILDREN = 3;
const EXPAND_AT = 2;
const ROW_SCORE = 5;
const PHRASE_RANK = 4;
const KEYWORD_SCORE = 10;

/** NFKD and lower case without diacritics, straight quotes, runs of space / - / _ as one space. */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\s\-_]+/g, " ")
    .trim();
}

const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;

/** Kt: a phrase split into words, so a query may also start at a later word. */
const words = (text: string) => (segmenter ? Array.from(segmenter.segment(text), (part) => part.segment).join(" ") : text);

const flat = (text: string) => text.replaceAll(" ", "");

/** 0 equal, 1 prefix, 2 every query word starts a word of `text`, 3 contained, -1 no match; spaces do not count. */
export function rank(text: string, query: string): number {
  const q = normalize(query);
  const t = normalize(text);
  if (flat(t) === flat(q)) return 0;
  if (flat(t).startsWith(flat(q))) return 1;
  const terms = q === "" ? [] : q.split(" ");
  if (!terms.every((term) => flat(t).includes(term))) return -1;
  const parts = t.split(" ");
  const tails = parts.map((_, index) => parts.slice(index).join(""));
  return terms.every((term) => tails.some((tail) => tail.startsWith(term))) ? 2 : 3;
}

/**
 * Pages by score (name 0–3, else 5 + the best row's rank, else 10 for a keyword); from two
 * characters a page lists up to three matched rows and "+N", a page found by one row shows it as
 * its second line, and a label shown once is not repeated under a later page.
 */
export function searchSettings(sections: SearchSection[], query: string): SearchHit[] {
  const target = flat(normalize(query));
  if (!target) return [];
  const expand = target.length >= EXPAND_AT;
  const found: { section: SearchSection; score: number; named: boolean; rows: SearchRow[]; keyword?: string }[] = [];
  for (const section of sections) {
    const seen = new Set<string>();
    const rows = section.rows
      .map((row) => ({ row, rank: rank(row.phrase ? words(row.text) : row.text, query) }))
      .filter((match) => match.rank >= 0 && !(match.row.phrase && match.rank > 2))
      .map((match) => (match.row.phrase ? { ...match, rank: PHRASE_RANK } : match))
      .sort((a, b) => a.rank - b.rank)
      .filter(({ row }) => !seen.has(row.display) && !!seen.add(row.display));
    const name = rank(section.name, query);
    if (name >= 0) found.push({ section, score: name, named: true, rows: rows.map((match) => match.row) });
    else if (rows.length) found.push({ section, score: ROW_SCORE + rows[0].rank, named: false, rows: rows.map((match) => match.row) });
    else {
      const keyword = section.keywords?.find((word) => flat(normalize(word)).includes(target));
      if (keyword) found.push({ section, score: KEYWORD_SCORE, named: false, rows: [], keyword });
    }
  }
  found.sort((a, b) => a.score - b.score);

  const shown = new Set<string>();
  const hits: SearchHit[] = [];
  const show = (section: SearchSection, row: SearchRow) => {
    if (!section.open) shown.add(row.display);
  };
  const children = (section: SearchSection, rows: SearchRow[]) => {
    for (const row of rows.slice(0, CHILDREN)) {
      show(section, row);
      hits.push({ kind: "child", section: section.id, via: row.display, anchor: row.anchor });
    }
    if (rows.length > CHILDREN) hits.push({ kind: "more", section: section.id, count: rows.length - CHILDREN });
  };
  for (const { section, named, rows, keyword } of found) {
    if (keyword !== undefined) {
      hits.push({ kind: "hit", section: section.id, via: keyword });
      continue;
    }
    const fresh = section.open ? rows : rows.filter((row) => !shown.has(row.display));
    if (named) {
      hits.push({ kind: "hit", section: section.id });
      if (expand) children(section, fresh);
    } else if (!expand) {
      const [row] = rows;
      if (section.open || !shown.has(row.display)) {
        show(section, row);
        hits.push({ kind: "hit", section: section.id, via: row.display, anchor: row.anchor });
      }
    } else if (fresh.length === 1) {
      show(section, fresh[0]);
      hits.push({ kind: "hit", section: section.id, via: fresh[0].display, anchor: fresh[0].anchor });
    } else if (fresh.length > 1) {
      hits.push({ kind: "hit", section: section.id });
      children(section, fresh);
    }
  }
  return hits;
}
