import { describe, expect, it } from "vitest"

import { selectEscalatedLine } from "@/lib/metric-escalation"
import type { ManifestLine, MetricLine } from "@/lib/plugin-types"

const percent = { kind: "percent" } as const

function progress(label: string, used: number, limit = 100): MetricLine {
  return { type: "progress", label, used, limit, format: percent }
}

function manifest(label: string, escalateAtPercent?: number): ManifestLine {
  return { type: "progress", label, scope: "detail", escalateAtPercent }
}

describe("selectEscalatedLine", () => {
  it("returns undefined when no manifest line declares a threshold", () => {
    const result = selectEscalatedLine([progress("Monthly", 99)], [manifest("Monthly")])
    expect(result).toBeUndefined()
  })

  it("returns undefined when usage is below the threshold", () => {
    const result = selectEscalatedLine([progress("Monthly", 97)], [manifest("Monthly", 98)])
    expect(result).toBeUndefined()
  })

  it("returns the line when usage is at the threshold", () => {
    const result = selectEscalatedLine([progress("Monthly", 98)], [manifest("Monthly", 98)])
    expect(result?.label).toBe("Monthly")
  })

  it("returns the line when usage is above the threshold", () => {
    const result = selectEscalatedLine([progress("Monthly", 100)], [manifest("Monthly", 98)])
    expect(result?.label).toBe("Monthly")
  })

  it("picks the most-critical line when several cross", () => {
    const result = selectEscalatedLine(
      [progress("Monthly", 98), progress("Weekly", 99.5)],
      [manifest("Monthly", 98), manifest("Weekly", 95)]
    )
    expect(result?.label).toBe("Weekly")
  })

  it("ignores a line absent from runtime data", () => {
    const result = selectEscalatedLine([progress("Session", 10)], [manifest("Monthly", 98)])
    expect(result).toBeUndefined()
  })

  it("ignores a line with non-positive limit", () => {
    const result = selectEscalatedLine(
      [{ type: "progress", label: "Monthly", used: 5, limit: 0, format: percent }],
      [manifest("Monthly", 98)]
    )
    expect(result).toBeUndefined()
  })

  it("ignores an out-of-range threshold", () => {
    const result = selectEscalatedLine([progress("Monthly", 100)], [manifest("Monthly", 150)])
    expect(result).toBeUndefined()
  })

  it("ignores escalateAtPercent on a non-progress manifest line", () => {
    const result = selectEscalatedLine(
      [progress("Monthly", 100)],
      [{ type: "badge", label: "Monthly", scope: "detail", escalateAtPercent: 98 }]
    )
    expect(result).toBeUndefined()
  })
})
