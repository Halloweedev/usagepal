import { create } from "zustand"
import {
  DEFAULT_AUTO_UPDATE_INTERVAL,
  DEFAULT_BETA_UPDATES_ENABLED,
  DEFAULT_DISPLAY_MODE,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_MENUBAR_ICON_STYLE,
  DEFAULT_MENUBAR_METRIC,
  DEFAULT_MULTI_TRAY_DISPLAY_MODE,
  DEFAULT_MULTI_TRAY_PROVIDER_COUNT,
  DEFAULT_OVERVIEW_SPEND_STRIP_ENABLED,
  DEFAULT_RESET_TIMER_DISPLAY_MODE,
  DEFAULT_START_ON_LOGIN,
  DEFAULT_THEME_MODE,
  DEFAULT_TIME_FORMAT_MODE,
  type AutoUpdateIntervalMinutes,
  type DisplayMode,
  type GlobalShortcut,
  type MenubarIconStyle,
  type MenubarMetric,
  type MultiTrayDisplayMode,
  type MultiTrayProviderCount,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type TimeFormatMode,
} from "@/lib/settings"

type AppPreferencesStore = {
  autoUpdateInterval: AutoUpdateIntervalMinutes
  betaUpdatesEnabled: boolean
  themeMode: ThemeMode
  displayMode: DisplayMode
  resetTimerDisplayMode: ResetTimerDisplayMode
  timeFormatMode: TimeFormatMode
  globalShortcut: GlobalShortcut
  startOnLogin: boolean
  menubarIconStyle: MenubarIconStyle
  menubarMetric: MenubarMetric
  multiTrayProviderCount: MultiTrayProviderCount
  multiTrayDisplayMode: MultiTrayDisplayMode
  overviewSpendStripEnabled: boolean
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
  setOverviewSpendStripEnabled: (value: boolean) => void
  resetState: () => void
}

const initialState = {
  autoUpdateInterval: DEFAULT_AUTO_UPDATE_INTERVAL,
  betaUpdatesEnabled: DEFAULT_BETA_UPDATES_ENABLED,
  themeMode: DEFAULT_THEME_MODE,
  displayMode: DEFAULT_DISPLAY_MODE,
  resetTimerDisplayMode: DEFAULT_RESET_TIMER_DISPLAY_MODE,
  timeFormatMode: DEFAULT_TIME_FORMAT_MODE,
  globalShortcut: DEFAULT_GLOBAL_SHORTCUT,
  startOnLogin: DEFAULT_START_ON_LOGIN,
  menubarIconStyle: DEFAULT_MENUBAR_ICON_STYLE,
  menubarMetric: DEFAULT_MENUBAR_METRIC,
  multiTrayProviderCount: DEFAULT_MULTI_TRAY_PROVIDER_COUNT,
  multiTrayDisplayMode: DEFAULT_MULTI_TRAY_DISPLAY_MODE,
  overviewSpendStripEnabled: DEFAULT_OVERVIEW_SPEND_STRIP_ENABLED,
}

export const useAppPreferencesStore = create<AppPreferencesStore>((set) => ({
  ...initialState,
  setAutoUpdateInterval: (value) => set({ autoUpdateInterval: value }),
  setBetaUpdatesEnabled: (value) => set({ betaUpdatesEnabled: value }),
  setThemeMode: (value) => set({ themeMode: value }),
  setDisplayMode: (value) => set({ displayMode: value }),
  setResetTimerDisplayMode: (value) => set({ resetTimerDisplayMode: value }),
  setTimeFormatMode: (value) => set({ timeFormatMode: value }),
  setGlobalShortcut: (value) => set({ globalShortcut: value }),
  setStartOnLogin: (value) => set({ startOnLogin: value }),
  setMenubarIconStyle: (value) => set({ menubarIconStyle: value }),
  setMenubarMetric: (value) => set({ menubarMetric: value }),
  setMultiTrayProviderCount: (value) => set({ multiTrayProviderCount: value }),
  setMultiTrayDisplayMode: (value) => set({ multiTrayDisplayMode: value }),
  setOverviewSpendStripEnabled: (value) => set({ overviewSpendStripEnabled: value }),
  resetState: () => set(initialState),
}))
