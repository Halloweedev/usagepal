import { describe, expect, it } from "vitest"
import { DEFAULT_SHARE_SETTINGS, normalizeShareSettings } from "@/lib/settings"

describe("normalizeShareSettings graph fields", () => {
  it("defaults the graph fields when absent", () => {
    const settings = normalizeShareSettings({})
    expect(settings.graphStyle).toBe("bar")
    expect(settings.graphGroupBy).toBe("provider")
    expect(settings.graphShowPrices).toBe(false)
  })

  it("round-trips valid graph fields", () => {
    const settings = normalizeShareSettings({
      graphStyle: "donut",
      graphGroupBy: "model",
      graphShowPrices: true,
    })
    expect(settings.graphStyle).toBe("donut")
    expect(settings.graphGroupBy).toBe("model")
    expect(settings.graphShowPrices).toBe(true)
  })

  it("falls back to defaults on invalid values", () => {
    const settings = normalizeShareSettings({
      graphStyle: "pie",
      graphGroupBy: "team",
      graphShowPrices: "yes",
    })
    expect(settings.graphStyle).toBe("bar")
    expect(settings.graphGroupBy).toBe("provider")
    expect(settings.graphShowPrices).toBe(false)
  })

  it("keeps the defaults object in sync", () => {
    expect(DEFAULT_SHARE_SETTINGS.graphStyle).toBe("bar")
    expect(DEFAULT_SHARE_SETTINGS.graphGroupBy).toBe("provider")
    expect(DEFAULT_SHARE_SETTINGS.graphShowPrices).toBe(false)
  })
})
