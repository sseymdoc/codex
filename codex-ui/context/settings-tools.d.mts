export declare const SETTINGS_TOOL_NAMES: readonly ["get_settings", "set_setting"];
export type SettingsToolName = typeof SETTINGS_TOOL_NAMES[number];
export type ModelSettingKey =
  | "theme" | "transcript_text_size" | "transcript_width" | "motion" | "interface_font" | "default_transcript_view"
  | "plan_card" | "away_recap" | "merged_model_picker" | "new_task_prompt" | "draw_attention" | "keep_awake_while_working" | "keep_awake_on_battery";
export declare const MODEL_SETTINGS: Readonly<Record<ModelSettingKey, { label: string; options: [string, string][] }>>;
export declare const SETTING_KEYS: readonly ModelSettingKey[];
export declare const SETTINGS_TOOLS: { name: SettingsToolName; description: string; inputSchema: object; annotations: object }[];
export declare function valueLabel(key: string, value: string): string;

export interface SettingsArgs { key?: ModelSettingKey; value?: string }

export type SettingsReceipt =
  | { threadId: string; cwd: string; values: Partial<Record<ModelSettingKey, string>> }
  | { threadId: string; cwd: string; key: ModelSettingKey; value: string; previous: string; outcome: "changed" | "unchanged" | "declined" };

export declare function settingsInput(name: string, value: Record<string, unknown>): SettingsArgs;
export declare function settingsReceipt(name: string, value: any, request: { args: SettingsArgs }, invalid: () => never): SettingsReceipt;
export declare function settingsResult(name: string, args: SettingsArgs, receipt: any): { isError?: boolean; content: { type: "text"; text: string }[] };
