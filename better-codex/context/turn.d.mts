export type AppAction = "commit" | "create_pr" | "merge" | "fix_ci" | "address_comments" | "resolve_conflicts" | "verify" | "archive";
export type OfferedAction = "commit" | "create_pr" | "archive";
export interface WrapUpReply { label: string; message?: string }
export type WrapUpAction = { action: AppAction | "new_session" } | WrapUpReply;
/** The box a wrap_up call's arguments make (Claude Me). */
export interface WrapUp { recap: string; blocked: boolean; next?: { ask: string; actions: WrapUpAction[] } }
export const APP_ACTIONS: readonly AppAction[];
export const OFFERED_ACTIONS: readonly OfferedAction[];
export const RECAP_MAX: number;
export const ASK_MAX: number;
export const LABEL_MAX: number;
export const LABEL_WORDS: number;
export const MESSAGE_MAX: number;
export const BUTTONS: number;
export const WRAP_UP_OFF: string;
export const WRAP_UP_KEYS: readonly string[];
export function unsafeReply(value: unknown): boolean;
export function wrapUpResult(args: Record<string, unknown>, options?: { available?: readonly string[]; enabled?: boolean }): { text: string } | { error: string };
export function displayText(value: unknown): string;
export function parseWrapUp(args: unknown): WrapUp | null;
export function boxShows(wrap: WrapUp | null | undefined): boolean;
export function drawableReply(entry: WrapUpReply): boolean;
export function replyText(entry: WrapUpReply): string;
