import { CHAT_ID, chatFailure, createChatStore } from "./chat-store.mjs";

const MESSAGES = {
  sign_in_required: "请先连接 ChatGPT 账号。", sharing_not_enabled: "此账号尚未授权使用 ChatGPT 套餐。",
  cancelled: "已停止。", connection_busy: "请先完成当前账号操作。", connection_changed: "账号已改变，请重新操作。",
  account_mismatch: "返回的账号与所选账号不同，请重新登录。", reauth_required: "授权已失效，请重新登录。",
  network_error: "无法连接 ChatGPT，请检查网络。", stream_interrupted: "回复连接中断，已保留收到的内容。",
  response_incomplete: "回复未完成，已保留收到的内容。", invalid_stream: "回复流异常，已保留收到的内容。",
  subscription_sharing_usage_limit_exceeded: "ChatGPT 套餐用量已达上限，请打开管理用量。",
  subscription_sharing_usage_unavailable: "当前无法使用 ChatGPT 套餐，请打开管理用量。",
  storage_unavailable: "系统凭据保护不可用，原凭据文件已保留。",
  storage_invalid: "凭据无法读取，原文件已保留。", invalid_grant: "登录授权已过期，请重新连接。",
  context_length_exceeded: "对话已超过模型上下文上限，请新建聊天。",
  response_too_large: "回复过大，已保留收到的内容。请缩小问题范围。",
};

/** Upstream errors can contain request bodies; only known, fixed messages cross the bridge. */
export function chatError(error) {
  const code = typeof error?.code === "string" && /^[a-z0-9_]{1,100}$/i.test(error.code) ? error.code : "chat_failed";
  const local = ["history_invalid", "history_full", "chat_busy", "chat_not_found", "invalid_input", "model_unavailable", "chat_disabled", "connection_closed"];
  return { code, message: MESSAGES[code] ?? (local.includes(code) ? error.message : "无法完成聊天操作，请检查连接或重新登录。") };
}

/** The desktop owns one service; no token, file path or upstream request is supplied by the page. */
export function createChatService({ root, client }) {
  const store = createChatStore(root), listeners = new Set(), active = new Map(), documents = new Map(), catalogs = new Map();
  let closed = false, changing = false;
  const emit = (event, data) => { for (const listener of listeners) { try { listener(event, structuredClone(data)); } catch {} } };
  const safeSession = (session) => ({ ...session, ...(session.error ? { error: chatError(session.error) } : {}) });
  const unsubscribe = client.subscribe((session) => emit("account", safeSession(session)));
  const key = (profileId, id) => `${profileId}/${id}`;
  const assertOpen = () => { if (closed) throw chatFailure("chat_disabled", "聊天服务已关闭。", 403); };
  async function account(connected = false) {
    assertOpen();
    if (changing) throw chatFailure("connection_busy", MESSAGES.connection_busy, 409);
    const session = await client.getSession();
    assertOpen();
    if (changing) throw chatFailure("connection_busy", MESSAGES.connection_busy, 409);
    if (!session.profileId || (connected && (session.status !== "connected" || !session.sharing))) throw chatFailure("sign_in_required", MESSAGES.sign_in_required, 401);
    return session.profileId;
  }
  function load(profileId, id) {
    const cacheKey = key(profileId, id);
    if (!documents.has(cacheKey)) {
      let chat;
      try { chat = store.read(profileId, id); } catch (error) {
        if (error.code === "ENOENT") throw chatFailure("chat_not_found", "找不到此账号的聊天记录。", 404);
        throw error;
      }
      // A process exit cannot resume a store:false response; never resend it automatically.
      let interrupted = false;
      for (const turn of chat.turns) if (turn.status === "running") {
        turn.status = "cancelled";
        turn.error = { code: "cancelled", message: "上次回复已中断，未自动重发。" };
        interrupted = true;
      }
      if (interrupted) store.write(chat);
      documents.set(cacheKey, chat);
    }
    return documents.get(cacheKey);
  }
  const stopAll = () => { for (const run of active.values()) run.abort.abort(); client.cancelSignIn(); };
  async function status() {
    assertOpen();
    return { available: true, session: safeSession(await client.getSession()), profiles: await client.listProfiles(), working: active.size };
  }
  async function models() {
    const profileId = await account(true), items = await client.listModels();
    if (profileId !== await account(true)) throw chatFailure("connection_changed", MESSAGES.connection_changed, 409);
    catalogs.set(profileId, items);
    return items;
  }
  async function chooseModel(profileId, model) {
    const items = catalogs.get(profileId) ?? await models();
    if (profileId !== await account(true)) throw chatFailure("connection_changed", MESSAGES.connection_changed, 409);
    if (typeof model !== "string" || !items.some((item) => item.slug === model)) throw chatFailure("model_unavailable", "所选模型不在此账号的模型目录中，请刷新模型。", 400);
  }
  async function change(run) {
    assertOpen();
    if (changing) throw chatFailure("connection_busy", MESSAGES.connection_busy, 409);
    changing = true;
    stopAll();
    catalogs.clear();
    try { await run(); return await status(); }
    finally { changing = false; emit("changed", {}); }
  }
  async function generate(chat, turn, run) {
    let timer, writeError;
    const checkpoint = () => {
      timer = undefined;
      try { store.write(chat); } catch (error) { writeError = error; run.abort.abort(); }
    };
    try {
      const input = chat.turns.slice(0, -1).flatMap((item) => [
        { role: "user", content: item.user }, ...(item.assistant ? [{ role: "assistant", content: item.assistant }] : []),
      ]);
      input.push({ role: "user", content: turn.user });
      const result = await client.streamResponse({ model: turn.model, input, signal: run.abort.signal, onDelta(text) {
        if (run.abort.signal.aborted) return;
        turn.assistant += text;
        emit("delta", { profileId: chat.profileId, id: chat.id, turnId: turn.id, offset: turn.assistant.length - text.length, text });
        timer ??= setTimeout(checkpoint, 500);
      } });
      if (writeError) throw writeError;
      run.abort.signal.throwIfAborted();
      turn.assistant = result.text;
      turn.status = "completed";
    } catch (error) {
      turn.status = !writeError && run.abort.signal.aborted ? "cancelled" : "failed";
      turn.error = chatError(writeError ?? (run.abort.signal.aborted ? { code: "cancelled" } : error));
    } finally {
      clearTimeout(timer);
      chat.updatedAt = Date.now();
      try { store.write(chat); } catch {
        turn.status = "failed";
        turn.error = { code: "history_write_failed", message: "回复暂未保存到磁盘，请复制内容后检查磁盘权限或空间。" };
      }
      active.delete(key(chat.profileId, chat.id));
      emit("chat", chat);
      emit("changed", {});
    }
  }
  async function request(action, body = {}) {
    assertOpen();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw chatFailure("invalid_input", "聊天请求格式无效。");
    if (action === "status") return status();
    if (action === "login/cancel") { client.cancelSignIn(); return {}; }
    if (action === "login") return change(() => client.signIn({ newProfile: body.newProfile === true, reconsent: body.reconsent === true }));
    if (action === "logout") return change(() => client.disconnect());
    if (action === "account") {
      if (typeof body.profileId !== "string") throw chatFailure("invalid_input", "请选择账号。");
      return change(() => client.selectProfile(body.profileId));
    }
    if (action === "models") return { models: await models() };
    const profileId = await account(action === "send" || action === "create");
    if (action === "list") return { chats: store.list(profileId) };
    if (action === "create") {
      await chooseModel(profileId, body.model);
      const chat = store.create(profileId, body.model);
      documents.set(key(profileId, chat.id), chat);
      emit("changed", {});
      return { chat };
    }
    const chat = load(profileId, body.id), cacheKey = key(profileId, chat.id);
    if (action === "read") return { chat: structuredClone(chat) };
    if (action === "cancel") { active.get(cacheKey)?.abort.abort(); return {}; }
    if (action === "delete") {
      if (active.has(cacheKey)) throw chatFailure("chat_busy", "请先停止当前回复。", 409);
      store.remove(profileId, chat.id);
      documents.delete(cacheKey);
      emit("changed", {});
      return {};
    }
    if (action !== "send") throw chatFailure("invalid_input", "不支持的聊天操作。", 404);
    if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 256 * 1024 || typeof body.turnId !== "string" || !CHAT_ID.test(body.turnId)) {
      throw chatFailure("invalid_input", "请输入有效文本（最多 256 Ki 字符）。");
    }
    await chooseModel(profileId, body.model);
    // A lost HTTP acknowledgement must not append or send the same user message twice.
    if (chat.turns.some((turn) => turn.id === body.turnId)) return { chat: structuredClone(chat) };
    if (active.has(cacheKey)) throw chatFailure("chat_busy", "当前聊天仍在回复。", 409);
    const turn = { id: body.turnId, user: body.text, assistant: "", model: body.model, status: "running" };
    const previous = { model: chat.model, title: chat.title, updatedAt: chat.updatedAt };
    chat.turns.push(turn);
    chat.model = body.model;
    if (chat.turns.length === 1) chat.title = Array.from(body.text.trim().split(/\r?\n/)[0]).slice(0, 60).join("");
    chat.updatedAt = Date.now();
    try { store.write(chat); } catch (error) { chat.turns.pop(); Object.assign(chat, previous); throw error; }
    const run = { abort: new AbortController() };
    active.set(cacheKey, run);
    emit("chat", chat);
    emit("changed", {});
    run.done = generate(chat, turn, run);
    return { chat: structuredClone(chat) };
  }
  return {
    request,
    subscribe(listener) { assertOpen(); listeners.add(listener); return () => listeners.delete(listener); },
    stop: stopAll,
    async close() {
      closed = true;
      stopAll();
      await Promise.allSettled([...active.values()].map((run) => run.done));
      unsubscribe(); listeners.clear();
    },
  };
}
