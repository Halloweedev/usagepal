import { describe, expect, it, beforeEach } from "vitest"
import { useAppAgentsStore } from "@/stores/app-agents-store"
import type { AgentSession } from "@/bindings"

const session: AgentSession = {
  providerId: "claude",
  providerName: "Claude Code",
  projectName: "usagepal",
  sessionId: "abc123",
  cwd: "/Users/me/usagepal",
  title: null,
  lastActiveMs: 1_000,
  status: "active",
}

describe("app-agents-store", () => {
  beforeEach(() => {
    useAppAgentsStore.getState().resetState()
  })

  it("starts empty and idle", () => {
    const state = useAppAgentsStore.getState()
    expect(state.sessions).toEqual([])
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
    expect(state.lastUpdatedAt).toBeNull()
  })

  it("stores sessions, loading, error, and timestamp", () => {
    const { setSessions, setLoading, setError, setLastUpdatedAt } =
      useAppAgentsStore.getState()
    setSessions([session])
    setLoading(true)
    setError("boom")
    setLastUpdatedAt(1_234)

    const state = useAppAgentsStore.getState()
    expect(state.sessions).toEqual([session])
    expect(state.loading).toBe(true)
    expect(state.error).toBe("boom")
    expect(state.lastUpdatedAt).toBe(1_234)
  })

  it("resets to initial state", () => {
    useAppAgentsStore.getState().setSessions([session])
    useAppAgentsStore.getState().resetState()
    expect(useAppAgentsStore.getState().sessions).toEqual([])
  })
})
