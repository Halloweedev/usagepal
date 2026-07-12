import { describe, expect, it } from "vitest"
import {
  assignGraphEntryColors,
  deriveDistinctModelColor,
  deriveModelColors,
  deriveProviderColor,
  hexToOklch,
  oklchToHex,
  OTHERS_COLORS,
} from "@/lib/graph-colors"

const HEX = /^#[0-9a-f]{6}$/

function hueDistance(a: number, b: number) {
  const diff = Math.abs(a - b) % 360
  return Math.min(diff, 360 - diff)
}

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

  it("separates same-brand models by hue and lightness", () => {
    const colors = deriveModelColors("#DE7356", 3, "dark").map((hex) => hexToOklch(hex)!)
    expect(hueDistance(colors[0].h, colors[1].h)).toBeGreaterThanOrEqual(20)
    expect(Math.abs(colors[0].l - colors[1].l)).toBeGreaterThanOrEqual(0.08)
    expect(Math.abs(colors[1].l - colors[2].l)).toBeGreaterThanOrEqual(0.08)
  })

  it("keeps dark-theme colors inside the dark lightness band", () => {
    for (const color of deriveModelColors("#DE7356", 8, "dark")) {
      const { l } = hexToOklch(color)!
      expect(l).toBeGreaterThanOrEqual(0.42)
      expect(l).toBeLessThanOrEqual(0.80)
    }
  })

  it("keeps light-theme colors inside the light lightness band", () => {
    for (const color of deriveModelColors("#74AA9C", 8, "light")) {
      const { l } = hexToOklch(color)!
      expect(l).toBeGreaterThanOrEqual(0.38)
      expect(l).toBeLessThanOrEqual(0.76)
    }
  })

  it("preserves the brand hue on the first provider accent", () => {
    const brandHue = hexToOklch("#DE7356")!.h
    const { h } = hexToOklch(deriveProviderColor("#DE7356", "dark"))!
    expect(Math.abs(h - brandHue)).toBeLessThanOrEqual(4)
  })

  it("maps mono brands (black, null) to a low-chroma slate ramp", () => {
    for (const brand of ["#000000", null]) {
      for (const color of deriveModelColors(brand, 2, "dark")) {
        const { c } = hexToOklch(color)!
        expect(c).toBeLessThanOrEqual(0.06)
      }
    }
  })

  it("cycles rank steps past 8 models instead of throwing", () => {
    expect(deriveModelColors("#DE7356", 10, "dark")).toHaveLength(10)
  })

  it("provides in-band neutral Others colors", () => {
    expect(hexToOklch(OTHERS_COLORS.dark)!.l).toBeGreaterThanOrEqual(0.46)
    expect(hexToOklch(OTHERS_COLORS.light)!.l).toBeLessThanOrEqual(0.79)
  })
})

describe("assignGraphEntryColors", () => {
  it("model mode: globally ranks colors so adjacent models diverge", () => {
    const colors = assignGraphEntryColors(
      [
        { key: "claude::Opus", brandColor: "#DE7356" },
        { key: "claude::Sonnet", brandColor: "#DE7356" },
        { key: "codex::GPT", brandColor: "#74AA9C" },
      ],
      "model",
      "dark"
    )
    const opus = hexToOklch(colors.get("claude::Opus")!)!
    const sonnet = hexToOklch(colors.get("claude::Sonnet")!)!
    expect(hueDistance(opus.h, sonnet.h)).toBeGreaterThanOrEqual(20)
    expect(Math.abs(opus.l - sonnet.l)).toBeGreaterThanOrEqual(0.08)
  })

  it("provider mode: locks each slice to its brand hue", () => {
    const colors = assignGraphEntryColors(
      [
        { key: "claude", brandColor: "#DE7356" },
        { key: "codex", brandColor: "#74AA9C" },
      ],
      "provider",
      "dark"
    )
    const claudeHue = hexToOklch("#DE7356")!.h
    const codexHue = hexToOklch("#74AA9C")!.h
    expect(Math.abs(hexToOklch(colors.get("claude")!)!.h - claudeHue)).toBeLessThanOrEqual(4)
    expect(Math.abs(hexToOklch(colors.get("codex")!)!.h - codexHue)).toBeLessThanOrEqual(4)
  })
})

describe("deriveDistinctModelColor", () => {
  it("changes color with rank even for the same brand hex", () => {
    expect(deriveDistinctModelColor("#DE7356", 0, "dark")).not.toBe(
      deriveDistinctModelColor("#DE7356", 1, "dark")
    )
  })
})
