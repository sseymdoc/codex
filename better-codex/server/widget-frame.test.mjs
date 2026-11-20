import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { WIDGET_FRAME_HTML } from "./widget-frame.mjs";

// The frame's own script, run against the few DOM pieces it touches.
function frame() {
  const posted = [];
  const listeners = {};
  class Element {
    constructor(attrs = {}) { this.attrs = attrs; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    getAttributeNS(ns, name) { return ns === "http://www.w3.org/1999/xlink" ? this.attrs[`xlink:${name}`] ?? null : null; }
    setAttribute(name, value) { this.attrs[name] = value; }
    get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value })); }
    get src() { return this.attrs.src ?? ""; }
    get type() { return this.attrs.type ?? ""; }
    get noModule() { return "nomodule" in this.attrs; }
  }
  const ran = [];
  let scripts = [];
  const root = {
    set innerHTML(code) { scripts = JSON.parse(code).map((attrs) => Object.assign(new Element(attrs), { textContent: attrs.text ?? "", replaceWith: (next) => ran.push(next) })); },
    querySelectorAll: () => scripts,
  };
  const document = {
    baseURI: "http://127.0.0.1:1/widget-frame",
    documentElement: { dataset: {}, style: { setProperty() {} } },
    body: { getBoundingClientRect: () => ({ height: 10 }) },
    getElementById: () => root,
    createElement: () => new Element(),
    addEventListener: (type, fn) => { listeners[`document:${type}`] = fn; },
  };
  const parent = { postMessage: (message) => posted.push(message) };
  const window = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  const context = { document, parent, window, Element, URL, ResizeObserver: class { observe() {} } };
  window.parent = parent;
  vm.runInNewContext(WIDGET_FRAME_HTML.match(/<script>([\s\S]*)<\/script>/)[1], context);
  return { posted, listeners, ran, Element, parent };
}

test("a link inside inline SVG opens at its resolved address, not an SVGAnimatedString", () => {
  const { posted, listeners, Element } = frame();
  const click = (attrs) => {
    const link = new Element(attrs);
    Object.defineProperty(link, "href", { value: { baseVal: attrs.href } });
    const target = Object.assign(new Element(), { closest: () => link });
    listeners["document:click"]({ target, preventDefault() {} });
  };
  click({ href: "https://example.com/a" });
  click({ "xlink:href": "https://example.com/b" });
  click({ href: "#top" });
  assert.deepEqual(posted.filter((m) => m.type === "openLink").map((m) => m.url), ["https://example.com/a", "https://example.com/b"]);
});

test("a <script src> that never loads (a data type, nomodule) does not hold back the scripts after it", async () => {
  const { listeners, ran, parent } = frame();
  listeners.message({ source: parent, data: { type: "render", code: JSON.stringify([
    { src: "https://cdn.jsdelivr.net/x.json", type: "application/json" },
    { src: "https://cdn.jsdelivr.net/legacy.js", nomodule: "" },
    { text: "draw()" },
    { src: "https://cdn.jsdelivr.net/lib.js" },
    { text: "useLib()" },
  ]) } });
  const names = async () => { await new Promise((resolve) => setImmediate(resolve)); return ran.map((script) => script.textContent || script.attrs.src); };
  assert.deepEqual(await names(), ["https://cdn.jsdelivr.net/x.json", "https://cdn.jsdelivr.net/legacy.js", "draw()", "https://cdn.jsdelivr.net/lib.js"]);
  // A JavaScript src still holds the next script until it loads.
  ran.at(-1).onload();
  assert.equal((await names()).at(-1), "useLib()");
});

test("the frame's stylesheet lets a widget taller than the parent's cap scroll (html overflow-y:auto)", () => {
  assert.match(WIDGET_FRAME_HTML, /html\{overflow-y:auto\}/);
});
