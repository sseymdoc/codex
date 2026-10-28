// 自动修复 (auto-fix): pull requests a session watches, read in the background while the app
// runs, whichever session is on screen. When CI fails on a head, GitHub reports a merge conflict
// or someone leaves new review comments, the session is woken with a <ci-monitor-event> message
// (context/ci-monitor.mjs) once it is idle; each change is reported once. A PR that merges or
// closes, or leaves the session, stops being watched.

import { useSyncExternalStore } from "react";
import { ciMonitorEvent } from "../../context/ci-monitor.mjs";
import { ensureThreads, isArchivedThread, readPr, threadCwd } from "./codex";
import { wakeSession } from "./linked";
import { monitorChange, parsePr, type PrStatus, type PrWatch } from "./pr";
import { getState, readJson, writeJson } from "./store";

interface Watch extends PrWatch { url: string }

/** Watched PRs by session, then by attachment key, kept across restarts. */
const KEY = "codex-ui:pr-monitor";
let watches: Record<string, Record<string, Watch>> = (readJson(KEY) as Record<string, Record<string, Watch>> | null) ?? {};
const listeners = new Set<() => void>();
let version = 0;

function save() {
  writeJson(KEY, watches);
  version += 1;
  listeners.forEach((listener) => listener());
}

export const isMonitored = (threadId: string, key: string): boolean => !!watches[threadId]?.[key];

/** The 自动修复 switch: on starts watching (the first read only notes the comments already there). */
export function setMonitored(threadId: string, key: string, url: string, on: boolean): void {
  if (on === isMonitored(threadId, key)) return;
  const own = { ...watches[threadId] };
  if (on) own[key] = { url, fired: [], seen: null };
  else delete own[key];
  watches = { ...watches, [threadId]: own };
  if (!Object.keys(own).length) delete watches[threadId];
  due.delete(`${threadId}\0${key}`);
  save();
  if (on) void pollNow();
}

export function useMonitored(threadId: string, key: string): boolean {
  useSyncExternalStore((listener) => (listeners.add(listener), () => void listeners.delete(listener)), () => version);
  return isMonitored(threadId, key);
}

/** When each PR is read next, and how many reads in a row failed (backoff). */
const due = new Map<string, number>();
const failures = new Map<string, number>();
let polling = false;
let timer: ReturnType<typeof setInterval> | undefined;

/** Starts the background reads once; App calls it. */
export function startPrMonitor(): void {
  if (timer) return;
  timer = setInterval(() => void pollNow(), 30_000);
  void pollNow();
}

/**
 * One round: every watched PR that is due is read; what changed wakes its session when the
 * session can take it, else waits for the next round. Exported for tests and the switch.
 */
export async function pollNow(now = Date.now()): Promise<void> {
  if (polling || getState().conn.status !== "ready") return;
  polling = true;
  try {
    for (const threadId of Object.keys(watches)) {
      if (!getState().threads[threadId]) await ensureThreads([threadId]);
      const thread = getState().threads[threadId];
      // A deleted session takes its watches with it; an archived one keeps them, paused.
      if (!thread) {
        delete watches[threadId];
        save();
        continue;
      }
      if (isArchivedThread(threadId)) continue;
      for (const [key, watch] of Object.entries(watches[threadId] ?? {})) {
        const at = `${threadId}\0${key}`;
        if ((due.get(at) ?? 0) > now) continue;
        // Removed from the session (移除, unbind_pr): no longer watched.
        if (thread.attachments && !thread.attachments.some((a) => a.attachmentType === "pull_request" && a.identityKey === key)) {
          setMonitored(threadId, key, watch.url, false);
          continue;
        }
        const { status, problem } = await readPr(threadCwd(thread), watch.url);
        if (!status) {
          const failed = (failures.get(at) ?? 0) + 1;
          failures.set(at, failed);
          due.set(at, now + (problem?.kind === "rateLimit" ? 900_000 : Math.min(60_000 * 2 ** (failed - 1), 900_000)));
          continue;
        }
        failures.delete(at);
        due.set(at, now + (status.ci.status === "pending" ? 60_000 : 120_000));
        step(threadId, key, watch, status);
      }
    }
  } finally {
    polling = false;
  }
}

/** What one read means for its watch: stop, report the changes (once delivered), or note the comments seen. */
function step(threadId: string, key: string, watch: Watch, status: PrStatus): void {
  const change = monitorChange(watch, status);
  if (change.stop) return setMonitored(threadId, key, watch.url, false);
  const link = parsePr(status.url);
  const sent = change.parts.length > 0 && !!link && wakeSession(threadId, ciMonitorEvent({ url: link.url, number: link.number, title: status.title, parts: change.parts }));
  // Undelivered changes are judged again next round; the comments a first read finds are only noted.
  const next = sent ? { ...watch, fired: change.fired, seen: change.seen } : watch.seen === null && change.seen !== null ? { ...watch, seen: change.seen } : watch;
  if (next === watch || !watches[threadId]?.[key]) return;
  watches = { ...watches, [threadId]: { ...watches[threadId], [key]: next } };
  save();
}
