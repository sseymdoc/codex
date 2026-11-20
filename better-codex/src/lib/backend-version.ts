// 实验型后端版本不匹配: an experimental backend built for this Better Codex reports every betterCodex*
// initialize field (all gated on experimentalApi + Config.experimental_backend alike). One it leaves
// out means an older backend whose features this UI cannot use; one this UI does not know means a
// newer backend.

import type { InitializeResponse } from "@protocol/InitializeResponse";

type Capability = Extract<keyof InitializeResponse, `betterCodex${string}`>;

/** What each field turns on. A Record so tsc fails when the protocol gains a field this list lacks. */
export const CAPABILITIES: Record<Capability, string> = {
  betterCodexHostContext: "宿主说明",
  betterCodexHostContextV2: "按环境区分的桌面工具说明",
  betterCodexDesktopContext: "桌面说明模块",
  betterCodexDesktopTools: "桌面显示工具",
  betterCodexHostContextMaxBytes: "512 KiB 宿主说明上限",
  betterCodexStdioEnvironments: "SSH 环境",
  betterCodexBackgroundTerminals: "在后台运行命令",
  betterCodexRevertSwitch: "撤销回退",
  betterCodexWorkflows: "动态工作流程",
};

export interface BackendMismatch {
  /** The features an older backend lacks. */
  missing: string[];
  /** It reports fields this UI does not know. */
  newer: boolean;
}

/** Null when the experimental backend matches this UI, or none runs (native behaviour is never a mismatch). */
export function backendMismatch(experimental: boolean, info: InitializeResponse | null): BackendMismatch | null {
  if (!experimental || !info) return null;
  const fields = info as unknown as Record<string, unknown>;
  const missing = Object.entries(CAPABILITIES).filter(([key]) => fields[key] == null).map(([, label]) => label);
  const newer = Object.keys(fields).some((key) => key.startsWith("betterCodex") && !Object.hasOwn(CAPABILITIES, key));
  return missing.length || newer ? { missing, newer } : null;
}

/** The sidebar card's line; `detailed` (the settings row) names what an older backend lacks. */
export function mismatchText({ missing }: BackendMismatch, detailed = false): string {
  if (!missing.length) return "实验型后端版本不匹配：后端比当前 Better Codex 新，请更新 Better Codex。";
  return detailed ? `实验型后端版本不匹配：后端比当前 Better Codex 旧，缺少${missing.join("、")}。` : "实验型后端版本不匹配，部分功能不可用。";
}
