// node zh-table.mjs <Cache_Data> <ion-dist/i18n...>: the id/en/zh table copydiff.mjs and idmatch.mjs
// annotate with, written to CLAUDE_DIFF_ZH (default <out>/id-en-zh.tsv). The zh side is the newest
// claude.ai i18n/zh-Hans.json in Claude Desktop's Chromium block-file HTTP cache (the package ships no
// Chinese web strings); the en side is en-US.json (+ dynamic/en-US.json) of each i18n folder given.
// Rows are "id\ten\tzh", either side empty when missing, newlines escaped as \n.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { out } from "./lib.mjs";
const [cache, ...i18n] = process.argv.slice(2);
if (!cache || !i18n.length) throw new Error("usage: node zh-table.mjs <Cache_Data> <ion-dist/i18n...>");
const files = {};
const file = (n) => (files[n] ??= fs.readFileSync(path.join(cache, n)));
const BS = { 1: 36, 2: 256, 3: 1024, 4: 4096 };
// A CacheAddr: bit 31 set, type (a>>28)&7: 0 = external f_%06x, else block file data_<(a>>16)&0xff>.
function read(addr, size) {
  if (!(addr & 0x80000000)) return null;
  const type = (addr >>> 28) & 7;
  if (type === 0) return file("f_" + (addr & 0x0fffffff).toString(16).padStart(6, "0")).subarray(0, size);
  const f = file("data_" + ((addr >>> 16) & 0xff));
  const off = 8192 + (addr & 0xffff) * BS[type];
  return f.subarray(off, off + size);
}
// data_1 holds the 256-byte entry records: key_len @32, long_key @36, data_size[] @40, data_addr[] @56,
// key @96; stream 0 is the response headers, stream 1 the body.
const idx = file("data_1");
let zh = null;
for (let o = 8192; o + 256 <= idx.length; o += 256) {
  const keyLen = idx.readInt32LE(o + 32);
  if (keyLen <= 0 || keyLen > 4000) continue;
  const longKey = idx.readUInt32LE(o + 36);
  const key = longKey ? read(longKey, keyLen)?.toString("latin1") : idx.subarray(o + 96, o + 96 + Math.min(keyLen, 160)).toString("latin1");
  if (!key || !/i18n\/zh-Hans\.json/.test(key)) continue;
  try {
    const hdr = read(idx.readUInt32LE(o + 56), idx.readInt32LE(o + 40)).toString("latin1");
    const body = read(idx.readUInt32LE(o + 60), idx.readInt32LE(o + 44));
    const date = Date.parse((hdr.match(/date: ?([^\0\r\n]+)/i) || [])[1] || "") || 0;
    const enc = (hdr.match(/content-encoding: ?(\w+)/i) || [])[1];
    const text = enc === "zstd" ? zlib.zstdDecompressSync(body) : enc === "br" ? zlib.brotliDecompressSync(body) : body;
    if (!zh || date > zh.date) zh = { key, date, strings: JSON.parse(text.toString("utf8")) };
  } catch (e) { console.error("skip", key, e.message); }
}
if (!zh) throw new Error(`no claude.ai i18n/zh-Hans.json in ${cache}; open Claude Desktop in Chinese once to cache it`);
const en = {};
for (const d of i18n) for (const f of ["en-US.json", "dynamic/en-US.json"]) if (fs.existsSync(path.join(d, f))) Object.assign(en, JSON.parse(fs.readFileSync(path.join(d, f), "utf8")));
const flat = (s) => (s ?? "").replace(/\r?\n/g, "\\n").replace(/\t/g, " ");
const ids = [...new Set([...Object.keys(en), ...Object.keys(zh.strings)])].sort();
const tsv = process.env.CLAUDE_DIFF_ZH || out("id-en-zh.tsv");
fs.writeFileSync(tsv, ids.map((id) => `${id}\t${flat(en[id])}\t${flat(zh.strings[id])}`).join("\n"));
console.log(`${ids.length} ids → ${tsv} (zh from ${zh.key}, ${new Date(zh.date).toISOString()})`);
