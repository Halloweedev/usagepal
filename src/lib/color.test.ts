import { describe, expect, it } from "vitest"

import { getRelativeLuminance } from "@/lib/color"

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

