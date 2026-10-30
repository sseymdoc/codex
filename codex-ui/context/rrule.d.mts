export type Freq = "MINUTELY" | "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type Weekday = "SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA";

/** A parsed rule. Lists are sorted and deduplicated; `byday` uses Date#getDay numbers (0 = Sunday). */
export interface Rule {
  freq: Freq;
  interval: number;
  byday: number[] | null;
  byhour: number[] | null;
  byminute: number[] | null;
  bymonthday: number[] | null;
  bymonth: number[] | null;
  count: 1 | null;
  /** Local wall clock; a UTC (Z) DTSTART is converted. */
  dtstart: { year: number; month: number; day: number; hour: number; minute: number; second: number } | null;
  /** The keys the text wrote, upper case (DTSTART included). */
  keys: ReadonlySet<string>;
}

export type RruleProblem = { code: "invalid" | "unsupported" | "no-future"; message: string };

export declare const DEFAULT_RRULE: string;
export declare function parseRrule(text?: string | null): Rule | null;
export declare function rruleProblem(text: string, now: number): RruleProblem | null;
export declare function nextRun(rule: Rule, now: number): number | null;
export declare function oneShot(rule: Rule): boolean;
export declare function heartbeatInterval(rule: Rule): number | null;
export declare function jitterSpan(rule: Rule): 0 | 119 | 300;
export declare function describeRrule(text: string, opts?: { tz?: string }): string;

export interface Schedule {
  mode: "hourly" | "daily" | "weekdays" | "weekly" | "monthly" | "custom";
  intervalHours: number;
  intervalMinutes: number | null;
  /** Replaced, never changed in place (DEFAULT_SCHEDULE's is frozen). */
  weekdays: readonly Weekday[];
  time: string;
  monthDay: number;
  customRrule: string;
}
export declare const DEFAULT_SCHEDULE: Readonly<Schedule>;
export declare function scheduleOf(text: string): Schedule;
export declare function rruleOf(schedule: Schedule): string;

export interface Builder {
  frequency: "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  weekdays: Weekday[];
  month: number;
  monthDays: number[];
  time: string;
  minute: number;
}
export declare function builderOf(text: string): Builder | null;
export declare function builderRrule(builder: Builder): string;
