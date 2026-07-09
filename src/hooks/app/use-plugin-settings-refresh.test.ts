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

  const makeArgs = (pluginSettings: { order: string[]; disabled: string[] } | null) => ({
    pluginSettings,
    setPluginSettings: vi.fn(),
    setLoadingForPlugins: vi.fn(),
    setErrorForPlugins: vi.fn(),
    startBatch: vi.fn(() => Promise.resolve(undefined)),
    scheduleTrayIconUpdate: vi.fn(),
  })

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
    const args = makeArgs({ order: ["claude"], disabled: [] })
    const settings = { order: ["claude"], disabled: ["codex"] }
    loadPluginSettingsMock.mockResolvedValue(settings)

    renderHook(() => usePluginSettingsRefresh(args))
    await waitFor(() => expect(handlers.has("plugins:changed")).toBe(true))

    handlers.get("plugins:changed")!()
    await waitFor(() => expect(args.setPluginSettings).toHaveBeenCalledWith(settings))
  })

  it("probes plugins that just became enabled", async () => {
    const args = makeArgs({ order: ["claude", "codex", "grok"], disabled: ["codex", "grok"] })
    loadPluginSettingsMock.mockResolvedValue({
      order: ["claude", "codex", "grok"],
      disabled: ["grok"],
    })

    renderHook(() => usePluginSettingsRefresh(args))
    await waitFor(() => expect(handlers.has("plugins:changed")).toBe(true))

    handlers.get("plugins:changed")!()
    await waitFor(() => expect(args.startBatch).toHaveBeenCalledWith(["codex"]))
    expect(args.setLoadingForPlugins).toHaveBeenCalledWith(["codex"])
    expect(args.scheduleTrayIconUpdate).toHaveBeenCalledWith("settings", expect.any(Number))
  })

  it("does not probe when nothing became enabled", async () => {
    const args = makeArgs({ order: ["claude", "codex"], disabled: [] })
    loadPluginSettingsMock.mockResolvedValue({ order: ["claude", "codex"], disabled: ["codex"] })

    renderHook(() => usePluginSettingsRefresh(args))
    await waitFor(() => expect(handlers.has("plugins:changed")).toBe(true))

    handlers.get("plugins:changed")!()
    await waitFor(() => expect(args.setPluginSettings).toHaveBeenCalled())
    expect(args.startBatch).not.toHaveBeenCalled()
    expect(args.setLoadingForPlugins).not.toHaveBeenCalled()
  })

  it("marks plugins with an error when the probe fails to start", async () => {
    const args = makeArgs({ order: ["claude", "codex"], disabled: ["codex"] })
    args.startBatch = vi.fn(() => Promise.reject(new Error("boom")))
    loadPluginSettingsMock.mockResolvedValue({ order: ["claude", "codex"], disabled: [] })

    renderHook(() => usePluginSettingsRefresh(args))
    await waitFor(() => expect(handlers.has("plugins:changed")).toBe(true))

    handlers.get("plugins:changed")!()
    await waitFor(() =>
      expect(args.setErrorForPlugins).toHaveBeenCalledWith(["codex"], "Failed to start probe")
    )
  })

  it("does nothing outside Tauri", () => {
    isTauriMock.mockReturnValue(false)
    renderHook(() => usePluginSettingsRefresh(makeArgs(null)))
    expect(listenMock).not.toHaveBeenCalled()
  })

  it("unsubscribes on unmount", async () => {
    const { unmount } = renderHook(() => usePluginSettingsRefresh(makeArgs(null)))
    await waitFor(() => expect(handlers.has("plugins:changed")).toBe(true))
    unmount()
    await waitFor(() => expect(handlers.has("plugins:changed")).toBe(false))
  })
})
