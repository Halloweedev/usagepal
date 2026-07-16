import { beforeEach, describe, expect, it, vi } from "vitest"

const { loadShareSettingsMock, saveShareSettingsMock } = vi.hoisted(() => ({
  loadShareSettingsMock: vi.fn(),
  saveShareSettingsMock: vi.fn(),
}))

vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings")
  return {
    ...actual,
    loadShareSettings: loadShareSettingsMock,
    saveShareSettings: saveShareSettingsMock,
  }
})

import { DEFAULT_SHARE_SETTINGS } from "@/lib/settings"
import { useAppShareStore } from "@/stores/app-share-store"

describe("app-share-store", () => {
  beforeEach(() => {
    loadShareSettingsMock.mockReset()
    saveShareSettingsMock.mockReset().mockResolvedValue(undefined)
    useAppShareStore.getState().resetState()
  })

  it("starts with defaults and unhydrated", () => {
    expect(useAppShareStore.getState().settings).toEqual(DEFAULT_SHARE_SETTINGS)
    expect(useAppShareStore.getState().hydrated).toBe(false)
  })

  it("hydrates once from persisted settings", async () => {
    const persisted = { ...DEFAULT_SHARE_SETTINGS, theme: "light" as const, selectedId: "codex" }
    loadShareSettingsMock.mockResolvedValue(persisted)

    await useAppShareStore.getState().hydrate()
    await useAppShareStore.getState().hydrate() // second call is a no-op

    expect(useAppShareStore.getState().settings).toEqual(persisted)
    expect(useAppShareStore.getState().hydrated).toBe(true)
    expect(loadShareSettingsMock).toHaveBeenCalledTimes(1)
  })

  it("marks hydrated even when load fails, without throwing", async () => {
    loadShareSettingsMock.mockRejectedValue(new Error("boom"))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await useAppShareStore.getState().hydrate()

    expect(useAppShareStore.getState().hydrated).toBe(true)
    expect(useAppShareStore.getState().settings).toEqual(DEFAULT_SHARE_SETTINGS)
    errorSpy.mockRestore()
  })

  it("patch merges and persists the full settings object", () => {
    useAppShareStore.getState().patch({ theme: "light" })

    expect(useAppShareStore.getState().settings.theme).toBe("light")
    expect(saveShareSettingsMock).toHaveBeenCalledWith({ ...DEFAULT_SHARE_SETTINGS, theme: "light" })
  })

  it("hands off a pending graph period exactly once", () => {
    expect(useAppShareStore.getState().takePendingGraphPeriod()).toBeNull()

    useAppShareStore.getState().setPendingGraphPeriod("yesterday")

    expect(useAppShareStore.getState().takePendingGraphPeriod()).toBe("yesterday")
    expect(useAppShareStore.getState().takePendingGraphPeriod()).toBeNull()
  })

  it("resetState clears a pending graph period", () => {
    useAppShareStore.getState().setPendingGraphPeriod("thirtyDay")
    useAppShareStore.getState().resetState()

    expect(useAppShareStore.getState().takePendingGraphPeriod()).toBeNull()
  })
})
