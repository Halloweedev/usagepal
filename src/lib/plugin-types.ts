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

export type PluginDisplayState = {
  meta: PluginMeta
  data: PluginOutput | null
  loading: boolean
  error: string | null
  lastManualRefreshAt: number | null
  lastUpdatedAt: number | null
}
