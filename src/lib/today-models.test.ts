import { describe, expect, it } from "vitest"
import type { ManifestLine, MetricLine } from "@/lib/plugin-types"
import {
  buildModelUsage,
  buildTodayModelUsage,
  formatShareCost,
  formatShareDonutTotal,
  formatShareGraphDateLabel,
  formatSharePercent,
  formatSharePricePerMillion,
  formatSharePricePerMillionStacked,
  formatShareTokens,
  formatShareTokensStacked,
  formatShareTokensStackedTotal,
  formatGraphMetricTotal,
  graphEntities,
  graphMetricHeading,
  modelBreakdownDetailLines,
  parseDollarAmount,
  parseProviderPeriodTokens,
  parseProviderPeriodTotal,
  parseTokenCount,
  selectGraphEntries,
  selectGraphEntriesByMetric,
  type GraphEntry,
  type TodayModelsSource,
} from "@/lib/today-models"

function modelLine(label: string, value: string): MetricLine {
  return { type: "text", label, value, color: null, subtitle: null, resetExpiry: null }
}

function makeSource(
  id: string,
  name: string,
  brandColor: string | null,
  lines: MetricLine[]
): TodayModelsSource {
  // A manifest entry exists for "Session" only; model lines are runtime-generated
  // (no manifest entry), which is what classifies them as modelBreakdown.
  const manifest: ManifestLine[] = [{ type: "progress", label: "Session", scope: "overview" } as ManifestLine]
  return { meta: { id, name, brandColor, lines: manifest }, data: { lines } }
}

const claude = makeSource("claude", "Claude", "#DE7356", [
  modelLine("Opus 4.8", "62% · Today $12.40 · 7d $80.00 · 30d $200.00"),
  modelLine("Sonnet 5", "30% · Today $4.10"),
])
const codex = makeSource("codex", "Codex", "#74AA9C", [
  modelLine("GPT-5.4", "80% · Today $3.20"),
])

describe("parseDollarAmount", () => {
  it("parses plain and comma-grouped dollars", () => {
    expect(parseDollarAmount("$12.40")).toBe(12.4)
    expect(parseDollarAmount("$1,234")).toBe(1234)
  })

  it("rejects malformed or non-positive values", () => {
    expect(parseDollarAmount("12.40")).toBeNull()
    expect(parseDollarAmount("$0")).toBeNull()
    expect(parseDollarAmount("$abc")).toBeNull()
  })
})

describe("parseTokenCount", () => {
  it("parses compact and suffixed token strings", () => {
    expect(parseTokenCount("333M")).toBe(333_000_000)
    expect(parseTokenCount("94M tokens")).toBe(94_000_000)
    expect(parseTokenCount("1.2K")).toBe(1200)
    expect(parseTokenCount("500")).toBe(500)
  })

  it("rejects malformed values", () => {
    expect(parseTokenCount("361M tokens extra")).toBeNull()
    expect(parseTokenCount("")).toBeNull()
  })
})

describe("buildTodayModelUsage", () => {
  it("aggregates across providers, ranked by today cost", () => {
    const usage = buildTodayModelUsage([codex, claude])

    expect(usage.models.map((m) => m.name)).toEqual(["Opus 4.8", "Sonnet 5", "GPT-5.4"])
    expect(usage.totalCost).toBeCloseTo(19.7)
    expect(usage.models[0].providerName).toBe("Claude")
    expect(usage.models[0].todayCost).toBeCloseTo(12.4)
  })

  it("computes shares as fractions of the total that sum to 1", () => {
    const usage = buildTodayModelUsage([claude, codex])

    expect(usage.models[0].share).toBeCloseTo(12.4 / 19.7)
    expect(usage.models.reduce((sum, m) => sum + m.share, 0)).toBeCloseTo(1)
  })

  it("ranks provider subtotals by cost", () => {
    const usage = buildTodayModelUsage([codex, claude])

    expect(usage.providers.map((p) => p.name)).toEqual(["Claude", "Codex"])
    expect(usage.providers[0].todayCost).toBeCloseTo(16.5)
    expect(usage.providers[1].todayCost).toBeCloseTo(3.2)
  })

  it("skips models with no Today segment and providers with no qualifying models", () => {
    const stale = makeSource("cursor", "Cursor", "#000000", [
      modelLine("Grok 4.5", "12% · 7d $9.00"),
    ])
    const usage = buildTodayModelUsage([claude, stale])

    expect(usage.models.map((m) => m.name)).toEqual(["Opus 4.8", "Sonnet 5"])
    expect(usage.providers.map((p) => p.id)).toEqual(["claude"])
  })

  it("keeps every model ranked by today cost", () => {
    const many = makeSource(
      "claude",
      "Claude",
      "#DE7356",
      Array.from({ length: 10 }, (_, i) => modelLine(`Model ${i}`, `5% · Today $${(10 - i).toFixed(2)}`))
    )
    const usage = buildTodayModelUsage([many])

    expect(usage.models).toHaveLength(10)
    expect(usage.models.map((m) => m.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Model ${i}`)
    )
    expect(usage.models.every((m) => !m.isOthers)).toBe(true)
  })

  it("returns an empty result when nothing was used today", () => {
    const usage = buildTodayModelUsage([makeSource("claude", "Claude", "#DE7356", []), { ...codex, data: null }])

    expect(usage.models).toEqual([])
    expect(usage.providers).toEqual([])
    expect(usage.totalCost).toBe(0)
  })
})

describe("graph grouping + selection", () => {
  const usage = buildTodayModelUsage([claude, codex])

  it("lists providers as entities in provider mode, ranked", () => {
    const entities = graphEntities(usage, "provider")
    expect(entities.map((e) => e.key)).toEqual(["claude", "codex"])
    expect(entities[0].todayCost).toBeCloseTo(16.5)
  })

  it("lists models as entities in model mode", () => {
    const entities = graphEntities(usage, "model")
    expect(entities.map((e) => e.name)).toEqual(["Opus 4.8", "Sonnet 5", "GPT-5.4"])
    expect(entities[0].key).toBe("opus 4.8")
  })

  it("keeps only selected entities and re-normalizes share + total", () => {
    const entities = graphEntities(usage, "provider")
    const { entries, totalCost } = selectGraphEntries(entities, (key) => key === "claude")

    expect(entries.map((e) => e.key)).toEqual(["claude"])
    expect(entries[0].share).toBeCloseTo(1) // sole survivor fills the ring
    expect(totalCost).toBeCloseTo(16.5)
  })

  it("re-normalizes a two-of-three model selection to sum to 1", () => {
    const entities = graphEntities(usage, "model")
    const { entries } = selectGraphEntries(entities, (key) =>
      key === "opus 4.8" || key === "gpt-5.4"
    )
    expect(entries.map((e) => e.name)).toEqual(["Opus 4.8", "GPT-5.4"])
    expect(entries.reduce((s, e) => s + e.share, 0)).toBeCloseTo(1)
  })

  it("returns an empty result when nothing is selected", () => {
    expect(selectGraphEntries(graphEntities(usage, "provider"), () => false)).toEqual({
      entries: [],
      totalCost: 0,
    })
  })

  it("re-normalizes usage slices by token mass", () => {
    const codexPct = makeSource("codex", "Codex", "#74AA9C", [
      modelLine("Today", "$400.00 · 333M"),
      modelLine("GPT-5.6 Sol", "99.7%"),
      modelLine("GPT-5.5", "0.3%"),
    ])
    const tokenUsage = buildTodayModelUsage([codexPct])
    const entities = graphEntities(tokenUsage, "model")
    const { entries, totalTokens } = selectGraphEntriesByMetric(entities, "usage", () => true)

    expect(entries[0].name).toBe("GPT-5.6 Sol")
    expect(entries[0].share).toBeCloseTo(0.997)
    expect(totalTokens).toBeCloseTo(333_000_000)
  })
})

describe("formatting", () => {
  it("formats costs like the plugins do", () => {
    expect(formatShareCost(12.4)).toBe("$12.40")
    expect(formatShareCost(1234)).toBe("$1,234")
  })

  it("formats donut totals as whole dollars with grouping", () => {
    expect(formatShareDonutTotal(19.7)).toBe("$20")
    expect(formatShareDonutTotal(1234.4)).toBe("$1,234")
  })

  it("formats sub-1% shares as 1%", () => {
    expect(formatSharePercent(0.55)).toBe("55%")
    expect(formatSharePercent(0.004)).toBe("1%")
    expect(formatSharePercent(0)).toBe("0%")
  })

  it("formats share graph date labels with calendar dates", () => {
    const ref = new Date(2026, 6, 12)

    expect(formatShareGraphDateLabel("today", ref)).toBe("Jul 12, 2026")
    expect(formatShareGraphDateLabel("yesterday", ref)).toBe("Jul 11, 2026")
    expect(formatShareGraphDateLabel("thirtyDay", ref)).toBe("Jun 13 – Jul 12, 2026")
  })

  it("includes both years in a 30-day range that crosses New Year", () => {
    const ref = new Date(2026, 0, 14)
    expect(formatShareGraphDateLabel("thirtyDay", ref)).toBe("Dec 16, 2025 – Jan 14, 2026")
  })

  it("formats token counts and price per million tokens", () => {
    expect(formatShareTokens(333_000_000)).toBe("333M")
    expect(formatShareTokens(94_000_000)).toBe("94M")
    expect(formatShareTokens(1200)).toBe("1.2K")
    expect(formatSharePricePerMillion(12.4, 94_000_000)).toBe("$0.13/MTok")
    expect(formatSharePricePerMillion(3.2, null)).toBeNull()
  })

  it("formats stacked share-graph token and price-per-million values", () => {
    expect(formatShareTokensStacked(333_000_000)).toEqual({ kind: "stacked", amount: "333", unit: "Million" })
    expect(formatShareTokensStacked(94_000_000)).toEqual({ kind: "stacked", amount: "94", unit: "Million" })
    expect(formatShareTokensStacked(1200)).toEqual({ kind: "stacked", amount: "1.2", unit: "Thousand" })
    expect(formatSharePricePerMillionStacked(12.4, 94_000_000)).toEqual({
      kind: "stacked",
      amount: "$0.13",
      unit: "Per Million",
    })
    expect(formatSharePricePerMillionStacked(3.2, null)).toBeNull()
  })

  it("formats stacked token totals with one decimal when not whole", () => {
    expect(formatShareTokensStackedTotal(12_300_000)).toEqual({ kind: "stacked", amount: "12.3", unit: "Million" })
    expect(formatShareTokensStackedTotal(11_600_000)).toEqual({ kind: "stacked", amount: "11.6", unit: "Million" })
    expect(formatShareTokensStackedTotal(12_000_000)).toEqual({ kind: "stacked", amount: "12", unit: "Million" })
    expect(formatGraphMetricTotal("usage", 0, 12_350_000)).toEqual({ kind: "stacked", amount: "12.4", unit: "Million" })
  })

  it("builds metric-specific headings", () => {
    expect(graphMetricHeading("price", "provider", "today")).toBe("Spend today")
    expect(graphMetricHeading("usage", "model", "30 days")).toBe("Model Token Usage 30 days")
    expect(graphMetricHeading("pricePerM", "provider", "yesterday")).toBe("Token Price yesterday")
  })
})

describe("buildModelUsage — periods", () => {
  // Claude carries per-model $ for today and 30d, but never for yesterday.
  const claudePeriods = makeSource("claude", "Claude", "#DE7356", [
    modelLine("Opus 4.8", "70% · Today $12.40 · 30d $200.00"),
    modelLine("Sonnet 5", "30% · Today $4.10 · 30d $50.00"),
  ])
  // Codex is percent-only, with provider-level period summary lines.
  const codexPeriods = makeSource("codex", "Codex", "#74AA9C", [
    modelLine("Today", "$400.00 · 333M"),
    modelLine("Yesterday", "$300.00 · 228M"),
    modelLine("Last 30 Days", "$800.00 · 563M"),
    modelLine("GPT-5.6 Sol", "99.7%"),
    modelLine("GPT-5.5", "0.3%"),
  ])
  // Cursor carries per-model Today/30d dollars like Claude, plus provider summary lines.
  const cursorPeriods = makeSource("cursor", "Cursor", "#000000", [
    modelLine("Today", "$12.00 · 2M"),
    modelLine("Yesterday", "$8.00 · 1.5M"),
    modelLine("Last 30 Days", "$48.00 · 8M"),
    modelLine("Composer 2", "75% · Yesterday $6.00 · Today $9.00 · 30d $36.00"),
    modelLine("Claude 4 Sonnet", "25% · Yesterday $2.00 · Today $3.00 · 30d $12.00"),
  ])
  // OpenCode Go mirrors Cursor: provider summary lines plus per-model breakdown.
  const opencodeGoPeriods = makeSource("opencode-go", "OpenCode Go", "#000000", [
    modelLine("Today", "$5.00 · 500K"),
    modelLine("Yesterday", "$3.00 · 300K"),
    modelLine("Last 30 Days", "$20.00 · 2M"),
    modelLine("GLM 5.1", "60% · Yesterday $1.80 · Today $3.00 · 30d $12.00"),
    modelLine("GPT 5.4", "40% · Yesterday $1.20 · Today $2.00 · 30d $8.00"),
  ])
  // Grok: local log estimates with per-model breakdown.
  const grokPeriods = makeSource("grok", "Grok", "#000000", [
    modelLine("Today", "$4.00 · 400K"),
    modelLine("Yesterday", "$2.00 · 200K"),
    modelLine("Last 30 Days", "$16.00 · 1.6M"),
    modelLine("Grok 4.5", "75% · Yesterday $1.50 · Today $3.00 · 30d $12.00"),
    modelLine("Grok 4.5 Fast", "25% · Yesterday $0.50 · Today $1.00 · 30d $4.00"),
  ])
  // OpenRouter: API spend only, single aggregate model line.
  const openrouterPeriods = makeSource("openrouter", "OpenRouter", "#94A3B8", [
    modelLine("Today", "$1.50"),
    modelLine("Yesterday", "$0.00"),
    modelLine("Last 30 Days", "$30.00"),
    modelLine("OpenRouter", "100% · Today $1.50 · 30d $30.00"),
  ])

  it("buildTodayModelUsage equals buildModelUsage(_, 'today')", () => {
    const plugins = [claudePeriods, codexPeriods]
    expect(buildTodayModelUsage(plugins)).toEqual(buildModelUsage(plugins, "today"))
  })

  it("sums per-model 30-day dollars for a per-model-dollar provider (Claude)", () => {
    const usage = buildModelUsage([claudePeriods], "thirtyDay")
    const claude = usage.providers.find((p) => p.id === "claude")!

    expect(claude.todayCost).toBeCloseTo(250)
    expect(claude.models.map((m) => m.name)).toEqual(["Opus 4.8", "Sonnet 5"])
    expect(claude.models[0].todayCost).toBeCloseTo(200)
    expect(claude.models[1].todayCost).toBeCloseTo(50)
  })

  it("sizes a percent-only provider by its Yesterday / Last 30 Days summary line", () => {
    const yesterday = buildModelUsage([codexPeriods], "yesterday")
    const codexY = yesterday.providers.find((p) => p.id === "codex")!
    expect(codexY.todayCost).toBeCloseTo(300)
    expect(codexY.models[0].todayCost).toBeCloseTo(299.1)

    const thirty = buildModelUsage([codexPeriods], "thirtyDay")
    expect(thirty.providers.find((p) => p.id === "codex")!.todayCost).toBeCloseTo(800)
  })

  it("drops a provider that has no data for the requested period", () => {
    // Claude has no per-model Yesterday $ and no provider "Yesterday" line.
    const usage = buildModelUsage([claudePeriods, codexPeriods], "yesterday")
    expect(usage.providers.map((p) => p.id)).toEqual(["codex"])
  })

  it("includes Cursor models in buildModelUsage when breakdown lines exist", () => {
    const usage = buildModelUsage([cursorPeriods], "today")
    expect(usage.providers.map((p) => p.id)).toContain("cursor")
    expect(usage.models.some((m) => m.name === "Composer 2")).toBe(true)
    expect(usage.models.some((m) => m.name === "Claude 4 Sonnet")).toBe(true)
    const composer = usage.models.find((m) => m.name === "Composer 2")!
    expect(composer.todayCost).toBe(9)
    expect(composer.providerId).toBe("cursor")
  })

  it("sums per-model yesterday dollars for Cursor", () => {
    const usage = buildModelUsage([cursorPeriods], "yesterday")
    const cursor = usage.providers.find((p) => p.id === "cursor")!

    expect(cursor.todayCost).toBeCloseTo(8)
    expect(cursor.models.map((m) => m.name)).toEqual(["Composer 2", "Claude 4 Sonnet"])
    expect(cursor.models[0].todayCost).toBeCloseTo(6)
    expect(cursor.models[1].todayCost).toBeCloseTo(2)
  })

  it("sums per-model 30-day dollars for Cursor", () => {
    const usage = buildModelUsage([cursorPeriods], "thirtyDay")
    const cursor = usage.providers.find((p) => p.id === "cursor")!

    expect(cursor.todayCost).toBeCloseTo(48)
    expect(cursor.models.map((m) => m.name)).toEqual(["Composer 2", "Claude 4 Sonnet"])
    expect(cursor.models[0].todayCost).toBeCloseTo(36)
    expect(cursor.models[1].todayCost).toBeCloseTo(12)
  })

  it("includes OpenCode Go models in buildModelUsage when breakdown lines exist", () => {
    const usage = buildModelUsage([opencodeGoPeriods], "today")
    expect(usage.providers.map((p) => p.id)).toContain("opencode-go")
    expect(usage.models.some((m) => m.name === "GLM 5.1")).toBe(true)
    expect(usage.models.some((m) => m.name === "GPT 5.4")).toBe(true)
    const glm = usage.models.find((m) => m.name === "GLM 5.1")!
    expect(glm.todayCost).toBe(3)
    expect(glm.providerId).toBe("opencode-go")
  })

  it("sums per-model yesterday dollars for OpenCode Go", () => {
    const usage = buildModelUsage([opencodeGoPeriods], "yesterday")
    const opencode = usage.providers.find((p) => p.id === "opencode-go")!

    expect(opencode.todayCost).toBeCloseTo(3)
    expect(opencode.models.map((m) => m.name)).toEqual(["GLM 5.1", "GPT 5.4"])
    expect(opencode.models[0].todayCost).toBeCloseTo(1.8)
    expect(opencode.models[1].todayCost).toBeCloseTo(1.2)
  })

  it("sums per-model 30-day dollars for OpenCode Go", () => {
    const usage = buildModelUsage([opencodeGoPeriods], "thirtyDay")
    const opencode = usage.providers.find((p) => p.id === "opencode-go")!

    expect(opencode.todayCost).toBeCloseTo(20)
    expect(opencode.models.map((m) => m.name)).toEqual(["GLM 5.1", "GPT 5.4"])
    expect(opencode.models[0].todayCost).toBeCloseTo(12)
    expect(opencode.models[1].todayCost).toBeCloseTo(8)
  })

  it("includes Grok models in buildModelUsage when breakdown lines exist", () => {
    const usage = buildModelUsage([grokPeriods], "today")
    expect(usage.providers.map((p) => p.id)).toContain("grok")
    const grok45 = usage.models.find((m) => m.name === "Grok 4.5")!
    expect(grok45.todayCost).toBe(3)
    expect(grok45.providerId).toBe("grok")
  })

  it("sizes OpenRouter by aggregate model line at 100%", () => {
    const usage = buildModelUsage([openrouterPeriods], "today")
    const openrouter = usage.providers.find((p) => p.id === "openrouter")!
    expect(openrouter.todayCost).toBeCloseTo(1.5)
    expect(openrouter.models).toHaveLength(1)
    expect(openrouter.models[0].name).toBe("OpenRouter")
    expect(openrouter.models[0].todayCost).toBeCloseTo(1.5)
  })

  it("uses OpenRouter Last 30 Days summary for thirtyDay period", () => {
    const usage = buildModelUsage([openrouterPeriods], "thirtyDay")
    expect(usage.providers.find((p) => p.id === "openrouter")!.todayCost).toBeCloseTo(30)
  })

  it("merges same-named models across providers into one ranked entry", () => {
    const cursorGpt = makeSource("cursor", "Cursor", "#000000", [
      modelLine("Today", "$5.00 · 2M"),
      modelLine("GPT 4", "100% · Today $5.00"),
    ])
    const codexGpt = makeSource("codex", "Codex", "#74AA9C", [
      modelLine("Today", "$3.00 · 1M"),
      modelLine("GPT 4", "100% · Today $3.00"),
    ])
    const usage = buildModelUsage([cursorGpt, codexGpt], "today")

    expect(usage.models).toHaveLength(1)
    expect(usage.models[0].name).toBe("GPT 4")
    expect(usage.models[0].todayCost).toBeCloseTo(8)
    expect(usage.models[0].providerName).toBe("Cursor")
    expect(usage.models[0].providerNames).toEqual(["Cursor", "Codex"])
    expect(usage.providers).toHaveLength(2)
  })

  it("lists both providers when a model is used on OpenCode Go and ClinePass", () => {
    const opencode = makeSource("opencode-go", "OpenCode Go", "#000000", [
      modelLine("GLM 5.2", "100% · Today $4.00"),
    ])
    const clinePass = makeSource("cline-pass", "ClinePass", "#F59E0B", [
      modelLine("GLM 5.2", "100% · Today $1.50"),
    ])
    const usage = buildModelUsage([opencode, clinePass], "today")

    expect(usage.models).toHaveLength(1)
    expect(usage.models[0].name).toBe("GLM 5.2")
    expect(usage.models[0].todayCost).toBeCloseTo(5.5)
    expect(usage.models[0].providerNames).toEqual(["OpenCode Go", "ClinePass"])
  })

  it("dedupes duplicate display names within one provider", () => {
    const cursorDup = makeSource("cursor", "Cursor", "#000000", [
      modelLine("Today", "$10.00 · 5M"),
      modelLine("Composer 2.5", "60% · Today $6.00"),
      modelLine("Composer 2.5", "40% · Today $4.00"),
    ])
    const usage = buildModelUsage([cursorDup], "today")
    const cursor = usage.providers.find((p) => p.id === "cursor")!

    expect(cursor.models).toHaveLength(1)
    expect(cursor.models[0].name).toBe("Composer 2.5")
    expect(cursor.models[0].todayCost).toBeCloseTo(10)
    expect(usage.models).toHaveLength(1)
    expect(graphEntities(usage, "model").map((entry) => entry.key)).toEqual(["composer 2.5"])
  })
})

describe("parseProviderPeriodTotal", () => {
  it("extracts the leading dollar of a provider summary line by label", () => {
    const lines: MetricLine[] = [
      modelLine("Today", "$458.16 · 333M"),
      modelLine("Last 30 Days", "$774.65 · 563M"),
    ]
    expect(parseProviderPeriodTotal(lines, "Today")).toBeCloseTo(458.16)
    expect(parseProviderPeriodTotal(lines, "Last 30 Days")).toBeCloseTo(774.65)
    expect(parseProviderPeriodTotal(lines, "Yesterday")).toBeNull()
  })
})

describe("modelBreakdownDetailLines", () => {
  it("passes through real per-model dollars (Claude), ignoring the basis", () => {
    const parsed = { percent: "62%", today: "$12.40", sevenDay: "$80.00", thirtyDay: "$200.00" }
    expect(modelBreakdownDetailLines(parsed, { today: 999, thirtyDay: 999 })).toEqual([
      "Today $12.40",
      "7 days $80.00",
      "30 days $200.00",
    ])
  })

  it("derives Today and 30 days for percent-only rows (Codex) from provider totals", () => {
    expect(modelBreakdownDetailLines({ percent: "99.7%" }, { today: 458.16, thirtyDay: 774.65 })).toEqual([
      "Today $456.79",
      "30 days $772.33",
    ])
  })

  it("omits periods that have no source", () => {
    expect(modelBreakdownDetailLines({ percent: "0.3%" }, { today: 458.16, thirtyDay: null })).toEqual([
      "Today $1.37",
    ])
    expect(modelBreakdownDetailLines({ percent: "0.3%" }, { today: null, thirtyDay: null })).toEqual([])
  })
})

describe("provider view", () => {
  const claude: TodayModelsSource = {
    meta: { id: "claude", name: "Claude", brandColor: "#DE7356", lines: [] },
    data: {
      lines: [
        { type: "text", label: "Opus 4.8", value: "62% · Today $12.40", color: null, subtitle: null, resetExpiry: null },
        { type: "text", label: "Sonnet 5", value: "30% · Today $4.10", color: null, subtitle: null, resetExpiry: null },
      ],
    },
  }
  const codex: TodayModelsSource = {
    meta: { id: "codex", name: "Codex", brandColor: "#74AA9C", lines: [] },
    data: {
      lines: [
        { type: "text", label: "GPT-5.4", value: "16% · Today $3.20", color: null, subtitle: null, resetExpiry: null },
      ],
    },
  }

  it("carries brandColor, share and the ranked model list per provider", () => {
    const usage = buildTodayModelUsage([claude, codex])

    expect(usage.providers.map((p) => p.id)).toEqual(["claude", "codex"])
    expect(usage.providers[0].brandColor).toBe("#DE7356")
    expect(usage.providers[0].share).toBeCloseTo(16.5 / 19.7)
    expect(usage.providers[0].models.map((m) => m.name)).toEqual(["Opus 4.8", "Sonnet 5"])
    expect(usage.providers[1].models.map((m) => m.name)).toEqual(["GPT-5.4"])
  })

  it("never adds an Others bucket to provider model lists", () => {
    const many: TodayModelsSource = {
      meta: { id: "claude", name: "Claude", brandColor: "#DE7356", lines: [] },
      data: {
        lines: Array.from({ length: 10 }, (_, i) => ({
          type: "text" as const,
          label: `Model ${i}`,
          value: `5% · Today $${(10 - i).toFixed(2)}`,
          color: null,
          subtitle: null,
          resetExpiry: null,
        })),
      },
    }
    const usage = buildTodayModelUsage([many])

    expect(usage.models).toHaveLength(10)
    expect(usage.models.some((m) => m.isOthers)).toBe(false)
    expect(usage.providers[0].models.some((m) => m.isOthers)).toBe(false)
    expect(usage.providers[0].models).toHaveLength(10)
  })
})

describe("parseProviderPeriodTokens", () => {
  it("reads provider period tokens from summary lines", () => {
    const lines = [modelLine("Today", "$400.00 · 333M"), modelLine("Yesterday", "$300.00 · 228M")]
    expect(parseProviderPeriodTokens(lines, "Today")).toBe(333_000_000)
    expect(parseProviderPeriodTokens(lines, "Yesterday")).toBe(228_000_000)
  })
})

describe("percent-only providers (e.g. Codex)", () => {
  // Mirrors Codex's real shape: a provider-level "Today $ · tokens" summary
  // line plus per-model rows that carry only a token percentage, no per-model $.
  const codexPct = makeSource("codex", "Codex", "#74AA9C", [
    modelLine("Today", "$400.00 · 333M"),
    modelLine("GPT-5.6 Sol", "99.7%"),
    modelLine("GPT-5.5", "0.3%"),
  ])

  it("sizes the slice by the provider Today total and splits it across models by percent", () => {
    const usage = buildTodayModelUsage([codexPct])
    const codexProvider = usage.providers.find((p) => p.id === "codex")!

    expect(codexProvider.todayCost).toBeCloseTo(400)
    expect(codexProvider.tokenCount).toBe(333_000_000)
    expect(codexProvider.models.map((m) => m.name)).toEqual(["GPT-5.6 Sol", "GPT-5.5"])
    expect(codexProvider.models[0].todayCost).toBeCloseTo(398.8)
    expect(codexProvider.models[0].tokenCount).toBeCloseTo(333_000_000 * 0.997)
    expect(codexProvider.models[1].todayCost).toBeCloseTo(1.2)
    expect(codexProvider.models[1].tokenCount).toBeCloseTo(333_000_000 * 0.003)
  })

  it("excludes a percent-only provider with no Today total to size it", () => {
    const noTotal = makeSource("codex", "Codex", "#74AA9C", [
      modelLine("GPT-5.6 Sol", "99.7%"),
      modelLine("GPT-5.5", "0.3%"),
    ])
    const usage = buildTodayModelUsage([noTotal])

    expect(usage.providers).toEqual([])
  })

  it("ranks a percent-only provider against a per-model-dollar provider by total", () => {
    const usage = buildTodayModelUsage([claude, codexPct])

    expect(usage.providers.map((p) => p.id)).toEqual(["codex", "claude"])
    expect(usage.providers[0].todayCost).toBeCloseTo(400)
  })
})
