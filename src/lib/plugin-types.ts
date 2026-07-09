export type { ProgressFormat, BarChartPoint, MetricLine, PluginOutput } from "@/bindings"
import type { ManifestLineDto, PluginLinkDto, PluginMeta as PluginMetaDto, PluginOutput } from "@/bindings"

export type ManifestLine = Omit<ManifestLineDto, "type" | "scope"> & {
  type: "text" | "progress" | "badge" | "barChart"
  scope: "overview" | "detail"
}

export type PluginLink = PluginLinkDto

export type PluginMeta = Omit<PluginMetaDto, "lines"> & {
  lines: ManifestLine[]
}

/** Providers whose access runs through a UsagePal-managed API key. Enabling
 * them prompts for the key; onboarding surfaces them as "needs a key". */
export const MANAGED_API_KEY_PLUGIN_IDS = ["openrouter", "cline-pass"] as const

export const hasManagedApiKey = (pluginId: string): boolean =>
  (MANAGED_API_KEY_PLUGIN_IDS as readonly string[]).includes(pluginId)

export type PluginDisplayState = {
  meta: PluginMeta
  data: PluginOutput | null
  loading: boolean
  error: string | null
  lastManualRefreshAt: number | null
  lastUpdatedAt: number | null
}
