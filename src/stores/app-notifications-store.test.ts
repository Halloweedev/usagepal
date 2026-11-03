import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PaceNotificationSettings } from "@/lib/settings"

const { loadPaceNotificationSettingsMock, savePaceNotificationSettingsMock } = vi.hoisted(() => ({
  loadPaceNotificationSettingsMock: vi.fn(),
  savePaceNotificationSettingsMock: vi.fn(),
}))

vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings")
  return {
    ...actual,
    loadPaceNotificationSettings: loadPaceNotificationSettingsMock,
    savePaceNotificationSettings: savePaceNotificationSettingsMock,
  }
})

import { DEFAULT_PACE_NOTIFICATION_SETTINGS } from "@/lib/settings"
import { useAppNotificationsStore } from "@/stores/app-notifications-store"

describe("app notifications store", () => {
  beforeEach(() => {
    loadPaceNotificationSettingsMock.mockReset()
    savePaceNotificationSettingsMock.mockReset()
    loadPaceNotificationSettingsMock.mockResolvedValue(DEFAULT_PACE_NOTIFICATION_SETTINGS)
    savePaceNotificationSettingsMock.mockResolvedValue(undefined)
    useAppNotificationsStore.getState().resetState()
  })

  it("starts with defaults and unhydrated", () => {
    expect(useAppNotificationsStore.getState().settings).toEqual(DEFAULT_PACE_NOTIFICATION_SETTINGS)
    expect(useAppNotificationsStore.getState().hydrated).toBe(false)
  })

  it("hydrates from persisted settings", async () => {
    const persisted: PaceNotificationSettings = {
      ...DEFAULT_PACE_NOTIFICATION_SETTINGS,
      closeToRunningOut: true,
      sessionReset: true,
    }
    loadPaceNotificationSettingsMock.mockResolvedValue(persisted)

    await useAppNotificationsStore.getState().hydrate()

    expect(useAppNotificationsStore.getState().settings).toEqual(persisted)
    expect(useAppNotificationsStore.getState().hydrated).toBe(true)
  })

  it("hydrates once when called repeatedly", async () => {
    const persisted: PaceNotificationSettings = {
      ...DEFAULT_PACE_NOTIFICATION_SETTINGS,
      healthyToClose: true,
    }
    loadPaceNotificationSettingsMock.mockResolvedValue(persisted)

    await useAppNotificationsStore.getState().hydrate()
    await useAppNotificationsStore.getState().hydrate()

    expect(loadPaceNotificationSettingsMock).toHaveBeenCalledTimes(1)
  })

  it("marks hydrated even when load fails, without throwing", async () => {
    loadPaceNotificationSettingsMock.mockRejectedValue(new Error("boom"))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await useAppNotificationsStore.getState().hydrate()

    expect(useAppNotificationsStore.getState().hydrated).toBe(true)
    expect(useAppNotificationsStore.getState().settings).toEqual(DEFAULT_PACE_NOTIFICATION_SETTINGS)
    errorSpy.mockRestore()
  })

  it("flips one notification setting and persists the merged settings object", () => {
    useAppNotificationsStore.getState().setToggle("closeToRunningOut", true)

    expect(useAppNotificationsStore.getState().settings.closeToRunningOut).toBe(true)
    expect(savePaceNotificationSettingsMock).toHaveBeenCalledWith({
      ...DEFAULT_PACE_NOTIFICATION_SETTINGS,
      closeToRunningOut: true,
    })
  })

  it("sets and saves all notification settings at once", () => {
    const settings: PaceNotificationSettings = {
      underTenPercent: false,
      healthyToClose: false,
      closeToRunningOut: true,
      sessionReset: true,
    }

    useAppNotificationsStore.getState().setSettings(settings)

    expect(useAppNotificationsStore.getState().settings).toEqual(settings)
    expect(savePaceNotificationSettingsMock).toHaveBeenCalledWith(settings)
  })

  it("resets to defaults and unhydrated", async () => {
    loadPaceNotificationSettingsMock.mockResolvedValue({
      ...DEFAULT_PACE_NOTIFICATION_SETTINGS,
      underTenPercent: true,
    })
    await useAppNotificationsStore.getState().hydrate()

    useAppNotificationsStore.getState().resetState()

    expect(useAppNotificationsStore.getState().settings).toEqual(DEFAULT_PACE_NOTIFICATION_SETTINGS)
    expect(useAppNotificationsStore.getState().hydrated).toBe(false)
  })
})
