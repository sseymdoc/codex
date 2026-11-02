// read_me's guidance for show_widget (context/visualize-tools.mjs): what Codex UI's widget frame
// (server/widget-frame.mjs) provides and how to draw for it. codex-ui's own text, after the shape
// of Claude 4.4212's (index.chunk-BBu5cdqa y(): a preamble, then each module's sections once, in
// order); Claude's guide stays Claude's. Each answer stays well under Codex's tool-output cut
// (10,000 tokens for the current models): the largest, every module at once, is checked in a test.

export const VISUAL_MODULES = Object.freeze(["diagram", "mockup", "interactive", "data_viz", "art", "chart"]);
export const VISUAL_PLATFORMS = Object.freeze(["mobile", "desktop", "unknown"]);

const width = (platform) => (platform === "mobile" ? 380 : 680);

const preamble = (w) => `# Inline visuals in Codex UI

show_widget draws an SVG or an HTML fragment inline in the conversation, in a sandboxed frame about ${w}px wide whose height follows its content. Load more guidance with read_me's modules:
- \`diagram\`: flowcharts, structures, explanatory diagrams (SVG)
- \`mockup\`: UI mockups, forms, cards, dashboards (HTML)
- \`interactive\`: explainers and calculators with controls (HTML)
- \`chart\` / \`data_viz\`: charts and data analysis (Chart.js)
- \`art\`: illustration and generative art (SVG)

## Core rules
- Words go in your reply, the visual goes in the tool. No headings, introductions or paragraphs of explanation inside the widget; the user's text settings apply only to your reply.
- widget_code is a fragment: an \`<svg>…</svg>\` element, or HTML without DOCTYPE, \`<html>\`, \`<head>\` or \`<body>\`. One visual per call.
- Flat and quiet: no gradients, shadows, blur or glow; no emoji. Two font weights only (400 and 500), sentence case everywhere, nothing below 11px.
- The background is the conversation's: keep outer containers transparent and skip outer padding (\`padding: 1rem 0\` on the first element if it needs air).
- Every color must work in light and dark mode: use the variables and classes below, never fixed text colors such as #333.
- No \`position: fixed\`, no fullscreen, no nested scroll areas, no hidden tabs or carousels: stack content vertically and let the height grow.
- \`alert\`, \`confirm\`, \`prompt\`, popups, forms that submit, cookies and localStorage are unavailable. Keep state in JavaScript variables.
- Accessibility: an HTML widget starts with \`<h2 class="sr-only">\` holding a one-sentence summary; an SVG carries \`role="img"\` with \`<title>\` and \`<desc>\` as its first children.

## Scripts and libraries
Scripts run in order once the code is in place. Load a library with \`<script src>\` before the script that uses its global, from cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com or esm.sh only; fonts from fonts.googleapis.com and fonts.gstatic.com. Every other address is blocked, including fetches to APIs, and images must be inline (data: URLs or SVG).

## CSS variables
- Surfaces: \`--surface-0\` (page), \`--surface-1\` (card), \`--surface-2\`, \`--surface-3\` (raised); tints \`--bg-accent\`, \`--bg-danger\`, \`--bg-success\`, \`--bg-warning\`
- Text: \`--text-primary\`, \`--text-secondary\` (supporting), \`--text-muted\` (hints, captions); \`--text-accent\`, \`--text-danger\`, \`--text-success\`, \`--text-warning\`
- Borders: \`--border\` (hairline), \`--border-strong\`, \`--border-stronger\`; \`--border-accent\`, \`--border-danger\`, \`--border-success\`, \`--border-warning\`
- Type: \`--font-sans\`, \`--font-mono\`, \`--font-voice\` (serif, for a rare quote)
- Layout: \`--radius\` (8px; use 12px for cards), \`--pad-sm\` … \`--pad-xl\`, \`--gap-xs\` … \`--gap-xl\`
- Short forms: \`--p\` (primary text), \`--s\` (secondary), \`--t\` (muted), \`--bg2\` (card), \`--b\` (border)
Headings are preset: h1 22px, h2 18px, h3 16px, weight 500. Body text is 16px at line-height 1.6.

## sendPrompt(text) and links
\`sendPrompt(text)\` sends text as the user's next message, only from a click or key press. Use it when the next step needs Codex to think (a choice, "explain this part"); do filtering, sorting and arithmetic in JavaScript. Links (\`<a href="https://…">\`) or \`openLink(url)\` open in the user's browser.`;

const palette = `## Color ramps
Nine ramps, from lightest to darkest stop: 50, 100, 200, 400, 600, 800, 900.

| Class | 50 | 100 | 200 | 400 | 600 | 800 | 900 |
|---|---|---|---|---|---|---|---|
| \`c-purple\` | #EEEDFE | #CECBF6 | #AFA9EC | #7F77DD | #534AB7 | #3C3489 | #26215C |
| \`c-teal\` | #E1F5EE | #9FE1CB | #5DCAA5 | #1D9E75 | #0F6E56 | #085041 | #04342C |
| \`c-coral\` | #FAECE7 | #F5C4B3 | #F0997B | #D85A30 | #993C1D | #712B13 | #4A1B0C |
| \`c-pink\` | #FBEAF0 | #F4C0D1 | #ED93B1 | #D4537E | #993556 | #72243E | #4B1528 |
| \`c-gray\` | #F1EFE8 | #D3D1C7 | #B4B2A9 | #888780 | #5F5E5A | #444441 | #2C2C2A |
| \`c-blue\` | #E6F1FB | #B5D4F4 | #85B7EB | #378ADD | #185FA5 | #0C447C | #042C53 |
| \`c-green\` | #EAF3DE | #C0DD97 | #97C459 | #639922 | #3B6D11 | #27500A | #173404 |
| \`c-amber\` | #FAEEDA | #FAC775 | #EF9F27 | #BA7517 | #854F0B | #633806 | #412402 |
| \`c-red\` | #FCEBEB | #F7C1C1 | #F09595 | #E24B4A | #A32D2D | #791F1F | #501313 |

- Colors carry meaning: one ramp per category of thing, gray for neutral steps, two or three ramps in all. Purple, teal, coral and pink suit plain categories; keep blue, green, amber and red for information, success, warning and error.
- A \`c-*\` class on an SVG \`<g>\` (or directly on a rect, circle or ellipse) fills its shapes with the 50 stop and strokes them with 600 in light mode (800 and 200 in dark), and colors its \`t\`/\`ts\`/\`th\` text to match. It reaches direct children only: put it on the innermost group. Paths get no fill from it.
- In HTML, text on a tinted background uses the 800 or 900 stop of the same ramp; a title and its subtitle use different stops.`;

const svg = (w) => `## SVG setup
- Root: \`<svg width="100%" viewBox="0 0 ${w} H" role="img"><title>…</title><desc>…</desc>…</svg>\`. Keep the width at ${w}: one unit is then one CSS pixel, which the text sizes below assume. Center narrow content instead of narrowing the viewBox.
- H = the lowest point of any shape or text baseline + 30. Keep content within x 20 to ${w - 20}, never at negative coordinates.
- Text classes, one on every \`<text>\`: \`t\` (14px, primary), \`th\` (14px, weight 500), \`ts\` (12px, secondary). No other sizes.
- Shapes: \`box\` (card fill, strong border), \`arr\` (1.5px connector; add \`marker-end="url(#arrow)"\`), \`leader\` (thin dashed line), \`node\` (a clickable group: pointer and hover), \`c-*\` ramps. Corners \`rx="4"\`; larger only for pills.
- Arrowheads: start the SVG with \`<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>\`.
- \`<text>\` never wraps: break lines with \`<tspan x="…" dy="1.2em">\`, or shorten the label.
- Text widths at 14px: about 7.5px per Latin character (8px at weight 500), 14px per CJK character; at 12px, about 6.5px. A box needs the text width plus 24px each side; check before placing it.
- Labels never overlap other labels, arrows or unrelated boxes; an arrow ends at the edge of the box it points to.`;

const diagram = (w) => `## Diagrams
- Pick the form from the question: steps in order → flowchart (top to bottom, or left to right for 3 to 4 steps); parts of a whole → nested boxes; how something works physically → a simple illustration with labels; comparison → two columns.
- Keep it sparse: box titles of a few words, subtitles of five words at most, at most 4 boxes in a row (about 140px each with 20px gaps) and about 12 boxes in all. More detail → split into an overview and a second diagram, or put it in your reply.
- Box: \`<g class="c-teal"><rect x="…" y="…" width="160" height="56" rx="4"/><text class="th" x="…" y="…" text-anchor="middle">Title</text><text class="ts" x="…" y="…" text-anchor="middle">Subtitle</text></g>\`; one line of text needs 40px of height, two need 56.
- Connectors: \`<line class="arr" …>\` or \`<path class="arr" fill="none" d="…">\` with the arrow marker; label them with \`ts\` text set beside the line, not on it. Leave 30px or more between rows for arrows.
- If colors encode meaning, add a one-line legend under the diagram.
- A click that should lead somewhere: \`<g class="node c-purple" onclick="sendPrompt('Explain the cache layer')">\`.
- The frame is ${w}px wide: a diagram that needs more room goes taller, not wider.`;

const ui = (w) => `## HTML interfaces
- Lay out with flex or grid inside the ${w}px width; on narrow content, keep to one column.
- Cards: \`background: var(--surface-1); border: 0.5px solid var(--border); border-radius: 12px; padding: 16px\`. Separate groups with space before borders.
- Controls: buttons \`border: 0.5px solid var(--border-strong); border-radius: var(--radius); background: transparent; color: var(--text-primary); padding: 6px 12px; font: inherit\`; a primary button may use \`background: var(--text-primary); color: var(--surface-0)\`. Inputs share the border and radius.
- Metric tiles: the number at 22 to 28px weight 500, its label above at 13px \`--text-secondary\`.
- Tables: 14px, header row \`--text-secondary\` weight 500, hairline row borders, numbers right-aligned.
- Status colors come from the variables (\`--text-success\`, \`--bg-warning\`, …); categories from the ramps' 50/800 stops.
- Keep any \`<style>\` block short; inline styles are fine.
- A mockup of a modal: draw it inside a normal-flow box (\`min-height: 360px; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center\`), never with fixed positioning.`;

const interactive = `## Interactive widgets
- Controls first, result below, all visible at once. Update the result on \`input\` events, without a submit button where possible.
- Sliders: \`<input type="range">\` with its current value shown beside it; give each control a \`<label>\`.
- Validate what the user enters: on an empty or invalid value show a short message in 13px \`--text-danger\` next to the field and stop until it is fixed.
- Step-by-step explainers: a "Next" button that changes the content of elements already on the page (never rebuild controls with innerHTML; their listeners are lost).
- Animations: requestAnimationFrame, short and calm; offer a pause control for anything longer than a few seconds.
- Use sendPrompt only for what needs Codex (\`sendPrompt('Why does the curve flatten?')\`), never for state the widget can compute.`;

const chart = `## Charts with Chart.js
\`\`\`html
<div style="position: relative; width: 100%; height: 300px;"><canvas id="c" role="img" aria-label="Monthly revenue, Jan to Jun"></canvas></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script>
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
Chart.defaults.font.family = css('--font-sans');
Chart.defaults.color = css('--text-secondary');
Chart.defaults.borderColor = css('--border');
new Chart(document.getElementById('c'), {
  type: 'bar',
  data: { labels: ['Jan', 'Feb', 'Mar'], datasets: [{ label: 'Revenue', data: [12, 19, 7], backgroundColor: '#7F77DD', borderRadius: 4 }] },
  options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
});
</script>
\`\`\`
- Always the fixed-height wrapper with \`maintainAspectRatio: false\`; 240 to 360px tall.
- Series colors: the 400 stops of the ramps (#7F77DD, #1D9E75, #D85A30, #378ADD, #BA7517), lines 2px with no point dots unless there are few points.
- One dataset needs no legend; several get the legend or direct labels. Axis titles only when units are not obvious; format big numbers (12k, 1.2M).
- Maps and custom shapes: D3 from cdnjs (\`https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js\`), drawn into an SVG sized like the frame.`;

const dataViz = `## Data visualization
- Start from the question the chart answers, then pick the form: change over time → line; comparison of categories → bar (horizontal when labels are long); part of a whole → stacked bar, or a pie with at most 5 slices; distribution → histogram; relation of two measures → scatter.
- Sort bars by value unless the order means something. Start value axes at zero for bars.
- Color last: one color for everything, then a second ramp only for what the reader should notice. Gray for context.
- Label directly where you can (values on bars, names at line ends) instead of a legend to decode.
- Put the takeaway in your reply, not in a chart title; include units in labels.
- Summary numbers that matter go in metric tiles above the chart.`;

const art = `## Art and illustration
- SVG, with the same viewBox and safe-area rules. Build from simple shapes; flat fills from the ramps; no gradients or filters.
- Keep a clear subject with negative space around it. A small legend or labels only when the picture explains something.
- Generative pieces: a \`<script>\` that writes shapes into the SVG or a \`<canvas>\`, seeded so the result is stable, with a "Regenerate" button if variation is the point.`;

/** The guidance for `modules` (an empty list: the preamble alone), each section once, at `platform`'s width. */
export function visualGuide(modules = [], platform = "unknown") {
  const w = width(platform);
  const sections = {
    diagram: [palette, svg(w), diagram(w)],
    mockup: [palette, ui(w)],
    interactive: [palette, ui(w), interactive],
    data_viz: [palette, chart, dataViz],
    chart: [palette, chart, dataViz],
    art: [palette, svg(w), art],
  };
  const parts = [preamble(w)];
  for (const name of modules) for (const part of sections[name] ?? []) if (!parts.includes(part)) parts.push(part);
  parts.push("Keep planning short: decide the form, check sizes, then call show_widget once.");
  return parts.join("\n\n");
}
