import type { ManifestLine, MetricLine } from "@/lib/plugin-types"
import { buildShareableLines } from "@/lib/share-lines"
import { parseModelBreakdownValue } from "@/lib/model-breakdown-format"

/** Sentinel Share-page tab id for the cross-provider graph card. */
export const ALL_SHARE_TAB_ID = "all"

/** Models past this rank collapse into a single "Others" entry. */
export const MAX_GRAPH_MODELS = 8

export type TodayModelEntry = {
  name: string
  providerId: string
  providerName: string
  brandColor: string | null
  todayCost: number
  /** Fraction of totalCost, 0..1. */
  share: number
  isOthers?: boolean
}

export type TodayProviderEntry = {
  id: string
  name: string
  brandColor: string | null
  todayCost: number
  /** Fraction of totalCost, 0..1. */
  share: number
  /** This provider's entries from the ranked model list, cost-desc.
   * The synthetic Others bucket belongs to no provider. */
  models: TodayModelEntry[]
}

export type TodayModelUsage = {
  /** Ranked by todayCost desc; the Others bucket (if any) is always last. */
  models: TodayModelEntry[]
  /** Ranked by todayCost desc. */
  providers: TodayProviderEntry[]
  totalCost: number
}

/** Structural subset of DisplayPluginState/PluginDisplayState that this lib
 * needs, so both the Share page and the Overview page can pass their plugin
 * arrays without conversion. */
export type TodayModelsSource = {
  meta: { id: string; name: string; brandColor: string | null; lines: ManifestLine[] }
  data: { lines: MetricLine[] } | null
}

/** Parses a plugin-formatted dollar string ("$12.40", "$1,234"). Returns null
 * for anything malformed or non-positive. */
export function parseDollarAmount(value: string): number | null {
  const match = value.match(/^\$([\d,]+(?:\.\d+)?)$/)
  if (!match) return null
  const amount = Number(match[1].replace(/,/g, ""))
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

/** Aggregates today's per-model spend across providers from the model
 * breakdown lines plugins already emit. Share is cost-weighted: a model's
 * today-$ over the sum of all today-$. */
export function buildTodayModelUsage(plugins: TodayModelsSource[]): TodayModelUsage {
  const models: TodayModelEntry[] = []
  const providers: TodayProviderEntry[] = []

  for (const plugin of plugins) {
    if (!plugin.data) continue
    let providerTotal = 0
    for (const entry of buildShareableLines(plugin.data.lines, plugin.meta.lines)) {
      if (entry.scope !== "modelBreakdown" || entry.line.type !== "text") continue
      const parsed = parseModelBreakdownValue(entry.line.value)
      if (!parsed?.today) continue
      const cost = parseDollarAmount(parsed.today)
      if (cost == null) continue
      models.push({
        name: entry.line.label,
        providerId: plugin.meta.id,
        providerName: plugin.meta.name,
        brandColor: plugin.meta.brandColor,
        todayCost: cost,
        share: 0,
      })
      providerTotal += cost
    }
    if (providerTotal > 0)
      providers.push({
        id: plugin.meta.id,
        name: plugin.meta.name,
        brandColor: plugin.meta.brandColor,
        todayCost: providerTotal,
        share: 0,
        models: [],
      })
  }

  models.sort((a, b) => b.todayCost - a.todayCost || a.name.localeCompare(b.name))
  providers.sort((a, b) => b.todayCost - a.todayCost || a.name.localeCompare(b.name))

  let ranked = models
  if (models.length > MAX_GRAPH_MODELS) {
    const rest = models.slice(MAX_GRAPH_MODELS)
    ranked = models.slice(0, MAX_GRAPH_MODELS)
    ranked.push({
      name: "Others",
      providerId: "",
      providerName: "",
      brandColor: null,
      todayCost: rest.reduce((sum, model) => sum + model.todayCost, 0),
      share: 0,
      isOthers: true,
    })
  }

  const totalCost = ranked.reduce((sum, model) => sum + model.todayCost, 0)
  if (totalCost <= 0) return { models: [], providers: [], totalCost: 0 }
  for (const model of ranked) model.share = model.todayCost / totalCost
  for (const provider of providers) {
    provider.share = provider.todayCost / totalCost
    provider.models = ranked.filter((model) => model.providerId === provider.id)
  }
  return { models: ranked, providers, totalCost }
}

/** Matches the plugins' fmtModelCost: cents under $1000, grouped whole dollars above. */
export function formatShareCost(amount: number): string {
  if (amount < 1000) return "$" + amount.toFixed(2)
  return "$" + Math.round(amount).toLocaleString("en-US")
}

export function formatSharePercent(share: number): string {
  const percent = share * 100
  if (percent > 0 && percent < 1) return "<1%"
  return `${Math.round(percent)}%`
}
