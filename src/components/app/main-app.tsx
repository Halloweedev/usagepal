import { useCallback, useEffect, useRef } from "react"
import { useShallow } from "zustand/react/shallow"
import { AppShell } from "@/components/app/app-shell"
import { useAppPluginViews } from "@/hooks/app/use-app-plugin-views"
import { useProbe } from "@/hooks/app/use-probe"
import { usePaceNotifications } from "@/hooks/app/use-pace-notifications"
import { usePluginSettingsRefresh } from "@/hooks/app/use-plugin-settings-refresh"
import { useSettingsBootstrap } from "@/hooks/app/use-settings-bootstrap"
import { useSettingsDisplayActions } from "@/hooks/app/use-settings-display-actions"
import { useSettingsPluginActions } from "@/hooks/app/use-settings-plugin-actions"
import { useSettingsPluginList } from "@/hooks/app/use-settings-plugin-list"
import { useSettingsSystemActions } from "@/hooks/app/use-settings-system-actions"
import { useSettingsTheme } from "@/hooks/app/use-settings-theme"
import { useTrayIcon } from "@/hooks/app/use-tray-icon"
import { REFRESH_COOLDOWN_MS, savePluginSettings } from "@/lib/settings"
import { type PluginContextAction } from "@/components/side-nav"
import { useAppPluginStore } from "@/stores/app-plugin-store"
import { useAppPreferencesStore } from "@/stores/app-preferences-store"
import { useAppShareStore } from "@/stores/app-share-store"
import { useAppUiStore } from "@/stores/app-ui-store"

const TRAY_PROBE_DEBOUNCE_MS = 500
const TRAY_SETTINGS_DEBOUNCE_MS = 2000

export function MainApp() {
  const {
    activeView,
    setActiveView,
  } = useAppUiStore(
    useShallow((state) => ({
      activeView: state.activeView,
      setActiveView: state.setActiveView,
    }))
  )

  const {
    pluginsMeta,
    setPluginsMeta,
    pluginSettings,
    setPluginSettings,
  } = useAppPluginStore(
    useShallow((state) => ({
      pluginsMeta: state.pluginsMeta,
      setPluginsMeta: state.setPluginsMeta,
      pluginSettings: state.pluginSettings,
      setPluginSettings: state.setPluginSettings,
    }))
  )

  const {
    autoUpdateInterval,
    betaUpdatesEnabled,
    setAutoUpdateInterval,
    setBetaUpdatesEnabled,
    themeMode,
    setThemeMode,
    displayMode,
    setDisplayMode,
    menubarIconStyle,
    setMenubarIconStyle,
    menubarMetric,
    setMenubarMetric,
    multiTrayProviderCount,
    setMultiTrayProviderCount,
    multiTrayDisplayMode,
    setMultiTrayDisplayMode,
    resetTimerDisplayMode,
    setResetTimerDisplayMode,
    setOverviewSpendStripEnabled,
    setTimeFormatMode,
    setGlobalShortcut,
    setStartOnLogin,
  } = useAppPreferencesStore(
    useShallow((state) => ({
      autoUpdateInterval: state.autoUpdateInterval,
      betaUpdatesEnabled: state.betaUpdatesEnabled,
      setAutoUpdateInterval: state.setAutoUpdateInterval,
      setBetaUpdatesEnabled: state.setBetaUpdatesEnabled,
      themeMode: state.themeMode,
      setThemeMode: state.setThemeMode,
      displayMode: state.displayMode,
      setDisplayMode: state.setDisplayMode,
      menubarIconStyle: state.menubarIconStyle,
      setMenubarIconStyle: state.setMenubarIconStyle,
      menubarMetric: state.menubarMetric,
      setMenubarMetric: state.setMenubarMetric,
      multiTrayProviderCount: state.multiTrayProviderCount,
      setMultiTrayProviderCount: state.setMultiTrayProviderCount,
      multiTrayDisplayMode: state.multiTrayDisplayMode,
      setMultiTrayDisplayMode: state.setMultiTrayDisplayMode,
      resetTimerDisplayMode: state.resetTimerDisplayMode,
      setResetTimerDisplayMode: state.setResetTimerDisplayMode,
      setOverviewSpendStripEnabled: state.setOverviewSpendStripEnabled,
      setTimeFormatMode: state.setTimeFormatMode,
      setGlobalShortcut: state.setGlobalShortcut,
      setStartOnLogin: state.setStartOnLogin,
    }))
  )

  const scheduleProbeTrayUpdateRef = useRef<() => void>(() => {})
  const handleProbeResult = useCallback(() => {
    scheduleProbeTrayUpdateRef.current()
  }, [])

  const {
    pluginStates,
    setLoadingForPlugins,
    setErrorForPlugins,
    startBatch,
    autoUpdateNextAt,
    setAutoUpdateNextAt,
    handleRetryPlugin,
    handleRefreshAll,
  } = useProbe({
    pluginSettings,
    autoUpdateInterval,
    onProbeResult: handleProbeResult,
  })

  usePaceNotifications(pluginStates)

  const hydrateShareSettings = useAppShareStore((s) => s.hydrate)
  useEffect(() => {
    void hydrateShareSettings()
  }, [hydrateShareSettings])

  const { scheduleTrayIconUpdate, traySettingsPreview } = useTrayIcon({
    pluginsMeta,
    pluginSettings,
    pluginStates,
    displayMode,
    menubarIconStyle,
    menubarMetric,
    multiTrayProviderCount,
    multiTrayDisplayMode,
    activeView,
  })

  useEffect(() => {
    scheduleProbeTrayUpdateRef.current = () => {
      scheduleTrayIconUpdate("probe", TRAY_PROBE_DEBOUNCE_MS)
    }
  }, [scheduleTrayIconUpdate])

  usePluginSettingsRefresh({
    pluginSettings,
    setPluginSettings,
    setLoadingForPlugins,
    setErrorForPlugins,
    startBatch,
    scheduleTrayIconUpdate,
  })

  const { applyStartOnLogin } = useSettingsBootstrap({
    setPluginSettings,
    setPluginsMeta,
    setAutoUpdateInterval,
    setBetaUpdatesEnabled,
    setThemeMode,
    setDisplayMode,
    setMenubarIconStyle,
    setMenubarMetric,
    setMultiTrayProviderCount,
    setMultiTrayDisplayMode,
    setResetTimerDisplayMode,
    setOverviewSpendStripEnabled,
    setTimeFormatMode,
    setGlobalShortcut,
    setStartOnLogin,
    setLoadingForPlugins,
    setErrorForPlugins,
    startBatch,
  })

  useSettingsTheme(themeMode)

  const {
    handleThemeModeChange,
    handleDisplayModeChange,
    handleDisplayModeToggle,
    handleResetTimerDisplayModeChange,
    handleResetTimerDisplayModeToggle,
    handleTimeFormatModeChange,
    handleMenubarIconStyleChange,
    handleMultiMenubarClick,
    handleMultiTrayDisplayModeChange,
    handleMenubarMetricChange,
    handleOverviewSpendStripEnabledChange,
  } = useSettingsDisplayActions({
    menubarIconStyle,
    multiTrayProviderCount,
    setThemeMode,
    displayMode,
    setDisplayMode,
    resetTimerDisplayMode,
    setResetTimerDisplayMode,
    setTimeFormatMode,
    setMenubarIconStyle,
    setMenubarMetric,
    setMultiTrayProviderCount,
    setMultiTrayDisplayMode,
    setOverviewSpendStripEnabled,
    scheduleTrayIconUpdate,
  })

  const {
    handleAutoUpdateIntervalChange,
    handleBetaUpdatesEnabledChange,
    handleGlobalShortcutChange,
    handleStartOnLoginChange,
  } = useSettingsSystemActions({
    pluginSettings,
    setAutoUpdateInterval,
    setAutoUpdateNextAt,
    setBetaUpdatesEnabled,
    setGlobalShortcut,
    setStartOnLogin,
    applyStartOnLogin,
  })

  const {
    handleReorder,
    handleToggle,
  } = useSettingsPluginActions({
    pluginSettings,
    setPluginSettings,
    setLoadingForPlugins,
    setErrorForPlugins,
    startBatch,
    scheduleTrayIconUpdate,
  })

  const settingsPlugins = useSettingsPluginList({
    pluginSettings,
    pluginsMeta,
  })

  const { displayPlugins, navPlugins, selectedPlugin } = useAppPluginViews({
    activeView,
    setActiveView,
    pluginSettings,
    pluginsMeta,
    pluginStates,
  })

  const pluginSettingsRef = useRef(pluginSettings)
  useEffect(() => {
    pluginSettingsRef.current = pluginSettings
  }, [pluginSettings])

  const handleShareClick = useCallback(() => {
    setActiveView("share")
  }, [setActiveView])

  const handlePluginContextAction = useCallback(
    (pluginId: string, action: PluginContextAction) => {
      if (action === "reload") {
        handleRetryPlugin(pluginId)
        return
      }

      const currentSettings = pluginSettingsRef.current
      if (!currentSettings) return
      const alreadyDisabled = currentSettings.disabled.includes(pluginId)
      if (alreadyDisabled) return

      const nextSettings = {
        ...currentSettings,
        disabled: [...currentSettings.disabled, pluginId],
      }
      setPluginSettings(nextSettings)
      scheduleTrayIconUpdate("settings", TRAY_SETTINGS_DEBOUNCE_MS)
      void savePluginSettings(nextSettings).catch((error) => {
        console.error("Failed to save plugin toggle:", error)
      })

      if (activeView === pluginId) {
        setActiveView("home")
      }
    },
    [activeView, handleRetryPlugin, scheduleTrayIconUpdate, setActiveView, setPluginSettings]
  )

  const isPluginRefreshAvailable = useCallback(
    (pluginId: string) => {
      const pluginState = pluginStates[pluginId]
      if (!pluginState) return true
      if (pluginState.loading) return false
      if (!pluginState.lastManualRefreshAt) return true
      return Date.now() - pluginState.lastManualRefreshAt >= REFRESH_COOLDOWN_MS
    },
    [pluginStates]
  )

  return (
    <AppShell
      onRefreshAll={handleRefreshAll}
      navPlugins={navPlugins}
      displayPlugins={displayPlugins}
      settingsPlugins={settingsPlugins}
      autoUpdateNextAt={autoUpdateNextAt}
      betaUpdatesEnabled={betaUpdatesEnabled}
      selectedPlugin={selectedPlugin}
      onPluginContextAction={handlePluginContextAction}
      isPluginRefreshAvailable={isPluginRefreshAvailable}
      onNavReorder={handleReorder}
      onShareClick={handleShareClick}
      appContentProps={{
        onRetryPlugin: handleRetryPlugin,
        onReorder: handleReorder,
        onToggle: handleToggle,
        onAutoUpdateIntervalChange: handleAutoUpdateIntervalChange,
        onBetaUpdatesEnabledChange: handleBetaUpdatesEnabledChange,
        onThemeModeChange: handleThemeModeChange,
        onDisplayModeChange: handleDisplayModeChange,
        onUsageValueToggle: handleDisplayModeToggle,
        onResetTimerDisplayModeChange: handleResetTimerDisplayModeChange,
        onResetTimerDisplayModeToggle: handleResetTimerDisplayModeToggle,
        onTimeFormatModeChange: handleTimeFormatModeChange,
        onMenubarIconStyleChange: handleMenubarIconStyleChange,
        onMultiMenubarClick: handleMultiMenubarClick,
        onMultiTrayDisplayModeChange: handleMultiTrayDisplayModeChange,
        onMenubarMetricChange: handleMenubarMetricChange,
        onOverviewSpendStripEnabledChange: handleOverviewSpendStripEnabledChange,
        traySettingsPreview,
        onGlobalShortcutChange: handleGlobalShortcutChange,
        onStartOnLoginChange: handleStartOnLoginChange,
      }}
    />
  )
}
