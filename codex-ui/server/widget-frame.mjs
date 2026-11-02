// /widget-frame: the page show_widget's code runs in (src/components/Widget.tsx), after Claude
// 4.4212's visualize widget host (index.chunk-BBu5cdqa g(): the CSS variables, SVG classes and
// color ramps read_me describes, sendPrompt and openLink). The response's CSP sandboxes it on
// every load: scripts only, an opaque origin (no cookies, storage or same-origin requests), code
// and fonts from the four CDNs read_me names, nothing else out. The parent sends the code and its
// theme once; the frame reports its height, prompts and links, which the parent checks again.

const CDNS = "https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://esm.sh";

export const WIDGET_FRAME_CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  `script-src 'unsafe-inline' ${CDNS}`,
  `style-src 'unsafe-inline' ${CDNS} https://fonts.googleapis.com`,
  `font-src data: ${CDNS} https://fonts.gstatic.com`,
  "img-src data: blob:",
  `connect-src ${CDNS}`,
  "media-src 'none'",
  "frame-src 'none'",
  "worker-src blob:",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");

// The nine ramps: 50 / 600 / 800 in light mode, 800 / 200 / 100 in dark (fill / stroke / title).
const RAMPS = {
  purple: ["#EEEDFE", "#CECBF6", "#AFA9EC", "#7F77DD", "#534AB7", "#3C3489", "#26215C"],
  teal: ["#E1F5EE", "#9FE1CB", "#5DCAA5", "#1D9E75", "#0F6E56", "#085041", "#04342C"],
  coral: ["#FAECE7", "#F5C4B3", "#F0997B", "#D85A30", "#993C1D", "#712B13", "#4A1B0C"],
  pink: ["#FBEAF0", "#F4C0D1", "#ED93B1", "#D4537E", "#993556", "#72243E", "#4B1528"],
  gray: ["#F1EFE8", "#D3D1C7", "#B4B2A9", "#888780", "#5F5E5A", "#444441", "#2C2C2A"],
  blue: ["#E6F1FB", "#B5D4F4", "#85B7EB", "#378ADD", "#185FA5", "#0C447C", "#042C53"],
  green: ["#EAF3DE", "#C0DD97", "#97C459", "#639922", "#3B6D11", "#27500A", "#173404"],
  amber: ["#FAEEDA", "#FAC775", "#EF9F27", "#BA7517", "#854F0B", "#633806", "#412402"],
  red: ["#FCEBEB", "#F7C1C1", "#F09595", "#E24B4A", "#A32D2D", "#791F1F", "#501313"],
};
const ramp = (name, [s50, s100, s200, , s600, s800]) => {
  const shapes = `:is(rect,circle,ellipse,polygon)`;
  return `.c-${name}>${shapes},${shapes}.c-${name}{fill:${s50};stroke:${s600}}` +
    `.c-${name}>.t,.c-${name}>.th{fill:${s800}}.c-${name}>.ts{fill:${s600}}` +
    `[data-mode=dark] .c-${name}>${shapes},[data-mode=dark] ${shapes}.c-${name}{fill:${s800};stroke:${s200}}` +
    `[data-mode=dark] .c-${name}>.t,[data-mode=dark] .c-${name}>.th{fill:${s100}}[data-mode=dark] .c-${name}>.ts{fill:${s200}}`;
};

const STYLE = `:root{color-scheme:light;--surface-0:#faf9f5;--surface-1:#f5f4ed;--surface-2:#fff;--surface-3:#fff;--text-primary:#141413;--text-secondary:#5e5d59;--text-muted:#87867f;--text-accent:#2c84db;--text-danger:#b53333;--text-success:#3b6d11;--text-warning:#854f0b;--bg-accent:#e6f1fb;--bg-danger:#fcebeb;--bg-success:#eaf3de;--bg-warning:#faeeda;--border:rgb(31 30 29/15%);--border-strong:rgb(31 30 29/30%);--border-stronger:rgb(31 30 29/40%);--font-sans:system-ui,-apple-system,"Segoe UI",sans-serif;--font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--font-voice:Georgia,"Times New Roman",serif;--radius:8px;--pad-sm:8px;--pad-md:12px;--pad-lg:16px;--pad-xl:24px;--gap-xs:4px;--gap-sm:8px;--gap-md:12px;--gap-lg:16px;--gap-xl:24px}
[data-mode=dark]{color-scheme:dark;--surface-0:#1f1e1d;--surface-1:#262624;--surface-2:#30302e;--surface-3:#30302e;--text-primary:#faf9f5;--text-secondary:#c2c0b6;--text-muted:#9c9a92;--text-accent:#85b7eb;--text-danger:#f09595;--text-success:#97c459;--text-warning:#ef9f27;--bg-accent:#0c447c;--bg-danger:#791f1f;--bg-success:#27500a;--bg-warning:#633806;--border:rgb(250 249 245/15%);--border-strong:rgb(250 249 245/30%);--border-stronger:rgb(250 249 245/40%)}
:root{--border-accent:color-mix(in srgb,var(--text-accent) 45%,transparent);--border-danger:color-mix(in srgb,var(--text-danger) 45%,transparent);--border-success:color-mix(in srgb,var(--text-success) 45%,transparent);--border-warning:color-mix(in srgb,var(--text-warning) 45%,transparent);--p:var(--text-primary);--s:var(--text-secondary);--t:var(--text-muted);--bg2:var(--surface-1);--b:var(--border)}
html,body{margin:0;padding:0;background:transparent}
body{color:var(--text-primary);font:400 16px/1.6 var(--font-sans);overflow:hidden;overflow-wrap:break-word}
#root{display:block;width:100%}
h1,h2,h3{color:var(--text-primary);font-weight:500;margin:0 0 .5em}h1{font-size:22px}h2{font-size:18px}h3{font-size:16px}
a{color:var(--text-accent)}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
#root>svg{display:block;width:100%;height:auto}
svg text{font-family:var(--font-sans)}
.t{font-size:14px;fill:var(--text-primary)}.ts{font-size:12px;fill:var(--text-secondary)}.th{font-size:14px;font-weight:500;fill:var(--text-primary)}
.box{fill:var(--surface-1);stroke:var(--border-strong);stroke-width:.5}
.arr{fill:none;stroke:var(--text-secondary);stroke-width:1.5}
.leader{fill:none;stroke:var(--text-muted);stroke-width:.5;stroke-dasharray:3 3}
.node{cursor:pointer}.node:hover{opacity:.8}
${Object.entries(RAMPS).map(([name, stops]) => ramp(name, stops)).join("\n")}`;

// Runs in the frame. Scripts in the code run in order (a library's <script src> before what uses it).
const SCRIPT = `(() => {
  const root = document.getElementById("root");
  const post = (message) => parent.postMessage({ codexUiWidget: true, ...message }, "*");
  const active = () => navigator.userActivation ? navigator.userActivation.isActive : false;
  window.sendPrompt = (text) => { if (typeof text === "string" && text.trim()) post({ type: "sendPrompt", text: text.slice(0, 4000), active: active() }); };
  window.openLink = (url) => post({ type: "openLink", url: String(url), active: active() });
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link || link.getAttribute("href").startsWith("#")) return;
    event.preventDefault();
    window.openLink(link.href);
  });
  const theme = (data) => {
    document.documentElement.dataset.mode = data.mode === "dark" ? "dark" : "light";
    for (const [name, value] of Object.entries(data.vars || {})) if (/^--[a-z0-9-]+$/.test(name) && typeof value === "string") document.documentElement.style.setProperty(name, value);
  };
  let rendered = false, last = -1;
  const size = () => {
    const height = Math.ceil(document.body.getBoundingClientRect().height);
    if (height !== last) post({ type: "size", height: (last = height) });
  };
  async function render(code) {
    root.innerHTML = code;
    size();
    for (const old of [...root.querySelectorAll("script")]) {
      const script = document.createElement("script");
      for (const { name, value } of old.attributes) script.setAttribute(name, value);
      script.textContent = old.textContent;
      const loaded = script.src ? new Promise((resolve) => { script.onload = script.onerror = resolve; }) : null;
      old.replaceWith(script);
      if (loaded) await loaded;
      size();
    }
  }
  window.addEventListener("message", (event) => {
    const data = event.source === parent ? event.data : null;
    if (!data || typeof data !== "object") return;
    if (data.type === "theme") theme(data);
    if (data.type === "render" && !rendered && typeof data.code === "string") {
      rendered = true;
      theme(data);
      void render(data.code);
    }
  });
  // Later changes (a chart drawing, a click revealing more); the explicit reports above cover a frame not yet painting.
  new ResizeObserver(size).observe(document.body);
})();`;

export const WIDGET_FRAME_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${STYLE}</style>
</head>
<body><div id="root"></div><script>${SCRIPT}</script></body>
</html>`;

export function serveWidgetFrame(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return void res.writeHead(405, { Allow: "GET, HEAD" }).end();
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    "Content-Security-Policy": WIDGET_FRAME_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(req.method === "HEAD" ? undefined : WIDGET_FRAME_HTML);
}
