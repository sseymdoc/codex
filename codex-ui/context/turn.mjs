// Claude 4.29's ccd_turn wrap_up (main index.chunk-CnwrM2Bo: Hn / Wn / Un, ar's wrap_up branch;
// live renderer cb27dab29 Me / je / Ee, c4de0b325 g0, cd4f82e77 Qe, shared-11 dD): the next-step
// box's fields, what the call answers the model, and what the box may draw. Pure; the host and the
// renderer share it.

/** Every app action Claude knows (vn); Codex UI can offer commit, create_pr and archive. */
export const APP_ACTIONS = Object.freeze(["commit", "create_pr", "merge", "fix_ci", "address_comments", "resolve_conflicts", "verify", "archive"]);
export const OFFERED_ACTIONS = Object.freeze(["commit", "create_pr", "archive"]);
export const RECAP_MAX = 300;
export const ASK_MAX = 100;
export const LABEL_MAX = 24;
export const LABEL_WORDS = 4;
export const MESSAGE_MAX = 300;
export const BUTTONS = 2;
const FIELD_MAX = 1200;
export const WRAP_UP_OFF = "wrap_up is turned off right now; write it as text instead.";

const LEAKED = /<\/?(?:antml:\w+|recap|ask|actions|blocked|outcome|failures|not_verified|needs_user|next_recap|next_ask|next_brief|next_actions|next|parameter|invoke)\b[^>]*>[\s\S]*$/;
const HIDDEN = /(?![\u200c\u200d])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u115f\u1160\u3164\uffa0\u2800\ufffc\u{1d159}\u{13441}\u{13442}\u{16910}]/gu;
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;

const cut = (text, max) => text.slice(0, max).replace(/[\ud800-\udbff]$/, "");
/** rr: a trimmed non-empty string, cut. */
const plain = (value, max) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
/** er: a field with a leaked tag and everything after it dropped. */
const field = (value, max = FIELD_MAX) => {
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(LEAKED, "").trim();
  return text ? cut(text, max) : undefined;
};
const flat = (value) => (typeof value === "string" ? value.normalize("NFC").replace(HIDDEN, "").replace(/\s+/g, " ").trim() : undefined);
/** Xn: text a click would send as a command (/, !) or that hides what it sends. */
export const unsafeReply = (value) => {
  const text = flat(value);
  return text !== undefined && (/^[/!]/.test(text) || IGNORABLE.test(text));
};
const yes = (value) => value === true || value === "true";
const blockedOf = (args) => yes(args.blocked) || field(args.needs_user) !== undefined;
const known = (actions) => (Array.isArray(actions) ? APP_ACTIONS.filter((action) => actions.includes(action)) : []);
/** zn: entries that are an app action (or new_session) or a reply with a label. */
const entries = (actions) => (Array.isArray(actions) ? actions : []).filter((entry) => {
  if (!entry || typeof entry !== "object") return false;
  return typeof entry.action === "string" ? entry.action === "new_session" || APP_ACTIONS.includes(entry.action) : plain(entry.label, LABEL_MAX) !== undefined;
});
/** bn: the app actions among the first two buttons that do not hold now; none when availability is unknown. */
function unavailable(actions, available) {
  if (available === undefined) return [];
  const holds = new Set(known(available));
  return entries(actions).slice(0, BUTTONS).flatMap((entry) => (typeof entry.action === "string" && entry.action !== "new_session" && !holds.has(entry.action) ? [entry.action] : []));
}

/** The arguments wrap_up accepts, current and previous field names; nothing else. */
export const WRAP_UP_KEYS = Object.freeze(["recap", "ask", "blocked", "actions", "outcome", "next_ask", "next_brief", "next_actions", "needs_user", "next_recap"]);

/**
 * What wrap_up answers (ar), or { error } for a refused call. `available` is what the app offers
 * now (undefined: unknown); `enabled` false is the plan card switched off (_n off).
 */
export function wrapUpResult(args, { available, enabled = true } = {}) {
  if (!enabled) return { error: WRAP_UP_OFF };
  const legacy = args.recap === undefined && (args.outcome !== undefined || args.next_actions !== undefined);
  const recap = plain(args.recap, FIELD_MAX) ?? plain(args.outcome, FIELD_MAX);
  if (recap === undefined) return { error: "recap is required: what is now true or changed and where it stands, said to the user in two or three sentences." };
  const actions = Array.isArray(args.actions ?? args.next_actions) ? (args.actions ?? args.next_actions) : [];
  const missing = unavailable(actions, available);
  if (missing.length) {
    const now = known(available);
    return { error: `Not shown: ${missing.join(", ")} ${missing.length === 1 ? "does" : "do"} not hold right now (app actions available: ${now.length ? now.join(", ") : "none"}), so the app could not draw that button and would drop your question with it. Call wrap_up again with only available app actions, or say it as a reply ({"label": "\u2026", "message": "\u2026"}) \u2014 for something you can do yourself when clicked, the message asks you to.` };
  }
  const advice = [];
  if (legacy) advice.push("This call used the previous field names (outcome, next_ask, next_actions, needs_user); they were read this time. The tool now takes recap, ask, actions and blocked, and what failed, is unfinished or is unverified goes in recap.");
  const askValue = args.ask ?? args.next_ask ?? args.next_brief;
  const ask = typeof askValue === "string" ? askValue.trim() : "";
  const valid = entries(actions);
  const shown = valid.slice(0, BUTTONS).filter((entry) => entry.action !== "new_session");
  const newSession = valid.some((entry) => entry.action === "new_session");
  const idle = ask === "" && actions.length === 0 && !blockedOf(args);
  if (newSession) advice.push("new_session is not an action: your start_session proposal shows as a card in the transcript, where the user starts it. Leave it out of actions; the card carries the proposal.");
  if (!newSession && !idle && (ask === "" || shown.length === 0)) advice.push('The box drew no buttons: it needs ask and at least one entry in actions ({"action": "create_pr"} or {"label": "Yes, do it", "message": "\u2026"}); when nothing is left for the user, the recap alone (no ask, no actions, not blocked) is the whole call.');
  else if (ask.length > ASK_MAX) advice.push(`ask is the decision alone, in one short sentence (about ${ASK_MAX} characters) with no reason or recommendation; this one ran ${ask.length}.`);
  if (valid.length > BUTTONS) advice.push(`actions is 1\u2013${BUTTONS} buttons; this call had ${valid.length}, and the app drops every one past the first ${BUTTONS}.`);
  const replies = shown.filter((entry) => typeof entry.action !== "string");
  if (replies.some((entry) => unsafeReply(entry.label) || unsafeReply(entry.message))) advice.push('The app drops a reply whose label or message starts with "/" or "!", or carries an invisible character such as an emoji variation selector or a zero-width joiner (sent text would run a command or hide what it sends) \u2014 and, when that reply was the recommendation, the other answers with it, and the question too unless the call is blocked. Rewrite it without those.');
  const long = replies.map((entry) => (typeof entry.label === "string" ? entry.label.trim() : "")).find((label) => label.length > LABEL_MAX || label.split(/\s+/).length > LABEL_WORDS);
  if (long !== undefined) advice.push(`A reply label is a button, 1\u20133 words (${LABEL_WORDS} at most, ${LABEL_MAX} characters); "${long}" is too long and the button clips it. Put the detail in message and keep the label to the answer itself.`);
  if (replies.some((entry) => typeof entry.message === "string" && entry.message.trim().length > MESSAGE_MAX)) advice.push(`A reply's message is cut at ${MESSAGE_MAX} characters mid-sentence; keep it under.`);
  if (recap.length > RECAP_MAX) advice.push(`recap is two or three sentences (about ${RECAP_MAX} characters); this one ran ${recap.length}. Keep it to what is now true and where it stands.`);
  const first = actions[0] && typeof actions[0] === "object" ? actions[0] : undefined;
  const leads = first !== undefined && (typeof first.action === "string" ? APP_ACTIONS.includes(first.action) : field(first.label) !== undefined && (flat(first.label) ?? "") !== "" && !unsafeReply(first.label) && !unsafeReply(first.message));
  const blocked = blockedOf(args);
  const asks = field(askValue) !== undefined;
  const boxAsks = asks && [args.recap, args.outcome].some((value) => field(value) !== undefined) && (blocked || leads);
  const text = [
    blocked || (asks && leads) ? "Shown in the next-step box." : idle ? "Nothing is pending, so the app draws no box." : "The app draws no box for this call.",
    ...(advice.length ? ["Do not call wrap_up again this turn; the advice that follows is for your next call."] : []),
    ...advice,
    boxAsks ? "Your closing message is your answer to the user: write it now, in full, as the last thing you say this turn. The box asks your question, so do not ask it again."
      : idle ? "Your closing message is your answer to the user: write it now, as the last thing you say this turn."
        : "Write your closing message now, as the last thing you say this turn, and put your question to the user there.",
  ].join(" ");
  return { text };
}

/** shared-11 dD: one display line, invisible characters out, at most 500 characters. */
export function displayText(value) {
  if (typeof value !== "string") return "";
  // Line breaks (U+2028 / U+2029 too) fold to spaces before the control characters go.
  const text = value.replace(/[\s\u2028\u2029]+/g, " ").normalize("NFC").replace(HIDDEN, "").replace(/\s+/g, " ").trim();
  return text.length > 500 ? `${text.slice(0, 500)}\u2026` : text;
}

/**
 * The box a wrap_up call's arguments make (Me / je): recap, the ask with its 1\u20132 actions (only
 * with an ask), blocked. null without a recap.
 */
export function parseWrapUp(args) {
  if (!args || typeof args !== "object") return null;
  const recap = field(args.recap) ?? field(args.next_recap) ?? field(args.outcome);
  if (recap === undefined) return null;
  const ask = field(args.ask) ?? field(args.next_ask) ?? field(args.next_brief);
  const actions = (Array.isArray(args.actions ?? args.next_actions) ? (args.actions ?? args.next_actions) : []).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    if (typeof entry.action === "string") return APP_ACTIONS.includes(entry.action) || entry.action === "new_session" ? [{ action: entry.action }] : [];
    const label = field(entry.label);
    if (label === undefined) return [];
    const message = field(entry.message);
    return [{ label, ...(message !== undefined && message !== label && { message: cut(message, MESSAGE_MAX) }) }];
  }).slice(0, BUTTONS);
  return { recap, blocked: blockedOf(args), ...(ask !== undefined && { next: { ask, actions } }) };
}

/** Ee: the box shows when blocked or with an answer that is not new_session. */
export const boxShows = (wrap) => !!wrap && (wrap.blocked || !!wrap.next?.actions.some((entry) => entry.action !== "new_session"));

// cd4f82e77 Qe, the renderer's own check: a command (/ or !) or any invisible character drops the reply.
const DROPS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800\ufffc\u{1d159}\u{13441}\u{13442}\u{16910}\u{16fe4}]/u;
const dropped = (value) => {
  if (typeof value !== "string") return false;
  const text = value.normalize("NFC").trim();
  return /^[/!]/.test(text) || DROPS.test(text);
};

/** g0: a reply the box may draw (a label, nothing that runs a command or hides what it sends). */
export const drawableReply = (entry) => !!entry.label && !!displayText(entry.label) && !dropped(entry.label) && !dropped(entry.message);

/** What a reply button sends: its message, else its label (Claude's renderer sends the label alone; Codex UI keeps the model's word). */
export const replyText = (entry) => entry.message ?? entry.label;
