import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROFILE = /^[a-zA-Z0-9-]{1,100}$/;
const MAX_FILE = 64 * 1024 * 1024;
export const chatFailure = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const invalid = () => chatFailure("history_invalid", "聊天记录无法读取，原文件已保留。", 409);

function directory(dir) {
  mkdirSync(dir, { recursive: true });
  const info = lstatSync(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw invalid();
}

/** One desktop owner writes these files; SDK profile IDs keep registrations separate. */
export function createChatStore(root) {
  const folder = (profileId) => {
    if (typeof profileId !== "string" || !PROFILE.test(profileId)) throw invalid();
    directory(root);
    const dir = path.join(root, profileId);
    directory(dir);
    return dir;
  };
  const file = (profileId, id) => {
    if (typeof id !== "string" || !CHAT_ID.test(id)) throw invalid();
    return path.join(folder(profileId), `${id}.json`);
  };
  function regular(where, optional = false) {
    try {
      const info = lstatSync(where);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE) throw invalid();
    } catch (error) {
      if (optional && error.code === "ENOENT") return;
      throw error;
    }
  }
  function write(chat) {
    const where = file(chat.profileId, chat.id);
    regular(where, true);
    const text = JSON.stringify(chat);
    if (Buffer.byteLength(text) > MAX_FILE) throw chatFailure("history_full", "聊天记录过大，请新建聊天。", 413);
    const temporary = `${where}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, text, { flag: "wx", mode: 0o600 });
      renameSync(temporary, where);
    } finally {
      try { unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  function read(profileId, id) {
    const where = file(profileId, id);
    regular(where);
    let chat;
    try { chat = JSON.parse(readFileSync(where, "utf8")); } catch { throw invalid(); }
    if (chat?.version !== 1 || chat.id !== id || chat.profileId !== profileId || typeof chat.title !== "string" || typeof chat.model !== "string"
      || !Number.isFinite(chat.updatedAt) || !Array.isArray(chat.turns) || chat.turns.some((turn) => typeof turn?.id !== "string" || !CHAT_ID.test(turn.id)
        || typeof turn.user !== "string" || typeof turn.assistant !== "string" || typeof turn.model !== "string"
        || !["running", "completed", "cancelled", "failed"].includes(turn.status)
        || turn.error != null && (typeof turn.error.code !== "string" || typeof turn.error.message !== "string"))) throw invalid();
    return chat;
  }
  function list(profileId) {
    return readdirSync(folder(profileId)).filter((name) => CHAT_ID.test(name.replace(/\.json$/, "")) && name.endsWith(".json"))
      .map((name) => {
        const id = name.slice(0, -5);
        try {
          const chat = read(profileId, id);
          return { id, title: chat.title, model: chat.model, updatedAt: chat.updatedAt };
        } catch {
          return { id, title: "无法读取的聊天（文件已保留）", model: "", updatedAt: 0, unreadable: true };
        }
      }).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return {
    read, write, list,
    create(profileId, model) {
      const chat = { version: 1, id: randomUUID(), profileId, title: "新聊天", model, updatedAt: Date.now(), turns: [] };
      write(chat);
      return chat;
    },
    remove(profileId, id) {
      const where = file(profileId, id);
      regular(where);
      unlinkSync(where);
    },
  };
}
