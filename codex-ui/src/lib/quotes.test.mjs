// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of quotes.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { marked } from "marked";
import { curlQuotes, curlTokens, freshQuotes } from "./quotes.ts";

const curl = (text) => curlQuotes(text, freshQuotes());

test("quotes open after a space or bracket and close after a word", () => {
  assert.equal(curl(`He said "hi" and 'yo'.`), "He said “hi” and ‘yo’.");
  assert.equal(curl(`("quoted")`), "(“quoted”)");
  assert.equal(curl(`"Start" of a line`), "“Start” of a line");
});

test("apostrophes inside and before words", () => {
  assert.equal(curl("don't it's"), "don’t it’s");
  assert.equal(curl("the '90s"), "the ’90s");
  assert.equal(curl("rock 'n' roll, 'em"), "rock ’n’ roll, ’em");
});

test("primes, measurements and attributes stay straight", () => {
  assert.equal(curl(`a 5'10" wall`), `a 5'10" wall`);
  assert.equal(curl("then f'(x) and g''(x)"), "then f'(x) and g''(x)");
  assert.equal(curl(`set x="y" here`), `set x="y" here`);
});

test("text in other scripts keeps straight quotes", () => {
  assert.equal(curl(`他说"你好"`), `他说"你好"`);
});

test("blocks start fresh, inline code is left alone and the run carries across emphasis and escapes", () => {
  const tokens = marked.lexer(`A "b \`"c"\` d" e\n\n"**bold**" and \\"esc\\"\n\n| "x" |\n|---|\n| it's |`);
  curlTokens(tokens);
  const texts = (list) => list.flatMap((t) => (t.tokens ? texts(t.tokens) : [t.type === "codespan" ? `[${t.text}]` : t.text]));
  assert.equal(texts(tokens[0].tokens).join(""), "A “b [\"c\"] d” e");
  assert.equal(texts(tokens[2].tokens).join(""), "“bold” and “esc”");
  assert.equal(tokens[4].header[0].tokens[0].text, "“x”");
  assert.equal(tokens[4].rows[0][0].tokens[0].text, "it’s");
});
