import { execFileSync, spawn } from "node:child_process";
import { Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

/**
 * Newline-delimited output, one `line` per CR, LF or CRLF, with each unfinished line bounded to `maxBytes`
 * so a runaway child cannot build a string large enough to crash the host. U+2028 / U+2029 stay in the
 * line: they are legal inside JSON strings, and readline (Node 24+) would split the protocol frame there.
 */
export function readLines(input, { maxBytes, line, error }) {
  const decoder = new StringDecoder("utf8");
  let bytes = 0, closed = false, cr = false, pending = "";
  const bounded = new Writable({
    write(chunk, _encoding, done) {
      try {
        for (let offset = 0; offset < chunk.length; offset += 64 * 1024) {
          append(decoder.write(chunk.subarray(offset, offset + 64 * 1024)));
        }
        done();
      } catch (cause) { done(cause); }
    },
    final(done) {
      try {
        append(decoder.end());
        if (pending && !closed) line(pending);
        done();
      } catch (cause) { done(cause); }
    },
  });
  function append(text) {
    let start = 0;
    for (const match of text.matchAll(/[\r\n]/g)) {
      push(text.slice(start, match.index), match[0]);
      start = match.index + 1;
    }
    push(text.slice(start), "");
  }
  function push(text, ending) {
    bytes += Buffer.byteLength(text);
    if (bytes > maxBytes) throw Object.assign(new Error(`Output line exceeded ${maxBytes} bytes`), { code: "OUTPUT_TOO_LARGE" });
    pending += text;
    if (!ending) return;
    // The \n of a CRLF (even split across chunks) ends nothing: its \r already ended the line.
    if (!(cr && !pending && ending === "\n") && !closed) line(pending);
    cr = ending === "\r";
    pending = "";
    bytes = 0;
  }
  function close() {
    if (closed) return;
    closed = true;
    input.unpipe(bounded);
    input.pause();
    input.off("error", fail);
    input.off("close", close);
    bounded.destroy();
  }
  function fail(cause) {
    if (closed) return;
    close();
    error(cause);
  }
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

/**
 * Args for spawn(): a shell launch (npm's .cmd shim through cmd.exe) gets each one quoted as
 * CommandLineToArgvW reads it back, so -c values keep their quotes. cmd.exe leaves quoted text alone
 * except %VAR%, which it expands even there: each % goes as %%cd:~,% (an empty slice of %cd% after
 * a literal %, as Rust's std escapes .bat args), so a user's -c value arrives unchanged.
 */
export function spawnArgs(command, args) {
  if (!command.shell) return args;
  return args.map((arg) => `"${String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1").replace(/%/g, "%%cd:~,%")}"`);
}

/**
 * The login shell's PATH, or null. Finder and the Dock start a Mac app with launchd's
 * /usr/bin:/bin:/usr/sbin:/sbin, which has none of the Homebrew, npm or ~/.local/bin folders that
 * codex, node and cargo live in.
 */
export function loginShellPath({ shell = process.env.SHELL || "/bin/zsh", run = execFileSync } = {}) {
  try {
    // Shell start-up files may print; the PATH is the last line.
    const out = run(shell, ["-ilc", 'printf "\\n%s" "$PATH"'], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\n").at(-1).trim() || null;
  } catch {
    return null;
  }
}
