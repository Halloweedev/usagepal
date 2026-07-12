import type { ManifestLine, MetricLine } from "@/lib/plugin-types"
import { buildShareableLines } from "@/lib/share-lines"
import { parseModelBreakdownValue, type ModelBreakdownParsed } from "@/lib/model-breakdown-format"

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

/** Time window a usage graph is built for. `todayCost` on the returned entries
 * holds the cost for whichever period was requested. */
export type UsagePeriod = "today" | "yesterday" | "thirtyDay"

/** Per period: which per-model dollar field to read (Claude carries Today/30d
 * per model; Yesterday never has a per-model figure), and the provider-level
 * summary line to fall back to for percent-only providers (e.g. Codex). */
const PERIOD: Record<UsagePeriod, { dollarField: "today" | "thirtyDay" | null; providerLabel: string }> = {
  today: { dollarField: "today", providerLabel: "Today" },
  yesterday: { dollarField: null, providerLabel: "Yesterday" },
  thirtyDay: { dollarField: "thirtyDay", providerLabel: "Last 30 Days" },
}

/** Parses a plugin-formatted dollar string ("$12.40", "$1,234"). Returns null
 * for anything malformed or non-positive. */
export function parseDollarAmount(value: string): number | null {
  const match = value.match(/^\$([\d,]+(?:\.\d+)?)$/)
  if (!match) return null
  const amount = Number(match[1].replace(/,/g, ""))
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

/** Fraction 0..1 from a breakdown percent field ("99.7%", "<0.1%"). */
function parsePercentFraction(percent: string): number | null {
  const match = percent.match(/^<?(\d+(?:\.\d+)?)%$/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value / 100 : null
}

/** A provider's period summary line (e.g. "Today" → "$458.16 · 333M",
 * "Last 30 Days" → "$774.65 · 563M"); extracts the leading dollar magnitude,
 * used to size a percent-only provider's slice or derive its per-model costs. */
export function parseProviderPeriodTotal(lines: MetricLine[], label: string): number | null {
  const line = lines.find((l) => l.label === label && l.type === "text")
  if (!line || line.type !== "text") return null
  return parseDollarAmount(line.value.split(" · ")[0])
}

/** Provider-level period totals a percent-only model row is sized against. */
export type ModelCostBasis = { today: number | null; thirtyDay: number | null }

/** Tooltip detail lines ("Today $X", "7 days $Y", "30 days $Z") for a model
 * breakdown row. Rows that already carry per-model dollars (Claude) pass them
 * through; percent-only rows (Codex) derive Today/30d as `provider total ×
 * this model's %`, so both providers get the same hover breakdown. A period
 * with no source (no per-model $, no provider total) is omitted. */
export function modelBreakdownDetailLines(
  parsed: ModelBreakdownParsed,
  basis: ModelCostBasis
): string[] {
  const fraction = parsePercentFraction(parsed.percent)
  const derive = (total: number | null) =>
    total != null && fraction != null ? formatShareCost(total * fraction) : undefined
  const today = parsed.today ?? derive(basis.today)
  const thirtyDay = parsed.thirtyDay ?? derive(basis.thirtyDay)
  return [
    today && `Today ${today}`,
    parsed.sevenDay && `7 days ${parsed.sevenDay}`,
    thirtyDay && `30 days ${thirtyDay}`,
  ].filter((detail): detail is string => Boolean(detail))
}

/** Aggregates per-model spend for `period` across providers from the model
 * breakdown lines plugins already emit. Share is cost-weighted: a model's
 * period-$ over the sum of all period-$. A provider with no data for the period
 * (no per-model $ and no matching provider summary line) is left out entirely. */
export function buildModelUsage(plugins: TodayModelsSource[], period: UsagePeriod): TodayModelUsage {
  const { dollarField, providerLabel } = PERIOD[period]
  const models: TodayModelEntry[] = []
  const providers: TodayProviderEntry[] = []

  for (const plugin of plugins) {
    if (!plugin.data) continue
    const base = {
      providerId: plugin.meta.id,
      providerName: plugin.meta.name,
      brandColor: plugin.meta.brandColor,
    }
    // Per-model dollars (e.g. Claude via ccusage) and percent-only rows
    // (e.g. Codex) are two different data shapes; collect both, prefer dollars.
    const dollarModels: TodayModelEntry[] = []
    const percentModels: { name: string; fraction: number }[] = []
    for (const entry of buildShareableLines(plugin.data.lines, plugin.meta.lines)) {
      if (entry.scope !== "modelBreakdown" || entry.line.type !== "text") continue
      const parsed = parseModelBreakdownValue(entry.line.value)
      if (!parsed) continue
      const dollarValue = dollarField ? parsed[dollarField] : undefined
      if (dollarValue) {
        const cost = parseDollarAmount(dollarValue)
        if (cost != null) dollarModels.push({ ...base, name: entry.line.label, todayCost: cost, share: 0 })
      } else {
        const fraction = parsePercentFraction(parsed.percent)
        if (fraction != null) percentModels.push({ name: entry.line.label, fraction })
      }
    }

    let providerModels: TodayModelEntry[]
    if (dollarModels.length > 0) {
      providerModels = dollarModels
    } else if (percentModels.length > 0) {
      // No per-model dollars: size the slice by the provider's own period total
      // and split it across models by their token percentage.
      const total = parseProviderPeriodTotal(plugin.data.lines, providerLabel)
      if (total == null) continue
      providerModels = percentModels.map((m) => ({ ...base, name: m.name, todayCost: total * m.fraction, share: 0 }))
    } else {
      continue
    }

    const providerTotal = providerModels.reduce((sum, model) => sum + model.todayCost, 0)
    if (providerTotal <= 0) continue
    providerModels.sort((a, b) => b.todayCost - a.todayCost || a.name.localeCompare(b.name))
    models.push(...providerModels)
    providers.push({
      id: plugin.meta.id,
      name: plugin.meta.name,
      brandColor: plugin.meta.brandColor,
      todayCost: providerTotal,
      share: 0,
      // A provider's own uncapped list, for its hover tooltip; never holds Others.
      models: providerModels,
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
    // provider.models is the provider's own uncapped list; set each entry's
    // share against the same grand total the ranked list uses.
    for (const model of provider.models) model.share = model.todayCost / totalCost
  }
  return { models: ranked, providers, totalCost }
}

/** Today's usage — the default window. Thin wrapper over {@link buildModelUsage}. */
export function buildTodayModelUsage(plugins: TodayModelsSource[]): TodayModelUsage {
  return buildModelUsage(plugins, "today")
}

/** How the Share graph slices usage: one slice per provider, or per model. */
export type GraphGroupBy = "provider" | "model"

/** A selectable, renderable graph slice — a provider or a model, flattened to
 * a common shape so the graph card and the "what to show" checklist share it. */
export type GraphEntry = {
  /** Stable id for selection state and React keys. */
  key: string
  name: string
  providerId: string
  brandColor: string | null
  todayCost: number
  /** Fraction of the selected total, 0..1. */
  share: number
  isOthers?: boolean
}

/** Stable key for a model within the ranked list (provider + name); providers
 * key on their own id. */
export function modelEntryKey(model: Pick<TodayModelEntry, "providerId" | "name">): string {
  return `${model.providerId}::${model.name}`
}

/** Every selectable slice for a grouping, unfiltered — the source for the
 * Share "what to show" checklist. Ranked as the usage already is. */
export function graphEntities(usage: TodayModelUsage, groupBy: GraphGroupBy): GraphEntry[] {
  if (groupBy === "provider") {
    return usage.providers.map((provider) => ({
      key: provider.id,
      name: provider.name,
      providerId: provider.id,
      brandColor: provider.brandColor,
      todayCost: provider.todayCost,
      share: provider.share,
    }))
  }
  return usage.models.map((model) => ({
    key: modelEntryKey(model),
    name: model.name,
    providerId: model.providerId,
    brandColor: model.brandColor,
    todayCost: model.todayCost,
    share: model.share,
    isOthers: model.isOthers,
  }))
}

/** Keeps only the selected slices and re-normalizes share + total over them, so
 * the graph fills the ring with whatever the user chose to show off. */
export function selectGraphEntries(
  entities: GraphEntry[],
  isSelected: (key: string) => boolean
): { entries: GraphEntry[]; totalCost: number } {
  const kept = entities.filter((entry) => isSelected(entry.key))
  const totalCost = kept.reduce((sum, entry) => sum + entry.todayCost, 0)
  if (totalCost <= 0) return { entries: [], totalCost: 0 }
  return { entries: kept.map((entry) => ({ ...entry, share: entry.todayCost / totalCost })), totalCost }
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
