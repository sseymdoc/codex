export type HeartbeatDecision = "NOTIFY" | "DONT_NOTIFY";
export declare const HEARTBEAT_KEY: string;
export declare function heartbeatEnvelope(id: string, nowIso: string, prompt: string): string;
export declare function parseHeartbeat(text: string): { automationId: string | null; currentTimeIso: string; instructions: string } | null;
export interface CronMessage { name: string; id: string; memory: string; lastRunAt: number | null; prompt: string }
export declare function cronMessage(message: CronMessage): string;
export declare function parseCronMessage(text: string): CronMessage | null;
export declare const CRON_GUIDANCE: string;
export declare function heartbeatGuidance(tools: boolean): string;
export declare function heartbeatDecision(text: string): { decision: HeartbeatDecision; message: string | null } | null;
export declare function visibleReply(text: string, streaming?: boolean): string;
export declare const QUIET_HEARTBEAT: string;
export declare function shownReply(text: string, streaming?: boolean): string;
export declare function inboxItem(text: string): { title: string | null; summary: string | null } | null;
export declare function notificationDecision(kind: "cron" | "heartbeat", policy: string | null | undefined, status: string, reply: string | null | undefined): HeartbeatDecision | null;
