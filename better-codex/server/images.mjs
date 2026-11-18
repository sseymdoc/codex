// Whether this login sees the 图像 page, and the page's statsig switches, judged as the Codex
// desktop app 26.1023 judges them (the entry's `b && d && f && !r`: app-initial Klt, VNt and tqa;
// the switches: suggestions' G, prompts' ae, chatgpt-image-share, app-initial QKa). Only a verdict
// hides the page: a plan the desktop app does not let in (Xdt), a workspace's missing permission,
// a free plan's image holdout. Anything that
// could not be read leaves it shown, with its `reason`, as before these were read. `call(method,
// path, body)` makes one call ({status, body}), as the library's; `statsig` is the bootstrap's
// request. In the browser (Node's fetch) Cloudflare answers everything off /wham with a 403
// (/accounts/check too), so there the page shows with the defaults.
import { PLANS, evaluateStatsig, selectAccount } from "./library.mjs";

/** The plans whose desktop chat a workspace may switch off (app-initial Jlt, `Bg`). */
const ENTERPRISE = new Set(["business", "enterprise", "enterprise_cbp_usage_based", "enterprise_cbp_automation", "enterprise_cbp_trial",
  "enterprise_cbp_view_only", "deprecated_enterprise", "hc", "hc_consumption", "finserv", "law", "ent26", "education", "edu_plus", "edu_pro",
  "edu", "deprecated_edu", "k12", "quorum"]);

export const PROMPT_WITH_IMAGE = "prompt_with_image";

/** What a page with nothing read gets: the preview as the main path, the rest off. */
const DEFAULTS = { available: true, preview: true, autoSendWithAttachments: false, sectionOrder: [], promptShare: false, promptShareLabel: PROMPT_WITH_IMAGE, savedReferences: false, shareAudience: "unknown" };

/**
 * The page's availability and switches: `{available, reason?, preview, autoSendWithAttachments,
 * sectionOrder, promptShare, promptShareLabel, savedReferences, shareAudience}`. The account is the token's own
 * (/accounts/check by account_ordering), its plan one of the library's (both are Xdt's). Its
 * workspace's permissions (/accounts/{id}/settings) are asked only when a gate wants them and count
 * only on a 200; /settings/user only for a free plan (the holdout) or when saved references may
 * show. Statsig's values are read as its SDK reads them: a layer's parameter only in the type of
 * its fallback. A bootstrap not read leaves every gate off and the preview on; the holdout, which
 * reads no statsig, is still judged.
 */
export async function imagesAvailable({ authMethod, claims, call, statsig }) {
  const read = (method, path, body) => call(method, path, body).catch(() => ({ status: 0, body: null }));
  const id = claims?.chatgpt_account_id;
  if (authMethod !== "chatgpt") return { ...DEFAULTS, reason: "not_chatgpt_auth" };
  if (!id) return { ...DEFAULTS, reason: "missing_account" };
  const accounts = await read("GET", "/accounts/check/v4-2023-04-27");
  const entry = accounts.status === 200 ? selectAccount(accounts.body, id) : null;
  if (!entry) return { ...DEFAULTS, reason: accounts.status === 200 ? "missing_account" : "accounts_unavailable" };
  // Klt's accountAccess: a plan outside $dt is denied before any gate.
  if (!PLANS.has(entry.account.plan_type)) return { ...DEFAULTS, available: false, reason: "unsupported_plan" };
  const bootstrap = await read("POST", "/wham/statsig/bootstrap", statsig);
  const values = bootstrap.status === 200 && typeof bootstrap.body?.statsigPayload === "string" ? evaluateStatsig(bootstrap.body.statsigPayload) : null;
  const gate = values?.gate ?? (() => false);
  const config = values?.config ?? (() => ({}));
  const layer = (name, key, fallback) => {
    const value = config("layer_configs", name)?.[key];
    return typeof value === typeof fallback ? value : fallback;
  };
  const order = config("dynamic_configs", "3939855767")?.section_order;
  const result = {
    available: true,
    preview: values ? layer("2724553558", "enabled", false) : true,
    autoSendWithAttachments: layer("3360722522", "auto_send_with_attachments", false),
    sectionOrder: Array.isArray(order) && order.every((section) => typeof section === "string") ? order : [],
    promptShare: gate("2496586795") && !gate("1939400492") && layer("250422953", "imagegen_prompt_share_tabs_enabled", false),
    promptShareLabel: layer("250422953", "imagegen_prompt_share_label", PROMPT_WITH_IMAGE) === "image_with_prompt" ? "image_with_prompt" : PROMPT_WITH_IMAGE,
    savedReferences: false,
    // Who a share link reaches (the share dialog's V, by the account's structure); unknown for anything else.
    shareAudience: entry.account.structure === "personal" ? "public" : entry.account.structure === "workspace" ? "workspace" : "unknown",
  };
  let reason = values ? undefined : "statsig_unavailable";
  const { plan_type: plan, structure } = entry.account;

  // d (Klt) and f (VNt): a gate that wants a workspace permission, from the account's settings.
  let workspace;
  const lacks = async (permission) => {
    workspace ??= await read("GET", `/accounts/${id}/settings`);
    if (workspace.status !== 200) {
      reason ??= "workspace_settings_unavailable";
      return false;
    }
    return !(Array.isArray(workspace.body?.permissions) && workspace.body.permissions.includes(permission));
  };
  if (gate("770071981") && ENTERPRISE.has(plan) && (await lacks("chatgpt.workspace.feature.desktop-app-chat.access"))) return { ...result, available: false, reason: "desktop_chat_access" };
  if (structure === "workspace" && gate("1355972088") && (await lacks("chatgpt.workspace.feature.image-gen.access"))) return { ...result, available: false, reason: "image_gen_access" };

  // !r (tqa) and the saved references (QKa), from the user's settings.
  const references = gate("3734976009") || layer("2023018368", "visor_enabled", false);
  let user = null;
  if (plan === "free" || references) {
    const answer = await read("GET", "/settings/user");
    if (answer.status === 200) user = answer.body ?? {};
    else reason ??= "settings_unavailable";
  }
  if (plan === "free" && user?.flags?.image_gen_holdout_active === true && user.settings?.image_gen_enabled !== true) return { ...result, available: false, reason: "image_gen_holdout" };
  if (user && references && !(structure !== "personal" && user.beta_settings?.memory === false)) {
    const sunshine = user.settings?.sunshine === true;
    result.savedReferences = (gate("1862054621") ? user.settings?.m3m ?? sunshine : sunshine) === true;
  }
  return reason ? { ...result, reason } : result;
}
