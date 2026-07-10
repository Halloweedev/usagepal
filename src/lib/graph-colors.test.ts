import { describe, expect, it } from "vitest"
import { deriveModelColors, hexToOklch, oklchToHex, OTHERS_COLORS } from "@/lib/graph-colors"

const HEX = /^#[0-9a-f]{6}$/

describe("oklch conversion", () => {
  it("round-trips within tolerance", () => {
    const back = hexToOklch(oklchToHex({ l: 0.62, c: 0.11, h: 35 }))!
    expect(back.l).toBeCloseTo(0.62, 1)
    expect(back.c).toBeCloseTo(0.11, 1)
    expect(back.h).toBeCloseTo(35, -1)
  })

  it("rejects malformed hex", () => {
    expect(hexToOklch("#12")).toBeNull()
    expect(hexToOklch("nope")).toBeNull()
  })
})

describe("deriveModelColors", () => {
  it("returns distinct valid hex colors, one per model", () => {
    const colors = deriveModelColors("#DE7356", 4, "dark")
    expect(colors).toHaveLength(4)
    for (const color of colors) expect(color).toMatch(HEX)
    expect(new Set(colors).size).toBe(4)
  })

  it("keeps dark-theme colors inside the dark lightness band", () => {
    for (const color of deriveModelColors("#DE7356", 8, "dark")) {
      const { l } = hexToOklch(color)!
      expect(l).toBeGreaterThanOrEqual(0.46)
      expect(l).toBeLessThanOrEqual(0.69)
    }
  })

  it("keeps light-theme colors inside the light lightness band", () => {
    for (const color of deriveModelColors("#74AA9C", 8, "light")) {
      const { l } = hexToOklch(color)!
      expect(l).toBeGreaterThanOrEqual(0.41)
      expect(l).toBeLessThanOrEqual(0.79)
    }
  })

  it("preserves the brand hue and enforces the chroma floor", () => {
    const brandHue = hexToOklch("#DE7356")!.h
    for (const color of deriveModelColors("#DE7356", 2, "dark")) {
      const { c, h } = hexToOklch(color)!
      expect(c).toBeGreaterThanOrEqual(0.09)
      expect(Math.abs(h - brandHue)).toBeLessThanOrEqual(8)
    }
  })

  it("maps mono brands (black, null) to a low-chroma slate ramp", () => {
    for (const brand of ["#000000", null]) {
      for (const color of deriveModelColors(brand, 2, "dark")) {
        const { c } = hexToOklch(color)!
        expect(c).toBeLessThanOrEqual(0.06)
      }
    }
  })

  it("cycles lightness steps past 8 models instead of throwing", () => {
    expect(deriveModelColors("#DE7356", 10, "dark")).toHaveLength(10)
  })

  it("provides in-band neutral Others colors", () => {
    expect(hexToOklch(OTHERS_COLORS.dark)!.l).toBeGreaterThanOrEqual(0.46)
    expect(hexToOklch(OTHERS_COLORS.light)!.l).toBeLessThanOrEqual(0.79)
  })
})
