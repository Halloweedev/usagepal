import { describe, expect, it } from "vitest"
import { buildShareableLines } from "@/lib/share-lines"
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

  it("treats a merged model-cost line (undeclared, no suffix) as model-breakdown, checked by default", () => {
    const dataLines: MetricLine[] = [
      ...DATA_LINES,
      { type: "text", label: "claude-opus-4-8", value: "86.7% · Today $3.00 · 7d $7.00 · 30d $9.00" },
    ]
    const result = buildShareableLines(dataLines, MANIFEST_LINES)
    const merged = result.find((entry) => entry.line.label === "claude-opus-4-8")!
    expect(merged.scope).toBe("modelBreakdown")
    expect(merged.defaultChecked).toBe(true)
  })

  it("treats an undeclared non-text line (e.g. a rate-limit badge) as detail scope, not model-breakdown", () => {
    const dataLines: MetricLine[] = [
      ...DATA_LINES,
      { type: "badge", label: "Status", text: "Rate limited" },
    ]
    const result = buildShareableLines(dataLines, MANIFEST_LINES)
    const status = result.find((entry) => entry.line.label === "Status")!
    expect(status.scope).toBe("detail")
    expect(status.defaultChecked).toBe(false)
  })
})
