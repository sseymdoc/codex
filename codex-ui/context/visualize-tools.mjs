// codex_ui_desktop's inline visuals, after Claude 4.4212's visualize server (app.asar
// index.chunk-BBu5cdqa getImagineServerDef: show_widget and read_me; its elicitation module and
// MCP App resource are Claude's own). The page answers whether 设置 › 能力 › 内联可视化 is on and
// draws the widget from the call's arguments (src/components/Widget.tsx in a server/widget-frame.mjs
// frame); read_me's text is context/visualize-guide.mjs. No I/O.

import { read, toolTable, tool } from "./manage-tools.mjs";
import { VISUAL_MODULES, VISUAL_PLATFORMS, visualGuide } from "./visualize-guide.mjs";

/** What a widget may weigh, in UTF-16 units: codex-ui's cap (Claude's schema sets none). */
export const MAX_WIDGET_CODE = 512 * 1024;
export const SHOWN = "Content rendered and shown to the user. Please do not duplicate the shown content in text because it's already visually represented.";
export const VISUALS_OFF = "Inline visualizations are turned off in Codex UI's settings. Retries will fail; answer in text instead.";

const SPEC = [
  tool("show_widget", "Show visual content (SVG graphics, diagrams, charts, or interactive HTML widgets) that renders inline alongside your text response. Use for flowcharts, architecture diagrams, dashboards, forms, calculators, data tables, games, illustrations, or any visual content. The code is auto-detected: it starts with <svg> for SVG mode, otherwise HTML mode. A global sendPrompt(text) function is available: it sends a message to the chat as if the user typed it. IMPORTANT: call read_me before your first show_widget call. Do not narrate or mention the read_me call to the user; call it silently, then respond as if you went straight to building the visualization.",
    {
      loading_messages: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", minLength: 1, maxLength: 80 }, description: "1 to 4 loading messages shown while the visual renders, each about 5 words, in the user's language. Use 1 for simple visuals, more for complex ones. On a serious topic (illness, death, war, disaster, trauma, money worries, anything the reader may be personally affected by) keep them plain descriptions of the work (\"Setting up the model\"); otherwise they may be playful." },
      title: { type: "string", minLength: 1, maxLength: 80, description: "Short snake_case identifier for this visual, specific enough to tell it apart from the others in the conversation (e.g. 'q4_revenue_by_product_line', not 'chart'). Also used as the file name: no spaces or special characters." },
      widget_code: { type: "string", description: "SVG or HTML code to render. SVG: raw SVG starting with <svg>, colors through the CSS variables and classes read_me describes. HTML: a fragment, without DOCTYPE, <html>, <head> or <body>. Keep the background transparent and skip top-level padding. Scripts run once the code is in place." },
    }, ["loading_messages", "title", "widget_code"], read, ["shown"], () => SHOWN),
  tool("read_me", "Returns required context for show_widget (CSS variables, colors, typography, layout rules, examples). Call it before your first show_widget call, and again later if you need a different module. Do not mention or narrate this call to the user: it is an internal setup step; call it silently and go straight to the visualization in your response.",
    {
      modules: { type: "array", maxItems: VISUAL_MODULES.length, items: { type: "string", enum: VISUAL_MODULES }, description: "Which module(s) to load. Pick all that fit." },
      platform: { type: "string", enum: VISUAL_PLATFORMS, description: "The width the widget renders at: 'mobile' for a narrow (~380px) column, else 'desktop'. Defaults to 'unknown' (desktop sizing)." },
    }, [], read, ["ready"], (args) => visualGuide(args.modules, args.platform)),
];

const TABLE = toolTable(SPEC);
export const VISUALIZE_TOOL_NAMES = TABLE.names;
export const VISUALIZE_TOOLS = TABLE.tools;
export const visualizeReceipt = TABLE.receipt;
export const visualizeResult = TABLE.result;

/** The table's checks, but widget_code may hold newlines and runs to MAX_WIDGET_CODE; a title is snake_case. */
export function visualizeInput(name, value) {
  const refuse = (message) => { throw Object.assign(new Error(message), { code: "INVALID_INPUT" }); };
  if (name !== "show_widget") return TABLE.input(name, value);
  const { widget_code: code, ...rest } = value;
  if (typeof code !== "string" || !code.trim()) refuse("widget_code is required: an <svg> element or an HTML fragment.");
  if (code.length > MAX_WIDGET_CODE) refuse(`widget_code must be at most ${MAX_WIDGET_CODE} characters.`);
  const args = TABLE.input(name, { ...rest, widget_code: "-" });
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(args.title)) refuse("title must be snake_case: lowercase letters and digits joined by underscores.");
  return { ...args, widget_code: code };
}
