import { render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { currentMonitorMock, getCurrentWindowMock, isTauriMock, setSizeMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(),
  getCurrentWindowMock: vi.fn(),
  currentMonitorMock: vi.fn(),
  setSizeMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: isTauriMock,
}))

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: getCurrentWindowMock,
  currentMonitor: currentMonitorMock,
  PhysicalSize: class PhysicalSize {
    width: number
    height: number

    constructor(width: number, height: number) {
      this.width = width
      this.height = height
    }
  },
}))

import { useShareWindowResize } from "@/hooks/app/use-share-window-resize"
import { SHARE_WINDOW_LABEL, SHARE_WINDOW_WIDTH } from "@/lib/share-window"

function ShareWindowResizeHarness() {
  const { containerRef } = useShareWindowResize()
  return (
    <div ref={containerRef} data-testid="share-resize-container">
      <div style={{ height: 320 }}>Share content</div>
    </div>
  )
}

describe("useShareWindowResize", () => {
  beforeEach(() => {
    isTauriMock.mockReset().mockReturnValue(true)
    getCurrentWindowMock.mockReset()
    currentMonitorMock.mockReset().mockResolvedValue(null)
    setSizeMock.mockReset().mockResolvedValue(undefined)
    getCurrentWindowMock.mockReturnValue({
      label: SHARE_WINDOW_LABEL,
      setSize: setSizeMock,
    })

    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 2,
    })
    Object.defineProperty(window.screen, "availHeight", {
      configurable: true,
      value: 800,
    })
  })

  it("does nothing when not running in Tauri", () => {
    isTauriMock.mockReturnValue(false)
    render(<ShareWindowResizeHarness />)
    expect(setSizeMock).not.toHaveBeenCalled()
  })

  it("resizes the share window to fit the observed container height", async () => {
    render(<ShareWindowResizeHarness />)

    await waitFor(() => expect(setSizeMock).toHaveBeenCalled())

    const sizeArg = setSizeMock.mock.calls.at(-1)?.[0]
    expect(sizeArg.width).toBe(Math.ceil(SHARE_WINDOW_WIDTH * 2))
    expect(sizeArg.height).toBeGreaterThan(0)
  })

  it("skips resizing when the current window is not the share window", async () => {
    getCurrentWindowMock.mockReturnValue({
      label: "main",
      setSize: setSizeMock,
    })

    render(<ShareWindowResizeHarness />)

    await waitFor(() => {
      expect(getCurrentWindowMock).toHaveBeenCalled()
    })

    expect(setSizeMock).not.toHaveBeenCalled()
  })
})
