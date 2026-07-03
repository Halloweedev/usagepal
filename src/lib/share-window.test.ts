import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"

const state = vi.hoisted(() => ({
  getByLabelMock: vi.fn(),
  emitMock: vi.fn(),
  listenMock: vi.fn(),
  showMock: vi.fn(),
  setFocusMock: vi.fn(),
  onceHandlers: new Map<string, (event: unknown) => void>(),
  constructorArgs: [] as Array<{ label: string; options: unknown }>,
}))

vi.mock("@tauri-apps/api/event", () => ({
  emit: state.emitMock,
  listen: state.listenMock,
}))

vi.mock("@tauri-apps/api/webviewWindow", () => {
  class WebviewWindow {
    label: string
    static getByLabel = state.getByLabelMock
    constructor(label: string, options: unknown) {
      this.label = label
      state.constructorArgs.push({ label, options })
    }
    once(event: string, handler: (event: unknown) => void) {
      state.onceHandlers.set(event, handler)
      return Promise.resolve(() => {})
    }
  }
  return { WebviewWindow }
})

import { openShareWindow, SHARE_WINDOW_LABEL } from "@/lib/share-window"
import { SHARE_PLUGINS_UPDATED, SHARE_READY } from "@/lib/share-window-events"

function makePlugins(): DisplayPluginState[] {
  return [
    {
      meta: {
        id: "codex",
        name: "Codex",
        iconUrl: "/codex.svg",
        brandColor: "#000000",
        lines: [],
        primaryCandidates: [],
      },
      data: null,
      loading: false,
      error: null,
      lastManualRefreshAt: null,
      lastUpdatedAt: null,
    },
  ]
}

describe("openShareWindow", () => {
  beforeEach(() => {
    state.getByLabelMock.mockReset()
    state.emitMock.mockReset().mockResolvedValue(undefined)
    state.listenMock.mockReset().mockResolvedValue(() => {})
    state.showMock.mockReset().mockResolvedValue(undefined)
    state.setFocusMock.mockReset().mockResolvedValue(undefined)
    state.onceHandlers.clear()
    state.constructorArgs.length = 0
  })

  it("focuses and re-sends the payload when the window already exists", async () => {
    state.getByLabelMock.mockResolvedValue({
      show: state.showMock,
      setFocus: state.setFocusMock,
    })
    const plugins = makePlugins()

    await openShareWindow(plugins)

    expect(state.getByLabelMock).toHaveBeenCalledWith(SHARE_WINDOW_LABEL)
    expect(state.showMock).toHaveBeenCalledTimes(1)
    expect(state.setFocusMock).toHaveBeenCalledTimes(1)
    expect(state.emitMock).toHaveBeenCalledWith(SHARE_PLUGINS_UPDATED, plugins)
    expect(state.constructorArgs).toHaveLength(0)
  })

  it("creates a window when absent and emits the payload once created", async () => {
    state.getByLabelMock.mockResolvedValue(null)
    const plugins = makePlugins()

    await openShareWindow(plugins)

    expect(state.constructorArgs).toHaveLength(1)
    expect(state.constructorArgs[0]?.label).toBe(SHARE_WINDOW_LABEL)
    // Payload is not sent until the window reports it was created.
    expect(state.emitMock).not.toHaveBeenCalled()

    const createdHandler = state.onceHandlers.get("tauri://created")
    expect(createdHandler).toBeDefined()
    createdHandler?.(undefined)

    expect(state.emitMock).toHaveBeenCalledWith(SHARE_PLUGINS_UPDATED, plugins)
  })

  it("registers a share:ready backup handshake when creating a window", async () => {
    state.getByLabelMock.mockResolvedValue(null)
    const plugins = makePlugins()

    await openShareWindow(plugins)

    expect(state.listenMock).toHaveBeenCalledWith(SHARE_READY, expect.any(Function))
    const readyHandler = state.listenMock.mock.calls[0]?.[1] as (event: unknown) => void
    readyHandler(undefined)
    expect(state.emitMock).toHaveBeenCalledWith(SHARE_PLUGINS_UPDATED, plugins)
  })

  it("calls onClosed when a freshly-created window is destroyed", async () => {
    state.getByLabelMock.mockResolvedValue(null)
    const onClosed = vi.fn()

    await openShareWindow(makePlugins(), onClosed)

    const destroyedHandler = state.onceHandlers.get("tauri://destroyed")
    expect(destroyedHandler).toBeDefined()
    destroyedHandler?.(undefined)

    expect(onClosed).toHaveBeenCalledTimes(1)
  })

  it("does not call onClosed when re-focusing an already-open window", async () => {
    state.getByLabelMock.mockResolvedValue({
      show: state.showMock,
      setFocus: state.setFocusMock,
    })
    const onClosed = vi.fn()

    await openShareWindow(makePlugins(), onClosed)

    expect(onClosed).not.toHaveBeenCalled()
  })

  it("logs loudly when window creation reports an error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    state.getByLabelMock.mockResolvedValue(null)

    await openShareWindow(makePlugins())
    const errorHandler = state.onceHandlers.get("tauri://error")
    expect(errorHandler).toBeDefined()
    errorHandler?.({ payload: "boom" })

    expect(errorSpy).toHaveBeenCalledWith("Failed to create share window:", { payload: "boom" })
    errorSpy.mockRestore()
  })

  it("logs loudly when getByLabel throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    state.getByLabelMock.mockRejectedValue(new Error("no window"))

    await openShareWindow(makePlugins())

    expect(errorSpy).toHaveBeenCalledWith("Failed to open share window:", expect.any(Error))
    errorSpy.mockRestore()
  })
})
