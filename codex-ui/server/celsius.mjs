// ChatGPT's pubsub socket (celsius), as the Codex desktop app opens it for Dots (app-initial Lvt /
// fHt): ask for the socket URL, connect, say the window is in the foreground, subscribe to the
// messaging topic from the last offset. Commands go out as `[{command, id}]`; frames come back as
// arrays of topic messages (`{type: "message", topic_id, offset, payload}`) and command replies
// (`{id, reply}`, the subscribe reply carrying the `catchups` missed since the offset). Each event
// goes to `emit("dots", payload)`; `emit("live", {live})` says whether the socket is up, and a
// `resync` event follows every (re)connect, since anything may have been missed in between.

export const MESSAGING_TOPIC = "calpico-chatgpt-messaging";

export function celsiusFeed({ getUrl, WebSocket: Socket = globalThis.WebSocket, emit, signal, topic = MESSAGING_TOPIC }) {
  let offset;
  let delay = 1_000;
  let socket = null;
  let timer = null;
  let nextId = 1;
  let opened = false;

  const take = (entry) => {
    if (entry?.type !== "message" || entry.topic_id !== topic) return;
    if (typeof entry.offset === "string") offset = entry.offset;
    if (entry.payload && typeof entry.payload === "object") emit("dots", entry.payload);
  };

  const retry = () => {
    if (signal.aborted || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void open();
    }, delay);
    delay = Math.min(delay * 2, 30_000);
  };

  const open = async () => {
    let url;
    // A socket that never opened may have had a stale URL: ask for a new one.
    try { url = await getUrl(!opened); } catch { return retry(); }
    if (signal.aborted) return;
    opened = false;
    try { socket = new Socket(url); } catch { return retry(); }
    socket.addEventListener("open", () => {
      opened = true;
      delay = 1_000;
      const commands = [
        { presence: { state: "foreground", type: "presence" }, type: "connect" },
        { ...(offset ? { offset } : {}), topic_id: topic, type: "subscribe" },
      ];
      socket.send(JSON.stringify(commands.map((command) => ({ command, id: nextId++ }))));
      emit("live", { live: true });
      emit("dots", { type: "resync" });
    });
    socket.addEventListener("message", (event) => {
      let frame;
      try { frame = JSON.parse(typeof event.data === "string" ? event.data : ""); } catch { return; }
      if (!Array.isArray(frame)) return;
      for (const entry of frame) {
        if (entry?.type) take(entry);
        else if (entry?.reply?.type === "subscribe" && entry.reply.topic_id === topic) {
          for (const missed of Array.isArray(entry.reply.catchups) ? entry.reply.catchups : []) take(missed);
          if (typeof entry.reply.last_offset === "string") offset = entry.reply.last_offset;
        }
      }
    });
    socket.addEventListener("close", () => {
      socket = null;
      if (signal.aborted) return;
      emit("live", { live: false });
      retry();
    });
    socket.addEventListener("error", () => socket?.close());
  };

  signal.addEventListener("abort", () => {
    clearTimeout(timer);
    timer = null;
    socket?.close();
  }, { once: true });
  void open();
}
