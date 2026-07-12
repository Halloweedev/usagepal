import { describe, expect, it } from "vitest"
import {
  getProviderIconScale,
  getScaledProviderIconLayout,
  scaleProviderIconSize,
} from "@/lib/provider-icon-scale"

describe("provider-icon-scale", () => {
  it("returns 0.9 for OpenCode and Cline", () => {
    expect(getProviderIconScale("opencode-go")).toBe(0.9)
    expect(getProviderIconScale("cline-pass")).toBe(0.9)
  })

  it("returns 0.8 for Amp", () => {
    expect(getProviderIconScale("amp")).toBe(0.8)
  })

  it("returns 1 for other providers", () => {
    expect(getProviderIconScale("claude")).toBe(1)
    expect(getProviderIconScale(undefined)).toBe(1)
  })

  it("scaleProviderIconSize rounds scaled dimensions", () => {
    expect(scaleProviderIconSize(24, "opencode-go")).toBe(22)
    expect(scaleProviderIconSize(24, "amp")).toBe(19)
    expect(scaleProviderIconSize(24, "claude")).toBe(24)
  })

  it("getScaledProviderIconLayout centers smaller icons", () => {
    const layout = getScaledProviderIconLayout({
      baseSizePx: 30,
      pluginId: "opencode-go",
      x: 4,
      y: 6,
    })
    expect(layout.size).toBe(27)
    expect(layout.x).toBe(6)
    expect(layout.y).toBe(8)
  })

  it("getScaledProviderIconLayout centers Amp at 80%", () => {
    const layout = getScaledProviderIconLayout({
      baseSizePx: 30,
      pluginId: "amp",
      x: 4,
      y: 6,
    })
    expect(layout.size).toBe(24)
    expect(layout.x).toBe(7)
    expect(layout.y).toBe(9)
  })
})
