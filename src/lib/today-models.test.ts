import { describe, expect, it } from "vitest"
import type { ManifestLine, MetricLine } from "@/lib/plugin-types"
import {
  buildTodayModelUsage,
  formatShareCost,
  formatSharePercent,
  parseDollarAmount,
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
