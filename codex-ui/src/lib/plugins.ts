// The pure parts of plugin sharing and 检查更新 on Settings › 插件 (SettingsCustomize.tsx).

import type { PluginReconcileResponse } from "@protocol/v2/PluginReconcileResponse";
import type { PluginSharePrincipal } from "@protocol/v2/PluginSharePrincipal";
import type { PluginShareTarget } from "@protocol/v2/PluginShareTarget";

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
