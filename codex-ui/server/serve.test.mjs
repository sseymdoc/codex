import assert from "node:assert/strict";
import { test } from "node:test";
import { CSP } from "./serve.mjs";

test("UI policy permits OpenAI icon hosts while keeping arbitrary remote resources blocked", () => {
  const images = CSP.split("; ").find((rule) => rule.startsWith("img-src ")).split(" ").slice(1);
  assert.ok(images.includes("https://cdn.openai.com"));
  assert.ok(images.includes("https://connector-icons.chatgpt.com"));
  assert.ok(images.includes("https://persistent.oaistatic.com"));
  assert.ok(!images.includes("https:") && !images.includes("*") && !images.includes("http:"));
  assert.ok(!images.includes("https://example.com"));
  assert.match(CSP, /script-src 'self';/);
  assert.match(CSP, /connect-src 'self';/);
});
