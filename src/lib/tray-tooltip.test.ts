import { describe, expect, it } from "vitest"
import { formatTrayPercentIfPresent, formatTrayPercentText, formatTrayTooltip, formatTrayTooltipMulti } from "./tray-tooltip"
import type { PluginMeta } from "./plugin-types"
import type { TrayPrimaryBar } from "./tray-primary-progress"

describe("tray-tooltip", () => {
  describe("formatTrayPercentText", () => {
    it("should format valid fractions", () => {
      expect(formatTrayPercentText(0.45)).toBe("45%")
      expect(formatTrayPercentText(0)).toBe("0%")
      expect(formatTrayPercentText(1)).toBe("100%")
    })

    it("should round fractions", () => {
      expect(formatTrayPercentText(0.456)).toBe("46%")
      expect(formatTrayPercentText(0.454)).toBe("45%")
    })

    it("should clamp fractions", () => {
      expect(formatTrayPercentText(-0.1)).toBe("0%")
      expect(formatTrayPercentText(1.1)).toBe("100%")
    })

    it("should handle undefined and NaN", () => {
      expect(formatTrayPercentText(undefined)).toBe("--%")
      expect(formatTrayPercentText(NaN)).toBe("--%")
    })
  })

  describe("formatTrayPercentIfPresent", () => {
    it("returns undefined when fraction missing", () => {
      expect(formatTrayPercentIfPresent(undefined)).toBeUndefined()
      expect(formatTrayPercentIfPresent(NaN)).toBeUndefined()
    })

    it("returns 0% for zero", () => {
      expect(formatTrayPercentIfPresent(0)).toBe("0%")
    })

    it("formats normal fractions", () => {
      expect(formatTrayPercentIfPresent(0.36)).toBe("36%")
      expect(formatTrayPercentIfPresent(1)).toBe("100%")
    })
  })

  describe("formatTrayTooltip", () => {
    const mockMeta: PluginMeta[] = [
      { id: "p1", name: "Plugin 1", iconUrl: "", lines: [], links: [], primaryCandidates: [], weeklyCandidate: null, detected: true },
      { id: "p2", name: "Plugin 2", iconUrl: "", lines: [], links: [], primaryCandidates: [], weeklyCandidate: null, detected: true },
    ]

    it("should show app name when no bars", () => {
      expect(formatTrayTooltip([], mockMeta)).toBe("UsagePal")
    })

    it("should list enabled plugins with percentages", () => {
      const bars: TrayPrimaryBar[] = [
        { id: "p1", fraction: 0.45 },
        { id: "p2", fraction: 0.12 },
      ]
      const tooltip = formatTrayTooltip(bars, mockMeta)
      expect(tooltip).toBe("UsagePal\nPlugin 1: 45%\nPlugin 2: 12%")
    })

    it("should handle missing plugin metadata gracefully", () => {
      const bars: TrayPrimaryBar[] = [
        { id: "p1", fraction: 0.45 },
        { id: "unknown", fraction: 0.5 },
      ]
      const tooltip = formatTrayTooltip(bars, mockMeta)
      expect(tooltip).toBe("UsagePal\nPlugin 1: 45%")
    })

    it("should show --% for missing fractions", () => {
      const bars: TrayPrimaryBar[] = [
        { id: "p1", fraction: undefined },
      ]
      const tooltip = formatTrayTooltip(bars, mockMeta)
      expect(tooltip).toBe("UsagePal\nPlugin 1: --%")
    })

    it("omits tags in weekly mode when every line is weekly", () => {
      const bars: TrayPrimaryBar[] = [
        { id: "p1", fraction: 0.42, label: "Weekly", weekly: true },
        { id: "p2", fraction: 0.6, label: "Weekly", weekly: true },
      ]
      const tooltip = formatTrayTooltip(bars, mockMeta, true)
      expect(tooltip).toBe("UsagePal\nPlugin 1: 42%\nPlugin 2: 60%")
    })

    it("tags every line in weekly mode when the list is mixed", () => {
      const bars: TrayPrimaryBar[] = [
        { id: "p1", fraction: 0.42, label: "Weekly", weekly: true },
        { id: "p2", fraction: 0.3, label: "Premium" },
      ]
      const tooltip = formatTrayTooltip(bars, mockMeta, true)
      expect(tooltip).toBe("UsagePal\nPlugin 1: 42% · Weekly\nPlugin 2: 30% · Premium")
    })

    it("does not tag lines when weekly mode is off", () => {
      const bars: TrayPrimaryBar[] = [
        { id: "p1", fraction: 0.42, label: "Weekly", weekly: true },
        { id: "p2", fraction: 0.3, label: "Premium" },
      ]
      const tooltip = formatTrayTooltip(bars, mockMeta, false)
      expect(tooltip).toBe("UsagePal\nPlugin 1: 42%\nPlugin 2: 30%")
    })
  })

  describe("formatTrayTooltipMulti", () => {
    const meta = [{ id: "claude", name: "Claude", iconUrl: "", primaryCandidates: ["Session"], lines: [] }]

    it("omits providers with no data lines", () => {
      expect(
        formatTrayTooltipMulti(
          [{ id: "claude", sessionFraction: undefined, weeklyFraction: undefined }],
          meta
        )
      ).toBe("UsagePal")
    })

    it("formats session and weekly when both present", () => {
      expect(
        formatTrayTooltipMulti(
          [{ id: "claude", sessionFraction: 1, weeklyFraction: 0.36 }],
          meta
        )
      ).toBe("UsagePal\nClaude: 100% · 36%")
    })

    it("formats session only when weekly missing", () => {
      expect(
        formatTrayTooltipMulti(
          [{ id: "claude", sessionFraction: 0.93, weeklyFraction: undefined }],
          meta
        )
      ).toBe("UsagePal\nClaude: 93%")
    })
  })
})
