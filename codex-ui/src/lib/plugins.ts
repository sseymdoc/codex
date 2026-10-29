// The pure parts of the 插件 page (Plugins.tsx), and of plugin sharing and 检查更新 on Settings › 插件
// (SettingsCustomize.tsx).

import type { PluginListResponse } from "@protocol/v2/PluginListResponse";
import type { PluginMarketplaceEntry } from "@protocol/v2/PluginMarketplaceEntry";
import type { PluginReconcileResponse } from "@protocol/v2/PluginReconcileResponse";
import type { PluginSharePrincipal } from "@protocol/v2/PluginSharePrincipal";
import type { PluginShareTarget } from "@protocol/v2/PluginShareTarget";
import type { PluginSummary } from "@protocol/v2/PluginSummary";

/**
 * The people a share keeps when only its general access changes: plugin/share/updateTargets
 * replaces the whole list, so the readers and editors go back as they are. The owner is implied,
 * and the workspace principal is the one UNLISTED adds by itself (the server rejects both).
 */
export function keptTargets(principals: PluginSharePrincipal[] | null): PluginShareTarget[] {
  return (principals ?? []).flatMap(({ principalType, principalId, role }) =>
    principalType === "workspace" || role === "owner" ? [] : [{ principalType, principalId, role }],
  );
}

/**
 * The 检查更新 toast for one plugin after plugin/reconcile, worded as c334c9fcc Q's onSuccess:
 * already up to date, updated from one version to another, or just updated. Null when the
 * plugin's update failed (c334c9fcc Y: “Couldn’t check for updates. Try again.”).
 */
export function updateMessage(
  response: PluginReconcileResponse,
  plugin: { id: string; remotePluginId: string | null },
  before: string | null,
  after: string | null,
): string | null {
  if (plugin.remotePluginId && response.failedRemotePluginIds.includes(plugin.remotePluginId)) return null;
  if (!response.changedPlugins.some((changed) => changed.id === plugin.id)) return "插件已是最新版本。";
  return before && after && before !== after ? `已从 ${before} 更新到 ${after}。` : "插件已更新。";
}

/** A plugin with the marketplace plugin/read and plugin/install name it by. */
export type PluginEntry = { plugin: PluginSummary; marketplaceName: string; marketplacePath: string | null };
export type PluginSection = { id: string; title: string; detail?: string; entries: PluginEntry[] };

const entriesOf = (markets: PluginMarketplaceEntry[]): PluginEntry[] =>
  markets.flatMap((market) => market.plugins.map((plugin) => ({ plugin, marketplaceName: market.name, marketplacePath: market.path })));

/** The marketplaces OpenAI ships (openai-curated, openai-bundled, openai-curated-remote…): 公开, not 个人. */
export const isOfficialMarketplace = (name: string): boolean => name.startsWith("openai-") || name === "codex-official";

/** Cannot be installed or used here (the Codex app's card dims these and sorts them last). */
export const unavailable = (plugin: PluginSummary): boolean =>
  plugin.availability === "DISABLED_BY_ADMIN" || (!plugin.installed && (plugin.installPolicy === "NOT_AVAILABLE" || plugin.disabledReason !== null));

/** One section per category, 其他 last; within one, the unavailable go last. */
export function categorySections(entries: PluginEntry[]): PluginSection[] {
  const groups = new Map<string, PluginEntry[]>();
  for (const entry of entries) {
    const category = entry.plugin.interface?.category?.trim() || "Other";
    groups.set(category, [...(groups.get(category) ?? []), entry]);
  }
  return [...groups.keys()]
    .sort((a, b) => (a === "Other") === (b === "Other") ? a.localeCompare(b) : a === "Other" ? 1 : -1)
    .map((category) => ({
      id: `category:${category}`,
      title: category === "Other" ? "其他" : category,
      entries: [...groups.get(category)!].sort((a, b) => Number(unavailable(a.plugin)) - Number(unavailable(b.plugin))),
    }));
}

/**
 * 公开 as the Codex app builds it from plugin/list without a ChatGPT home feed: 精选 in
 * featuredPluginIds order, then the categories. The local openai-curated copy steps aside when the
 * account's remote curated catalog came back, as the app hides it then.
 */
export function publicSections(list: PluginListResponse): PluginSection[] {
  const remote = list.marketplaces.some((market) => market.name === "openai-curated-remote");
  const entries = entriesOf(list.marketplaces.filter((market) => isOfficialMarketplace(market.name) && !(remote && market.name === "openai-curated")));
  const byId = new Map(entries.map((entry) => [entry.plugin.id, entry]));
  const featured = [...new Set(list.featuredPluginIds)].flatMap((id) => byId.get(id) ?? []);
  return [...(featured.length ? [{ id: "featured", title: "精选", entries: featured }] : []), ...categorySections(entries)];
}

/** 个人: 由您创建, 与您共享, then each marketplace the user added (empty ones too, with their path). */
export function personalSections(list: PluginListResponse): PluginSection[] {
  const created: PluginEntry[] = [];
  const shared: PluginEntry[] = [];
  const markets: PluginSection[] = [];
  for (const market of list.marketplaces) {
    if (isOfficialMarketplace(market.name)) continue;
    if (market.name === "created-by-me-remote") created.push(...entriesOf([market]));
    else if (market.name.startsWith("workspace-shared-with-me")) shared.push(...entriesOf([market]));
    else markets.push({ id: `market:${market.name}`, title: market.interface?.displayName ?? market.name, detail: market.path ?? undefined, entries: entriesOf([market]) });
  }
  return [
    ...(created.length ? [{ id: "created", title: "由您创建", entries: created }] : []),
    ...(shared.length ? [{ id: "shared", title: "与您共享", entries: shared }] : []),
    ...markets,
  ];
}

/** The search box when the server has no plugin/search: name, description, developer, keywords. */
export function matchesPlugin(plugin: PluginSummary, term: string): boolean {
  const query = term.trim().toLowerCase();
  const ui = plugin.interface;
  return !query || [plugin.name, ui?.displayName, ui?.shortDescription, ui?.developerName, ui?.category, ...plugin.keywords].some((text) => text?.toLowerCase().includes(query));
}

/**
 * The main action a card or the detail page offers, after plugin-detail-actions: blocked by the
 * admin, needs another plan, cannot be installed here, 安装, 启用, or 立即试用. Remote plugins are
 * turned on and off on ChatGPT (no RPC), so a disabled one only says so.
 */
export type PluginStatus = "admin" | "plan" | "unavailable" | "install" | "enable" | "disabled" | "try";
export function pluginStatus(plugin: PluginSummary): PluginStatus {
  if (plugin.availability === "DISABLED_BY_ADMIN" || plugin.disabledReason === "disabled_by_admin") return "admin";
  if (plugin.installed) return plugin.enabled ? "try" : plugin.source.type === "remote" ? "disabled" : "enable";
  if (plugin.disabledReason === "plan_not_eligible") return "plan";
  return plugin.installPolicy === "NOT_AVAILABLE" || plugin.disabledReason !== null ? "unavailable" : "install";
}

/** The card's origin badge (plugins.card.*Plugin): none for OpenAI's own marketplaces. */
export function originBadge({ plugin, marketplaceName }: PluginEntry): string | null {
  if (isOfficialMarketplace(marketplaceName)) return null;
  if (marketplaceName === "created-by-me-remote") return "您的云端插件";
  if (marketplaceName === "workspace-directory" || marketplaceName.startsWith("workspace-shared-with-me")) return "工作空间插件";
  return plugin.source.type === "git" ? "Git 市场插件" : "本地插件";
}
