import { useEffect, useRef, useState } from "react";
import { chatAccountAction, clearChatError, deleteChat, refreshChat, selectChat, selectChatModel, sendChat, setChatDraft, stopChat, useChat } from "../lib/chat";
import { newChat } from "../lib/codex";
import { Markdown, PlainLinks } from "./content";
import { Button, Spinner } from "./ui";
import "../styles/chat.css";

const USAGE = "https://chatgpt.com/settings/usage";

export function ChatView() {
  const state = useChat((s) => s), chat = state.selectedId ? state.documents[state.selectedId] : undefined;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [welcomed, setWelcomed] = useState<string[]>(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem("codex-ui:siwc-welcomed") || "[]"); return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : []; } catch { return []; }
  });
  const composer = useRef<HTMLTextAreaElement>(null), bottom = useRef<HTMLDivElement>(null), composing = useRef(false);
  const stick = useRef(true);
  const draftId = `${state.session?.profileId ?? ""}/${state.selectedId ?? "new"}`, text = state.drafts[draftId] ?? "";
  const running = chat?.turns.some((turn) => turn.status === "running") ?? false;
  const connected = state.session?.status === "connected" && state.session.sharing;
  const profile = state.session?.profileId;
  const showWelcome = !!connected && !!profile && !welcomed.includes(profile);
  const updateText = (value: string) => setChatDraft(draftId, value);
  useEffect(() => { document.title = `${chat?.title ?? "聊天"} — Codex UI`; setConfirmDelete(false); }, [chat?.id, chat?.title]);
  useEffect(() => { stick.current = true; }, [state.selectedId]);
  useEffect(() => { if (stick.current) bottom.current?.scrollIntoView({ block: "nearest" }); }, [chat?.turns.at(-1)?.assistant, state.selectedId]);
  async function submit() {
    if (!text.trim() || running || state.busy || !connected || !state.model) return;
    await sendChat(text);
    composer.current?.focus();
  }
  function welcome() {
    if (!profile) return;
    const next = [...welcomed, profile]; setWelcomed(next);
    try { localStorage.setItem("codex-ui:siwc-welcomed", JSON.stringify(next)); } catch {}
  }
  return (
    <div className="main-col siwc-chat" data-testid="siwc-chat">
      <header className="chat-header" data-density="compact">
        <h1 className="draft-title">{chat?.title ?? "聊天"}</h1>
        <span className="spacer" />
        <Button variant="ghost" disabled={state.busy} onClick={() => selectChat(null)}>新聊天</Button>
        <Button variant="ghost" onClick={newChat}>返回 Code</Button>
        {chat && <Button variant="ghost" disabled={running || state.busy} onClick={() => setConfirmDelete(true)}>删除</Button>}
      </header>
      <div className="siwc-account">
        <span>{state.session?.identity?.email ?? state.session?.profileLabel ?? "ChatGPT 账号"}</span>
        {state.profiles.length > 1 && <select aria-label="聊天账号" disabled={state.busy} value={profile ?? ""} onChange={(event) => void chatAccountAction("account", { profileId: event.target.value })}>
          {state.profiles.map((item) => <option key={item.id} value={item.id}>{item.identity?.email || item.label} · {item.label}</option>)}
        </select>}
        {state.session?.status === "connecting" || state.busy && !connected ? (
          <><Spinner /><Button variant="ghost" onClick={() => void chatAccountAction("login/cancel")}>取消登录</Button></>
        ) : connected ? (
          <><Button variant="ghost" disabled={state.busy} onClick={() => void chatAccountAction("login", { newProfile: true })}>添加账号</Button>
            <Button variant="ghost" disabled={state.busy} onClick={() => void chatAccountAction("logout")}>断开连接</Button></>
        ) : <Button variant="primary" disabled={state.busy} onClick={() => void chatAccountAction("login", { reconsent: state.session?.status === "connected" })}>使用 ChatGPT 继续</Button>}
      </div>
      {showWelcome && <div className="siwc-notice" role="status"><div>你正在使用 ChatGPT 套餐。聊天记录保存在本机，可在 ChatGPT 设置中管理用量。</div><Button variant="ghost" onClick={welcome}>知道了</Button></div>}
      {confirmDelete && chat && <div className="siwc-notice" role="alert"><span>删除这条本地聊天记录？此操作无法撤销。</span><Button variant="ghost" onClick={() => setConfirmDelete(false)}>取消</Button><Button variant="primary" onClick={() => { setConfirmDelete(false); void deleteChat(chat.id); }}>删除此聊天</Button></div>}
      {(state.error || state.session?.error) && <div className="siwc-notice" role="alert"><span>{state.error || state.session?.error?.message}</span><Button variant="ghost" onClick={() => { clearChatError(); void refreshChat(true); }}>刷新</Button></div>}
      <div className="session-row"><div className="session-chat">
        <div className="transcript-wrap"><div className="transcript" role="feed" aria-label="聊天消息" aria-busy={running} onScroll={(event) => { const el = event.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
          {!chat?.turns.length ? <div className="transcript-empty"><p className="transcript-empty-title">{connected ? "开始新的聊天" : "连接你的 ChatGPT 账号"}</p><p className="transcript-empty-body">使用 ChatGPT 套餐，聊天记录仅保存在 Codex UI 本机。这里不会读取项目文件或运行命令。</p></div> : (
            <PlainLinks value><div className="siwc-turns">
              {chat.turns.map((turn) => <article key={turn.id} className="siwc-turn">
                <div className="siwc-user">{turn.user}</div>
                <div className="siwc-assistant"><Markdown text={turn.assistant} streaming={turn.status === "running"} localLinks={false} />
                  {turn.status === "running" && <span className="siwc-working" role="status"><Spinner />正在回复…</span>}
                  {turn.error && <p className="siwc-turn-error" role="status">{turn.error.message}</p>}
                  {turn.assistant && <Button variant="ghost" onClick={() => void navigator.clipboard.writeText(turn.assistant)}>复制</Button>}
                </div>
              </article>)}
            </div></PlainLinks>
          )}<div ref={bottom} />
        </div></div>
        <div className="dock">
          <div className="siwc-model-row">
            <select aria-label="聊天模型" value={state.model} disabled={!connected || state.busy || running} onChange={(event) => selectChatModel(event.target.value)}>
              {!state.models.length && <option value="">{connected ? "正在加载模型…" : "连接后选择模型"}</option>}
              {state.models.map((model) => <option key={model.slug} value={model.slug}>{model.displayName}</option>)}
            </select>
            {connected && <span>使用 ChatGPT 套餐</span>}
            <a href={USAGE} target="_blank" rel="noopener noreferrer">管理用量</a>
          </div>
          <form className="siwc-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <textarea ref={composer} value={text} disabled={!connected || state.busy} rows={3} aria-label="聊天消息" placeholder="输入消息…" maxLength={256 * 1024}
              onChange={(event) => updateText(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current) { event.preventDefault(); void submit(); } }} />
            {running && chat ? <Button type="button" variant="ghost" onClick={() => void stopChat(chat.id)}>停止</Button> : <Button type="submit" variant="primary" disabled={!text.trim() || !connected || !state.model || state.busy}>发送</Button>}
          </form>
        </div>
      </div></div>
    </div>
  );
}
