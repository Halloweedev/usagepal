import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { getEnabledPluginIdsMock } = vi.hoisted(() => ({
  getEnabledPluginIdsMock: vi.fn(),
}))

vi.mock("@/lib/settings", () => ({
  getEnabledPluginIds: getEnabledPluginIdsMock,
}))

import { useProbeAutoUpdate } from "@/hooks/app/use-probe-auto-update"

describe("useProbeAutoUpdate (display-only countdown)", () => {
  beforeEach(() => {
    getEnabledPluginIdsMock.mockReset()
    getEnabledPluginIdsMock.mockImplementation((settings: { order: string[]; disabled: string[] }) =>
      settings.order.filter((id) => !settings.disabled.includes(id))
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("keeps the countdown cleared when plugin settings are missing", () => {
    const { result } = renderHook(() =>
      useProbeAutoUpdate({ pluginSettings: null, autoUpdateInterval: 15 })
    )

    expect(result.current.autoUpdateNextAt).toBeNull()

    act(() => {
      result.current.resetAutoUpdateSchedule()
    })

    expect(result.current.autoUpdateNextAt).toBeNull()
  })

  it("seeds the countdown on mount when enabled plugins are present", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000)

    const { result } = renderHook(() =>
      useProbeAutoUpdate({
        pluginSettings: { order: ["codex"], disabled: [] },
        autoUpdateInterval: 15,
      })
    )

    expect(result.current.autoUpdateNextAt).toBe(910_000)
    nowSpy.mockRestore()
  })

  it("re-seeds the countdown on resetAutoUpdateSchedule", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000)

    const { result } = renderHook(() =>
      useProbeAutoUpdate({
        pluginSettings: { order: ["codex"], disabled: [] },
        autoUpdateInterval: 15,
      })
    )

    nowSpy.mockReturnValue(50_000)
    act(() => {
      result.current.resetAutoUpdateSchedule()
    })

    expect(result.current.autoUpdateNextAt).toBe(50_000 + 15 * 60_000)
    nowSpy.mockRestore()
  })

  it("clears the countdown when no plugins are enabled", () => {
    const { result } = renderHook(() =>
      useProbeAutoUpdate({
        pluginSettings: { order: ["codex"], disabled: ["codex"] },
        autoUpdateInterval: 15,
      })
    )

    expect(result.current.autoUpdateNextAt).toBeNull()
  })
})
