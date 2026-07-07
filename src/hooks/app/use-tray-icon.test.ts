import { describe, expect, it } from "vitest"
import type { PluginMeta } from "@/lib/plugin-types"
import type { PluginSettings } from "@/lib/settings"
import {
  buildTraySettingsPreview,
  getMultiTrayProviderIds,
} from "@/hooks/app/use-tray-icon"

const pluginsMeta: PluginMeta[] = [
  {
    id: "claude",
    name: "Claude",
    iconUrl: "claude-icon",
    lines: [],
    links: [],
    primaryCandidates: ["Session"],
    weeklyCandidate: "Weekly",
    multiTrayLines: [],
    detected: true,
  },
  {
    id: "cursor",
    name: "Cursor",
    iconUrl: "cursor-icon",
    lines: [],
    links: [],
    primaryCandidates: ["Credits", "Total usage"],
    weeklyCandidate: null,
    trayPrimaryLabel: "Total usage",
    multiTrayLines: ["Auto usage", "API usage"],
    detected: true,
  },
  {
    id: "codex",
    name: "Codex",
    iconUrl: "codex-icon",
    lines: [],
    links: [],
    primaryCandidates: ["Session"],
    weeklyCandidate: "Weekly",
    multiTrayLines: [],
    detected: true,
  },
]

const pluginSettings: PluginSettings = {
  order: ["claude", "cursor", "codex"],
  disabled: [],
}

describe("getMultiTrayProviderIds", () => {
  it("includes enabled providers without primary metrics up to the cap", () => {
    expect(getMultiTrayProviderIds(pluginsMeta, pluginSettings)).toEqual([
      "claude",
      "cursor",
      "codex",
    ])
  })

  it("respects plugin order and skips disabled providers", () => {
    expect(
      getMultiTrayProviderIds(pluginsMeta, {
        order: ["codex", "claude", "cursor"],
        disabled: ["claude"],
      }),
    ).toEqual(["codex", "cursor"])
  })

  it("respects configured max provider count", () => {
    expect(getMultiTrayProviderIds(pluginsMeta, pluginSettings, 2)).toEqual([
      "claude",
      "cursor",
    ])
  })
})

describe("buildTraySettingsPreview", () => {
  it("populates single-style and multi-style preview fields together", () => {
    const preview = buildTraySettingsPreview({
      pluginsMeta,
      pluginSettings,
      pluginStates: {
        claude: {
          data: {
            providerId: "claude",
            lines: [
              { type: "progress", label: "Session", used: 70, limit: 100 },
              { type: "progress", label: "Weekly", used: 36, limit: 100 },
            ],
          },
          loading: false,
          error: null,
        },
      },
      displayMode: "used",
      menubarMetric: "default",
      activeView: "home",
      lastTrayProviderId: null,
    })

    expect(preview.providerIconUrl).toBe("claude-icon")
    expect(preview.providerPercentText).toBe("70%")
    expect(preview.providerBars[0]?.fraction).toBe(0.7)
    expect(preview.multiProviders).toHaveLength(3)
    expect(preview.multiProviders[0]).toMatchObject({
      id: "claude",
      sessionText: "70%",
      weeklyText: "36%",
    })
    expect(preview.multiProviders[1]).toMatchObject({
      id: "cursor",
      iconUrl: "cursor-icon",
    })
    expect(preview.bars.length).toBeGreaterThan(0)
  })

  it("uses Cursor multiTrayLines for multi preview metrics", () => {
    const preview = buildTraySettingsPreview({
      pluginsMeta,
      pluginSettings,
      pluginStates: {
        cursor: {
          data: {
            providerId: "cursor",
            lines: [
              { type: "progress", label: "Credits", used: 10, limit: 100 },
              { type: "progress", label: "Total usage", used: 55, limit: 100 },
              { type: "progress", label: "Auto usage", used: 42, limit: 100 },
              { type: "progress", label: "API usage", used: 18, limit: 100 },
            ],
          },
          loading: false,
          error: null,
        },
      },
      displayMode: "used",
      menubarMetric: "default",
      activeView: "home",
      lastTrayProviderId: null,
    })

    expect(preview.multiProviders[1]).toMatchObject({
      id: "cursor",
      sessionText: "42%",
      weeklyText: "18%",
      sessionFraction: 0.42,
      weeklyFraction: 0.18,
    })
  })

  it("uses Total usage for Cursor provider and bars preview", () => {
    const preview = buildTraySettingsPreview({
      pluginsMeta,
      pluginSettings: { order: ["cursor", "claude"], disabled: [] },
      pluginStates: {
        cursor: {
          data: {
            providerId: "cursor",
            lines: [
              { type: "progress", label: "Credits", used: 10, limit: 100 },
              { type: "progress", label: "Total usage", used: 42, limit: 100 },
              { type: "progress", label: "Auto usage", used: 70, limit: 100 },
              { type: "progress", label: "API usage", used: 30, limit: 100 },
            ],
          },
          loading: false,
          error: null,
        },
      },
      displayMode: "used",
      menubarMetric: "default",
      activeView: "cursor",
      lastTrayProviderId: null,
    })

    expect(preview.providerBars).toEqual([
      { id: "cursor", fraction: 0.42, label: "Total usage" },
    ])
    expect(preview.providerPercentText).toBe("42%")
    expect(preview.bars[0]).toEqual({ id: "cursor", fraction: 0.42, label: "Total usage" })
  })
})
