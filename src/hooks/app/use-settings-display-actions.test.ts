import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  saveDisplayModeMock,
  saveMenubarIconStyleMock,
  saveMenubarMetricMock,
  saveMultiTrayDisplayModeMock,
  saveMultiTrayProviderCountMock,
  saveResetTimerDisplayModeMock,
  saveThemeModeMock,
  saveTimeFormatModeMock,
} = vi.hoisted(() => ({
  saveThemeModeMock: vi.fn(),
  saveDisplayModeMock: vi.fn(),
  saveMenubarIconStyleMock: vi.fn(),
  saveMenubarMetricMock: vi.fn(),
  saveMultiTrayDisplayModeMock: vi.fn(),
  saveMultiTrayProviderCountMock: vi.fn(),
  saveResetTimerDisplayModeMock: vi.fn(),
  saveTimeFormatModeMock: vi.fn(),
}))

vi.mock("@/lib/settings", () => ({
  cycleMultiTrayProviderCount: (current: 2 | 3 | 4) => (current === 2 ? 3 : current === 3 ? 4 : 2),
  saveThemeMode: saveThemeModeMock,
  saveDisplayMode: saveDisplayModeMock,
  saveMenubarIconStyle: saveMenubarIconStyleMock,
  saveMenubarMetric: saveMenubarMetricMock,
  saveMultiTrayDisplayMode: saveMultiTrayDisplayModeMock,
  saveMultiTrayProviderCount: saveMultiTrayProviderCountMock,
  saveResetTimerDisplayMode: saveResetTimerDisplayModeMock,
  saveTimeFormatMode: saveTimeFormatModeMock,
}))

import { useSettingsDisplayActions } from "@/hooks/app/use-settings-display-actions"

describe("useSettingsDisplayActions", () => {
  beforeEach(() => {
    saveThemeModeMock.mockReset()
    saveDisplayModeMock.mockReset()
    saveMenubarIconStyleMock.mockReset()
    saveMenubarMetricMock.mockReset()
    saveMultiTrayDisplayModeMock.mockReset()
    saveMultiTrayProviderCountMock.mockReset()
    saveResetTimerDisplayModeMock.mockReset()
    saveTimeFormatModeMock.mockReset()
    saveThemeModeMock.mockResolvedValue(undefined)
    saveDisplayModeMock.mockResolvedValue(undefined)
    saveMenubarIconStyleMock.mockResolvedValue(undefined)
    saveMenubarMetricMock.mockResolvedValue(undefined)
    saveMultiTrayDisplayModeMock.mockResolvedValue(undefined)
    saveMultiTrayProviderCountMock.mockResolvedValue(undefined)
    saveResetTimerDisplayModeMock.mockResolvedValue(undefined)
    saveTimeFormatModeMock.mockResolvedValue(undefined)
  })

  const baseArgs = {
    menubarIconStyle: "provider" as const,
    multiTrayProviderCount: 3 as const,
    setThemeMode: vi.fn(),
    setDisplayMode: vi.fn(),
    resetTimerDisplayMode: "relative" as const,
    setResetTimerDisplayMode: vi.fn(),
    setTimeFormatMode: vi.fn(),
    setMenubarIconStyle: vi.fn(),
    setMenubarMetric: vi.fn(),
    setMultiTrayProviderCount: vi.fn(),
    setMultiTrayDisplayMode: vi.fn(),
    scheduleTrayIconUpdate: vi.fn(),
  }

  it("applies display-related setting changes", () => {
    const setThemeMode = vi.fn()
    const setDisplayMode = vi.fn()
    const setResetTimerDisplayMode = vi.fn()
    const setTimeFormatMode = vi.fn()
    const setMenubarMetric = vi.fn()
    const scheduleTrayIconUpdate = vi.fn()

    const { result } = renderHook(() =>
      useSettingsDisplayActions({
        ...baseArgs,
        setThemeMode,
        setDisplayMode,
        setResetTimerDisplayMode,
        setTimeFormatMode,
        setMenubarMetric,
        scheduleTrayIconUpdate,
      })
    )

    act(() => {
      result.current.handleThemeModeChange("dark")
      result.current.handleDisplayModeChange("used")
      result.current.handleResetTimerDisplayModeChange("absolute")
      result.current.handleTimeFormatModeChange("24h")
      result.current.handleMenubarMetricChange("weekly")
    })

    expect(setThemeMode).toHaveBeenCalledWith("dark")
    expect(setDisplayMode).toHaveBeenCalledWith("used")
    expect(setResetTimerDisplayMode).toHaveBeenCalledWith("absolute")
    expect(setTimeFormatMode).toHaveBeenCalledWith("24h")
    expect(setMenubarMetric).toHaveBeenCalledWith("weekly")
    expect(scheduleTrayIconUpdate).toHaveBeenCalledWith("settings", 0)

    expect(saveThemeModeMock).toHaveBeenCalledWith("dark")
    expect(saveDisplayModeMock).toHaveBeenCalledWith("used")
    expect(saveResetTimerDisplayModeMock).toHaveBeenCalledWith("absolute")
    expect(saveTimeFormatModeMock).toHaveBeenCalledWith("24h")
    expect(saveMenubarMetricMock).toHaveBeenCalledWith("weekly")
  })

  it("toggles reset timer mode in both directions", () => {
    const setResetTimerDisplayMode = vi.fn()

    const { result, rerender } = renderHook(
      ({ mode }: { mode: "relative" | "absolute" }) =>
        useSettingsDisplayActions({
          ...baseArgs,
          resetTimerDisplayMode: mode,
          setResetTimerDisplayMode,
        }),
      { initialProps: { mode: "relative" as const } }
    )

    act(() => {
      result.current.handleResetTimerDisplayModeToggle()
    })
    expect(setResetTimerDisplayMode).toHaveBeenCalledWith("absolute")

    rerender({ mode: "absolute" })
    act(() => {
      result.current.handleResetTimerDisplayModeToggle()
    })
    expect(setResetTimerDisplayMode).toHaveBeenCalledWith("relative")
  })

  it("logs persistence failures", async () => {
    const themeError = new Error("theme failed")
    const displayError = new Error("display failed")
    const resetError = new Error("reset failed")
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    saveThemeModeMock.mockRejectedValueOnce(themeError)
    saveDisplayModeMock.mockRejectedValueOnce(displayError)
    saveResetTimerDisplayModeMock.mockRejectedValueOnce(resetError)

    const timeFormatError = new Error("time format failed")
    saveTimeFormatModeMock.mockRejectedValueOnce(timeFormatError)

    const { result } = renderHook(() =>
      useSettingsDisplayActions(baseArgs)
    )

    act(() => {
      result.current.handleThemeModeChange("light")
      result.current.handleDisplayModeChange("left")
      result.current.handleResetTimerDisplayModeChange("relative")
      result.current.handleTimeFormatModeChange("12h")
    })

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith("Failed to save theme mode:", themeError)
      expect(errorSpy).toHaveBeenCalledWith("Failed to save display mode:", displayError)
      expect(errorSpy).toHaveBeenCalledWith("Failed to save reset timer display mode:", resetError)
      expect(errorSpy).toHaveBeenCalledWith("Failed to save time format mode:", timeFormatError)
    })

    errorSpy.mockRestore()
  })

  it("selects multi style when clicking Multi from another style", () => {
    const setMenubarIconStyle = vi.fn()
    const setMultiTrayProviderCount = vi.fn()
    const scheduleTrayIconUpdate = vi.fn()

    const { result } = renderHook(() =>
      useSettingsDisplayActions({
        ...baseArgs,
        setMenubarIconStyle,
        setMultiTrayProviderCount,
        scheduleTrayIconUpdate,
      })
    )

    act(() => {
      result.current.handleMultiMenubarClick()
    })

    expect(setMenubarIconStyle).toHaveBeenCalledWith("multi")
    expect(setMultiTrayProviderCount).not.toHaveBeenCalled()
    expect(scheduleTrayIconUpdate).toHaveBeenCalledWith("settings", 0)
    expect(saveMenubarIconStyleMock).toHaveBeenCalledWith("multi")
    expect(saveMultiTrayProviderCountMock).not.toHaveBeenCalled()
  })

  it("cycles provider count when Multi is already selected", () => {
    const setMenubarIconStyle = vi.fn()
    const setMultiTrayProviderCount = vi.fn()
    const scheduleTrayIconUpdate = vi.fn()

    const { result } = renderHook(() =>
      useSettingsDisplayActions({
        ...baseArgs,
        menubarIconStyle: "multi",
        multiTrayProviderCount: 3,
        setMenubarIconStyle,
        setMultiTrayProviderCount,
        scheduleTrayIconUpdate,
      })
    )

    act(() => {
      result.current.handleMultiMenubarClick()
    })

    expect(setMultiTrayProviderCount).toHaveBeenCalledWith(4)
    expect(setMenubarIconStyle).not.toHaveBeenCalled()
    expect(scheduleTrayIconUpdate).toHaveBeenCalledWith("settings", 0)
    expect(saveMultiTrayProviderCountMock).toHaveBeenCalledWith(4)
    expect(saveMenubarIconStyleMock).not.toHaveBeenCalled()
  })

  it("saves multi tray display mode and refreshes tray icon", () => {
    const setMultiTrayDisplayMode = vi.fn()
    const scheduleTrayIconUpdate = vi.fn()

    const { result } = renderHook(() =>
      useSettingsDisplayActions({
        ...baseArgs,
        setMultiTrayDisplayMode,
        scheduleTrayIconUpdate,
      })
    )

    act(() => {
      result.current.handleMultiTrayDisplayModeChange("bars")
    })

    expect(setMultiTrayDisplayMode).toHaveBeenCalledWith("bars")
    expect(scheduleTrayIconUpdate).toHaveBeenCalledWith("settings", 0)
    expect(saveMultiTrayDisplayModeMock).toHaveBeenCalledWith("bars")
  })
})
