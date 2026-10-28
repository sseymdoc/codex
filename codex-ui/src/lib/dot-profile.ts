// A dot's profile panel (components/DotProfile.tsx) as the Codex desktop app 26.1023 has it: its
// status (aeon-summary-panel-identity), renaming and deleting it, a safety pause and its review,
// its channels (email: state-2e25…, texting: the aeon-messaging phone calls), its schedules
// (state-e485…), its cloud computer (last-frame / panel), meeting invites (control-b260…), and its
// character: the ORBAST1 appearance bytes the character runtime speaks, read and written as the
// desktop app does (save-character I / app-initial fVt), saved as a snapshot plus its manifest.
import { useSyncExternalStore } from "react";
import { CloudError, list, obj, query, str } from "./cloud";
import { connectionId, errorMessage } from "./codex";
import { dotCall as call, dotContentUrl, dotPath, dotsState, dropDot, parseDot, putDot, refreshDot, type Dot } from "./dots";

export interface DotEmail {
  linked: boolean;
  address: string;
}

export interface DotPhone {
  /** The user's verified number, bound to texting. */
  number: string | null;
  generation: string | null;
  /** The number the dot texts from, once texting is on. */
  dotNumber: string | null;
  canSetup: boolean;
}

export interface DotAutomation {
  id: string;
  title: string;
  /** When it runs next (ms), when the service says. */
  next: number | null;
}

export interface DotComputer {
  status: string;
  /** The cloud computer can be started again (status says it is off or stuck). */
  stuck: boolean;
}

/** A desktop the dot can work on (GET /tbo/{id}/computers, `kind: "user"` ones). */
export interface DotDesktop {
  environmentId: string;
  name: string | null;
  attached: boolean;
  status: string;
  canConnect: boolean;
  canDisconnect: boolean;
}

export interface DotDesktops {
  computers: DotDesktop[];
  adminDisabled: boolean;
}

/** This machine as a computer for dots (server/executor.mjs); `available` only in the desktop shell. */
export interface LocalComputer {
  available: boolean;
  enabled: boolean;
  environmentId: string | null;
  ready: boolean;
  error: string | null;
}

export interface DotProfile {
  desktops: DotDesktops | null | undefined;
  email: DotEmail | null | undefined;
  emailError: boolean;
  phone: DotPhone | null | undefined;
  phoneError: boolean;
  automations: DotAutomation[] | null | undefined;
  computer: DotComputer | null | undefined;
  /** A safety pause's explanation (misalignment-review). */
  review: string | null | undefined;
}

interface ProfileState {
  profiles: Record<string, DotProfile>;
  /** When this page paused each dot (ms): the service does not say. */
  pausedAt: Record<string, number>;
  local: LocalComputer | undefined;
}

const BLANK: DotProfile = { desktops: undefined, email: undefined, emailError: false, phone: undefined, phoneError: false, automations: undefined, computer: undefined, review: undefined };
let state: ProfileState = { profiles: {}, pausedAt: {}, local: undefined };
const listeners = new Set<() => void>();
const set = (patch: Partial<ProfileState>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};
const patchProfile = (id: string, patch: Partial<DotProfile>) =>
  set({ profiles: { ...state.profiles, [id]: { ...(state.profiles[id] ?? BLANK), ...patch } } });

export function useDotProfile<T>(pick: (s: ProfileState) => T): T {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => pick(state));
}

export const profileOf = (id: string | undefined) => (id ? state.profiles[id] ?? BLANK : BLANK);
const upstream = (error: unknown) => (error instanceof CloudError && error.upstream ? error.status : 0);
const missing = (error: unknown) => upstream(error) === 404;
/** The service's error code: its `type`, else a known code named in its message. */
const codeOf = (error: unknown, known: Record<string, string>) =>
  (error instanceof CloudError && error.type && error.type in known ? error.type : undefined) ?? Object.keys(known).find((key) => errorMessage(error).includes(key));

// ---------------------------------------------------------------------------
// Status

const GRACE_MS = 60_000;
const ago = (ms: number, now: number) => {
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟前`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} 小时前` : `${Math.round(hours / 24)} 天前`;
};

/**
 * The status line (aeon-summary-panel-identity, `Kt=6e4`): paused just now, or since when as
 * this page saw it; else active, or when it last was once that is past a minute.
 */
export function statusLine(dot: Pick<Dot, "paused">, pausedAt: number | undefined, lastActive: number | null, now = Date.now()): string {
  if (dot.paused) {
    if (pausedAt === undefined) return "已暂停";
    return now - pausedAt < GRACE_MS ? "刚刚已暂停" : `已于 ${ago(pausedAt, now)} 暂停`;
  }
  return lastActive === null || now - lastActive < GRACE_MS ? "活跃" : `上次活跃：${ago(lastActive, now)}`;
}

/** A nickname as the appearance picker takes it: up to 24 characters, no backslash. */
export const validName = (name: string) => [...name].length <= 24 && !name.includes("\\");

/** Was this pause the service's own, for safety (a guardian or misalignment monitor)? */
export const safetyPause = (dot: Dot) => dot.paused && /guardian|misalignment/i.test(dot.pauseReason ?? "");

/**
 * Pauses or resumes the dot as the desktop app does: the runtime answers with the root thread it
 * runs, which may be a new one; the profile is then read back to be sure it took. Failures say
 * which of the two went wrong.
 */
export async function setPaused(dot: Dot, paused: boolean): Promise<void> {
  let answer: Record<string, unknown>;
  try {
    answer = obj(await call<unknown>("POST", `${dotPath(dot.id)}/runtime/${paused ? "pause" : "resume"}`));
  } catch (error) {
    throw new Error(paused ? "无法暂停你的 dot，请重试" : "无法恢复，请重试", { cause: error });
  }
  const thread = str(answer.thread_id);
  let fresh: Dot | null = null;
  try {
    fresh = thread ? await byThread(thread) : await refreshDot(dot.id);
  } catch {
    fresh = null;
  }
  if (fresh?.paused !== paused) throw new Error(paused ? "无法确认你的 dot 是否已暂停" : "无法确认你的 Dot 是否已恢复运行");
  if (paused) set({ pausedAt: { ...state.pausedAt, [dot.id]: Date.now() } });
}

/** The dot whose root thread this is (a pause or resume may start a new one). */
async function byThread(threadId: string): Promise<Dot> {
  const raw = await call<unknown>("GET", `/tbo/by-thread/${encodeURIComponent(threadId)}`);
  const dot = parseDot(obj(obj(raw).tbo ?? raw));
  if (!dot.id) throw new Error("No dot.");
  putDot(dot);
  return dot;
}

/** Renames the dot; a name the service will not take says so (renameDialog.nameRejected). */
export async function renameDot(dot: Dot, name: string): Promise<void> {
  try {
    putDot({ ...dot, ...pick(await call<unknown>("PATCH", dotPath(dot.id), { display_name: name.trim() })) });
  } catch (error) {
    const status = upstream(error);
    throw new Error(status === 400 || status === 422 ? "不允许使用此名称。请选择其他名称。" : errorMessage(error));
  }
}

/** The profile fields an answer brings back, over what is known. */
function pick(raw: unknown): Partial<Dot> {
  const answer = obj(raw);
  return "display_name" in answer ? { name: str(answer.display_name).trim() || null } : {};
}

/**
 * Deletes the dot (resetOrbit): its conversations are archived and its memory cleared. A 503
 * means the deletion began; the dot leaves the list either way it took.
 */
export async function deleteDot(dot: Dot): Promise<void> {
  putDot({ ...dot, deleting: true });
  try {
    await call("DELETE", dotPath(dot.id));
  } catch (error) {
    if (upstream(error) !== 503) {
      putDot({ ...dot, deleting: false });
      throw error;
    }
  }
  dropDot(dot.id);
}

// ---------------------------------------------------------------------------
// The panel's data

/** Loads what the panel shows for a dot, each part on its own. */
export async function loadProfile(dot: Dot): Promise<void> {
  const id = dot.id;
  await Promise.all([
    loadDesktops(dot),
    state.local ? undefined : loadLocalComputer(),
    loadEmail(id),
    loadPhone(id),
    call<unknown>("GET", `${dotPath(id)}/automations${query({ limit: 100 })}`).then(
      (raw) => patchProfile(id, { automations: list(obj(raw).items).map(parseAutomation).filter((item) => item.id) }),
      () => patchProfile(id, { automations: null }),
    ),
    call<unknown>("GET", `${dotPath(id)}/environment/status${dot.rootThreadId ? query({ thread_id: dot.rootThreadId }) : ""}`).then(
      (raw) => patchProfile(id, { computer: parseComputer(raw) }),
      (error) => patchProfile(id, { computer: missing(error) ? { status: "unknown", stuck: false } : null }),
    ),
    dot.paused ? call<unknown>("GET", `${dotPath(id)}/misalignment-review`).then(
      (raw) => patchProfile(id, { review: str(obj(raw).detailed_explanation).trim() || null }),
      () => patchProfile(id, { review: null }),
    ) : undefined,
  ]);
}

function parseAutomation(raw: unknown): DotAutomation {
  const item = obj(raw);
  const next = str(item.next_run_at) || str(item.next_run_time);
  return {
    id: str(item.id),
    title: str(item.title).trim() || str(item.name).trim() || str(item.prompt).trim().split("\n")[0] || "已安排的任务",
    next: next && Number.isFinite(Date.parse(next)) ? Date.parse(next) : null,
  };
}

function parseComputer(raw: unknown): DotComputer {
  const answer = obj(raw);
  const status = str(answer.status) || "unknown";
  return { status, stuck: /offline|failed|error|stopped|unhealthy/.test(status) };
}

export async function loadEmail(id: string): Promise<void> {
  try {
    const answer = obj(await call<unknown>("GET", `${dotPath(id)}/channels/email`));
    patchProfile(id, { email: { linked: str(answer.status) === "linked", address: str(answer.email_address) }, emailError: false });
  } catch (error) {
    patchProfile(id, missing(error) ? { email: null, emailError: false } : { emailError: true });
  }
}

/** Where a new address can be claimed: the domain the service offers and a name it suggests. */
export async function emailOptions(id: string): Promise<{ domain: string; suggestion: string }> {
  const answer = obj(await call<unknown>("GET", `${dotPath(id)}/channels/email/options`));
  const domains = list(answer.domains).map((item) => (typeof item === "string" ? item : str(obj(item).domain))).filter(Boolean);
  return { domain: str(answer.domain) || domains[0] || "", suggestion: str(answer.suggested_local_part) || str(answer.local_part) };
}

/** restricted.aeon.email.dialog.operationError, by the service's code. */
const EMAIL_ERRORS: Record<string, string> = {
  ineligible: "此工作空间的电子邮箱功能不可用",
  workspace_disabled: "你的工作空间管理员已禁用电子邮箱功能",
  invalid_address: "此电子邮箱地址格式不正确",
  disallowed_address: "不允许使用此电子邮箱地址。请换一个地址",
  address_unavailable: "此电子邮箱地址已被占用。请换一个地址",
  quota_exceeded: "此账户的电子邮箱地址数量已达上限",
  workspace_setup: "此工作空间的电子邮箱配置尚未就绪。请重试",
  conflict: "未能将此地址关联到此 Dot",
};

/** Claims `<local>@<domain>` for the dot (the address is permanent). */
export async function claimEmail(id: string, local: string, domain: string): Promise<void> {
  try {
    const answer = obj(await call<unknown>("POST", `${dotPath(id)}/channels/email/claim`, { local_part: local, domain, narrow_email_consent_version: 1 }));
    patchProfile(id, { email: { linked: true, address: str(answer.email_address) || `${local}@${domain}` }, emailError: false });
  } catch (error) {
    const code = codeOf(error, EMAIL_ERRORS);
    throw new Error(code ? EMAIL_ERRORS[code] : upstream(error) === 422 ? EMAIL_ERRORS.invalid_address : upstream(error) === 409 ? EMAIL_ERRORS.conflict : "电子邮箱设置未成功。请重试");
  }
}

export async function removeEmail(id: string): Promise<void> {
  try {
    await call("DELETE", `${dotPath(id)}/channels/email`);
    patchProfile(id, { email: null });
  } catch {
    throw new Error("未能断开与电子邮箱的连接。请重试");
  }
}

export async function loadPhone(id: string): Promise<void> {
  try {
    const answer = obj(await call<unknown>("GET", `/aeon-messaging/phone${query({ include_texting: "true" })}`));
    const binding = obj(answer.binding);
    const texting = obj(binding.texting ?? answer.texting);
    patchProfile(id, {
      phone: {
        number: str(binding.phone_number) || null,
        generation: str(binding.generation) || (typeof binding.generation === "number" ? String(binding.generation) : null),
        dotNumber: str(texting.orbit_phone_number) || str(texting.phone_number) || str(answer.orbit_phone_number) || null,
        canSetup: answer.texting_can_setup !== false,
      },
      phoneError: false,
    });
  } catch (error) {
    patchProfile(id, missing(error) ? { phone: null, phoneError: false } : { phoneError: true });
  }
}

const PHONE_ERRORS: Record<string, string> = {
  invalid_phone: "请输入带有国家区号的有效电话号码",
  invalid_code: "验证码有误，请核对后重试",
  expired_code: "验证码已过期。请重新发送验证码，然后重试",
  already_bound: "此电话号码已与另一个账户关联",
  rate_limited: "尝试次数过多，请稍后重试",
  verification_not_allowed: "无法向此号码发送验证码。请换一个号码重试",
  messaging_not_supported: "此电话号码无法接收 iMessage 或 RCS 消息。请检查手机的消息设置后重试，或换用其他号码",
};
const phoneError = (error: unknown) => {
  const code = codeOf(error, PHONE_ERRORS);
  return new Error(code ? PHONE_ERRORS[code] : upstream(error) === 429 ? PHONE_ERRORS.rate_limited : "未能完成手机设置。请重试");
};

/** Sends the verification text; resolves to the challenge the code answers. */
export async function startPhone(number: string): Promise<string> {
  try {
    const answer = obj(await call<unknown>("POST", "/aeon-messaging/phone", { phone_number: number }));
    const challenge = str(answer.challenge_id);
    if (!challenge) throw new Error("No challenge.");
    return challenge;
  } catch (error) {
    throw phoneError(error);
  }
}

/** Verifies the code, then turns texting on for this dot (consent given in the dialog). */
export async function verifyPhone(dot: Dot, challenge: string, code: string): Promise<void> {
  let generation: unknown;
  try {
    const answer = obj(await call<unknown>("POST", "/aeon-messaging/phone/verify", { challenge_id: challenge, code }));
    generation = obj(answer.binding).generation ?? answer.generation;
  } catch (error) {
    throw phoneError(error);
  }
  try {
    await call("POST", "/aeon-messaging/texting/activate", { consent: true, expected_aeon_id: dot.id, phone_generation: generation });
  } catch {
    throw new Error("你的号码已验证，但未能启用短信功能。请重试");
  }
  await loadPhone(dot.id);
}

export async function removePhone(dot: Dot): Promise<void> {
  const generation = profileOf(dot.id).phone?.generation;
  try {
    await call("DELETE", `/aeon-messaging/phone${query({ generation: generation ?? undefined })}`);
  } catch {
    throw new Error("未能移除电话号码，请重试。");
  }
  patchProfile(dot.id, { phone: { number: null, generation: null, dotNumber: null, canSetup: true } });
}

/** Asks the dot to join a Google Meet call; one key per invite, so a retry is the same invite. */
export async function inviteToMeeting(dot: Dot, url: string, key: string): Promise<void> {
  const id = connectionId();
  if (!id) throw new Error("未连接到 app-server");
  const response = await fetch(`/api/cloud?c=${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "POST", path: `${dotPath(dot.id)}/meeting-sessions`, body: { meeting_url: url }, idempotencyKey: key }),
  });
  const answer = response.ok ? (await response.json()) as { status: number } : null;
  if (!answer || answer.status >= 400) throw new Error("未能确认邀请，请重试。");
}

/** A Google Meet link, as the invite takes it (https only). */
export function meetingUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" && url.hostname === "meet.google.com" && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(url.pathname) ? url.href : null;
  } catch {
    return null;
  }
}

/** Restarts the dot's cloud computer (orbit.primary.reboot). */
// ---------------------------------------------------------------------------
// Desktops (desktop-connection-b289…): this machine runs as one through server/executor.mjs;
// the dot attaches it (connect, or connect-and-replace when another one is attached) and lets it go.

async function executor(enabled?: boolean): Promise<LocalComputer> {
  const id = connectionId();
  if (!id) throw new Error("连接 Codex 后才能使用这台电脑。");
  const response = await fetch(`/api/executor?${new URLSearchParams({ c: id, ...(enabled === undefined ? {} : { enabled: enabled ? "1" : "0" }) })}`, { method: enabled === undefined ? "GET" : "POST" });
  if (!response.ok) throw new Error((await response.text().catch(() => "")) || `本机电脑不可用（${response.status}）`);
  const raw = obj(await response.json().catch(() => ({})));
  const local = {
    available: raw.available === true,
    enabled: raw.enabled === true,
    environmentId: str(raw.environmentId) || null,
    ready: raw.ready === true,
    error: str(raw.error) || null,
  };
  set({ local });
  return local;
}

export const loadLocalComputer = () => executor().catch(() => set({ local: { available: false, enabled: false, environmentId: null, ready: false, error: null } }));

export function parseDesktops(raw: unknown, threadId: string): DotDesktops | null {
  const body = obj(raw);
  if (str(body.thread_id) !== threadId) return null;
  return {
    adminDisabled: body.local_computer_access_disabled_by_admin === true,
    computers: list(body.computers).map(obj).filter((item) => item.kind === "user" && str(item.environment_id)).map((item) => ({
      environmentId: str(item.environment_id),
      name: str(item.display_name).trim() || null,
      attached: item.is_attached === true,
      status: str(item.status) || "unknown",
      canConnect: item.can_connect === true,
      canDisconnect: item.can_disconnect === true,
    })),
  };
}

export async function loadDesktops(dot: Dot): Promise<DotDesktops | null> {
  if (!dot.rootThreadId) {
    patchProfile(dot.id, { desktops: null });
    return null;
  }
  try {
    const desktops = parseDesktops(await call<unknown>("GET", `${dotPath(dot.id)}/computers${query({ expected_thread_id: dot.rootThreadId })}`), dot.rootThreadId);
    patchProfile(dot.id, { desktops });
    return desktops;
  } catch {
    patchProfile(dot.id, { desktops: null });
    return null;
  }
}

/** The status the panel shows for a desktop (restricted.aeon.desktopConnection.connectionState). */
export function desktopStatus(desktop: DotDesktop | undefined, local?: LocalComputer): "connected" | "disconnected" | "offline" | "unknown" {
  if (!desktop) return "unknown";
  if ((local && desktop.environmentId === local.environmentId && !local.ready) || desktop.status === "offline") return "offline";
  if (desktop.status === "connected") return desktop.attached ? "connected" : "disconnected";
  return "unknown";
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Lets the dot work on this machine: the local computer comes on (the user agreed to it just
 * now), reaches the registry, shows up among the dot's computers, and is attached to the dot,
 * replacing another attached one; then the dot's threads hear it is up.
 */
export async function connectThisComputer(dot: Dot): Promise<void> {
  let local = await executor(true);
  for (let tries = 0; !(local.ready && local.environmentId) && tries < 60; tries++) {
    await wait(1000);
    local = await executor();
  }
  if (!local.ready || !local.environmentId) throw new Error(local.error ?? "这台电脑未能连上 ChatGPT。");
  let mine: DotDesktop | undefined;
  for (let tries = 0; tries < 15; tries++) {
    const desktops = await loadDesktops(dot);
    if (desktops?.adminDisabled) throw new Error("您的管理员已禁用对本地计算机的访问");
    mine = desktops?.computers.find((item) => item.environmentId === local.environmentId);
    if (mine?.canConnect || mine?.attached) break;
    await wait(2000);
  }
  if (!mine?.canConnect && !mine?.attached) throw new Error(`未能加载您的 Dot 的计算机`);
  if (!mine.attached) {
    const replace = !!profileOf(dot.id).desktops?.computers.some((item) => item.attached && item.environmentId !== local.environmentId);
    await call("POST", `${dotPath(dot.id)}/computers/${encodeURIComponent(local.environmentId)}/${replace ? "connect-and-replace" : "connect"}${query({ expected_thread_id: dot.rootThreadId ?? undefined })}`);
  }
  await loadDesktops(dot);
  // Asked again while it is on, the local computer tells the dot's threads (now this one's too).
  await executor(true);
}

/**
 * Takes a desktop away from the dot. This machine's local computer goes off as well once no dot
 * has it attached: it is not left open for nothing.
 */
export async function revokeComputer(dot: Dot, environmentId: string): Promise<void> {
  await call("POST", `${dotPath(dot.id)}/computers/${encodeURIComponent(environmentId)}/disconnect${query({ expected_thread_id: dot.rootThreadId ?? undefined })}`);
  await loadDesktops(dot);
  const local = state.local;
  if (!local?.enabled || environmentId !== local.environmentId) return;
  const others = await Promise.all(dotsState().dots.filter((item) => item.id !== dot.id).map(loadDesktops));
  if (!others.some((desktops) => desktops?.computers.some((item) => item.environmentId === environmentId && item.attached))) await executor(false);
}

export async function rebootDot(dot: Dot): Promise<void> {
  try {
    await call("POST", `${dotPath(dot.id)}/environment/recreate${dot.rootThreadId ? query({ thread_id: dot.rootThreadId }) : ""}`);
  } catch {
    throw new Error("重启请求失败。请重试。");
  }
  patchProfile(dot.id, { computer: { status: "starting", stuck: false } });
}

// ---------------------------------------------------------------------------
// Avatars

const avatarUrls = new Map<string, Promise<string>>();

/**
 * A picture to show for an avatar URL: a web URL as it is, a file pointer (sediment:// or
 * file-service://) through the file's download URL; both through the bridge, which serves only
 * ChatGPT's own hosts.
 */
export function avatarSource(url: string): Promise<string> {
  if (!url) return Promise.resolve("");
  let found = avatarUrls.get(url);
  if (!found) {
    const pointer = /^(?:sediment|file-service):\/\/([\w-]+)$/.exec(url);
    found = pointer
      ? call<unknown>("GET", `/files/download/${pointer[1]}`).then((raw) => dotContentUrl(str(obj(raw).download_url), "avatar.png"))
      : Promise.resolve(/^https?:\/\//.test(url) ? dotContentUrl(url, "avatar.png") : "");
    found.catch(() => avatarUrls.delete(url));
    avatarUrls.set(url, found);
  }
  return found;
}

// ---------------------------------------------------------------------------
// The character's appearance: ORBAST1 bytes (save-character `L` / `I`, app-initial `vVt` / `fVt`)

type Vector = number[];
interface Part { offset: Vector; rotation: Vector; scale: Vector }

class Reader {
  offset = 0;
  private view: DataView;
  constructor(private bytes: Uint8Array) {
    if (bytes.length > 65536) throw new Error("Character state too large");
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  done() { return this.offset === this.bytes.length; }
  byte() { return this.view.getUint8(this.offset++); }
  flag() {
    const value = this.byte();
    if (value > 1) throw new Error("Invalid character flag");
    return value === 1;
  }
  count(max: number) {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    if (value > max) throw new Error("Character collection too large");
    return value;
  }
  scalar() {
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    if (!Number.isFinite(value)) throw new Error("Invalid character number");
    return value;
  }
  pair() { return [this.scalar(), this.scalar()]; }
  vector() { return [this.scalar(), this.scalar(), this.scalar()]; }
  part(): Part { return { offset: this.vector(), rotation: this.vector(), scale: this.vector() }; }
  text() {
    const length = this.count(63);
    if (this.offset + length > this.bytes.length) throw new Error("Truncated character text");
    const value = new TextDecoder("utf-8", { fatal: true }).decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }
  array<T>(read: () => T, max = 32) { return Array.from({ length: this.count(max) }, read); }
  entries<T>(read: () => T): Record<string, T> {
    const pairs = this.array((): [string, T] => [this.text(), read()]);
    if (new Set(pairs.map(([key]) => key)).size !== pairs.length) throw new Error("Duplicate character key");
    return Object.fromEntries(pairs);
  }
  nextTag(tag: string) {
    const bytes = new TextEncoder().encode(tag);
    if (!bytes.every((byte, i) => this.bytes[this.offset + i] === byte)) return false;
    this.offset += bytes.length;
    return true;
  }
  tag(tag: string) {
    if (!this.nextTag(tag)) throw new Error("Invalid character state header");
  }
}

/** ORBAST1 bytes as the manifest's `appearance` JSON (save-character `I`, then its donut rule). */
export function appearanceOf(bytes: Uint8Array): Record<string, unknown> {
  const t = new Reader(bytes);
  t.tag("ORBAST1\0");
  const shape = t.text(), color = t.text(), eyes = t.text(), eyewear = t.text();
  const accessories = t.array(() => t.text());
  const accessoryColors = t.entries(() => t.text());
  if (t.flag()) throw new Error("Unsupported flower center");
  const depth = t.scalar();
  let model: Record<string, unknown> | undefined;
  if (t.flag()) {
    const m: Record<string, unknown> = {};
    const body: Record<string, unknown> = { variant: t.text() || undefined, scale: t.vector(), upperStart: t.scalar(), upperScale: t.scalar() };
    if (t.flag()) body.volume = { halfDepth: t.scalar(), shoulderFullness: t.scalar(), lobes: t.array(() => ({ center: t.pair(), radius: t.pair(), strength: t.scalar() }), 16) };
    m.body = body;
    if (t.flag()) m.eyes = Array.from({ length: 2 }, () => ({ position: t.vector(), rotation: t.vector(), scale: t.vector(), reflectX: t.flag(), surfaceRelative: t.flag() }));
    const mount = t.byte();
    if (mount > 2) throw new Error("Unsupported eye mount");
    m.eyeMount = ["authored", "body", "body-fixed"][mount];
    if (t.text() !== "") throw new Error("Unsupported eye variant");
    m.closedLidScale = t.vector();
    m.pupilScale = t.vector();
    if (t.flag()) m.eyewear = t.part();
    m.eyewearBridge = t.flag();
    m.accessories = t.entries(() => t.part());
    m.materials = t.entries(() => {
      const mask = t.byte();
      if (mask > 7) throw new Error("Unsupported material");
      return { albedo: mask & 1 ? t.vector() : undefined, roughness: mask & 2 ? t.scalar() : undefined, reflectance: mask & 4 ? t.scalar() : undefined };
    });
    const headphones: Record<string, unknown> = { top: t.flag() ? t.scalar() : undefined, cushionScale: t.vector() };
    m.headphones = headphones;
    if (t.nextTag("ORBEYE1\0")) {
      const variant = t.text();
      if (variant !== "round_sunglasses_no_sidecaps") throw new Error("Unsupported eyewear variant");
      m.eyewearVariant = variant;
    }
    if (t.nextTag("ORBRIG1\0")) {
      m.restingEyeClosure = t.scalar();
      headphones.bandThicknessScale = t.scalar();
      m.eyewearSurfaceAlignment = t.scalar();
      m.eyeGazeScale = t.pair();
    }
    model = m;
  }
  const hereCharacter = t.nextTag("ORBHERE1") ? { id: t.text(), name: t.text() } : undefined;
  if (!t.done()) throw new Error("Unsupported character state extension");
  const appearance: Record<string, unknown> = JSON.parse(JSON.stringify({ schemaVersion: hereCharacter ? 3 : model ? 2 : 1, shape, color, eyes, eyewear, accessories, accessoryColors, depth, model, hereCharacter }));
  // A plain ring saves as the studio donut (save-character `save`).
  if (appearance.shape === "circle" && appearance.eyes === "none") Object.assign(appearance, { studioShape: "donut", eyes: "oval", color: appearance.color === "authored" ? "gray" : appearance.color });
  return appearance;
}

class Writer {
  bytes: number[] = [];
  valid = true;
  tag(tag: string) { this.bytes.push(...new TextEncoder().encode(tag)); }
  text(value: string) {
    const bytes = new TextEncoder().encode(value);
    this.count(bytes.length);
    this.bytes.push(...bytes);
  }
  count(value: number) {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setUint32(0, value, true);
    this.bytes.push(...new Uint8Array(buffer));
  }
  scalar(value: number) {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setFloat32(0, value === 0 ? 0 : value, true);
    this.valid &&= Number.isFinite(view.getFloat32(0, true));
    this.bytes.push(...new Uint8Array(buffer));
  }
  flag(value: unknown) { this.bytes.push(+!!value); }
  vector(values: Vector) { values.forEach((value) => this.scalar(value)); }
  part(part: Partial<Part>) {
    this.vector(part.offset ?? [0, 0, 0]);
    this.vector(part.rotation ?? [0, 0, 0]);
    this.vector(part.scale ?? [1, 1, 1]);
  }
  entries<T>(entries: Record<string, T>, write: (value: T) => void) {
    const sorted = Object.entries(entries).sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1));
    this.valid &&= sorted.length <= 32;
    this.count(sorted.length);
    for (const [key, value] of sorted) {
      this.text(key);
      write(value);
    }
  }
}

/** The default ring of a color, as a dot without a character has it (app-initial gSo). */
export const ringAppearance = (color = "gray") =>
  ({ schemaVersion: 1, shape: "circle", color: color === "gray" ? "authored" : color, eyes: "none", eyewear: "none", accessories: [], depth: 0.5 });

/** A manifest's `appearance` as ORBAST1 bytes, or null when it is not one (app-initial `fVt`). */
export function appearanceBytes(appearance: unknown): Uint8Array | null {
  const given = obj(appearance);
  if (typeof given.shape !== "string" || typeof given.color !== "string" || typeof given.eyes !== "string" || typeof given.eyewear !== "string") return null;
  type Model = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const r: Model = given.studioShape === "donut" ? ringAppearance(given.color === "gray" ? "gray" : String(given.color)) : given;
  const accessories = list(r.accessories).filter((item): item is string => typeof item === "string");
  const w = new Writer();
  w.tag("ORBAST1\0");
  for (const text of [r.shape, r.color, r.eyes, r.eyewear]) w.text(String(text));
  w.count(accessories.length);
  for (const item of accessories) w.text(item);
  const colors = Object.fromEntries(Object.entries(obj(r.accessoryColors)).filter(([key, value]) =>
    typeof value === "string" && (accessories.includes(key) || !["feather", "halo", "piercings", "moustache", "teardrop"].includes(key)))) as Record<string, string>;
  w.entries(colors, (value) => w.text(value));
  w.flag(false);
  w.scalar(typeof r.depth === "number" ? r.depth : 0.5);
  const o = r.model as Model | undefined;
  w.flag(o != null);
  if (o != null) {
    w.text(o.body?.variant ?? "");
    w.vector(o.body?.scale ?? [1, 1, 1]);
    w.scalar(o.body?.upperStart ?? 0.35);
    w.scalar(o.body?.upperScale ?? 1);
    const volume = o.body?.volume;
    w.flag(volume != null);
    if (volume != null) {
      w.scalar(volume.halfDepth ?? 0.4);
      w.scalar(volume.shoulderFullness ?? 1);
      w.count(volume.lobes?.length ?? 0);
      for (const lobe of volume.lobes ?? []) {
        w.vector(lobe.center);
        w.vector(lobe.radius);
        w.scalar(lobe.strength);
      }
    }
    w.flag(o.eyes != null);
    for (const eye of o.eyes ?? []) {
      w.vector(eye.position);
      w.vector(eye.rotation ?? [0, 0, 0]);
      w.vector(eye.scale ?? [1, 1, 1]);
      w.flag(eye.reflectX ?? false);
      w.flag(eye.surfaceRelative ?? false);
    }
    w.bytes.push(({ "body-fixed": 2, body: 1, authored: 0 } as Record<string, number>)[o.eyeMount ?? "authored"] ?? 0);
    w.text("");
    w.vector(o.closedLidScale ?? [1, 1, 1]);
    w.vector(o.pupilScale ?? [1, 1, 1]);
    w.flag(o.eyewear != null);
    if (o.eyewear != null) w.part(o.eyewear);
    w.flag(o.eyewearBridge ?? false);
    w.entries(o.accessories ?? {}, (part: Partial<Part>) => w.part(part));
    w.entries(o.materials ?? {}, (material: Model) => {
      w.bytes.push((material.albedo == null ? 0 : 1) + (material.roughness == null ? 0 : 2) + (material.reflectance == null ? 0 : 4));
      if (material.albedo != null) w.vector(material.albedo);
      if (material.roughness != null) w.scalar(material.roughness);
      if (material.reflectance != null) w.scalar(material.reflectance);
    });
    w.flag(o.headphones?.top != null);
    if (o.headphones?.top != null) w.scalar(o.headphones.top);
    w.vector(o.headphones?.cushionScale ?? [1, 1, 1]);
    if (o.eyewearVariant != null) {
      w.tag("ORBEYE1\0");
      w.text(o.eyewearVariant);
    }
    const closure = o.restingEyeClosure ?? 0, band = o.headphones?.bandThicknessScale ?? 1, align = o.eyewearSurfaceAlignment ?? 1, gaze: Vector = o.eyeGazeScale ?? [1, 1];
    if (closure !== 0 || band !== 1 || align !== 1 || gaze.some((value) => value !== 1)) {
      w.tag("ORBRIG1\0");
      w.scalar(closure);
      w.scalar(band);
      w.scalar(align);
      w.vector(gaze);
    }
  }
  if (r.hereCharacter != null) {
    w.tag("ORBHERE1");
    w.text(r.hereCharacter.id);
    w.text(r.hereCharacter.name);
  }
  return w.valid && w.bytes.length <= 65536 ? Uint8Array.from(w.bytes) : null;
}

/** The bytes the editor starts from: the dot's saved character, else its colored ring. */
export function startingAppearance(dot: Dot): Uint8Array {
  const saved = dot.avatar.type === "rendered-interactive" ? appearanceBytes(obj(dot.avatar.manifest).appearance) : null;
  return saved ?? (appearanceBytes(ringAppearance(dot.color ?? "gray")) as Uint8Array);
}

const sameManifest = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Saves a nickname and, when the character changed, its snapshot and manifest, as the desktop
 * app's saver does: the profile is read first (another device may have changed it), the PNG goes
 * up with its manifest, then the profile takes both; a failed write is read back to see whether
 * it landed anyway.
 */
export async function saveAppearance(dot: Dot, { name, character, bundleId }: { name: string; character?: { state: Uint8Array; png: Uint8Array }; bundleId: string | null }): Promise<void> {
  const current = obj(await call<unknown>("GET", dotPath(dot.id)));
  if (str(current.avatar_type) !== dot.avatar.type || !sameManifest(current.avatar_manifest ?? null, dot.avatar.manifest)) {
    throw new Error("角色已在其他设备上更改，请重新打开编辑器");
  }
  const change: Record<string, unknown> = { display_name: name.trim() };
  if (character) {
    if (!bundleId) throw new Error("无法保存你的 dot 头像");
    const manifest = { schema_version: 1, resource_bundle_id: bundleId, appearance: appearanceOf(character.state) };
    const id = connectionId();
    if (!id) throw new Error("未连接到 app-server");
    const params = new URLSearchParams({ c: id, path: "/cloud-aeons/avatar-snapshots", name: "avatar.png", type: "image/png", fields: JSON.stringify({ avatar_manifest: JSON.stringify(manifest) }) });
    const response = await fetch(`/api/dots/upload?${params}`, { method: "POST", body: new Blob([character.png as BlobPart], { type: "image/png" }) });
    const answer = response.ok ? (await response.json()) as { status: number; body: unknown } : null;
    const snapshot = obj(obj(answer?.body).snapshot);
    if (!answer || answer.status >= 400 || !str(snapshot.asset_pointer)) throw new Error("无法保存你的 dot 头像");
    change.avatar_type = "rendered-interactive";
    change.avatar_manifest = { ...manifest, snapshot };
  }
  const landed = (raw: unknown) => {
    const profile = obj(raw);
    return str(profile.display_name).trim() === change.display_name && (!character || (str(profile.avatar_type) === "rendered-interactive" && sameManifest(profile.avatar_manifest, change.avatar_manifest)));
  };
  let answer: unknown;
  try {
    answer = await call<unknown>("PATCH", dotPath(dot.id), change);
  } catch (error) {
    answer = await call<unknown>("GET", dotPath(dot.id)).catch(() => null);
    if (!landed(answer)) throw new Error(upstream(error) === 400 || upstream(error) === 422 ? "不允许使用此名称。请选择其他名称。" : "无法保存你的更改。请重试。");
  }
  const fresh = parseDot({ ...current, ...obj(answer) });
  putDot(fresh.id ? fresh : { ...dot, name: name.trim() || null });
}

/** The account changed: nothing of the old one's profiles stays. */
export function resetProfiles(): void {
  avatarUrls.clear();
  set({ profiles: {}, pausedAt: {}, local: undefined });
}
