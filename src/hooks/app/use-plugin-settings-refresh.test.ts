import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { isTauriMock, listenMock, loadPluginSettingsMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(),
  listenMock: vi.fn(),
  loadPluginSettingsMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: isTauriMock,
}))

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}))

vi.mock("@/lib/settings", () => ({
  loadPluginSettings: loadPluginSettingsMock,
}))

import { usePluginSettingsRefresh } from "@/hooks/app/use-plugin-settings-refresh"

describe("usePluginSettingsRefresh", () => {
  const handlers = new Map<string, () => void>()

  beforeEach(() => {
    handlers.clear()
    isTauriMock.mockReset()
    isTauriMock.mockReturnValue(true)
    listenMock.mockReset()
    listenMock.mockImplementation(async (event: string, handler: () => void) => {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    })
    loadPluginSettingsMock.mockReset()
  })

  it("reloads plugin settings when plugins:changed fires", async () => {
    const setPluginSettings = vi.fn()
    const settings = { order: ["claude"], disabled: ["codex"] }
    loadPluginSettingsMock.mockResolvedValue(settings)

    renderHook(() => usePluginSettingsRefresh(setPluginSettings))
    await waitFor(() => expect(handlers.has("plugins:changed")).toBe(true))

    handlers.get("plugins:changed")!()
    await waitFor(() => expect(setPluginSettings).toHaveBeenCalledWith(settings))
  })

  it("does nothing outside Tauri", () => {
    isTauriMock.mockReturnValue(false)
    renderHook(() => usePluginSettingsRefresh(vi.fn()))
    expect(listenMock).not.toHaveBeenCalled()
  })

  it("unsubscribes on unmount", async () => {
    const { unmount } = renderHook(() => usePluginSettingsRefresh(vi.fn()))
    await waitFor(() => expect(handlers.has("plugins:changed")).toBe(true))
    unmount()
    await waitFor(() => expect(handlers.has("plugins:changed")).toBe(false))
  })
})
