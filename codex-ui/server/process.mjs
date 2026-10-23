import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";

/** Bound unfinished output before readline can build a string large enough to crash the host. */
export function readLines(input, { maxBytes, line, error }) {
  const decoder = new StringDecoder("utf8");
  let bytes = 0, closed = false;
  const bounded = new Transform({
    readableObjectMode: true,
    transform(chunk, _encoding, done) {
      try {
        for (let offset = 0; offset < chunk.length; offset += 64 * 1024) {
          append(decoder.write(chunk.subarray(offset, offset + 64 * 1024)));
        }
        done();
      } catch (cause) { done(cause); }
    },
    flush(done) {
      try { append(decoder.end()); done(); }
      catch (cause) { done(cause); }
    },
  });
  function append(text) {
    let start = 0;
    for (const match of text.matchAll(/[\r\n\u2028\u2029]/gu)) {
      push(text.slice(start, match.index), match[0]);
      start = match.index + 1;
    }
    push(text.slice(start), "");
  }
  function push(text, ending) {
    bytes += Buffer.byteLength(text);
    if (bytes > maxBytes) throw Object.assign(new Error(`Output line exceeded ${maxBytes} bytes`), { code: "OUTPUT_TOO_LARGE" });
    if (text || ending) bounded.push(text + ending);
    if (ending) bytes = 0;
  }
  const lines = createInterface({ input: bounded, crlfDelay: Infinity });
  lines.on("line", line);
  function close() {
    if (closed) return;
    closed = true;
    input.unpipe(bounded);
    input.pause();
    input.off("error", fail);
    input.off("close", close);
    lines.close();
    bounded.destroy();
  }
  function fail(cause) {
    if (closed) return;
    close();
    error(cause);
  }
  lines.on("error", fail);
  bounded.on("error", fail);
  input.on("error", fail);
  input.once("close", close);
  input.pipe(bounded);
  return close;
}

// app-server exits once stdin closes; force-kill only if it lingers.
export function stop(child, force) {
  const kill = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      child.kill("SIGKILL");
    }
  };
  child.stdin.end();
  if (force) kill();
  else setTimeout(kill, 3000).unref();
}
