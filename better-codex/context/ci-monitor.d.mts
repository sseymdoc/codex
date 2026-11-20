export type CiChange = "ci" | "conflict" | "review";
export declare const CI_CHANGES: readonly CiChange[];
export type CiPart =
  | { kind: "ci"; sha: string; failing: string[]; failed: number; total: number }
  | { kind: "conflict"; base: string | null }
  | { kind: "review"; authors: string[]; count: number };
export declare function ciMonitorEvent(event: { url: string; number: number; title: string; parts: CiPart[] }): string;
export declare function ciMonitorParse(text: string): { pr: string; changes: CiChange[]; lines: string[] } | null;
