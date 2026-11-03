import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_AUTO_UPDATE_INTERVAL,
  DEFAULT_BETA_UPDATES_ENABLED,
  DEFAULT_DISPLAY_MODE,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_MENUBAR_ICON_STYLE,
  DEFAULT_MENUBAR_METRIC,
  DEFAULT_MULTI_TRAY_DISPLAY_MODE,
  DEFAULT_MULTI_TRAY_PROVIDER_COUNT,
  DEFAULT_ONBOARDING_COMPLETED,
  DEFAULT_OVERVIEW_GRAPH_GROUP_BY,
  DEFAULT_OVERVIEW_GRAPH_STYLE,
  DEFAULT_OVERVIEW_SPEND_STRIP_ENABLED,
  DEFAULT_OVERVIEW_STRIP_METRIC,
  DEFAULT_PACE_NOTIFICATION_SETTINGS,
  DEFAULT_PLUGIN_SETTINGS,
  DEFAULT_RESET_TIMER_DISPLAY_MODE,
  DEFAULT_SHARE_SETTINGS,
  DEFAULT_START_ON_LOGIN,
  DEFAULT_THEME_MODE,
  DEFAULT_TIME_FORMAT_MODE,
  arePluginSettingsEqual,
  getEnabledPluginIds,
  loadAutoUpdateInterval,
  loadBetaUpdatesEnabled,
  loadDisplayMode,
  loadGlobalShortcut,
  loadMenubarIconStyle,
  loadMenubarMetric,
  loadMultiTrayDisplayMode,
  loadMultiTrayProviderCount,
  loadOnboardingCompleted,
  loadOverviewGraphGroupBy,
  loadOverviewGraphStyle,
  loadOverviewSpendStripEnabled,
  loadOverviewStripMetric,
  loadPaceNotificationSettings,
  loadPluginSettings,
  loadResetTimerDisplayMode,
  loadShareSettings,
  loadStartOnLogin,
  loadTimeFormatMode,
  cycleMultiTrayProviderCount,
  mergeProviderSelection,
  migrateLegacyTraySettings,
  migrateWindsurfToDevin,
  ONBOARDING_PACE_NOTIFICATION_SETTINGS,
  loadThemeMode,
  normalizePluginSettings,
  resetOnboardingCompleted,
  saveAutoUpdateInterval,
  saveBetaUpdatesEnabled,
  saveDisplayMode,
  saveGlobalShortcut,
  saveMenubarIconStyle,
  saveMenubarMetric,
  saveMultiTrayDisplayMode,
  saveMultiTrayProviderCount,
  saveOnboardingCompleted,
  saveOverviewGraphGroupBy,
  saveOverviewSpendStripEnabled,
  saveOverviewStripMetric,
  saveOverviewGraphStyle,
  savePaceNotificationSettings,
  savePluginSettings,
  saveResetTimerDisplayMode,
  saveShareSettings,
  saveStartOnLogin,
  saveThemeMode,
  saveTimeFormatMode,
} from "@/lib/settings"
import type { PluginMeta } from "@/lib/plugin-types"

const storeState = new Map<string, unknown>()
const storeDeleteMock = vi.fn()
const storeSaveMock = vi.fn()

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async get<T>(key: string): Promise<T | null> {
      if (!storeState.has(key)) return undefined as T | null
      return storeState.get(key) as T | null
    }
    async set<T>(key: string, value: T): Promise<void> {
      storeState.set(key, value)
    }
    async delete(key: string): Promise<void> {
      storeDeleteMock(key)
      storeState.delete(key)
    }
    async save(): Promise<void> {
      storeSaveMock()
    }
  },
}))

describe("settings", () => {
  beforeEach(() => {
    storeState.clear()
    storeDeleteMock.mockReset()
    storeSaveMock.mockReset()
  })

  it("loads defaults when no settings stored", async () => {
    await expect(loadPluginSettings()).resolves.toEqual(DEFAULT_PLUGIN_SETTINGS)
  })

  it("sanitizes stored settings", async () => {
    storeState.set("plugins", { order: ["a"], disabled: "nope" })
    await expect(loadPluginSettings()).resolves.toEqual({
      order: ["a"],
      disabled: [],
    })
  })

  it("saves settings", async () => {
    const settings = { order: ["a"], disabled: ["b"] }
    await savePluginSettings(settings)
    await expect(loadPluginSettings()).resolves.toEqual(settings)
  })

  it("normalizes order + disabled against known plugins", () => {
    const plugins: PluginMeta[] = [
      { id: "a", name: "A", iconUrl: "", lines: [] },
      { id: "b", name: "B", iconUrl: "", lines: [] },
    ]
    const normalized = normalizePluginSettings(
      { order: ["b", "b", "c"], disabled: ["c", "a"] },
      plugins
    )
    expect(normalized).toEqual({ order: ["b", "a"], disabled: ["a"] })
  })

  it("auto-disables new undetected plugins, enables detected ones", () => {
    const plugins: PluginMeta[] = [
      { id: "claude", name: "Claude", iconUrl: "", lines: [], primaryCandidates: [], detected: true },
      { id: "copilot", name: "Copilot", iconUrl: "", lines: [], primaryCandidates: [], detected: false },
      { id: "devin", name: "Devin", iconUrl: "", lines: [], primaryCandidates: [], detected: false },
    ]
    const result = normalizePluginSettings({ order: [], disabled: [] }, plugins)
    expect(result.order).toEqual(["claude", "copilot", "devin"])
    expect(result.disabled).toEqual(["copilot", "devin"])
  })

  it("migrates enabled windsurf settings to enabled devin settings", () => {
    const result = migrateWindsurfToDevin({
      order: ["claude", "windsurf", "codex"],
      disabled: [],
    })

    expect(result).toEqual({
      order: ["claude", "devin", "codex"],
      disabled: [],
    })
  })

  it("keeps devin enabled when enabled windsurf conflicts with a stale disabled devin entry", () => {
    const result = migrateWindsurfToDevin({
      order: ["claude", "windsurf", "codex"],
      disabled: ["devin"],
    })

    expect(result).toEqual({
      order: ["claude", "devin", "codex"],
      disabled: [],
    })
  })

  it("migrates disabled windsurf settings to disabled devin settings", () => {
    const result = migrateWindsurfToDevin({
      order: ["windsurf", "claude"],
      disabled: ["windsurf"],
    })

    expect(result).toEqual({
      order: ["devin", "claude"],
      disabled: ["devin"],
    })
  })

  it("does not disable an existing devin entry when removing old windsurf settings", () => {
    const result = migrateWindsurfToDevin({
      order: ["windsurf", "devin", "claude"],
      disabled: ["windsurf"],
    })

    expect(result).toEqual({
      order: ["devin", "claude"],
      disabled: [],
    })
  })

  it("compares settings equality", () => {
    const a = { order: ["a"], disabled: [] }
    const b = { order: ["a"], disabled: [] }
    const c = { order: ["b"], disabled: [] }
    expect(arePluginSettingsEqual(a, b)).toBe(true)
    expect(arePluginSettingsEqual(a, c)).toBe(false)
  })

  it("returns enabled plugin ids", () => {
    expect(getEnabledPluginIds({ order: ["a", "b"], disabled: ["b"] })).toEqual(["a"])
  })

  it("loads default auto-update interval when missing", async () => {
    await expect(loadAutoUpdateInterval()).resolves.toBe(DEFAULT_AUTO_UPDATE_INTERVAL)
  })

  it("loads stored auto-update interval", async () => {
    storeState.set("autoUpdateInterval", 30)
    await expect(loadAutoUpdateInterval()).resolves.toBe(30)
  })

  it("saves auto-update interval", async () => {
    await saveAutoUpdateInterval(5)
    await expect(loadAutoUpdateInterval()).resolves.toBe(5)
  })

  it("loads default beta updates setting when missing", async () => {
    await expect(loadBetaUpdatesEnabled()).resolves.toBe(DEFAULT_BETA_UPDATES_ENABLED)
  })

  it("loads stored beta updates setting", async () => {
    storeState.set("betaUpdatesEnabled", true)
    await expect(loadBetaUpdatesEnabled()).resolves.toBe(true)
  })

  it("saves beta updates setting", async () => {
    await saveBetaUpdatesEnabled(true)
    await expect(loadBetaUpdatesEnabled()).resolves.toBe(true)
  })

  it("loads default theme mode when missing", async () => {
    await expect(loadThemeMode()).resolves.toBe(DEFAULT_THEME_MODE)
  })

  it("loads stored theme mode", async () => {
    storeState.set("themeMode", "dark")
    await expect(loadThemeMode()).resolves.toBe("dark")
  })

  it("saves theme mode", async () => {
    await saveThemeMode("light")
    await expect(loadThemeMode()).resolves.toBe("light")
  })

  it("falls back to default for invalid theme mode", async () => {
    storeState.set("themeMode", "invalid")
    await expect(loadThemeMode()).resolves.toBe(DEFAULT_THEME_MODE)
  })

  it("loads default display mode when missing", async () => {
    await expect(loadDisplayMode()).resolves.toBe(DEFAULT_DISPLAY_MODE)
  })

  it("loads stored display mode", async () => {
    storeState.set("displayMode", "left")
    await expect(loadDisplayMode()).resolves.toBe("left")
  })

  it("saves display mode", async () => {
    await saveDisplayMode("left")
    await expect(loadDisplayMode()).resolves.toBe("left")
  })

  it("falls back to default for invalid display mode", async () => {
    storeState.set("displayMode", "invalid")
    await expect(loadDisplayMode()).resolves.toBe(DEFAULT_DISPLAY_MODE)
  })

  it("loads default reset timer display mode when missing", async () => {
    await expect(loadResetTimerDisplayMode()).resolves.toBe(DEFAULT_RESET_TIMER_DISPLAY_MODE)
  })

  it("loads stored reset timer display mode", async () => {
    storeState.set("resetTimerDisplayMode", "absolute")
    await expect(loadResetTimerDisplayMode()).resolves.toBe("absolute")
  })

  it("saves reset timer display mode", async () => {
    await saveResetTimerDisplayMode("relative")
    await expect(loadResetTimerDisplayMode()).resolves.toBe("relative")
  })

  it("falls back to default for invalid reset timer display mode", async () => {
    storeState.set("resetTimerDisplayMode", "invalid")
    await expect(loadResetTimerDisplayMode()).resolves.toBe(DEFAULT_RESET_TIMER_DISPLAY_MODE)
  })

  it("loads default time format mode when missing", async () => {
    await expect(loadTimeFormatMode()).resolves.toBe(DEFAULT_TIME_FORMAT_MODE)
  })

  it("loads stored time format mode", async () => {
    storeState.set("timeFormatMode", "24h")
    await expect(loadTimeFormatMode()).resolves.toBe("24h")
  })

  it("saves time format mode", async () => {
    await saveTimeFormatMode("12h")
    await expect(loadTimeFormatMode()).resolves.toBe("12h")
  })

  it("falls back to default for invalid time format mode", async () => {
    storeState.set("timeFormatMode", "invalid")
    await expect(loadTimeFormatMode()).resolves.toBe(DEFAULT_TIME_FORMAT_MODE)
  })

  it("migrates and removes legacy tray settings keys", async () => {
    storeState.set("trayIconStyle", "provider")
    storeState.set("trayShowPercentage", false)

    await migrateLegacyTraySettings()

    expect(storeState.has("trayIconStyle")).toBe(false)
    expect(storeState.has("trayShowPercentage")).toBe(false)
  })

  it("migrates legacy trayIconStyle=bars to menubarIconStyle=bars when new key not set", async () => {
    storeState.set("trayIconStyle", "bars")

    await migrateLegacyTraySettings()

    expect(storeState.get("menubarIconStyle")).toBe("bars")
    expect(storeState.has("trayIconStyle")).toBe(false)
  })

  it("does not overwrite menubarIconStyle when already set during legacy migration", async () => {
    storeState.set("trayIconStyle", "bars")
    storeState.set("menubarIconStyle", "provider")

    await migrateLegacyTraySettings()

    expect(storeState.get("menubarIconStyle")).toBe("provider")
    expect(storeState.has("trayIconStyle")).toBe(false)
  })

  it("migrates legacy trayIconStyle=circle to menubarIconStyle=donut when new key not set", async () => {
    storeState.set("trayIconStyle", "circle")

    await migrateLegacyTraySettings()

    expect(storeState.get("menubarIconStyle")).toBe("donut")
    expect(storeState.has("trayIconStyle")).toBe(false)
  })

  it("does not set menubarIconStyle when legacy trayIconStyle is non-bars", async () => {
    storeState.set("trayIconStyle", "provider")

    await migrateLegacyTraySettings()

    expect(storeState.has("menubarIconStyle")).toBe(false)
    expect(storeState.has("trayIconStyle")).toBe(false)
  })

  it("loads default menubar icon style when missing", async () => {
    await expect(loadMenubarIconStyle()).resolves.toBe(DEFAULT_MENUBAR_ICON_STYLE)
  })

  it("loads stored menubar icon style", async () => {
    storeState.set("menubarIconStyle", "bars")
    await expect(loadMenubarIconStyle()).resolves.toBe("bars")
  })

  it("saves menubar icon style", async () => {
    await saveMenubarIconStyle("bars")
    await expect(loadMenubarIconStyle()).resolves.toBe("bars")
  })

  it("loads stored menubar donut icon style", async () => {
    storeState.set("menubarIconStyle", "donut")
    await expect(loadMenubarIconStyle()).resolves.toBe("donut")
  })

  it("saves menubar donut icon style", async () => {
    await saveMenubarIconStyle("donut")
    await expect(loadMenubarIconStyle()).resolves.toBe("donut")
  })

  it("accepts multi menubar icon style", async () => {
    await saveMenubarIconStyle("multi")
    expect(await loadMenubarIconStyle()).toBe("multi")
  })

  it("loads default multi tray provider count when missing", async () => {
    await expect(loadMultiTrayProviderCount()).resolves.toBe(DEFAULT_MULTI_TRAY_PROVIDER_COUNT)
  })

  it("loads stored multi tray provider count", async () => {
    storeState.set("multiTrayProviderCount", 4)
    await expect(loadMultiTrayProviderCount()).resolves.toBe(4)
  })

  it("saves multi tray provider count", async () => {
    await saveMultiTrayProviderCount(2)
    await expect(loadMultiTrayProviderCount()).resolves.toBe(2)
  })

  it("falls back to default for invalid multi tray provider count", async () => {
    storeState.set("multiTrayProviderCount", 5)
    await expect(loadMultiTrayProviderCount()).resolves.toBe(DEFAULT_MULTI_TRAY_PROVIDER_COUNT)
  })

  it("cycles multi tray provider count 2 to 3 to 4 to 2", () => {
    expect(cycleMultiTrayProviderCount(2)).toBe(3)
    expect(cycleMultiTrayProviderCount(3)).toBe(4)
    expect(cycleMultiTrayProviderCount(4)).toBe(2)
  })

  it("loads default multi tray display mode when missing", async () => {
    await expect(loadMultiTrayDisplayMode()).resolves.toBe(DEFAULT_MULTI_TRAY_DISPLAY_MODE)
  })

  it("loads stored multi tray display mode", async () => {
    storeState.set("multiTrayDisplayMode", "bars")
    await expect(loadMultiTrayDisplayMode()).resolves.toBe("bars")
  })

  it("saves multi tray display mode", async () => {
    await saveMultiTrayDisplayMode("bars")
    await expect(loadMultiTrayDisplayMode()).resolves.toBe("bars")
  })

  it("falls back to default for invalid multi tray display mode", async () => {
    storeState.set("multiTrayDisplayMode", "invalid")
    await expect(loadMultiTrayDisplayMode()).resolves.toBe(DEFAULT_MULTI_TRAY_DISPLAY_MODE)
  })

  it("falls back to default for invalid menubar icon style", async () => {
    storeState.set("menubarIconStyle", "invalid")
    await expect(loadMenubarIconStyle()).resolves.toBe(DEFAULT_MENUBAR_ICON_STYLE)
  })

  it("loads default menubar metric when missing", async () => {
    await expect(loadMenubarMetric()).resolves.toBe(DEFAULT_MENUBAR_METRIC)
  })

  it("loads stored menubar metric", async () => {
    storeState.set("menubarMetric", "weekly")
    await expect(loadMenubarMetric()).resolves.toBe("weekly")
  })

  it("saves menubar metric", async () => {
    await saveMenubarMetric("weekly")
    await expect(loadMenubarMetric()).resolves.toBe("weekly")
  })

  it("falls back to default for invalid menubar metric", async () => {
    storeState.set("menubarMetric", "invalid")
    await expect(loadMenubarMetric()).resolves.toBe(DEFAULT_MENUBAR_METRIC)
  })

  it("loads default overview graph style when missing", async () => {
    await expect(loadOverviewGraphStyle()).resolves.toBe(DEFAULT_OVERVIEW_GRAPH_STYLE);
  });

  it("loads stored overview graph style and migrates compact/detailed", async () => {
    storeState.set("overviewGraphStyle", "detailed");
    await expect(loadOverviewGraphStyle()).resolves.toBe("donut");

    storeState.set("overviewGraphStyle", "compact");
    await expect(loadOverviewGraphStyle()).resolves.toBe("bar");
  });

  it("saves overview graph style", async () => {
    await saveOverviewGraphStyle("donut");
    await expect(loadOverviewGraphStyle()).resolves.toBe("donut");
  });

  it("falls back to default for invalid overview graph style", async () => {
    storeState.set("overviewGraphStyle", "pie");
    await expect(loadOverviewGraphStyle()).resolves.toBe(DEFAULT_OVERVIEW_GRAPH_STYLE);
  });

  it("loads default overview strip metric when missing", async () => {
    await expect(loadOverviewStripMetric()).resolves.toBe(DEFAULT_OVERVIEW_STRIP_METRIC);
  });

  it("saves overview strip metric", async () => {
    await saveOverviewStripMetric("usage");
    await expect(loadOverviewStripMetric()).resolves.toBe("usage");
  });

  it("falls back to default for invalid overview strip metric", async () => {
    storeState.set("overviewStripMetric", "mtok");
    await expect(loadOverviewStripMetric()).resolves.toBe(DEFAULT_OVERVIEW_STRIP_METRIC);
  });

  it("loads default overview graph group by when missing", async () => {
    await expect(loadOverviewGraphGroupBy()).resolves.toBe(DEFAULT_OVERVIEW_GRAPH_GROUP_BY);
  });

  it("loads stored overview graph group by", async () => {
    storeState.set("overviewGraphGroupBy", "provider");
    await expect(loadOverviewGraphGroupBy()).resolves.toBe("provider");
  });

  it("saves overview graph group by", async () => {
    await saveOverviewGraphGroupBy("provider");
    await expect(loadOverviewGraphGroupBy()).resolves.toBe("provider");
  });

  it("falls back to default for invalid overview graph group by", async () => {
    storeState.set("overviewGraphGroupBy", "team");
    await expect(loadOverviewGraphGroupBy()).resolves.toBe(DEFAULT_OVERVIEW_GRAPH_GROUP_BY);
  });

  it("loads default overview spend strip enabled when missing", async () => {
    await expect(loadOverviewSpendStripEnabled()).resolves.toBe(DEFAULT_OVERVIEW_SPEND_STRIP_ENABLED);
  });

  it("loads stored overview spend strip enabled", async () => {
    storeState.set("overviewSpendStripEnabled", false);
    await expect(loadOverviewSpendStripEnabled()).resolves.toBe(false);
  });

  it("saves overview spend strip enabled", async () => {
    await saveOverviewSpendStripEnabled(false);
    await expect(loadOverviewSpendStripEnabled()).resolves.toBe(false);
  });

  it("falls back to default for invalid overview spend strip enabled", async () => {
    storeState.set("overviewSpendStripEnabled", "invalid");
    await expect(loadOverviewSpendStripEnabled()).resolves.toBe(DEFAULT_OVERVIEW_SPEND_STRIP_ENABLED);
  });

  it("loads default pace notification settings when missing", async () => {
    await expect(loadPaceNotificationSettings()).resolves.toEqual(DEFAULT_PACE_NOTIFICATION_SETTINGS)
  })

  it("defaults missing session reset notification settings to off", async () => {
    storeState.set("paceNotifications", {
      underTenPercent: true,
      healthyToClose: false,
      closeToRunningOut: true,
    })

    await expect(loadPaceNotificationSettings()).resolves.toEqual({
      underTenPercent: true,
      healthyToClose: false,
      closeToRunningOut: true,
      sessionReset: false,
    })
  })

  it("saves pace notification settings with session reset", async () => {
    const settings = {
      underTenPercent: false,
      healthyToClose: false,
      closeToRunningOut: false,
      sessionReset: true,
    }

    await savePaceNotificationSettings(settings)

    await expect(loadPaceNotificationSettings()).resolves.toEqual(settings)
  })

  it("skips legacy tray migration when keys are absent", async () => {
    await expect(migrateLegacyTraySettings()).resolves.toBeUndefined()
    expect(storeState.has("trayIconStyle")).toBe(false)
    expect(storeState.has("trayShowPercentage")).toBe(false)
    expect(storeDeleteMock).not.toHaveBeenCalled()
    expect(storeSaveMock).not.toHaveBeenCalled()
  })

  it("migrates when only one legacy tray key is present", async () => {
    storeState.set("trayShowPercentage", true)

    await migrateLegacyTraySettings()

    expect(storeState.has("trayShowPercentage")).toBe(false)
    expect(storeDeleteMock).toHaveBeenCalledWith("trayShowPercentage")
    expect(storeSaveMock).toHaveBeenCalledTimes(1)
  })

  it("falls back to nulling legacy keys if delete is unavailable", async () => {
    const { LazyStore } = await import("@tauri-apps/plugin-store")
    const prototype = LazyStore.prototype as { delete?: (key: string) => Promise<void> }
    const originalDelete = prototype.delete

    // Simulate older store implementation with no delete() method.
    prototype.delete = undefined
    storeState.set("trayIconStyle", "provider")

    try {
      await migrateLegacyTraySettings()
    } finally {
      prototype.delete = originalDelete
    }

    expect(storeDeleteMock).not.toHaveBeenCalled()
    expect(storeState.get("trayIconStyle")).toBeNull()
    expect(storeSaveMock).toHaveBeenCalledTimes(1)
  })

  it("loads default global shortcut when missing", async () => {
    await expect(loadGlobalShortcut()).resolves.toBe(DEFAULT_GLOBAL_SHORTCUT)
  })

  it("loads stored global shortcut values", async () => {
    storeState.set("globalShortcut", "CommandOrControl+Shift+O")
    await expect(loadGlobalShortcut()).resolves.toBe("CommandOrControl+Shift+O")

    storeState.set("globalShortcut", null)
    await expect(loadGlobalShortcut()).resolves.toBe(null)
  })

  it("falls back to default for invalid global shortcut values", async () => {
    storeState.set("globalShortcut", 1234)
    await expect(loadGlobalShortcut()).resolves.toBe(DEFAULT_GLOBAL_SHORTCUT)
  })

  it("saves global shortcut values", async () => {
    await saveGlobalShortcut("CommandOrControl+Shift+O")
    await expect(loadGlobalShortcut()).resolves.toBe("CommandOrControl+Shift+O")
  })

  it("loads default start on login when missing", async () => {
    await expect(loadStartOnLogin()).resolves.toBe(DEFAULT_START_ON_LOGIN)
  })

  it("loads stored start on login value", async () => {
    storeState.set("startOnLogin", true)
    await expect(loadStartOnLogin()).resolves.toBe(true)
  })

  it("saves start on login value", async () => {
    await saveStartOnLogin(true)
    await expect(loadStartOnLogin()).resolves.toBe(true)
  })

  it("falls back to default for invalid start on login value", async () => {
    storeState.set("startOnLogin", "invalid")
    await expect(loadStartOnLogin()).resolves.toBe(DEFAULT_START_ON_LOGIN)
  })

  it("loads onboarding as incomplete when missing", async () => {
    await expect(loadOnboardingCompleted()).resolves.toBe(DEFAULT_ONBOARDING_COMPLETED)
  })

  it("loads stored onboarding completion", async () => {
    storeState.set("onboardingCompleted", true)
    await expect(loadOnboardingCompleted()).resolves.toBe(true)
  })

  it("falls back to incomplete for invalid onboarding completion", async () => {
    storeState.set("onboardingCompleted", "yes")
    await expect(loadOnboardingCompleted()).resolves.toBe(false)
  })

  it("saves onboarding completion with a timestamp", async () => {
    await saveOnboardingCompleted(true)

    await expect(loadOnboardingCompleted()).resolves.toBe(true)
    expect(typeof storeState.get("onboardingCompletedAt")).toBe("number")
    expect(storeSaveMock).toHaveBeenCalled()
  })

  it("resets onboarding completion for QA", async () => {
    storeState.set("onboardingCompleted", true)
    storeState.set("onboardingCompletedAt", 1_783_419_024_000)

    await resetOnboardingCompleted()

    await expect(loadOnboardingCompleted()).resolves.toBe(false)
    expect(storeDeleteMock).toHaveBeenCalledWith("onboardingCompleted")
    expect(storeDeleteMock).toHaveBeenCalledWith("onboardingCompletedAt")
  })

  it("defines the low-noise onboarding pace alert preset", () => {
    expect(ONBOARDING_PACE_NOTIFICATION_SETTINGS).toEqual({
      underTenPercent: false,
      healthyToClose: false,
      closeToRunningOut: true,
      sessionReset: true,
    })
  })

  it("loads default share settings when missing", async () => {
    await expect(loadShareSettings()).resolves.toEqual(DEFAULT_SHARE_SETTINGS)
  })

  it("normalizes partial/invalid stored share settings to defaults per field", async () => {
    storeState.set("shareSettings", {
      selectedId: "claude",
      preset: "bogus",
      checkedLabels: ["Session", 42, "Sonnet"],
      theme: "light",
      showWatermark: "nope",
      modelDisplay: { showPercent: false, showToday: "x" },
    })

    await expect(loadShareSettings()).resolves.toEqual({
      selectedId: "claude",
      preset: null, // "bogus" is not a valid preset
      checkedLabels: ["Session", "Sonnet"], // non-strings dropped
      theme: "light",
      showPlan: true, // missing -> default
      showTokens: true, // missing -> default
      graphStyle: "bar", // missing -> default
      graphGroupBy: "provider", // missing -> default
      graphShowBreakdown: true, // missing -> default
      graphShowTotal: true, // missing -> default
      graphShowDate: true, // missing -> default
      graphMetric: "price", // missing -> default
      modelDisplay: {
        showPercent: false,
        showToday: true, // invalid -> default
        showSevenDay: true, // missing -> default
        showThirtyDay: true, // missing -> default
      },
    })
  })

  it("round-trips saved share settings", async () => {
    const settings = {
      selectedId: "codex",
      preset: "models" as const,
      checkedLabels: ["Session", "claude-sonnet-5"],
      theme: "dark" as const,
      showPlan: false,
      showTokens: false,
      graphStyle: "bar" as const,
      graphGroupBy: "provider" as const,
      graphShowBreakdown: true,
      graphShowTotal: true,
      graphShowDate: true,
      graphMetric: "price" as const,
      modelDisplay: { showPercent: true, showToday: false, showSevenDay: true, showThirtyDay: false },
    }

    await saveShareSettings(settings)

    await expect(loadShareSettings()).resolves.toEqual(settings)
    expect(storeSaveMock).toHaveBeenCalled()
  })

  it("round-trips saved share settings with preset: null", async () => {
    const settings = {
      selectedId: "codex",
      preset: null,
      checkedLabels: ["Session", "claude-sonnet-5"],
      theme: "dark" as const,
      showPlan: false,
      showTokens: false,
      graphStyle: "bar" as const,
      graphGroupBy: "provider" as const,
      graphShowBreakdown: true,
      graphShowTotal: true,
      graphShowDate: true,
      graphMetric: "price" as const,
      modelDisplay: { showPercent: true, showToday: false, showSevenDay: true, showThirtyDay: false },
    }

    await saveShareSettings(settings)

    await expect(loadShareSettings()).resolves.toEqual(settings)
  })
})

describe("mergeProviderSelection", () => {
  it("adds dropped ids to disabled and removes kept ids", () => {
    const result = mergeProviderSelection(
      { order: ["claude", "codex"], disabled: ["claude", "grok"] },
      ["claude"],
      ["codex"]
    )
    expect(result.order).toEqual(["claude", "codex"])
    expect(result.disabled).toEqual(["grok", "codex"])
  })

  it("dedupes ids already disabled", () => {
    const result = mergeProviderSelection({ order: [], disabled: ["codex"] }, [], ["codex", "codex"])
    expect(result.disabled).toEqual(["codex"])
  })

  it("leaves settings unchanged for empty keep and drop", () => {
    const settings = { order: ["claude"], disabled: ["grok"] }
    expect(mergeProviderSelection(settings, [], [])).toEqual(settings)
  })
})
