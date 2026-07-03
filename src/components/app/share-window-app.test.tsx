import { act, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  emitMock: vi.fn(),
  listenMock: vi.fn(),
  sharePageMock: vi.fn(),
  loadThemeModeMock: vi.fn(),
  handlers: new Map<string, (event: unknown) => void>(),
}))

vi.mock("@tauri-apps/api/event", () => ({
  emit: state.emitMock,
  listen: state.listenMock,
}))

vi.mock("@/pages/share", () => ({
  SharePage: (props: unknown) => {
    state.sharePageMock(props)
    return <div data-testid="share-page" />
  },
}))

vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings")
  return {
    ...actual,
    loadThemeMode: state.loadThemeModeMock,
  }
})

import { ShareWindowApp } from "@/components/app/share-window-app"
import { SHARE_PLUGINS_UPDATED, SHARE_READY } from "@/lib/share-window-events"

describe("ShareWindowApp", () => {
  beforeEach(() => {
    state.emitMock.mockReset().mockResolvedValue(undefined)
    state.listenMock.mockReset()
    state.sharePageMock.mockReset()
    state.loadThemeModeMock.mockReset().mockResolvedValue("dark")
    state.handlers.clear()
    state.listenMock.mockImplementation(async (event: string, handler: (event: unknown) => void) => {
      state.handlers.set(event, handler)
      return () => state.handlers.delete(event)
    })
  })

  it("emits share:ready after wiring up its listener", async () => {
    render(<ShareWindowApp />)

    await waitFor(() =>
      expect(state.listenMock).toHaveBeenCalledWith(SHARE_PLUGINS_UPDATED, expect.any(Function))
    )
    await waitFor(() => expect(state.emitMock).toHaveBeenCalledWith(SHARE_READY))
  })

  it("renders SharePage with plugins received via share:plugins-updated", async () => {
    render(<ShareWindowApp />)

    await waitFor(() => expect(state.handlers.get(SHARE_PLUGINS_UPDATED)).toBeDefined())
    expect(screen.getByTestId("share-page")).toBeInTheDocument()
    // First render passes the empty initial snapshot.
    expect(state.sharePageMock).toHaveBeenLastCalledWith(expect.objectContaining({ plugins: [] }))

    const plugins = [
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

    await act(async () => {
      state.handlers.get(SHARE_PLUGINS_UPDATED)?.({ payload: plugins })
    })

    await waitFor(() =>
      expect(state.sharePageMock).toHaveBeenLastCalledWith(expect.objectContaining({ plugins }))
    )
  })

  it("applies the stored theme mode", async () => {
    render(<ShareWindowApp />)
    await waitFor(() => expect(state.loadThemeModeMock).toHaveBeenCalled())
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true))
  })
})
