// Scratch workspaces, as Claude Desktop makes them (index.chunk-Uk7wsaDw.js): a session started on
// 本电脑 with no folder works in a fresh <CODEX_HOME>/codex-ui/scratch-workspaces/scratch-<date>-<hex>.
// A sweep removes the ones no session works in any more: an empty one an hour after it was made, any
// other once nothing in it changed for a week. Which ones a session holds only the page can ask Codex
// (thread/list), so it takes `stale()`, leaves out those, and has `remove()` drop the rest.
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { codexHome } from "./automations.mjs";

const NAME = /^scratch-\d{4}-\d{2}-\d{2}-[0-9a-f]{6}$/;
const EMPTY_AGE = 3_600_000;
const IDLE_AGE = 7 * 86_400_000;

export function createScratch({ home = codexHome(), now = Date.now } = {}) {
  const root = path.join(home, "codex-ui", "scratch-workspaces");

  /** The newest change in a folder's tree, links not followed; stops early once one is after `after`. */
  async function newest(dir, after) {
    let latest = (await stat(dir)).mtimeMs;
    const walk = async (at) => {
      for (const entry of await readdir(at, { withFileTypes: true }).catch(() => [])) {
        if (latest > after) return;
        const where = path.join(at, entry.name);
        const info = await lstat(where).catch(() => null);
        if (!info) continue;
        latest = Math.max(latest, info.mtimeMs);
        if (info.isDirectory()) await walk(where);
      }
    };
    await walk(dir);
    return latest;
  }

  async function isStale(dir) {
    const info = await lstat(dir).catch(() => null);
    if (!info?.isDirectory()) return false;
    if (!(await readdir(dir)).length) return now() - info.mtimeMs >= EMPTY_AGE;
    return now() - (await newest(dir, now() - IDLE_AGE)) >= IDLE_AGE;
  }

  /** A new scratch workspace's path. */
  async function create() {
    await mkdir(root, { recursive: true });
    for (let attempt = 0; attempt < 5; attempt++) {
      const dir = path.join(root, `scratch-${new Date(now()).toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`);
      try {
        await mkdir(dir);
        return { cwd: dir };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
    throw new Error("找不到可用的临时工作区名称。");
  }

  /** The workspaces old enough to sweep, whether or not a session still works in them. */
  async function stale() {
    const paths = [];
    for (const name of await readdir(root).catch(() => [])) {
      const dir = path.join(root, name);
      if (NAME.test(name) && await isStale(dir).catch(() => false)) paths.push(dir);
    }
    return { paths };
  }

  /** Removes one `stale()` gave, if it is still one of ours and still stale. */
  async function remove(dir) {
    if (typeof dir !== "string" || path.dirname(dir) !== root || !NAME.test(path.basename(dir)) || !(await isStale(dir).catch(() => false))) return { removed: false };
    await rm(dir, { recursive: true, force: true });
    return { removed: true };
  }

  return { root, create, stale, remove };
}
