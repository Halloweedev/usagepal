import { describe, expect, it } from "vitest"
import { formatModelBreakdownValue, parseModelBreakdownValue } from "@/lib/model-breakdown-format"

const ALL_ON = { showPercent: true, showToday: true, showSevenDay: true, showThirtyDay: true }

describe("parseModelBreakdownValue", () => {
  it("parses a full merged line", () => {
    expect(parseModelBreakdownValue("86.7% · Today $3.00 · 7d $7.00 · 30d $9.00")).toEqual({
      percent: "86.7%",
      today: "$3.00",
      sevenDay: "$7.00",
      thirtyDay: "$9.00",
    })
  })

  it("parses comma-formatted amounts", () => {
    expect(parseModelBreakdownValue("100% · Today $1,235 · 7d $1,235 · 30d $1,235")).toEqual({
      percent: "100%",
      today: "$1,235",
      sevenDay: "$1,235",
      thirtyDay: "$1,235",
    })
  })

  it("parses percent-only and partial segment lines", () => {
    expect(parseModelBreakdownValue("62%")).toEqual({ percent: "62%" })
    expect(parseModelBreakdownValue("1.6% · 30d $36.26")).toEqual({
      percent: "1.6%",
      thirtyDay: "$36.26",
    })
  })

  it("returns null for non-model text values", () => {
    expect(parseModelBreakdownValue("361M tokens")).toBeNull()
    expect(parseModelBreakdownValue("")).toBeNull()
  })

  it("parses the below-threshold '<0.1%' label plugins emit for near-zero shares", () => {
    expect(parseModelBreakdownValue("<0.1% · Today $0.02 · 7d $0.10 · 30d $0.30")).toEqual({
      percent: "<0.1%",
      today: "$0.02",
      sevenDay: "$0.10",
      thirtyDay: "$0.30",
    })
    expect(parseModelBreakdownValue("<0.1%")).toEqual({ percent: "<0.1%" })
  })
})

describe("formatModelBreakdownValue", () => {
  const full = parseModelBreakdownValue("86.7% · Today $3.00 · 7d $7.00 · 30d $9.00")!

  it("round-trips a full merged line when all toggles are on", () => {
    expect(formatModelBreakdownValue(full, ALL_ON)).toBe("86.7% · Today $3.00 · 7d $7.00 · 30d $9.00")
  })

  it("omits disabled segments", () => {
    expect(formatModelBreakdownValue(full, { ...ALL_ON, showToday: false })).toBe(
      "86.7% · 7d $7.00 · 30d $9.00"
    )
    expect(formatModelBreakdownValue(full, { ...ALL_ON, showPercent: false, showSevenDay: false })).toBe(
      "Today $3.00 · 30d $9.00"
    )
  })

  it("returns empty string when nothing is enabled", () => {
    expect(
      formatModelBreakdownValue(full, {
        showPercent: false,
        showToday: false,
        showSevenDay: false,
        showThirtyDay: false,
      })
    ).toBe("")
  })
})
