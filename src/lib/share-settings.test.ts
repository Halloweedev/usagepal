import { describe, expect, it } from "vitest"
import { DEFAULT_SHARE_SETTINGS, normalizeShareSettings } from "@/lib/settings"

describe("normalizeShareSettings graph fields", () => {
  it("defaults the graph fields when absent", () => {
    const settings = normalizeShareSettings({})
    expect(settings.graphStyle).toBe("bar")
    expect(settings.graphGroupBy).toBe("provider")
    expect(settings.graphMetric).toBe("price")
    expect(settings.graphShowBreakdown).toBe(true)
    expect(settings.graphShowTotal).toBe(true)
    expect(settings.graphShowDate).toBe(true)
  })

  it("round-trips valid graph fields", () => {
    const settings = normalizeShareSettings({
      graphStyle: "donut",
      graphGroupBy: "model",
      graphMetric: "usage",
      graphShowBreakdown: false,
      graphShowTotal: false,
      graphShowDate: false,
    })
    expect(settings.graphStyle).toBe("donut")
    expect(settings.graphGroupBy).toBe("model")
    expect(settings.graphMetric).toBe("usage")
    expect(settings.graphShowBreakdown).toBe(false)
    expect(settings.graphShowTotal).toBe(false)
    expect(settings.graphShowDate).toBe(false)
  })

  it("migrates retired line display flags to graphMetric", () => {
    expect(normalizeShareSettings({ graphShowLineTokens: true }).graphMetric).toBe("usage")
    expect(normalizeShareSettings({ graphShowLinePricePerM: true }).graphMetric).toBe("pricePerM")
    expect(normalizeShareSettings({ graphShowLinePrices: true }).graphMetric).toBe("price")
  })

  it("prefers graphMetric over retired line display flags", () => {
    expect(
      normalizeShareSettings({
        graphMetric: "price",
        graphShowLineTokens: true,
        graphShowLinePricePerM: true,
      }).graphMetric
    ).toBe("price")
  })

  it("migrates the retired graphShowPrices flag", () => {
    expect(normalizeShareSettings({ graphShowPrices: true })).toMatchObject({
      graphMetric: "price",
      graphShowTotal: true,
    })
    expect(normalizeShareSettings({ graphShowPrices: false })).toMatchObject({
      graphMetric: "price",
      graphShowTotal: true,
    })
  })

  it("falls back to defaults on invalid values", () => {
    const settings = normalizeShareSettings({
      graphStyle: "pie",
      graphGroupBy: "team",
      graphMetric: "tokens",
      graphShowBreakdown: "yes",
      graphShowTotal: "yes",
      graphShowDate: "yes",
    })
    expect(settings.graphStyle).toBe("bar")
    expect(settings.graphGroupBy).toBe("provider")
    expect(settings.graphMetric).toBe("price")
    expect(settings.graphShowBreakdown).toBe(true)
    expect(settings.graphShowTotal).toBe(true)
    expect(settings.graphShowDate).toBe(true)
  })

  it("keeps the defaults object in sync", () => {
    expect(DEFAULT_SHARE_SETTINGS.graphStyle).toBe("bar")
    expect(DEFAULT_SHARE_SETTINGS.graphGroupBy).toBe("provider")
    expect(DEFAULT_SHARE_SETTINGS.graphMetric).toBe("price")
    expect(DEFAULT_SHARE_SETTINGS.graphShowBreakdown).toBe(true)
    expect(DEFAULT_SHARE_SETTINGS.graphShowTotal).toBe(true)
    expect(DEFAULT_SHARE_SETTINGS.graphShowDate).toBe(true)
  })
})
