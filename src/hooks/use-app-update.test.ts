import { renderHook, act } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach, afterAll } from "vitest"

const { checkMock, invokeMock, listenMock, progressHandlers, relaunchMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  progressHandlers: [] as Array<(event: any) => void>,
  relaunchMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", async () => {
  const actual = await vi.importActual<typeof import("@tauri-apps/api/core")>("@tauri-apps/api/core")
  return {
    ...actual,
    invoke: invokeMock,
  }
})

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}))

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: checkMock,
}))

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: relaunchMock,
}))

import { useAppUpdate } from "@/hooks/use-app-update"

declare global {
  // eslint-disable-next-line no-var
  var isTauri: boolean | undefined
  // eslint-disable-next-line no-var
  var __USAGEPAL_ENABLE_UPDATES__: boolean | undefined
}

describe("useAppUpdate", () => {
  const originalIsTauri = globalThis.isTauri
  const originalUpdatesEnabled = globalThis.__USAGEPAL_ENABLE_UPDATES__

  beforeEach(() => {
    checkMock.mockReset()
    invokeMock.mockReset()
    progressHandlers.length = 0
    listenMock.mockReset()
    listenMock.mockImplementation(async (_eventName: string, handler: (event: any) => void) => {
      progressHandlers.push(handler)
      return vi.fn()
    })
    relaunchMock.mockReset()
    // `@tauri-apps/api/core` considers `globalThis.isTauri` the runtime flag.
    globalThis.isTauri = true
    globalThis.__USAGEPAL_ENABLE_UPDATES__ = true
  })

  afterAll(() => {
    if (originalIsTauri === undefined) {
      delete globalThis.isTauri
    } else {
      globalThis.isTauri = originalIsTauri
    }

    if (originalUpdatesEnabled === undefined) {
      delete globalThis.__USAGEPAL_ENABLE_UPDATES__
    } else {
      globalThis.__USAGEPAL_ENABLE_UPDATES__ = originalUpdatesEnabled
    }
  })

  it("starts checking on mount", async () => {
    checkMock.mockReturnValue(new Promise(() => {})) // never resolves
    const { result } = renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())
    expect(result.current.updateStatus).toEqual({ status: "checking" })
  })

  it("checks for updates by default when no fork override is set", async () => {
    delete globalThis.__USAGEPAL_ENABLE_UPDATES__
    checkMock.mockResolvedValue(null)

    renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())

    expect(checkMock).toHaveBeenCalledTimes(1)
  })

  it("uses the stable updater when beta updates are disabled", async () => {
    checkMock.mockResolvedValue(null)

    renderHook(() => useAppUpdate({ betaUpdatesEnabled: false }))
    await act(() => Promise.resolve())

    expect(checkMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).not.toHaveBeenCalledWith("check_beta_update")
  })

  it("checks both stable and beta updater commands when beta updates are enabled", async () => {
    checkMock.mockResolvedValue(null)
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "check_beta_update") return null
      return undefined
    })

    renderHook(() => useAppUpdate({ betaUpdatesEnabled: true }))
    await act(() => Promise.resolve())

    expect(checkMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith("check_beta_update")
  })

  it("downloads a beta update and transitions to ready", async () => {
    checkMock.mockResolvedValue(null)
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "check_beta_update") return { version: "0.7.29-beta.3" }
      if (command === "download_beta_update") return undefined
      return undefined
    })

    const { result } = renderHook(() => useAppUpdate({ betaUpdatesEnabled: true }))
    await act(() => Promise.resolve())
    await act(() => Promise.resolve())

    expect(invokeMock).toHaveBeenCalledWith("download_beta_update")
    expect(result.current.updateStatus).toEqual({ status: "ready", channel: "beta", version: "0.7.29-beta.3" })
  })

  it("downloads a stable update when beta is enabled and only stable is available", async () => {
    const downloadMock = vi.fn(async (onEvent: (event: any) => void) => {
      onEvent({ event: "Finished", data: {} })
    })
    checkMock.mockResolvedValue({ version: "0.7.29", download: downloadMock, install: vi.fn() })
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "check_beta_update") return null
      return undefined
    })

    const { result } = renderHook(() => useAppUpdate({ betaUpdatesEnabled: true }))
    await act(() => Promise.resolve())
    await act(() => Promise.resolve())

    expect(downloadMock).toHaveBeenCalled()
    expect(invokeMock).not.toHaveBeenCalledWith("download_beta_update")
    expect(result.current.updateStatus).toEqual({ status: "ready", channel: "stable", version: "0.7.29" })
  })

  it("offers a choice when beta updates are enabled and both channels have updates", async () => {
    const downloadMock = vi.fn(async (onEvent: (event: any) => void) => {
      onEvent({ event: "Finished", data: {} })
    })
    checkMock.mockResolvedValue({ version: "0.7.29", download: downloadMock, install: vi.fn() })
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "check_beta_update") return { version: "0.7.30-beta.1" }
      if (command === "download_beta_update") return undefined
      return undefined
    })

    const { result } = renderHook(() => useAppUpdate({ betaUpdatesEnabled: true }))
    await act(() => Promise.resolve())

    expect(result.current.updateStatus).toEqual({
      status: "choice",
      stableVersion: "0.7.29",
      betaVersion: "0.7.30-beta.1",
    })
    expect(downloadMock).not.toHaveBeenCalled()
    expect(invokeMock).not.toHaveBeenCalledWith("download_beta_update")
  })

  it("downloads the selected stable update when both channels are available", async () => {
    const installMock = vi.fn().mockResolvedValue(undefined)
    const downloadMock = vi.fn(async (onEvent: (event: any) => void) => {
      onEvent({ event: "Finished", data: {} })
    })
    checkMock.mockResolvedValue({ version: "0.7.29", download: downloadMock, install: installMock })
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "check_beta_update") return { version: "0.7.30-beta.1" }
      if (command === "download_beta_update") return undefined
      if (command === "install_beta_update") return undefined
      return undefined
    })
    relaunchMock.mockResolvedValue(undefined)

    const { result } = renderHook(() => useAppUpdate({ betaUpdatesEnabled: true }))
    await act(() => Promise.resolve())

    await act(() => result.current.chooseUpdate("stable"))
    expect(downloadMock).toHaveBeenCalled()
    expect(result.current.updateStatus).toEqual({ status: "ready", channel: "stable", version: "0.7.29" })

    await act(() => result.current.triggerInstall())
    expect(installMock).toHaveBeenCalled()
    expect(invokeMock).not.toHaveBeenCalledWith("install_beta_update")
    expect(relaunchMock).toHaveBeenCalled()
  })

  it("downloads the selected beta update when both channels are available", async () => {
    const downloadMock = vi.fn(async (onEvent: (event: any) => void) => {
      onEvent({ event: "Finished", data: {} })
    })
    checkMock.mockResolvedValue({ version: "0.7.29", download: downloadMock, install: vi.fn() })
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "check_beta_update") return { version: "0.7.30-beta.1" }
      if (command === "download_beta_update") return undefined
      return undefined
    })

    const { result } = renderHook(() => useAppUpdate({ betaUpdatesEnabled: true }))
    await act(() => Promise.resolve())

    await act(() => result.current.chooseUpdate("beta"))
    expect(downloadMock).not.toHaveBeenCalled()
    expect(invokeMock).toHaveBeenCalledWith("download_beta_update")
    expect(result.current.updateStatus).toEqual({ status: "ready", channel: "beta", version: "0.7.30-beta.1" })
  })

  it("installs beta updates through the beta install command", async () => {
    checkMock.mockResolvedValue(null)
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "check_beta_update") return { version: "0.7.29-beta.3" }
      if (command === "download_beta_update") return undefined
      if (command === "install_beta_update") return undefined
      return undefined
    })
    relaunchMock.mockResolvedValue(undefined)

    const { result } = renderHook(() => useAppUpdate({ betaUpdatesEnabled: true }))
    await act(() => Promise.resolve())
    await act(() => Promise.resolve())

    await act(() => result.current.triggerInstall())

    expect(invokeMock).toHaveBeenCalledWith("install_beta_update")
    expect(relaunchMock).toHaveBeenCalled()
  })

  it("shows up-to-date then returns to idle when a beta check returns null", async () => {
    vi.useFakeTimers()
    checkMock.mockResolvedValue(null)
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "check_beta_update") return null
      return undefined
    })

    const { result } = renderHook(() => useAppUpdate({ betaUpdatesEnabled: true }))
    await act(() => Promise.resolve())
    await act(() => Promise.resolve())

    expect(result.current.updateStatus).toEqual({ status: "up-to-date" })
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.updateStatus).toEqual({ status: "idle" })
    vi.useRealTimers()
  })

  it("transitions to error when beta download fails and does not install", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "check_beta_update") return { version: "0.7.29-beta.3" }
      if (command === "download_beta_update") throw new Error("download failed")
      if (command === "install_beta_update") return undefined
      return undefined
    })

    const { result } = renderHook(() => useAppUpdate({ betaUpdatesEnabled: true }))
    await act(() => Promise.resolve())
    await act(() => Promise.resolve())

    expect(result.current.updateStatus).toEqual({ status: "error", message: "Download failed" })
    await act(() => result.current.triggerInstall())
    expect(invokeMock).not.toHaveBeenCalledWith("install_beta_update")
  })

  it("transitions to error when beta install fails", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "check_beta_update") return { version: "0.7.29-beta.3" }
      if (command === "download_beta_update") return undefined
      if (command === "install_beta_update") throw new Error("install failed")
      return undefined
    })

    const { result } = renderHook(() => useAppUpdate({ betaUpdatesEnabled: true }))
    await act(() => Promise.resolve())
    await act(() => Promise.resolve())

    await act(() => result.current.triggerInstall())
    expect(result.current.updateStatus).toEqual({ status: "error", message: "Install failed" })
  })

  it("updates progress from beta progress events", async () => {
    let resolveDownload: (() => void) | null = null
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "check_beta_update") return { version: "0.7.29-beta.3" }
      if (command === "download_beta_update") return new Promise<void>((resolve) => { resolveDownload = resolve })
      return undefined
    })

    const { result } = renderHook(() => useAppUpdate({ betaUpdatesEnabled: true }))
    await act(() => Promise.resolve())
    await act(() => Promise.resolve())

    act(() => {
      progressHandlers[0]?.({ payload: { event: "Started", data: { contentLength: 1000 } } })
    })
    expect(result.current.updateStatus).toEqual({ status: "downloading", progress: 0 })

    act(() => {
      progressHandlers[0]?.({ payload: { event: "Progress", data: { chunkLength: 400 } } })
    })
    expect(result.current.updateStatus).toEqual({ status: "downloading", progress: 40 })

    await act(async () => { resolveDownload?.() })
  })

  it("keeps beta progress indeterminate when content length is unknown", async () => {
    let resolveDownload: (() => void) | null = null
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "check_beta_update") return { version: "0.7.29-beta.3" }
      if (command === "download_beta_update") return new Promise<void>((resolve) => { resolveDownload = resolve })
      return undefined
    })

    const { result } = renderHook(() => useAppUpdate({ betaUpdatesEnabled: true }))
    await act(() => Promise.resolve())
    await act(() => Promise.resolve())

    act(() => {
      progressHandlers[0]?.({ payload: { event: "Started", data: { contentLength: null } } })
      progressHandlers[0]?.({ payload: { event: "Progress", data: { chunkLength: 400 } } })
    })
    expect(result.current.updateStatus).toEqual({ status: "downloading", progress: -1 })

    await act(async () => { resolveDownload?.() })
  })

  it("cleans up the beta progress listener after unmount", async () => {
    const unlistenMock = vi.fn()
    listenMock.mockResolvedValue(unlistenMock)
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "check_beta_update") return null
      return undefined
    })

    const { unmount } = renderHook(() => useAppUpdate({ betaUpdatesEnabled: true }))
    await act(() => Promise.resolve())
    unmount()

    expect(unlistenMock).toHaveBeenCalled()
  })

  it("runs delayed beta listener cleanup when listen resolves after unmount", async () => {
    let resolveListen: ((cleanup: () => void) => void) | null = null
    const unlistenMock = vi.fn()
    listenMock.mockReturnValue(new Promise<() => void>((resolve) => { resolveListen = resolve }))
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "check_beta_update") return null
      return undefined
    })

    const { unmount } = renderHook(() => useAppUpdate({ betaUpdatesEnabled: true }))
    unmount()
    await act(async () => { resolveListen?.(unlistenMock) })

    expect(unlistenMock).toHaveBeenCalled()
  })

  it("ignores a second beta check while download is in flight", async () => {
    let resolveDownload: (() => void) | null = null
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "check_beta_update") return { version: "0.7.29-beta.3" }
      if (command === "download_beta_update") return new Promise<void>((resolve) => { resolveDownload = resolve })
      return undefined
    })

    const { result } = renderHook(() => useAppUpdate({ betaUpdatesEnabled: true }))
    await act(() => Promise.resolve())
    await act(() => Promise.resolve())
    expect(result.current.updateStatus.status).toBe("downloading")

    await act(() => result.current.checkForUpdates())
    expect(invokeMock).toHaveBeenCalledWith("check_beta_update")
    expect(invokeMock.mock.calls.filter(([command]) => command === "check_beta_update")).toHaveLength(1)

    await act(async () => { resolveDownload?.() })
  })

  it("does not trigger beta install outside Tauri", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "check_beta_update") return { version: "0.7.29-beta.3" }
      if (command === "download_beta_update") return undefined
      if (command === "install_beta_update") return undefined
      return undefined
    })

    const { result } = renderHook(() => useAppUpdate({ betaUpdatesEnabled: true }))
    await act(() => Promise.resolve())
    await act(() => Promise.resolve())
    invokeMock.mockClear()
    globalThis.isTauri = false

    await act(() => result.current.triggerInstall())

    expect(invokeMock).not.toHaveBeenCalled()
    expect(relaunchMock).not.toHaveBeenCalled()
  })

  it("resets stale ready state when beta updates are disabled", async () => {
    checkMock.mockResolvedValue(null)
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "check_beta_update") return { version: "0.7.29-beta.3" }
      if (command === "download_beta_update") return undefined
      if (command === "install_beta_update") return undefined
      return undefined
    })

    const { result, rerender } = renderHook(
      ({ betaUpdatesEnabled }) => useAppUpdate({ betaUpdatesEnabled }),
      { initialProps: { betaUpdatesEnabled: true } }
    )
    await act(() => Promise.resolve())
    await act(() => Promise.resolve())
    expect(result.current.updateStatus).toEqual({ status: "ready", channel: "beta", version: "0.7.29-beta.3" })

    rerender({ betaUpdatesEnabled: false })
    await act(() => Promise.resolve())
    expect(result.current.updateStatus).toEqual({ status: "idle" })

    await act(() => result.current.triggerInstall())
    expect(invokeMock).not.toHaveBeenCalledWith("install_beta_update")
  })

  it("stays idle when not running in Tauri", async () => {
    globalThis.isTauri = false

    const { result } = renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())

    expect(checkMock).not.toHaveBeenCalled()
    expect(result.current.updateStatus).toEqual({ status: "idle" })
  })

  it("stays idle when app updates are disabled for this fork", async () => {
    globalThis.__USAGEPAL_ENABLE_UPDATES__ = false

    const { result } = renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())

    expect(checkMock).not.toHaveBeenCalled()
    expect(result.current.updateStatus).toEqual({ status: "idle" })
  })

  it("ignores a manual re-check while a check is already in flight", async () => {
    let resolveCheck: ((value: null) => void) | undefined
    checkMock.mockReturnValue(new Promise<null>((resolve) => { resolveCheck = resolve }))

    const { result } = renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())
    expect(result.current.updateStatus).toEqual({ status: "checking" })

    await act(() => result.current.checkForUpdates())
    expect(checkMock).toHaveBeenCalledTimes(1)

    resolveCheck?.(null)
    await act(() => Promise.resolve())
  })

  it("clears a pending up-to-date timeout on re-check", async () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout")

    // First check: no update -> schedules up-to-date timeout.
    checkMock.mockResolvedValueOnce(null)
    // Second check: hang so we can observe "checking".
    let resolveSecond: ((value: null) => void) | undefined
    checkMock.mockReturnValueOnce(new Promise<null>((resolve) => { resolveSecond = resolve }))

    const { result } = renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())
    await act(() => Promise.resolve())
    expect(result.current.updateStatus).toEqual({ status: "up-to-date" })

    act(() => { void result.current.checkForUpdates() })
    await act(() => Promise.resolve())
    expect(clearTimeoutSpy).toHaveBeenCalled()
    expect(result.current.updateStatus).toEqual({ status: "checking" })

    // Cleanup: resolve second check so the hook can settle.
    resolveSecond?.(null)
    await act(() => Promise.resolve())

    clearTimeoutSpy.mockRestore()
    vi.useRealTimers()
  })

  it("auto-downloads when update is available and transitions to ready", async () => {
    const downloadMock = vi.fn(async (onEvent: (event: any) => void) => {
      onEvent({ event: "Started", data: { contentLength: 1000 } })
      onEvent({ event: "Progress", data: { chunkLength: 500 } })
      onEvent({ event: "Progress", data: { chunkLength: 500 } })
      onEvent({ event: "Finished", data: {} })
    })
    checkMock.mockResolvedValue({ version: "1.0.0", download: downloadMock, install: vi.fn() })

    const { result } = renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())
    await act(() => Promise.resolve()) // extra tick for download to complete

    expect(downloadMock).toHaveBeenCalled()
    expect(result.current.updateStatus).toEqual({ status: "ready", channel: "stable", version: "1.0.0" })
  })

  it("does not check again when already ready", async () => {
    const downloadMock = vi.fn(async (onEvent: (event: any) => void) => {
      onEvent({ event: "Finished", data: {} })
    })
    checkMock.mockResolvedValue({ version: "1.0.0", download: downloadMock, install: vi.fn() })

    const { result } = renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())
    await act(() => Promise.resolve())
    expect(result.current.updateStatus.status).toBe("ready")

    checkMock.mockClear()
    await act(() => result.current.checkForUpdates())
    expect(checkMock).not.toHaveBeenCalled()
  })

  it("shows up-to-date then returns to idle when check returns null", async () => {
    vi.useFakeTimers()
    checkMock.mockResolvedValue(null)
    const { result } = renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())
    await act(() => Promise.resolve())
    expect(result.current.updateStatus).toEqual({ status: "up-to-date" })
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.updateStatus).toEqual({ status: "idle" })
    vi.useRealTimers()
  })

  it("transitions to error when check throws", async () => {
    checkMock.mockRejectedValue(new Error("network error"))
    const { result } = renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())
    await act(() => Promise.resolve())
    expect(result.current.updateStatus).toEqual({ status: "error", message: "Update check failed" })
  })

  it("reports indeterminate progress when content length is unknown", async () => {
    let resolveDownload: (() => void) | null = null
    const downloadMock = vi.fn((onEvent: (event: any) => void) => {
      onEvent({ event: "Started", data: { contentLength: null } })
      return new Promise<void>((resolve) => { resolveDownload = resolve })
    })
    checkMock.mockResolvedValue({ version: "1.0.0", download: downloadMock, install: vi.fn() })

    const { result } = renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())

    expect(result.current.updateStatus).toEqual({ status: "downloading", progress: -1 })

    // Clean up: resolve the download
    await act(async () => { resolveDownload?.() })
  })

  it("ignores progress chunks when total content length is unknown", async () => {
    let resolveDownload: (() => void) | null = null
    const downloadMock = vi.fn((onEvent: (event: any) => void) => {
      onEvent({ event: "Started", data: { contentLength: null } })
      onEvent({ event: "Progress", data: { chunkLength: 500 } })
      return new Promise<void>((resolve) => { resolveDownload = resolve })
    })
    checkMock.mockResolvedValue({ version: "1.0.0", download: downloadMock, install: vi.fn() })

    const { result } = renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())

    expect(result.current.updateStatus).toEqual({ status: "downloading", progress: -1 })

    await act(async () => { resolveDownload?.() })
  })

  it("transitions to error on download failure", async () => {
    const downloadMock = vi.fn().mockRejectedValue(new Error("download failed"))
    checkMock.mockResolvedValue({ version: "1.0.0", download: downloadMock, install: vi.fn() })

    const { result } = renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())
    await act(() => Promise.resolve()) // extra tick for error to propagate

    expect(result.current.updateStatus).toEqual({ status: "error", message: "Download failed" })
  })

  it("installs and relaunches when ready", async () => {
    const installMock = vi.fn().mockResolvedValue(undefined)
    const downloadMock = vi.fn(async (onEvent: (event: any) => void) => {
      onEvent({ event: "Finished", data: {} })
    })
    relaunchMock.mockResolvedValue(undefined)
    checkMock.mockResolvedValue({ version: "1.0.0", download: downloadMock, install: installMock })

    const { result } = renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())
    await act(() => Promise.resolve()) // wait for download to complete
    expect(result.current.updateStatus.status).toBe("ready")

    await act(() => result.current.triggerInstall())
    expect(installMock).toHaveBeenCalled()
    expect(relaunchMock).toHaveBeenCalled()
    expect(result.current.updateStatus).toEqual({ status: "idle" })
  })

  it("transitions to error on install failure", async () => {
    const installMock = vi.fn().mockRejectedValue(new Error("install failed"))
    const downloadMock = vi.fn(async (onEvent: (event: any) => void) => {
      onEvent({ event: "Finished", data: {} })
    })
    checkMock.mockResolvedValue({ version: "1.0.0", download: downloadMock, install: installMock })

    const { result } = renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())
    await act(() => Promise.resolve()) // wait for download

    await act(() => result.current.triggerInstall())
    expect(result.current.updateStatus).toEqual({ status: "error", message: "Install failed" })
  })

  it("does not update state after unmount during check", async () => {
    const resolveRef: { current: ((val: any) => void) | null } = { current: null }
    checkMock.mockReturnValue(new Promise((resolve) => { resolveRef.current = resolve }))

    const { result, unmount } = renderHook(() => useAppUpdate())
    const statusAtUnmount = result.current.updateStatus
    unmount()
    resolveRef.current?.({ version: "1.0.0", download: vi.fn(), install: vi.fn() })
    await act(() => Promise.resolve())
    expect(result.current.updateStatus).toEqual(statusAtUnmount)
  })

  it("does not update state after unmount when check rejects", async () => {
    const rejectRef: { current: ((error: unknown) => void) | null } = { current: null }
    checkMock.mockReturnValue(new Promise((_, reject) => { rejectRef.current = reject }))

    const { result, unmount } = renderHook(() => useAppUpdate())
    const statusAtUnmount = result.current.updateStatus
    unmount()
    rejectRef.current?.(new Error("network error"))
    await act(() => Promise.resolve())
    expect(result.current.updateStatus).toEqual(statusAtUnmount)
  })

  it("ignores download events after unmount", async () => {
    let emitEvent: ((event: any) => void) | null = null
    let resolveDownload: (() => void) | null = null
    const downloadMock = vi.fn((onEvent: (event: any) => void) => {
      emitEvent = onEvent
      return new Promise<void>((resolve) => { resolveDownload = resolve })
    })
    checkMock.mockResolvedValue({ version: "1.0.0", download: downloadMock, install: vi.fn() })

    const { result, unmount } = renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())
    const statusAtUnmount = result.current.updateStatus
    unmount()

    emitEvent?.({ event: "Started", data: { contentLength: 100 } })
    emitEvent?.({ event: "Progress", data: { chunkLength: 50 } })
    emitEvent?.({ event: "Finished", data: {} })
    await act(async () => { resolveDownload?.() })

    expect(result.current.updateStatus).toEqual(statusAtUnmount)
  })

  it("does not trigger install when not in ready state", async () => {
    vi.useFakeTimers()
    checkMock.mockResolvedValue(null)
    const { result } = renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())
    await act(() => Promise.resolve())

    await act(() => result.current.triggerInstall())
    // Install ignored (we're not ready)
    expect(result.current.updateStatus).toEqual({ status: "up-to-date" })
    vi.useRealTimers()
  })

  it("does not trigger install while downloading", async () => {
    let resolveDownload: (() => void) | null = null
    const installMock = vi.fn().mockResolvedValue(undefined)
    const downloadMock = vi.fn((onEvent: (event: any) => void) => {
      onEvent({ event: "Started", data: { contentLength: 100 } })
      return new Promise<void>((resolve) => { resolveDownload = resolve })
    })
    checkMock.mockResolvedValue({ version: "1.0.0", download: downloadMock, install: installMock })

    const { result } = renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())
    await act(() => Promise.resolve())
    expect(result.current.updateStatus.status).toBe("downloading")

    await act(() => result.current.triggerInstall())
    expect(installMock).not.toHaveBeenCalled()

    // Cleanup: resolve download
    await act(async () => { resolveDownload?.() })
  })

  it("prevents concurrent install attempts", async () => {
    let resolveInstall: (() => void) | null = null
    const installMock = vi.fn(() => new Promise<void>((resolve) => { resolveInstall = resolve }))
    const downloadMock = vi.fn(async (onEvent: (event: any) => void) => {
      onEvent({ event: "Finished", data: {} })
    })
    relaunchMock.mockResolvedValue(undefined)
    checkMock.mockResolvedValue({ version: "1.0.0", download: downloadMock, install: installMock })

    const { result } = renderHook(() => useAppUpdate())
    await act(() => Promise.resolve())
    await act(() => Promise.resolve()) // wait for download

    act(() => { void result.current.triggerInstall() })
    act(() => { void result.current.triggerInstall() })
    await act(() => Promise.resolve())

    expect(result.current.updateStatus).toEqual({ status: "installing" })
    expect(installMock).toHaveBeenCalledTimes(1)

    await act(async () => { resolveInstall?.() })
  })
})
