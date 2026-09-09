import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentSession } from "@/bindings"

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(() => true),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}))

import { useAgents } from "@/hooks/app/use-agents"
import { useAppAgentsStore } from "@/stores/app-agents-store"

const session: AgentSession = {
  providerId: "claude",
  providerName: "Claude Code",
  projectName: "usagepal",
  sessionId: "abc123",
  cwd: "/Users/me/usagepal",
  title: null,
  subagents: [],
  lastActiveMs: 1_000,
  status: "active",
}

describe("useAgents", () => {
  beforeEach(() => {
    vi.useRealTimers()
    invokeMock.mockReset()
    isTauriMock.mockReset().mockReturnValue(true)
    useAppAgentsStore.getState().resetState()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("loads sessions on mount", async () => {
    invokeMock.mockResolvedValue([session])

    const { result } = renderHook(() => useAgents())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(invokeMock).toHaveBeenCalledWith("list_agent_sessions", { refresh: false })
    expect(result.current.sessions).toEqual([session])
    expect(result.current.error).toBeNull()
    expect(result.current.lastUpdatedAt).toEqual(expect.any(Number))
  })

  it("bypasses the cache on manual refresh", async () => {
    invokeMock.mockResolvedValue([session])

    const { result } = renderHook(() => useAgents())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    invokeMock.mockClear()

    await act(async () => {
      await result.current.refresh(true)
    })
    expect(invokeMock).toHaveBeenCalledWith("list_agent_sessions", { refresh: true })
  })

  it("surfaces load failures without throwing", async () => {
    invokeMock.mockRejectedValue(new Error("boom"))

    const { result } = renderHook(() => useAgents())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.error).toBe("Couldn't load agent sessions.")
    expect(result.current.sessions).toEqual([])
  })

  it("skips loading outside Tauri", () => {
    isTauriMock.mockReturnValue(false)

    const { result } = renderHook(() => useAgents())

    expect(invokeMock).not.toHaveBeenCalled()
    expect(result.current.sessions).toEqual([])
  })

  it("re-polls while mounted", async () => {
    vi.useFakeTimers()
    invokeMock.mockResolvedValue([session])

    renderHook(() => useAgents())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(invokeMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
