// Reuse only the hash-bound CDP implementation from the user's local Claude package.
// No Claude bundle, app bootstrap, native addon, account or telemetry is loaded.
import { createHash } from "node:crypto";
import * as nodeFs from "node:fs";
import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import { compileFunction, createContext } from "node:vm";
import { performance } from "node:perf_hooks";
import manifest from "./claude-browser-2.42304.json" with { type: "json" };

// Electron treats .asar as a directory; read the actual archive bytes with original-fs.
const { openSync, readSync, closeSync, statSync } = process.versions.electron ? createRequire(import.meta.url)("original-fs") : nodeFs;

export const CLAUDE_BROWSER_VERSION = manifest.version;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Read one packed member without extracting or executing the application. */
export function readAsarMember(file, member) {
  const fd = openSync(file, "r");
  const size = statSync(file).size;
  const read = (length, offset) => {
    if (!Number.isSafeInteger(length) || length < 0 || offset < 0 || offset + length > size) throw new Error("Invalid ASAR range");
    const bytes = Buffer.alloc(length);
    if (readSync(fd, bytes, 0, length, offset) !== length) throw new Error("Incomplete ASAR read");
    return bytes;
  };
  try {
    const header = read(16, 0);
    const length = header.readUInt32LE(12);
    if (length > 16 * 1024 * 1024) throw new Error("ASAR header is too large");
    let entry = JSON.parse(read(length, 16));
    for (const name of member.split("/")) entry = entry?.files?.[name];
    if (!entry || entry.unpacked || entry.link || !/^\d+$/.test(entry.offset)) throw new Error("Claude browser member is missing");
    return read(entry.size, 8 + header.readUInt32LE(4) + Number(entry.offset));
  } finally {
    closeSync(fd);
  }
}

/** The manifest contains source positions, never third-party executable code. */
export function loadClaudeBrowser(archive, logger = console) {
  const bytes = readAsarMember(archive, manifest.member);
  if (digest(bytes) !== manifest.memberSha256) throw new Error(`需要 Claude ${manifest.version} 的浏览器模块；所选安装包版本不匹配。`);
  const source = bytes.toString("utf8");
  const declarations = manifest.slices
    .map(({ start, end, kind }) => `${kind === "var" ? "var " : ""}${source.slice(start, end)};`)
    .join("\n");
  const context = createContext({
    URL,
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    performance,
    process: { versions: process.versions, memoryUsage: () => process.memoryUsage() },
  });
  const load = compileFunction(
    `${declarations}\nreturn { CDPTools: ${manifest.exports.CDPTools}, budgetStore: ${manifest.exports.budgetStore} };`,
    ["require", "N", "rA"],
    {
      filename: `claude-browser-${manifest.version}.js`,
      parsingContext: context,
    },
  );
  const runtime = load(
    (name) => {
      if (name !== "node:async_hooks") throw new Error(`Unexpected Claude browser dependency: ${name}`);
      return { AsyncLocalStorage };
    },
    logger,
    { logEvent() {} },
  ); // Product telemetry stays local; the original memory guard is retained.
  return {
    ...runtime,
    run(timeout, action) {
      const now = performance.now();
      return runtime.budgetStore.run({ startBy: now + timeout, finishBy: now + timeout, inputSent: false, inputHeld: false }, action);
    },
  };
}
