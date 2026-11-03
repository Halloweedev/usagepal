import { useCallback, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { syncAutostart } from "@/lib/autostart"
import type { PluginMeta } from "@/lib/plugin-types"
import {
  arePluginSettingsEqual,
  DEFAULT_AUTO_UPDATE_INTERVAL,
  DEFAULT_BETA_UPDATES_ENABLED,
  DEFAULT_DISPLAY_MODE,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_MENUBAR_ICON_STYLE,
  DEFAULT_MENUBAR_METRIC,
  DEFAULT_MULTI_TRAY_DISPLAY_MODE,
  DEFAULT_MULTI_TRAY_PROVIDER_COUNT,
  DEFAULT_RESET_TIMER_DISPLAY_MODE,
  DEFAULT_START_ON_LOGIN,
  DEFAULT_THEME_MODE,
  DEFAULT_TIME_FORMAT_MODE,
  getEnabledPluginIds,
  loadAutoUpdateInterval,
  loadBetaUpdatesEnabled,
  loadDisplayMode,
  loadGlobalShortcut,
  loadMenubarIconStyle,
  loadMenubarMetric,
  loadMultiTrayDisplayMode,
  loadMultiTrayProviderCount,
  migrateLegacyTraySettings,
  migrateWindsurfToDevin,
  loadPluginSettings,
  loadResetTimerDisplayMode,
  loadStartOnLogin,
  loadThemeMode,
  loadTimeFormatMode,
  normalizePluginSettings,
  savePluginSettings,
  type AutoUpdateIntervalMinutes,
  type DisplayMode,
  type GlobalShortcut,
  type MenubarIconStyle,
  type MenubarMetric,
  type MultiTrayDisplayMode,
  type MultiTrayProviderCount,
  type PluginSettings,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type TimeFormatMode,
} from "@/lib/settings"

type UseSettingsBootstrapArgs = {
  setPluginSettings: (value: PluginSettings | null) => void
  setPluginsMeta: (value: PluginMeta[]) => void
  setAutoUpdateInterval: (value: AutoUpdateIntervalMinutes) => void
  setBetaUpdatesEnabled: (value: boolean) => void
  setThemeMode: (value: ThemeMode) => void
  setDisplayMode: (value: DisplayMode) => void
  setResetTimerDisplayMode: (value: ResetTimerDisplayMode) => void
  setTimeFormatMode: (value: TimeFormatMode) => void
  setGlobalShortcut: (value: GlobalShortcut) => void
  setStartOnLogin: (value: boolean) => void
  setMenubarIconStyle: (value: MenubarIconStyle) => void
  setMenubarMetric: (value: MenubarMetric) => void
  setMultiTrayProviderCount: (value: MultiTrayProviderCount) => void
  setMultiTrayDisplayMode: (value: MultiTrayDisplayMode) => void
  setLoadingForPlugins: (ids: string[]) => void
  setErrorForPlugins: (ids: string[], error: string) => void
  startBatch: (pluginIds?: string[]) => Promise<string[] | undefined>
}

export function useSettingsBootstrap({
  setPluginSettings,
  setPluginsMeta,
  setAutoUpdateInterval,
  setBetaUpdatesEnabled,
  setThemeMode,
  setDisplayMode,
  setResetTimerDisplayMode,
  setTimeFormatMode,
  setGlobalShortcut,
  setStartOnLogin,
  setMenubarIconStyle,
  setMenubarMetric,
  setMultiTrayProviderCount,
  setMultiTrayDisplayMode,
  setLoadingForPlugins,
  setErrorForPlugins,
  startBatch,
}: UseSettingsBootstrapArgs) {
  const applyStartOnLogin = useCallback((value: boolean) => syncAutostart(value), [])

  useEffect(() => {
    let isMounted = true

    const loadSettings = async () => {
      try {
        const availablePlugins = await invoke<PluginMeta[]>("list_plugins")
        if (!isMounted) return
        setPluginsMeta(availablePlugins)

        const storedSettings = await loadPluginSettings()
        const migratedSettings = migrateWindsurfToDevin(storedSettings)
        const normalized = normalizePluginSettings(migratedSettings, availablePlugins)
        if (!arePluginSettingsEqual(storedSettings, normalized)) {
          await savePluginSettings(normalized)
        }

        let storedInterval = DEFAULT_AUTO_UPDATE_INTERVAL
        try {
          storedInterval = await loadAutoUpdateInterval()
        } catch (error) {
          console.error("Failed to load auto-update interval:", error)
        }

        let storedBetaUpdatesEnabled = DEFAULT_BETA_UPDATES_ENABLED
        try {
          storedBetaUpdatesEnabled = await loadBetaUpdatesEnabled()
        } catch (error) {
          console.error("Failed to load beta updates setting:", error)
        }

        let storedThemeMode = DEFAULT_THEME_MODE
        try {
          storedThemeMode = await loadThemeMode()
        } catch (error) {
          console.error("Failed to load theme mode:", error)
        }

        let storedDisplayMode = DEFAULT_DISPLAY_MODE
        try {
          storedDisplayMode = await loadDisplayMode()
        } catch (error) {
          console.error("Failed to load display mode:", error)
        }

        let storedResetTimerDisplayMode = DEFAULT_RESET_TIMER_DISPLAY_MODE
        try {
          storedResetTimerDisplayMode = await loadResetTimerDisplayMode()
        } catch (error) {
          console.error("Failed to load reset timer display mode:", error)
        }

        let storedTimeFormatMode = DEFAULT_TIME_FORMAT_MODE
        try {
          storedTimeFormatMode = await loadTimeFormatMode()
        } catch (error) {
          console.error("Failed to load time format mode:", error)
        }

        let storedGlobalShortcut = DEFAULT_GLOBAL_SHORTCUT
        try {
          storedGlobalShortcut = await loadGlobalShortcut()
        } catch (error) {
          console.error("Failed to load global shortcut:", error)
        }

        let storedStartOnLogin = DEFAULT_START_ON_LOGIN
        try {
          storedStartOnLogin = await loadStartOnLogin()
        } catch (error) {
          console.error("Failed to load start on login:", error)
        }

        try {
          await applyStartOnLogin(storedStartOnLogin)
        } catch (error) {
          console.error("Failed to apply start on login setting:", error)
        }
        try {
          await migrateLegacyTraySettings()
        } catch (error) {
          console.error("Failed to migrate legacy tray settings:", error)
        }

        let storedMenubarIconStyle = DEFAULT_MENUBAR_ICON_STYLE
        try {
          storedMenubarIconStyle = await loadMenubarIconStyle()
        } catch (error) {
          console.error("Failed to load menubar icon style:", error)
        }

        let storedMenubarMetric = DEFAULT_MENUBAR_METRIC
        try {
          storedMenubarMetric = await loadMenubarMetric()
        } catch (error) {
          console.error("Failed to load menubar metric:", error)
        }

        let storedMultiTrayProviderCount = DEFAULT_MULTI_TRAY_PROVIDER_COUNT
        try {
          storedMultiTrayProviderCount = await loadMultiTrayProviderCount()
        } catch (error) {
          console.error("Failed to load multi tray provider count:", error)
        }

        let storedMultiTrayDisplayMode = DEFAULT_MULTI_TRAY_DISPLAY_MODE
        try {
          storedMultiTrayDisplayMode = await loadMultiTrayDisplayMode()
        } catch (error) {
          console.error("Failed to load multi tray display mode:", error)
        }

        if (isMounted) {
          setPluginSettings(normalized)
          setAutoUpdateInterval(storedInterval)
          setBetaUpdatesEnabled(storedBetaUpdatesEnabled)
          setThemeMode(storedThemeMode)
          setDisplayMode(storedDisplayMode)
          setResetTimerDisplayMode(storedResetTimerDisplayMode)
          setTimeFormatMode(storedTimeFormatMode)
          setGlobalShortcut(storedGlobalShortcut)
          setStartOnLogin(storedStartOnLogin)
          setMenubarIconStyle(storedMenubarIconStyle)
          setMenubarMetric(storedMenubarMetric)
          setMultiTrayProviderCount(storedMultiTrayProviderCount)
          setMultiTrayDisplayMode(storedMultiTrayDisplayMode)

          const enabledIds = getEnabledPluginIds(normalized)
          setLoadingForPlugins(enabledIds)
          try {
            await startBatch(enabledIds)
          } catch (error) {
            console.error("Failed to start probe batch:", error)
            if (isMounted) {
              setErrorForPlugins(enabledIds, "Failed to start probe")
            }
          }
        }
      } catch (e) {
        console.error("Failed to load plugin settings:", e)
      }
    }

    loadSettings()

    return () => {
      isMounted = false
    }
  }, [
    applyStartOnLogin,
    setAutoUpdateInterval,
    setBetaUpdatesEnabled,
    setDisplayMode,
    setErrorForPlugins,
    setGlobalShortcut,
    setLoadingForPlugins,
    setMenubarIconStyle,
    setMenubarMetric,
    setMultiTrayProviderCount,
    setMultiTrayDisplayMode,
    migrateWindsurfToDevin,
    migrateLegacyTraySettings,
    setPluginSettings,
    setPluginsMeta,
    setResetTimerDisplayMode,
    setStartOnLogin,
    setThemeMode,
    setTimeFormatMode,
    startBatch,
  ])

  return {
    applyStartOnLogin,
  }
}
