import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { transformSync } from "rolldown/experimental";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier) && /\.tsx?$/.test(context.parentURL ?? "")) {
      for (const ext of [".ts", ".tsx"]) {
        try { return next(specifier + ext, context); } catch (error) { if (error.code !== "ERR_MODULE_NOT_FOUND") throw error; }
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith("file:") || !/\.tsx?$/.test(url)) return next(url, context);
    const { code } = transformSync(new URL(url).pathname, readFileSync(new URL(url), "utf8"), { jsx: { runtime: "automatic" } });
    return { format: "module", shortCircuit: true, source: code };
  },
});

const { ConnectorIcon } = await import("../components/ConnectorIcon.tsx");
const light = "https://cdn.openai.com/light.png";
const dark = "https://cdn.openai.com/dark.png";
const render = (props, darkMode = false) => {
  globalThis.document = { documentElement: { classList: { contains: () => darkMode } } };
  return renderToStaticMarkup(createElement(ConnectorIcon, props));
};

test("connector icons select the theme variant and reuse the available variant", () => {
  assert.match(render({ light, dark }), /src="https:\/\/cdn.openai.com\/light.png"/);
  assert.match(render({ light, dark }, true), /src="https:\/\/cdn.openai.com\/dark.png"/);
  assert.match(render({ light }, true), /src="https:\/\/cdn.openai.com\/light.png"/);
  assert.match(render({ dark }), /src="https:\/\/cdn.openai.com\/dark.png"/);
  assert.match(render({ light, dark }), /alt=""/);
  assert.match(render({ light, dark }), /referrerPolicy="no-referrer"/);
});

test("missing, malformed and unsafe icon URLs retain the generic connector icon", () => {
  for (const light of [undefined, null, "", "not a URL", "javascript:alert(1)", "http://localhost/icon", "https://user:secret@example.com/icon"]) {
    const html = render({ light });
    assert.match(html, /data-cds="Icon"/);
    assert.doesNotMatch(html, /<img/);
  }
  assert.match(render({ light: "invalid", dark }), /src="https:\/\/cdn.openai.com\/dark.png"/);
});
