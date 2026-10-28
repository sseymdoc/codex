// A dot's local computer, run as the Codex desktop app runs its local Work executor: this
// installation registers under the ChatGPT login (/flora/cca/executor), then
// `codex exec-server --remote` holds a relay to ChatGPT's environment registry so the dot's cloud
// threads can work on this machine. Off until the user turns it on; it ends with codex-ui.
import { spawn as spawnChild } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { readLines, stop } from "./process.mjs";

const REGISTRY = "https://codex-cloud-environments.chatgpt.com/api";

/**
 * The registry exec-server dials (CODEX_TPP_LOCAL_EXECUTOR_REMOTE_URL overrides it, as in the
 * desktop app): the production host over https, or http on loopback only.
 */
export function registryUrl() {
  const raw = process.env.CODEX_TPP_LOCAL_EXECUTOR_REMOTE_URL?.trim() || REGISTRY;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash) return null;
    const ok = (url.protocol === "https:" && url.host === new URL(REGISTRY).host)
      || (url.protocol === "http:" && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(url.hostname));
    return ok ? url.href.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

/** The relay's state from one exec-server log line: `ok` once it reaches rendezvous, false when it drops. */
export function rendezvous(line) {
  const text = stripVTControlCharacters(line);
  if (!text.includes('noise_event="rendezvous_connection"')) return null;
  const outcome = /\bnoise_outcome="(ok|disconnected|error)"/.exec(text)?.[1];
  return outcome ? outcome === "ok" : null;
}

/**
 * `launch()` names the codex command (`{command, args, env, shell, codexHome}`), `register(body)`
 * resolves to the executor id, and `reportReady(environmentId, roots, reported)` tells the dot's
 * threads the computer is up (adding each thread it told to `reported`).
 */
export function createExecutor({ dir, launch, register, reportReady, spawn = spawnChild }) {
  const file = path.join(dir, "local-executor.json");
  const saved = read();
  let child = null, environmentId = null, ready = false, error = null;
  let attempt = 0, starting = false, timer = null, delay = 1000, closed = false, reporting = false;
  let roots = [];
  let reported = new Set();
  // Threads created while it is up hear of it within five minutes, as a reconnect would tell them.
  const sweep = setInterval(() => void report(), 5 * 60_000);
  sweep.unref?.();

  function read() {
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      if (typeof value?.installationId === "string" && /^[0-9a-f-]{36}$/.test(value.installationId)) return { installationId: value.installationId, enabled: value.enabled === true };
    } catch { /* first run */ }
    return { installationId: randomUUID(), enabled: false };
  }

  function save() {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(saved)}\n`, { mode: 0o600 });
  }

  function state() {
    return { available: true, enabled: saved.enabled, environmentId, ready, error };
  }

  async function start() {
    if (closed || !saved.enabled || child || starting) return;
    const run = ++attempt;
    starting = true;
    error = null;
    try {
      const remote = registryUrl();
      if (!remote) throw new Error("本机电脑的注册地址不被允许。");
      const plan = launch();
      roots = [{ id: "codex-home-skills", path: path.join(plan.codexHome, "skills") }];
      const id = await register({ displayName: hostname().slice(0, 100), installation_id: saved.installationId, selected_capability_roots: roots });
      if (run !== attempt || closed || !saved.enabled) return;
      environmentId = id;
      const proc = spawn(plan.command, [...plan.args, "-c", 'forced_login_method="chatgpt"', "exec-server", "--remote", remote, "--environment-id", id], {
        cwd: homedir(),
        // It exits once our end of its stdin closes, so it never outlives codex-ui; its login is
        // codex's own (CODEX_HOME), never a token of ours.
        env: { ...plan.env, CODEX_EXEC_SERVER_EXIT_ON_STDIN_CLOSE: "true", RUST_LOG: "error,codex_exec_server::remote=info" },
        shell: plan.shell ?? false,
        stdio: ["pipe", "ignore", "pipe"],
        windowsHide: true,
      });
      child = proc;
      proc.stdin.on("error", () => {});
      readLines(proc.stderr, {
        maxBytes: 64 * 1024,
        line: (line) => {
          const up = rendezvous(line);
          if (up === null || child !== proc) return;
          ready = up;
          if (up) {
            delay = 1000;
            void report();
          } else reported = new Set();
        },
        error: () => {},
      });
      const ended = (code) => {
        if (child !== proc) return;
        child = null;
        ready = false;
        reported = new Set();
        error = typeof code === "number" ? `本机电脑的连接已退出（代码 ${code}）` : "本机电脑的连接未能启动";
        retry();
      };
      proc.once("exit", ended);
      proc.once("error", () => ended(null));
    } catch (failure) {
      if (run !== attempt) return;
      error = failure?.message || "本机电脑未能启动";
      retry();
    } finally {
      starting = false;
    }
  }

  function retry() {
    if (closed || !saved.enabled || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void start();
    }, delay);
    timer.unref?.();
    delay = Math.min(delay * 2, 60_000);
  }

  async function report() {
    const id = environmentId;
    if (!ready || !id || reporting) return;
    reporting = true;
    try { await reportReady(id, roots, reported); } catch { /* the next sweep or reconnect retries */ } finally { reporting = false; }
  }

  function halt(force) {
    attempt++;
    clearTimeout(timer);
    timer = null;
    const proc = child;
    child = null;
    environmentId = null;
    ready = false;
    reported = new Set();
    if (proc) stop(proc, force);
  }

  return {
    state,
    /** Turns it on or off for good (the choice survives restarts). */
    async setEnabled(on) {
      saved.enabled = on === true;
      save();
      if (saved.enabled) {
        delay = 1000;
        await start();
        // Asked while it is up (a dot just attached it): its threads hear of it now.
        await report();
      } else {
        halt(false);
        error = null;
      }
      return state();
    },
    /** A page connected: start now if it is on and waiting (registering needs a page's login). */
    wake() {
      if (!saved.enabled || child || starting) return;
      clearTimeout(timer);
      timer = null;
      void start();
    },
    close() {
      closed = true;
      clearInterval(sweep);
      halt(true);
    },
  };
}
