import { describe, expect, it } from "vitest"
import { buildShareableLines, matchModelCostPeriod, MODEL_COST_PERIODS } from "@/lib/share-lines"
import type { ManifestLine, MetricLine } from "@/lib/plugin-types"

const MANIFEST_LINES: ManifestLine[] = [
  { type: "progress", label: "Session", scope: "overview" },
  { type: "progress", label: "Sonnet", scope: "detail" },
  { type: "barChart", label: "Usage Trend", scope: "detail" },
]

const DATA_LINES: MetricLine[] = [
  { type: "progress", label: "Session", used: 10, limit: 100, format: { kind: "percent" } },
  { type: "progress", label: "Sonnet", used: 5, limit: 100, format: { kind: "percent" } },
  { type: "barChart", label: "Usage Trend", points: [{ label: "7/1", value: 1 }] },
  { type: "text", label: "claude-sonnet-5-20260101", value: "62%" },
]

describe("buildShareableLines", () => {
  it("classifies overview lines as checked-by-default", () => {
    const result = buildShareableLines(DATA_LINES, MANIFEST_LINES)
    const session = result.find((entry) => entry.line.label === "Session")!
    expect(session.scope).toBe("overview")
    expect(session.defaultChecked).toBe(true)
  })

  it("classifies declared detail progress lines as unchecked by default", () => {
    const result = buildShareableLines(DATA_LINES, MANIFEST_LINES)
    const sonnet = result.find((entry) => entry.line.label === "Sonnet")!
    expect(sonnet.scope).toBe("detail")
    expect(sonnet.defaultChecked).toBe(false)
  })

  it("checks barChart lines by default even when declared as detail scope", () => {
    const result = buildShareableLines(DATA_LINES, MANIFEST_LINES)
    const trend = result.find((entry) => entry.line.label === "Usage Trend")!
    expect(trend.scope).toBe("detail")
    expect(trend.defaultChecked).toBe(true)
  })

  it("treats lines with no manifest entry as model-breakdown lines, checked by default", () => {
    const result = buildShareableLines(DATA_LINES, MANIFEST_LINES)
    const model = result.find((entry) => entry.line.label === "claude-sonnet-5-20260101")!
    expect(model.scope).toBe("modelBreakdown")
    expect(model.defaultChecked).toBe(true)
  })

  it("preserves data-line order", () => {
    const result = buildShareableLines(DATA_LINES, MANIFEST_LINES)
    expect(result.map((entry) => entry.line.label)).toEqual([
      "Session",
      "Sonnet",
      "Usage Trend",
      "claude-sonnet-5-20260101",
    ])
  })

  it("classifies undeclared period-suffixed model-cost lines as detail, unchecked by default", () => {
    const dataLines: MetricLine[] = [
      ...DATA_LINES,
      { type: "text", label: "claude-opus-4-8 · Today", value: "$3.00" },
    ]
    const result = buildShareableLines(dataLines, MANIFEST_LINES)
    const costLine = result.find((entry) => entry.line.label === "claude-opus-4-8 · Today")!
    expect(costLine.scope).toBe("detail")
    expect(costLine.defaultChecked).toBe(false)
  })
})

describe("matchModelCostPeriod", () => {
  it("finds the right period for each suffix, in Today/7d/30d order", () => {
    expect(MODEL_COST_PERIODS.map((period) => period.label)).toEqual(["Today", "7d", "30d"])
    expect(matchModelCostPeriod("claude-opus-4-8 · Today")?.label).toBe("Today")
    expect(matchModelCostPeriod("claude-opus-4-8 · 7d")?.label).toBe("7d")
    expect(matchModelCostPeriod("claude-opus-4-8 · 30d")?.label).toBe("30d")
  })

  it("returns undefined for a label with no period suffix", () => {
    expect(matchModelCostPeriod("claude-opus-4-8")).toBeUndefined()
    expect(matchModelCostPeriod("Session")).toBeUndefined()
  })
})
