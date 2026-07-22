import type { ManifestLine, MetricLine } from "@/lib/plugin-types"
import { buildShareableLines } from "@/lib/share-lines"
import { parseModelBreakdownValue, type ModelBreakdownParsed } from "@/lib/model-breakdown-format"

/** Sentinel Share-page tab id for the cross-provider graph card. */
export const ALL_SHARE_TAB_ID = "all"

export type TodayModelEntry = {
  name: string
  providerId: string
  providerName: string
  /** Unique provider display names that contributed to this entry (dominant first). */
  providerNames: string[]
  brandColor: string | null
  todayCost: number
  /** Raw token count for the active period, when the provider exposes it. */
  tokenCount: number | null
  /** Fraction of totalCost, 0..1. */
  share: number
  isOthers?: boolean
}

export type TodayProviderEntry = {
  id: string
  name: string
  brandColor: string | null
  todayCost: number
  /** Provider-level token count for the active period, when exposed. */
  tokenCount: number | null
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

/** Per period: which per-model dollar field to read (Claude: Today/30d; Cursor adds
 * Yesterday from CSV), and the provider-level summary line for percent-only providers. */
const PERIOD: Record<UsagePeriod, { dollarField: "today" | "yesterday" | "thirtyDay" | null; providerLabel: string }> = {
  today: { dollarField: "today", providerLabel: "Today" },
  yesterday: { dollarField: "yesterday", providerLabel: "Yesterday" },
  thirtyDay: { dollarField: "thirtyDay", providerLabel: "Last 30 Days" },
}

/** Normalizes a model label for cross-provider grouping (case/space insensitive). */
export function normalizeModelName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ")
}

/** Unions provider display names, keeping the dominant provider first. */
function mergeProviderNames(dominant: string, a: string[], b: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of [dominant, ...a, ...b]) {
    const key = name.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

/** Merges same-named models across providers into one ranked entry. */
function mergeModelsByName(models: TodayModelEntry[]): TodayModelEntry[] {
  const byName = new Map<string, TodayModelEntry>()
  for (const model of models) {
    const key = normalizeModelName(model.name)
    const existing = byName.get(key)
    if (!existing) {
      byName.set(key, {
        ...model,
        providerNames: model.providerNames.length > 0 ? [...model.providerNames] : [model.providerName],
      })
      continue
    }
    const dominant = existing.todayCost >= model.todayCost ? existing : model
    const mergedTokens =
      existing.tokenCount != null || model.tokenCount != null
        ? (existing.tokenCount ?? 0) + (model.tokenCount ?? 0)
        : null
    byName.set(key, {
      name: dominant.name,
      providerId: dominant.providerId,
      providerName: dominant.providerName,
      providerNames: mergeProviderNames(dominant.providerName, existing.providerNames, model.providerNames),
      brandColor: dominant.brandColor,
      todayCost: existing.todayCost + model.todayCost,
      tokenCount: mergedTokens != null && mergedTokens > 0 ? mergedTokens : null,
      share: 0,
      isOthers: existing.isOthers || model.isOthers,
    })
  }
  return [...byName.values()]
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

/** Parses plugin token strings ("333M", "94M tokens", "1.2K"). */
export function parseTokenCount(value: string): number | null {
  const match = value.trim().match(/^(-?)(\d+(?:\.\d+)?)\s*([KMB])?(?:\s+tokens)?$/i)
  if (!match) return null
  const amount = Number(match[2])
  if (!Number.isFinite(amount) || amount < 0) return null
  const multiplier =
    match[3]?.toUpperCase() === "B" ? 1e9
    : match[3]?.toUpperCase() === "M" ? 1e6
    : match[3]?.toUpperCase() === "K" ? 1e3
    : 1
  const signed = (match[1] === "-" ? -1 : 1) * amount * multiplier
  return signed > 0 ? signed : null
}

/** Reads the token suffix from a provider period summary ("Today" → 333M). */
export function parseProviderPeriodTokens(lines: MetricLine[], label: string): number | null {
  const line = lines.find((l) => l.label === label && l.type === "text")
  if (!line || line.type !== "text") return null
  const parts = line.value.split(" · ")
  if (parts.length < 2) return null
  return parseTokenCount(parts.slice(1).join(" · "))
}

/** Provider-level period totals a percent-only model row is sized against. */
export type ModelCostBasis = { today: number | null; thirtyDay: number | null }

/** Fills missing Today/30d dollars on a model breakdown from provider totals ×
 * this model's %. Rows that already carry per-model dollars are unchanged.
 * Share's model table and Overview tooltips both use this so percent-only
 * providers (Codex before cost splits, Cursor when a model has tokens but $0
 * imputed cost, etc.) still show prices. 7d is not derived — plugins must
 * embed it; there is no provider-level 7d summary line. */
export function enrichModelBreakdownParsed(
  parsed: ModelBreakdownParsed,
  basis: ModelCostBasis
): ModelBreakdownParsed {
  const fraction = parsePercentFraction(parsed.percent)
  const derive = (total: number | null) =>
    total != null && fraction != null ? formatShareCost(total * fraction) : undefined
  return {
    ...parsed,
    today: parsed.today ?? derive(basis.today),
    thirtyDay: parsed.thirtyDay ?? derive(basis.thirtyDay),
  }
}

/** Tooltip detail lines ("Today $X", "7 days $Y", "30 days $Z") for a model
 * breakdown row. Rows that already carry per-model dollars (Claude) pass them
 * through; percent-only rows derive Today/30d as `provider total × this
 * model's %`. A period with no source is omitted. */
export function modelBreakdownDetailLines(
  parsed: ModelBreakdownParsed,
  basis: ModelCostBasis
): string[] {
  const enriched = enrichModelBreakdownParsed(parsed, basis)
  return [
    enriched.today && `Today ${enriched.today}`,
    enriched.sevenDay && `7 days ${enriched.sevenDay}`,
    enriched.thirtyDay && `30 days ${enriched.thirtyDay}`,
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
      providerNames: [plugin.meta.name],
      brandColor: plugin.meta.brandColor,
    }
    const providerTokens = parseProviderPeriodTokens(plugin.data.lines, providerLabel)
    // Per-model dollars (e.g. Claude via ccusage) and percent-only rows
    // (e.g. Codex) are two different data shapes; collect both, prefer dollars.
    const dollarModels: TodayModelEntry[] = []
    const percentModels: { name: string; fraction: number }[] = []
    for (const entry of buildShareableLines(plugin.data.lines, plugin.meta.lines)) {
      if (entry.scope !== "modelBreakdown" || entry.line.type !== "text") continue
      const parsed = parseModelBreakdownValue(entry.line.value)
      if (!parsed) continue
      const fraction = parsePercentFraction(parsed.percent)
      const dollarValue = dollarField ? parsed[dollarField] : undefined
      if (dollarValue) {
        const cost = parseDollarAmount(dollarValue)
        if (cost != null) {
          dollarModels.push({ ...base, name: entry.line.label, todayCost: cost, tokenCount: null, share: 0 })
        }
      } else if (fraction != null) {
        percentModels.push({ name: entry.line.label, fraction })
      }
    }

    let providerModels: TodayModelEntry[]
    if (dollarModels.length > 0) {
      providerModels = dollarModels
      if (providerTokens != null) {
        const dollarTotal = providerModels.reduce((sum, model) => sum + model.todayCost, 0)
        if (dollarTotal > 0) {
          for (const model of providerModels) {
            model.tokenCount = providerTokens * (model.todayCost / dollarTotal)
          }
        }
      }
    } else if (percentModels.length > 0) {
      // No per-model dollars: size the slice by the provider's own period total
      // and split it across models by their token percentage.
      const total = parseProviderPeriodTotal(plugin.data.lines, providerLabel)
      if (total == null) continue
      providerModels = percentModels.map((m) => ({
        ...base,
        name: m.name,
        todayCost: total * m.fraction,
        tokenCount: providerTokens != null ? providerTokens * m.fraction : null,
        share: 0,
      }))
    } else {
      continue
    }

    providerModels = mergeModelsByName(providerModels)
    providerModels.sort((a, b) => b.todayCost - a.todayCost || a.name.localeCompare(b.name))

    const providerTotal = providerModels.reduce((sum, model) => sum + model.todayCost, 0)
    if (providerTotal <= 0) continue
    models.push(...providerModels)
    providers.push({
      id: plugin.meta.id,
      name: plugin.meta.name,
      brandColor: plugin.meta.brandColor,
      todayCost: providerTotal,
      tokenCount: providerTokens,
      share: 0,
      // A provider's own uncapped list, for its hover tooltip; never holds Others.
      models: providerModels,
    })
  }

  models.sort((a, b) => b.todayCost - a.todayCost || a.name.localeCompare(b.name))
  providers.sort((a, b) => b.todayCost - a.todayCost || a.name.localeCompare(b.name))

  const ranked = mergeModelsByName(models)

  const totalCost = ranked.reduce((sum, model) => sum + model.todayCost, 0)
  if (totalCost <= 0) return { models: [], providers: [], totalCost: 0 }
  for (const model of ranked) model.share = model.todayCost / totalCost
  for (const provider of providers) {
    provider.share = provider.todayCost / totalCost
    // provider.models is the provider's own uncapped list; set each entry's
    // share against the same grand total the ranked list uses.
    for (const model of provider.models) model.share = model.todayCost / totalCost
    provider.models = provider.models.filter(isDisplayableModel)
  }
  // Sub-cent models (mostly percent-only rows whose derived cost rounds to
  // $0.00) are hidden as their own rows, but their spend stays in totalCost and
  // in each provider's subtotal — so the grand total and shares stay honest.
  return { models: ranked.filter(isDisplayableModel), providers, totalCost }
}

/** A model earns its own row only once its spend reaches a full cent; below
 * that it would render as "$0.00". */
const MIN_DISPLAY_COST = 0.01
function isDisplayableModel(model: TodayModelEntry): boolean {
  return model.todayCost >= MIN_DISPLAY_COST
}

/** Today's usage — the default window. Thin wrapper over {@link buildModelUsage}. */
export function buildTodayModelUsage(plugins: TodayModelsSource[]): TodayModelUsage {
  return buildModelUsage(plugins, "today")
}

/** How the Share graph slices usage: one slice per provider, or per model. */
export type GraphGroupBy = "provider" | "model"

/** What bar/donut mode visualizes: token usage, spend, or effective $/M. */
export type GraphMetric = "usage" | "price" | "pricePerM"

/** A selectable, renderable graph slice — a provider or a model, flattened to
 * a common shape so the graph card and the "what to show" checklist share it. */
export type GraphEntry = {
  /** Stable id for selection state and React keys. */
  key: string
  name: string
  providerId: string
  brandColor: string | null
  todayCost: number
  tokenCount: number | null
  /** Fraction of the selected total, 0..1. */
  share: number
  isOthers?: boolean
}

/** Stable key for a model within the ranked list; providers key on their own id. */
export function modelEntryKey(model: Pick<TodayModelEntry, "name" | "isOthers">): string {
  if (model.isOthers) return "::Others"
  return normalizeModelName(model.name)
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
      tokenCount: provider.tokenCount,
      share: provider.share,
    }))
  }
  return usage.models.map((model) => ({
    key: modelEntryKey(model),
    name: model.name,
    providerId: model.providerId,
    brandColor: model.brandColor,
    todayCost: model.todayCost,
    tokenCount: model.tokenCount,
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
  const result = selectGraphEntriesByMetric(entities, "price", isSelected)
  return { entries: result.entries, totalCost: result.totalCost }
}

/** Slice weight for the active share metric. Usage and price/M use token mass;
 * price uses spend. */
export function graphMetricWeight(entry: GraphEntry, metric: GraphMetric): number | null {
  if (metric === "price") {
    return entry.todayCost > 0 ? entry.todayCost : null
  }
  if (entry.tokenCount == null || entry.tokenCount <= 0) return null
  return entry.tokenCount
}

/** Filters to selected slices and re-normalizes share for the chosen metric. */
export function selectGraphEntriesByMetric(
  entities: GraphEntry[],
  metric: GraphMetric,
  isSelected: (key: string) => boolean
): { entries: GraphEntry[]; totalCost: number; totalTokens: number } {
  const kept = entities.filter((entry) => isSelected(entry.key))
  const weighted = kept
    .map((entry) => ({ entry, weight: graphMetricWeight(entry, metric) }))
    .filter((row): row is { entry: GraphEntry; weight: number } => row.weight != null && row.weight > 0)
  const totalWeight = weighted.reduce((sum, row) => sum + row.weight, 0)
  const totalCost = kept.reduce((sum, entry) => sum + entry.todayCost, 0)
  const totalTokens = kept.reduce((sum, entry) => sum + (entry.tokenCount ?? 0), 0)
  if (totalWeight <= 0) return { entries: [], totalCost: 0, totalTokens: 0 }
  return {
    entries: weighted.map(({ entry, weight }) => ({ ...entry, share: weight / totalWeight })),
    totalCost,
    totalTokens,
  }
}

export function graphMetricTitle(metric: GraphMetric): string {
  if (metric === "usage") return "Token Usage"
  if (metric === "price") return "Spend"
  return "Token Price"
}

export function graphMetricHeading(metric: GraphMetric, groupBy: GraphGroupBy, periodLabel: string): string {
  const title = graphMetricTitle(metric)
  return groupBy === "model" ? `Model ${title} ${periodLabel}` : `${title} ${periodLabel}`
}

export type ShareMetricDisplay =
  | { kind: "plain"; value: string }
  | { kind: "stacked"; amount: string; unit: string }

function scaleTokenAmount(abs: number, divisor: number): string {
  const scaled = abs / divisor
  return scaled >= 10 ? Math.round(scaled).toString() : scaled.toFixed(1).replace(/\.0$/, "")
}

/** One decimal for share-graph totals when the scaled count is not whole (12.3, not 12). */
function scaleTokenAmountForTotal(abs: number, divisor: number): string {
  const scaled = abs / divisor
  const oneDecimal = Math.round(scaled * 10) / 10
  if (Number.isInteger(oneDecimal)) return oneDecimal.toString()
  return oneDecimal.toFixed(1)
}

const TOKEN_SCALE_UNITS = [
  { threshold: 1e9, divisor: 1e9, unit: "Billion" },
  { threshold: 1e6, divisor: 1e6, unit: "Million" },
  { threshold: 1e3, divisor: 1e3, unit: "Thousand" },
] as const

/** Share graph: large amount with a muted unit line below (e.g. 313 + Million). */
export function formatShareTokensStacked(tokens: number): ShareMetricDisplay {
  const abs = Math.abs(tokens)
  const sign = tokens < 0 ? "-" : ""
  for (const { threshold, divisor, unit } of TOKEN_SCALE_UNITS) {
    if (abs >= threshold) {
      return { kind: "stacked", amount: sign + scaleTokenAmount(abs, divisor), unit }
    }
  }
  return { kind: "plain", value: sign + Math.round(abs).toLocaleString("en-US") }
}

/** Stacked token total for donut center / bar footer; keeps one decimal when needed. */
export function formatShareTokensStackedTotal(tokens: number): ShareMetricDisplay {
  const abs = Math.abs(tokens)
  const sign = tokens < 0 ? "-" : ""
  for (const { threshold, divisor, unit } of TOKEN_SCALE_UNITS) {
    if (abs >= threshold) {
      return { kind: "stacked", amount: sign + scaleTokenAmountForTotal(abs, divisor), unit }
    }
  }
  return { kind: "plain", value: sign + Math.round(abs).toLocaleString("en-US") }
}

/** Share graph: dollar amount with a muted "Per Million" line below. */
export function formatSharePricePerMillionStacked(cost: number, tokens: number | null): ShareMetricDisplay | null {
  if (tokens == null || tokens <= 0) return null
  const perM = (cost / tokens) * 1e6
  const amount = perM < 1000 ? "$" + perM.toFixed(2) : "$" + Math.round(perM).toLocaleString("en-US")
  return { kind: "stacked", amount, unit: "Per Million" }
}

/** Compact single-line values for the share-graph legend (e.g. 300M, $0.45/MTok). */
export function formatGraphMetricLegendValue(metric: GraphMetric, entry: GraphEntry): string | null {
  if (metric === "price") return formatShareCost(entry.todayCost)
  if (metric === "usage") {
    return entry.tokenCount != null ? formatShareTokens(entry.tokenCount) : null
  }
  return formatSharePricePerMillion(entry.todayCost, entry.tokenCount)
}

export function formatGraphMetricTotal(metric: GraphMetric, totalCost: number, totalTokens: number): ShareMetricDisplay {
  if (metric === "price") return { kind: "plain", value: formatShareDonutTotal(totalCost) }
  if (metric === "usage") return formatShareTokensStackedTotal(totalTokens)
  return formatSharePricePerMillionStacked(totalCost, totalTokens) ?? { kind: "plain", value: "—" }
}

/** Matches the plugins' fmtModelCost: cents under $1000, grouped whole dollars above. */
export function formatShareCost(amount: number): string {
  if (amount < 1000) return "$" + amount.toFixed(2)
  return "$" + Math.round(amount).toLocaleString("en-US")
}

/** Share donut center: always whole dollars with grouping, like the $1000+ style. */
export function formatShareDonutTotal(amount: number): string {
  return "$" + Math.round(amount).toLocaleString("en-US")
}

export function formatSharePercent(share: number): string {
  const percent = share * 100
  if (percent > 0 && percent < 1) return "1%"
  return `${Math.round(percent)}%`
}

/** Matches plugin fmtTokens: K/M/B suffixes, one decimal under 10. */
export function formatShareTokens(tokens: number): string {
  const abs = Math.abs(tokens)
  const sign = tokens < 0 ? "-" : ""
  const units = [
    { threshold: 1e9, divisor: 1e9, suffix: "B" },
    { threshold: 1e6, divisor: 1e6, suffix: "M" },
    { threshold: 1e3, divisor: 1e3, suffix: "K" },
  ]
  for (const unit of units) {
    if (abs >= unit.threshold) {
      const scaled = abs / unit.divisor
      const formatted =
        scaled >= 10 ? Math.round(scaled).toString() : scaled.toFixed(1).replace(/\.0$/, "")
      return sign + formatted + unit.suffix
    }
  }
  return sign + Math.round(abs).toLocaleString("en-US")
}

/** Effective $/MTok for a slice; null when tokens are unknown or zero. */
export function formatSharePricePerMillion(cost: number, tokens: number | null): string | null {
  if (tokens == null || tokens <= 0) return null
  const perM = (cost / tokens) * 1e6
  if (perM < 1000) return "$" + perM.toFixed(2) + "/MTok"
  return "$" + Math.round(perM).toLocaleString("en-US") + "/MTok"
}

const SHARE_SHORT_DATE: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }
const SHARE_RANGE_START: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }

function shareStartOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function shareAddDays(date: Date, days: number): Date {
  const next = shareStartOfDay(date)
  next.setDate(next.getDate() + days)
  return next
}

function formatShareShortDate(date: Date): string {
  return date.toLocaleDateString("en-US", SHARE_SHORT_DATE)
}

/** Heading/footer phrase for the share graph time window ("today",
 * "Jul 11, 2026", "Jun 13 – Jul 12, 2026"). Used only for the top-right date. */
function formatShareGraphPeriodDate(period: UsagePeriod, referenceDate: Date = new Date()): string {
  const today = shareStartOfDay(referenceDate)
  if (period === "today") return "today"
  if (period === "yesterday") return formatShareShortDate(shareAddDays(today, -1))
  const end = today
  const start = shareAddDays(today, -29)
  if (start.getFullYear() === end.getFullYear()) {
    const startPart = start.toLocaleDateString("en-US", SHARE_RANGE_START)
    return `${startPart} – ${formatShareShortDate(end)}`
  }
  return `${formatShareShortDate(start)} – ${formatShareShortDate(end)}`
}

/** Top-right date on the share graph card for the active window. */
export function formatShareGraphDateLabel(period: UsagePeriod, referenceDate: Date = new Date()): string {
  const today = shareStartOfDay(referenceDate)
  if (period === "today") return formatShareShortDate(today)
  if (period === "yesterday") return formatShareShortDate(shareAddDays(today, -1))
  return formatShareGraphPeriodDate("thirtyDay", referenceDate)
}
