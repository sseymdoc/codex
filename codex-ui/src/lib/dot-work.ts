// A dot's work (the Codex desktop app's work view, orbit-conversation-route): its root thread and
// the task threads it starts run on ChatGPT's durable app-server host. The page reaches it through
// the bridge as a second app-server connection (server/orchestrator.mjs connectDurable), with the
// same JSON-RPC and a handful of calls: resume and read a thread, page its turns, send a message
// (`turn/addUserMessage`, the host's admission of a user message), stop it. Its threads live in the
// store's durableThreads, so the transcript draws them as any thread; none of them reaches the
// sidebar, the session list or notifications.
import type { Thread } from "@protocol/v2/Thread";
import { useSyncExternalStore } from "react";
import { obj, str } from "./cloud";
import { applyNotification, connectionId, errorMessage, VERSION } from "./codex";
import { dotCall as call, dotPath, dotsState } from "./dots";
import { Rpc, RpcError, type Method } from "./rpc";
import { emptyThreadState, getState, setState, type ThreadState, type TurnState } from "./store";

export interface DotTaskInfo {
  title: string;
  /** A task thread the user can write to (`kind: thread`); a sub-agent's is read only. */
  interactive: boolean;
}

interface WorkState {
  /** The Dots page shows the dot's messages or its work. */
  mode: "chat" | "work";
  /** The task open in the work view (else its root thread). */
  taskId: string | null;
  status: "idle" | "connecting" | "ready" | "failed";
  error: string | null;
  /** Per thread: why it could not open. */
  failures: Record<string, string>;
  tasks: Record<string, DotTaskInfo>;
}

let state: WorkState = { mode: "chat", taskId: null, status: "idle", error: null, failures: {}, tasks: {} };
const listeners = new Set<() => void>();
const set = (patch: Partial<WorkState>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

export function useDotWork<T>(pick: (s: WorkState) => T): T {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => pick(state));
}

export const setDotMode = (mode: WorkState["mode"]) => set({ mode, ...(mode === "chat" ? { taskId: null } : {}) });

/** Back from a task to the dot's root thread. */
export const closeDotTask = () => set({ taskId: null });

/** Opens one of the dot's tasks in the work view (a task card, an activity row). */
export function openDotTask(threadId: string): void {
  set({ mode: "work", taskId: threadId === dotsState().dot?.rootThreadId ? null : threadId });
}

/** The thread notifications the work view folds in; the host's others are not this page's. */
const FOLDED = /^(turn\/|item\/|thread\/(status|name|tokenUsage)\/)/;

let rpc: Rpc | null = null;
let ready: Promise<Rpc> | null = null;

/** The durable host's connection, opened once and initialized as an app-server client. */
function durable(): Promise<Rpc> {
  if (ready) return ready;
  const parent = connectionId();
  if (!parent) return Promise.reject(new Error("未连接到 app-server"));
  set({ status: "connecting", error: null });
  const opening = new Promise<Rpc>((resolve, reject) => {
    const client: Rpc = new Rpc({
      open: () => {
        client.request("initialize", { clientInfo: { name: "codex_ui", title: "Codex UI", version: VERSION }, capabilities: { experimentalApi: true } }).then(() => {
          client.notify("initialized");
          set({ status: "ready" });
          resolve(client);
        }, (error) => {
          client.disconnect();
          reject(error);
        });
      },
      close: (reason) => {
        if (rpc === client) {
          rpc = null;
          ready = null;
        }
        set({ status: "failed", error: reason });
        reject(new Error(reason));
      },
      notification: (notification) => {
        if (FOLDED.test(notification.method)) applyNotification(notification);
      },
      // Questions and approvals of the dot's are answered in ChatGPT, not here.
      request: () => {},
    }, `/api/events?durable=${encodeURIComponent(parent)}`);
    rpc = client;
    void client.connect();
  });
  ready = opening;
  opening.catch(() => {
    if (ready === opening) ready = null;
  });
  return opening;
}

const PAGE = 20;

/** A page of turns, oldest first, with where the page before it starts. */
async function turnsOf(client: Rpc, threadId: string, cursor: string | null) {
  const answer = await client.request<{ data: TurnState[]; nextCursor: string | null }>("thread/turns/list", { threadId, cursor, limit: PAGE, sortDirection: "desc", itemsView: "full" });
  return { turns: answer.data.slice().reverse(), cursor: answer.nextCursor };
}

const putThread = (thread: ThreadState) => setState((s) => ({ durableThreads: { ...s.durableThreads, [thread.meta.id]: thread } }));

/**
 * Opens one of the dot's threads: resumed on the host (it then streams its turns here), else read
 * as it stands; its latest turns come in pages. A task's title and whether it takes messages come
 * from the dot's thread list.
 */
export async function openDotThread(threadId: string): Promise<void> {
  set({ failures: { ...state.failures, [threadId]: "" } });
  const dot = dotsState().dot;
  if (dot && threadId !== dot.rootThreadId && !state.tasks[threadId]) {
    void call<unknown>("GET", `${dotPath(dot.id)}/threads/${encodeURIComponent(threadId)}`).then((raw) => {
      const meta = obj(raw);
      set({ tasks: { ...state.tasks, [threadId]: { title: str(meta.title).trim() || "已创建的任务", interactive: str(meta.kind) === "thread" } } });
    }, () => {});
  }
  try {
    const client = await durable();
    let meta: Thread;
    let subscribed = true;
    try {
      meta = (await client.request<{ thread: Thread }>("thread/resume", { threadId, excludeTurns: true })).thread;
    } catch {
      meta = (await client.request<{ thread: Thread }>("thread/read", { threadId, includeTurns: false })).thread;
      subscribed = false;
    }
    const page = await turnsOf(client, threadId, null);
    const base = emptyThreadState(meta);
    putThread({ ...(getState().durableThreads[threadId] ?? base), meta: base.meta, turns: page.turns, olderCursor: page.cursor, loaded: true, loading: false, subscribed });
  } catch (error) {
    set({ failures: { ...state.failures, [threadId]: errorMessage(error) } });
  }
}

/** The page of turns before the oldest shown. */
export async function loadOlderDotTurns(threadId: string): Promise<void> {
  const thread = getState().durableThreads[threadId];
  if (!rpc || !thread?.olderCursor || thread.loading) return;
  putThread({ ...thread, loading: true, olderError: false });
  try {
    const page = await turnsOf(rpc, threadId, thread.olderCursor);
    const current = getState().durableThreads[threadId] ?? thread;
    putThread({ ...current, turns: [...page.turns, ...current.turns.filter((turn) => !page.turns.some((older) => older.id === turn.id))], olderCursor: page.cursor, loading: false });
  } catch {
    putThread({ ...(getState().durableThreads[threadId] ?? thread), loading: false, olderError: true });
  }
}

/** One conversation thread of messages per dot thread (the host groups a thread's user messages by it). */
const messageThreads = new Map<string, string>();

/**
 * Sends a message into a dot's thread as the desktop app does: the host admits it (starting a
 * turn, steering the running one, or recognizing a repeat by its client message id).
 */
export async function sendToDotThread(threadId: string, text: string): Promise<void> {
  const client = await durable();
  if (!messageThreads.has(threadId)) messageThreads.set(threadId, crypto.randomUUID());
  await client.request("turn/addUserMessage" as Method, {
    threadId,
    input: [{ type: "text", text, text_elements: [] }],
    clientUserMessageId: crypto.randomUUID(),
    messageThreadId: messageThreads.get(threadId),
  });
}

/** Stops a dot's thread: the host's stop, else (an older host) the running turn's interrupt. */
export async function stopDotThread(threadId: string): Promise<void> {
  const client = await durable();
  try {
    await client.request("thread/stop" as Method, { threadId });
  } catch (error) {
    const running = getState().durableThreads[threadId]?.turns.findLast((turn) => turn.status === "inProgress");
    if (!(error instanceof RpcError && error.code === -32601) || !running) throw error;
    await client.request("turn/interrupt", { threadId, turnId: running.id });
  }
}

/** The account changed or the page left: the host's connection and its threads go. */
export function resetDotWork(): void {
  rpc?.disconnect();
  rpc = null;
  ready = null;
  messageThreads.clear();
  setState({ durableThreads: {} });
  set({ mode: "chat", taskId: null, status: "idle", error: null, failures: {}, tasks: {} });
}
