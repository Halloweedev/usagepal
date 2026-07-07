import { useCallback } from "react"
import {
  cycleMultiTrayProviderCount,
  saveDisplayMode,
  saveMenubarIconStyle,
  saveMenubarMetric,
  saveMultiTrayDisplayMode,
  saveMultiTrayProviderCount,
  saveResetTimerDisplayMode,
  saveThemeMode,
  saveTimeFormatMode,
  type DisplayMode,
  type MenubarIconStyle,
  type MenubarMetric,
  type MultiTrayDisplayMode,
  type MultiTrayProviderCount,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type TimeFormatMode,
} from "@/lib/settings"

type ScheduleTrayIconUpdate = (reason: "probe" | "settings" | "init", delayMs?: number) => void

type UseSettingsDisplayActionsArgs = {
  menubarIconStyle: MenubarIconStyle
  multiTrayProviderCount: MultiTrayProviderCount
  setThemeMode: (value: ThemeMode) => void
  setDisplayMode: (value: DisplayMode) => void
  resetTimerDisplayMode: ResetTimerDisplayMode
  setResetTimerDisplayMode: (value: ResetTimerDisplayMode) => void
  setTimeFormatMode: (value: TimeFormatMode) => void
  setMenubarIconStyle: (value: MenubarIconStyle) => void
  setMenubarMetric: (value: MenubarMetric) => void
  setMultiTrayProviderCount: (value: MultiTrayProviderCount) => void
  setMultiTrayDisplayMode: (value: MultiTrayDisplayMode) => void
  scheduleTrayIconUpdate: ScheduleTrayIconUpdate
}

export function useSettingsDisplayActions({
  menubarIconStyle,
  multiTrayProviderCount,
  setThemeMode,
  setDisplayMode,
  resetTimerDisplayMode,
  setResetTimerDisplayMode,
  setTimeFormatMode,
  setMenubarIconStyle,
  setMenubarMetric,
  setMultiTrayProviderCount,
  setMultiTrayDisplayMode,
  scheduleTrayIconUpdate,
}: UseSettingsDisplayActionsArgs) {
  const handleThemeModeChange = useCallback((mode: ThemeMode) => {
    setThemeMode(mode)
    void saveThemeMode(mode).catch((error) => {
      console.error("Failed to save theme mode:", error)
    })
  }, [setThemeMode])

  const handleDisplayModeChange = useCallback((mode: DisplayMode) => {
    setDisplayMode(mode)
    scheduleTrayIconUpdate("settings", 0)
    void saveDisplayMode(mode).catch((error) => {
      console.error("Failed to save display mode:", error)
    })
  }, [scheduleTrayIconUpdate, setDisplayMode])

  const handleResetTimerDisplayModeChange = useCallback((mode: ResetTimerDisplayMode) => {
    setResetTimerDisplayMode(mode)
    void saveResetTimerDisplayMode(mode).catch((error) => {
      console.error("Failed to save reset timer display mode:", error)
    })
  }, [setResetTimerDisplayMode])

  const handleResetTimerDisplayModeToggle = useCallback(() => {
    const next = resetTimerDisplayMode === "relative" ? "absolute" : "relative"
    handleResetTimerDisplayModeChange(next)
  }, [handleResetTimerDisplayModeChange, resetTimerDisplayMode])

  const handleTimeFormatModeChange = useCallback((mode: TimeFormatMode) => {
    setTimeFormatMode(mode)
    void saveTimeFormatMode(mode).catch((error) => {
      console.error("Failed to save time format mode:", error)
    })
  }, [setTimeFormatMode])

  const handleMenubarIconStyleChange = useCallback((style: MenubarIconStyle) => {
    setMenubarIconStyle(style)
    scheduleTrayIconUpdate("settings", 0)
    void saveMenubarIconStyle(style).catch((error) => {
      console.error("Failed to save menubar icon style:", error)
    })
  }, [scheduleTrayIconUpdate, setMenubarIconStyle])

  const handleMultiMenubarClick = useCallback(() => {
    if (menubarIconStyle === "multi") {
      const nextCount = cycleMultiTrayProviderCount(multiTrayProviderCount)
      setMultiTrayProviderCount(nextCount)
      scheduleTrayIconUpdate("settings", 0)
      void saveMultiTrayProviderCount(nextCount).catch((error) => {
        console.error("Failed to save multi tray provider count:", error)
      })
      return
    }

    setMenubarIconStyle("multi")
    scheduleTrayIconUpdate("settings", 0)
    void saveMenubarIconStyle("multi").catch((error) => {
      console.error("Failed to save menubar icon style:", error)
    })
  }, [
    menubarIconStyle,
    multiTrayProviderCount,
    scheduleTrayIconUpdate,
    setMenubarIconStyle,
    setMultiTrayProviderCount,
  ])

  const handleMultiTrayDisplayModeChange = useCallback((mode: MultiTrayDisplayMode) => {
    setMultiTrayDisplayMode(mode)
    scheduleTrayIconUpdate("settings", 0)
    void saveMultiTrayDisplayMode(mode).catch((error) => {
      console.error("Failed to save multi tray display mode:", error)
    })
  }, [scheduleTrayIconUpdate, setMultiTrayDisplayMode])

  const handleMenubarMetricChange = useCallback((metric: MenubarMetric) => {
    setMenubarMetric(metric)
    scheduleTrayIconUpdate("settings", 0)
    void saveMenubarMetric(metric).catch((error) => {
      console.error("Failed to save menubar metric:", error)
    })
  }, [scheduleTrayIconUpdate, setMenubarMetric])

  return {
    handleThemeModeChange,
    handleDisplayModeChange,
    handleResetTimerDisplayModeChange,
    handleResetTimerDisplayModeToggle,
    handleTimeFormatModeChange,
    handleMenubarIconStyleChange,
    handleMultiMenubarClick,
    handleMultiTrayDisplayModeChange,
    handleMenubarMetricChange,
  }
}
