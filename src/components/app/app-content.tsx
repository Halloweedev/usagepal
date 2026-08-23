import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { OverviewPage } from "@/pages/overview"
import { ProviderDetailPage } from "@/pages/provider-detail"
import { SettingsPage } from "@/pages/settings"
import { SharePage } from "@/pages/share"
import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"
import {
  flattenAccountSources,
  type GroupedProviderView,
} from "@/hooks/app/group-provider-views"
import type { SettingsPluginState } from "@/hooks/app/use-settings-plugin-list"
import type { TraySettingsPreview } from "@/hooks/app/use-tray-icon"
import { useAppPreferencesStore } from "@/stores/app-preferences-store"
import { useAppUiStore } from "@/stores/app-ui-store"
import type {
  AutoUpdateIntervalMinutes,
  DisplayMode,
  GlobalShortcut,
  MenubarIconStyle,
  MenubarMetric,
  MultiTrayDisplayMode,
  ResetTimerDisplayMode,
  ThemeMode,
  TimeFormatMode,
} from "@/lib/settings"

type AppContentDerivedProps = {
  displayPlugins: DisplayPluginState[]
  groupedPlugins: GroupedProviderView[]
  settingsPlugins: SettingsPluginState[]
  selectedPlugin: DisplayPluginState | null
}

export type AppContentActionProps = {
  onRetryPlugin: (id: string) => void
  onReorder: (orderedIds: string[]) => void
  onToggle: (id: string) => void
  onSelectAccount: (providerId: string, accountId: string | null) => void
  onAddAccount: (providerId: string) => void
  onAutoUpdateIntervalChange: (value: AutoUpdateIntervalMinutes) => void
  onThemeModeChange: (mode: ThemeMode) => void
  onDisplayModeChange: (mode: DisplayMode) => void
  onUsageValueToggle: () => void
  onResetTimerDisplayModeChange: (mode: ResetTimerDisplayMode) => void
  onResetTimerDisplayModeToggle: () => void
  onTimeFormatModeChange: (mode: TimeFormatMode) => void
  onMenubarIconStyleChange: (value: MenubarIconStyle) => void
  onMultiMenubarClick: () => void
  onMultiTrayDisplayModeChange: (value: MultiTrayDisplayMode) => void
  onMenubarMetricChange: (value: MenubarMetric) => void
  onOverviewSpendStripEnabledChange: (value: boolean) => void
  traySettingsPreview: TraySettingsPreview
  onGlobalShortcutChange: (value: GlobalShortcut) => void
  onStartOnLoginChange: (value: boolean) => void
  onBetaUpdatesEnabledChange: (value: boolean) => void
}

export type AppContentProps = AppContentDerivedProps & AppContentActionProps

export function AppContent({
  displayPlugins,
  groupedPlugins,
  settingsPlugins,
  selectedPlugin,
  onRetryPlugin,
  onReorder,
  onToggle,
  onSelectAccount,
  onAddAccount,
  onAutoUpdateIntervalChange,
  onThemeModeChange,
  onDisplayModeChange,
  onUsageValueToggle,
  onResetTimerDisplayModeChange,
  onResetTimerDisplayModeToggle,
  onTimeFormatModeChange,
  onMenubarIconStyleChange,
  onMultiMenubarClick,
  onMultiTrayDisplayModeChange,
  onMenubarMetricChange,
  onOverviewSpendStripEnabledChange,
  traySettingsPreview,
  onGlobalShortcutChange,
  onStartOnLoginChange,
  onBetaUpdatesEnabledChange,
}: AppContentProps) {
  const { activeView, setActiveView, setShowAbout } = useAppUiStore(
    useShallow((state) => ({
      activeView: state.activeView,
      setActiveView: state.setActiveView,
      setShowAbout: state.setShowAbout,
    }))
  )

  // Every account of every provider — the Share All-tab graph aggregates all
  // accounts' spend, not just each provider's shown account.
  const shareSources = useMemo(() => flattenAccountSources(groupedPlugins), [groupedPlugins])

  const {
    displayMode,
    resetTimerDisplayMode,
    timeFormatMode,
    menubarIconStyle,
    menubarMetric,
    multiTrayProviderCount,
    multiTrayDisplayMode,
    autoUpdateInterval,
    betaUpdatesEnabled,
    globalShortcut,
    themeMode,
    startOnLogin,
    overviewSpendStripEnabled,
  } = useAppPreferencesStore(
    useShallow((state) => ({
      displayMode: state.displayMode,
      resetTimerDisplayMode: state.resetTimerDisplayMode,
      timeFormatMode: state.timeFormatMode,
      menubarIconStyle: state.menubarIconStyle,
      menubarMetric: state.menubarMetric,
      multiTrayProviderCount: state.multiTrayProviderCount,
      multiTrayDisplayMode: state.multiTrayDisplayMode,
      autoUpdateInterval: state.autoUpdateInterval,
      betaUpdatesEnabled: state.betaUpdatesEnabled,
      globalShortcut: state.globalShortcut,
      themeMode: state.themeMode,
      startOnLogin: state.startOnLogin,
      overviewSpendStripEnabled: state.overviewSpendStripEnabled,
    }))
  )

  if (activeView === "home") {
    return (
      <OverviewPage
        groupedPlugins={groupedPlugins}
        onRetryPlugin={onRetryPlugin}
        onSelectAccount={onSelectAccount}
        onAddAccount={onAddAccount}
        displayMode={displayMode}
        resetTimerDisplayMode={resetTimerDisplayMode}
        timeFormatMode={timeFormatMode}
        overviewSpendStripEnabled={overviewSpendStripEnabled}
        onResetTimerDisplayModeToggle={onResetTimerDisplayModeToggle}
        onUsageValueToggle={onUsageValueToggle}
      />
    )
  }

  if (activeView === "settings") {
    return (
      <SettingsPage
        plugins={settingsPlugins}
        onReorder={onReorder}
        onToggle={onToggle}
        autoUpdateInterval={autoUpdateInterval}
        onAutoUpdateIntervalChange={onAutoUpdateIntervalChange}
        themeMode={themeMode}
        onThemeModeChange={onThemeModeChange}
        displayMode={displayMode}
        onDisplayModeChange={onDisplayModeChange}
        resetTimerDisplayMode={resetTimerDisplayMode}
        onResetTimerDisplayModeChange={onResetTimerDisplayModeChange}
        timeFormatMode={timeFormatMode}
        onTimeFormatModeChange={onTimeFormatModeChange}
        menubarIconStyle={menubarIconStyle}
        onMenubarIconStyleChange={onMenubarIconStyleChange}
        multiTrayProviderCount={multiTrayProviderCount}
        multiTrayDisplayMode={multiTrayDisplayMode}
        onMultiMenubarClick={onMultiMenubarClick}
        onMultiTrayDisplayModeChange={onMultiTrayDisplayModeChange}
        menubarMetric={menubarMetric}
        onMenubarMetricChange={onMenubarMetricChange}
        traySettingsPreview={traySettingsPreview}
        globalShortcut={globalShortcut}
        onGlobalShortcutChange={onGlobalShortcutChange}
        startOnLogin={startOnLogin}
        onStartOnLoginChange={onStartOnLoginChange}
        overviewSpendStripEnabled={overviewSpendStripEnabled}
        onOverviewSpendStripEnabledChange={onOverviewSpendStripEnabledChange}
        betaUpdatesEnabled={betaUpdatesEnabled}
        onBetaUpdatesEnabledChange={onBetaUpdatesEnabledChange}
        onShowStats={() => setActiveView("home")}
        onShowAbout={() => setShowAbout(true)}
      />
    )
  }

  if (activeView === "share") {
    return <SharePage plugins={displayPlugins} sources={shareSources} />
  }

  const handleRetry = selectedPlugin
    ? () => onRetryPlugin(selectedPlugin.meta.id)
    : /* v8 ignore next */ undefined

  const selectedGroup = selectedPlugin
    ? groupedPlugins.find((group) => group.meta.id === selectedPlugin.meta.id)
    : undefined

  return (
    <ProviderDetailPage
      plugin={selectedPlugin}
      accounts={selectedGroup?.accounts}
      activeIndex={selectedGroup?.activeIndex ?? 0}
      onSelectAccount={onSelectAccount}
      onAddAccount={onAddAccount}
      onRetry={handleRetry}
      displayMode={displayMode}
      resetTimerDisplayMode={resetTimerDisplayMode}
      timeFormatMode={timeFormatMode}
      onResetTimerDisplayModeToggle={onResetTimerDisplayModeToggle}
      onUsageValueToggle={onUsageValueToggle}
    />
  )
}
