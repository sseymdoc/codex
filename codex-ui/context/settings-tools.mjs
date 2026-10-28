// codex_ui_desktop's settings tools: the Codex UI preferences the model may read and, with the
// user's consent each time, change. Permissions, tool access, the backend and anything else that
// widens what Codex may do are not on the list. Schemas, argument and receipt checks, result text.

export const SETTINGS_TOOL_NAMES = Object.freeze(["get_settings", "set_setting"]);

const onOff = [["on", "开"], ["off", "关"]];
/** key → the Settings page's label and its values with their labels. */
export const MODEL_SETTINGS = Object.freeze({
  theme: { label: "主题", options: [["system", "系统"], ["light", "浅色"], ["dark", "深色"]] },
  transcript_text_size: { label: "对话记录文字大小", options: [["s", "小号"], ["m", "中等"], ["l", "大号"]] },
  transcript_width: { label: "对话记录宽度", options: [["s", "窄版"], ["m", "中等"], ["l", "宽幅"]] },
  motion: { label: "动效", options: [["system", "系统"], ["reduce", "减弱"]] },
  interface_font: { label: "界面字体", options: [["anthropic", "Anthropic Sans"], ["system", "系统"], ["dyslexic", "OpenDyslexic"]] },
  default_transcript_view: { label: "默认对话记录视图", options: [["normal", "普通"], ["thinking", "思考"], ["verbose", "详细"]] },
  plan_card: { label: "计划卡", options: onOff },
  away_recap: { label: "离开后的回顾", options: onOff },
  merged_model_picker: { label: "合并模型与努力程度", options: onOff },
  new_task_prompt: { label: "当您请求无关的任务时", options: [["ask", "问我"], ["here", "始终在此处执行"], ["new_session", "始终新建会话"]] },
  draw_attention: { label: "收到通知时引起注意", options: onOff },
  keep_awake_while_working: { label: "Codex 工作时保持计算机唤醒", options: onOff },
  keep_awake_on_battery: { label: "使用电池供电时保持唤醒", options: onOff },
});
export const SETTING_KEYS = Object.freeze(Object.keys(MODEL_SETTINGS));

export const SETTINGS_TOOLS = [
  { name: "get_settings", description: "List the Codex UI preferences set_setting may change: key, label as the Settings page shows it, current value and allowed values. Read-only. Permissions, tool access, the backend and other settings that change what Codex may do are not listed and are changed by the user in Settings only.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "set_setting", description: "Change one Codex UI preference from get_settings to one of its allowed values. Every change first waits on a card where the user allows or declines it, so call it only when the user asks for that change, one setting per call; once allowed it applies at once. The result says whether it changed, was already set, or was declined.",
    inputSchema: { type: "object", additionalProperties: false, required: ["key", "value"], properties: {
      key: { type: "string", enum: [...SETTING_KEYS], description: "A key from get_settings." },
      value: { type: "string", maxLength: 40, description: "One of that setting's allowed values." } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];

const refuse = (message) => { throw Object.assign(new Error(message), { code: "INVALID_INPUT" }); };
const values = (key) => MODEL_SETTINGS[key].options.map(([value]) => value);
/** A value's label as the card and the result show it. */
export const valueLabel = (key, value) => MODEL_SETTINGS[key]?.options.find(([option]) => option === value)?.[1] ?? value;

export function settingsInput(name, value) {
  if (!SETTINGS_TOOL_NAMES.includes(name)) refuse("Unknown settings tool.");
  const allowed = name === "set_setting" ? ["key", "value"] : [];
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) refuse(`Unknown ${name} arguments: ${extra.join(", ")}.`);
  if (name === "get_settings") return {};
  if (typeof value.key !== "string" || !Object.hasOwn(MODEL_SETTINGS, value.key)) refuse("This setting is not one Codex may change; call get_settings for those it may. Permissions, tool access, the backend and other settings that change what Codex may do are changed by the user in Settings only.");
  if (typeof value.value !== "string" || !values(value.key).includes(value.value)) refuse(`value must be one of: ${values(value.key).join(", ")}.`);
  return { key: value.key, value: value.value };
}

export function settingsReceipt(name, value, request, invalid) {
  if (name === "get_settings") {
    if (Object.keys(value).some((key) => !["threadId", "cwd", "values"].includes(key)) || !value.values || typeof value.values !== "object") invalid();
    for (const [key, entry] of Object.entries(value.values)) if (!Object.hasOwn(MODEL_SETTINGS, key) || !values(key).includes(entry)) invalid();
    return value;
  }
  if (Object.keys(value).some((key) => !["threadId", "cwd", "key", "value", "previous", "outcome"].includes(key))) invalid();
  if (value.key !== request.args.key || value.value !== request.args.value || !values(value.key).includes(value.previous) || !["changed", "unchanged", "declined"].includes(value.outcome)) invalid();
  return value;
}

export function settingsResult(name, args, receipt) {
  const text = (body) => ({ content: [{ type: "text", text: body }] });
  if (name === "get_settings") {
    const settings = SETTING_KEYS.filter((key) => key in receipt.values).map((key) => ({ key, label: MODEL_SETTINGS[key].label, value: receipt.values[key], options: MODEL_SETTINGS[key].options.map(([value, label]) => ({ value, label })) }));
    return text(JSON.stringify({ settings }));
  }
  const label = `“${MODEL_SETTINGS[receipt.key].label}”`;
  const quoted = (value) => `“${valueLabel(receipt.key, value)}”`;
  if (receipt.outcome === "declined") return { isError: true, content: [{ type: "text", text: `The user declined changing ${label}. Nothing was changed.` }] };
  if (receipt.outcome === "unchanged") return text(`${label} is already ${quoted(receipt.value)}; nothing was changed.`);
  return text(`Changed ${label} to ${quoted(receipt.value)} (was ${quoted(receipt.previous)}).`);
}
