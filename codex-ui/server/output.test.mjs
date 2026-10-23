import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { readLines } from "./process.mjs";

test("bounded output preserves UTF-8, CRLF, empty lines and the final partial line", async () => {
  const input = new PassThrough(), lines = [], errors = [];
  readLines(input, { maxBytes: 20, line: (value) => lines.push(value), error: (value) => errors.push(value) });
  const data = Buffer.from("你好\r\n\nnext\rfinal");
  for (const byte of data) input.write(Buffer.from([byte]));
  input.end();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(lines, ["你好", "", "next", "final"]);
  assert.deepEqual(errors, []);
});

test("bounded output rejects an oversized line before forwarding it, across chunk boundaries", async () => {
  for (const chunks of [["good\n", "12345", "6789\nsecret\n"], ["good\n123456789\nsecret\n"]]) {
    const input = new PassThrough(), lines = [], errors = [];
    readLines(input, { maxBytes: 8, line: (value) => lines.push(value), error: (value) => errors.push(value) });
    for (const chunk of chunks) input.write(chunk);
    await new Promise((resolve) => setImmediate(resolve));
    input.end("more secret\n");
    assert.deepEqual(lines, ["good"]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, "OUTPUT_TOO_LARGE");
    assert.equal(errors[0].message.includes("secret"), false);
  }
});

test("bounded output accepts the exact byte limit and resets it for every line", async () => {
  const input = new PassThrough(), lines = [], errors = [];
  readLines(input, { maxBytes: 6, line: (value) => lines.push(value), error: (value) => errors.push(value) });
  input.end("你好\r\n123456\n你好\nabcdef\u2028ghijkl\u2029");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(lines, ["你好", "123456", "你好", "abcdef", "ghijkl"]);
  assert.deepEqual(errors, []);
});

test("source stream errors are reported once without forwarding incomplete output", async () => {
  const input = new PassThrough(), lines = [], errors = [];
  readLines(input, { maxBytes: 8, line: (value) => lines.push(value), error: (value) => errors.push(value) });
  input.write("partial");
  const failure = new Error("pipe failed");
  input.destroy(failure);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(errors, [failure]);
  assert.deepEqual(lines, []);
});

test("closing bounded output drops unfinished data and makes later chunks inert", () => {
  const input = new PassThrough(), lines = [], errors = [];
  const close = readLines(input, { maxBytes: 8, line: (value) => lines.push(value), error: (value) => errors.push(value) });
  input.write("partial");
  close();
  close();
  input.end("ignored\n");
  assert.deepEqual(lines, []);
  assert.deepEqual(errors, []);
});
