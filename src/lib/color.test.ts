import { describe, expect, it } from "vitest"

import { getAdaptiveBarColor, getRelativeLuminance } from "@/lib/color"

describe("getRelativeLuminance", () => {
  it("returns 0 for invalid hex", () => {
    expect(getRelativeLuminance("nope")).toBe(0)
    expect(getRelativeLuminance("#12")).toBe(0)
    expect(getRelativeLuminance("#gggggg")).toBe(0)
  })

  it("supports 3-digit and 4-digit hex (alpha ignored)", () => {
    const lum3 = getRelativeLuminance("#fff")
    const lum4 = getRelativeLuminance("#ffff")
    expect(lum3).toBeGreaterThan(0.9)
    expect(lum4).toBeGreaterThan(0.9)
  })

  it("ignores alpha in 8-digit hex", () => {
    const lum1 = getRelativeLuminance("#000000ff")
    const lum2 = getRelativeLuminance("#00000000")
    expect(lum1).toBe(0)
    expect(lum2).toBe(0)
  })
})

describe("getAdaptiveBarColor", () => {
  it("returns undefined when no color is given", () => {
    expect(getAdaptiveBarColor(null, true)).toBeUndefined()
    expect(getAdaptiveBarColor(undefined, true)).toBeUndefined()
    expect(getAdaptiveBarColor("", true)).toBeUndefined()
  })

  it("flips near-black colors to white in dark mode", () => {
    expect(getAdaptiveBarColor("#000000", true)).toBe("#ffffff")
    expect(getAdaptiveBarColor("#111111", true)).toBe("#ffffff")
  })

  it("keeps near-black colors unchanged in light mode", () => {
    expect(getAdaptiveBarColor("#000000", false)).toBe("#000000")
  })

  it("drops near-white colors in light mode so callers fall back to their default", () => {
    expect(getAdaptiveBarColor("#ffffff", false)).toBeUndefined()
    expect(getAdaptiveBarColor("#fafafa", false)).toBeUndefined()
  })

  it("keeps near-white colors in dark mode", () => {
    expect(getAdaptiveBarColor("#ffffff", true)).toBe("#ffffff")
  })

  it("passes mid-tone colors through unchanged in either mode", () => {
    expect(getAdaptiveBarColor("#DE7356", true)).toBe("#DE7356")
    expect(getAdaptiveBarColor("#DE7356", false)).toBe("#DE7356")
    expect(getAdaptiveBarColor("#777777", true)).toBe("#777777")
    expect(getAdaptiveBarColor("#777777", false)).toBe("#777777")
  })
})

