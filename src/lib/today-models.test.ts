import { describe, expect, it } from "vitest"
import type { ManifestLine, MetricLine } from "@/lib/plugin-types"
import {
  buildModelUsage,
  buildTodayModelUsage,
  formatShareCost,
  formatSharePercent,
  modelBreakdownDetailLines,
  parseDollarAmount,
  parseProviderPeriodTotal,
  MAX_GRAPH_MODELS,
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

  it("collapses models beyond the top 8 into a trailing Others entry", () => {
    const many = makeSource(
      "claude",
      "Claude",
      "#DE7356",
      Array.from({ length: 10 }, (_, i) => modelLine(`Model ${i}`, `5% · Today $${(10 - i).toFixed(2)}`))
    )
    const usage = buildTodayModelUsage([many])

    expect(usage.models).toHaveLength(MAX_GRAPH_MODELS + 1)
    const others = usage.models.at(-1)!
    expect(others.isOthers).toBe(true)
    expect(others.name).toBe("Others")
    // Models 8 and 9 have today costs $2 and $1
    expect(others.todayCost).toBeCloseTo(3)
  })

  it("returns an empty result when nothing was used today", () => {
    const usage = buildTodayModelUsage([makeSource("claude", "Claude", "#DE7356", []), { ...codex, data: null }])

    expect(usage.models).toEqual([])
    expect(usage.providers).toEqual([])
    expect(usage.totalCost).toBe(0)
  })
})

describe("formatting", () => {
  it("formats costs like the plugins do", () => {
    expect(formatShareCost(12.4)).toBe("$12.40")
    expect(formatShareCost(1234)).toBe("$1,234")
  })

  it("formats percents with a <1% floor", () => {
    expect(formatSharePercent(0.55)).toBe("55%")
    expect(formatSharePercent(0.004)).toBe("<1%")
    expect(formatSharePercent(0)).toBe("0%")
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

  it("keeps the Others bucket out of every provider's model list", () => {
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

    // The global ranked list caps at 8 + Others, but a provider's own model
    // list (used by its hover tooltip) is uncapped and never holds Others.
    expect(usage.models.at(-1)?.isOthers).toBe(true)
    expect(usage.providers[0].models.some((m) => m.isOthers)).toBe(false)
    expect(usage.providers[0].models).toHaveLength(10)
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
    expect(codexProvider.models.map((m) => m.name)).toEqual(["GPT-5.6 Sol", "GPT-5.5"])
    expect(codexProvider.models[0].todayCost).toBeCloseTo(398.8)
    expect(codexProvider.models[1].todayCost).toBeCloseTo(1.2)
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
