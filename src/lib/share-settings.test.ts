import { describe, expect, it } from "vitest"
import { DEFAULT_SHARE_SETTINGS, normalizeShareSettings } from "@/lib/settings"

describe("normalizeShareSettings graph fields", () => {
  it("defaults the graph fields when absent", () => {
    const settings = normalizeShareSettings({})
    expect(settings.graphStyle).toBe("bar")
    expect(settings.graphShowModelPrices).toBe(false)
    expect(settings.graphShowProviderPrices).toBe(false)
  })

  it("round-trips valid graph fields", () => {
    const settings = normalizeShareSettings({
      graphStyle: "donut",
      graphShowModelPrices: true,
      graphShowProviderPrices: true,
    })
    expect(settings.graphStyle).toBe("donut")
    expect(settings.graphShowModelPrices).toBe(true)
    expect(settings.graphShowProviderPrices).toBe(true)
  })

  it("falls back to defaults on invalid values", () => {
    const settings = normalizeShareSettings({
      graphStyle: "pie",
      graphShowModelPrices: "yes",
    })
    expect(settings.graphStyle).toBe("bar")
    expect(settings.graphShowModelPrices).toBe(false)
  })

  it("keeps the defaults object in sync", () => {
    expect(DEFAULT_SHARE_SETTINGS.graphStyle).toBe("bar")
    expect(DEFAULT_SHARE_SETTINGS.graphShowModelPrices).toBe(false)
    expect(DEFAULT_SHARE_SETTINGS.graphShowProviderPrices).toBe(false)
  })
})
