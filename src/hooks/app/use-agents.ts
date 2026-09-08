import { useCallback, useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { invoke, isTauri } from "@tauri-apps/api/core"
import type { AgentSession } from "@/bindings"
import { useAppAgentsStore } from "@/stores/app-agents-store"

const POLL_INTERVAL_MS = 60_000

/**
 * Loads local agent sessions for the Agents page. Fetches on mount and
 * re-polls every minute while the page stays open; the scan is local file
 * stats, so polling is cheap.
 */
export function useAgents() {
  const { sessions, loading, error, lastUpdatedAt, setSessions, setLoading, setError, setLastUpdatedAt } =
    useAppAgentsStore(
      useShallow((state) => ({
        sessions: state.sessions,
        loading: state.loading,
        error: state.error,
        lastUpdatedAt: state.lastUpdatedAt,
        setSessions: state.setSessions,
        setLoading: state.setLoading,
        setError: state.setError,
        setLastUpdatedAt: state.setLastUpdatedAt,
      }))
    )

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await invoke<AgentSession[]>("list_agent_sessions")
      setSessions(data)
      setLastUpdatedAt(Date.now())
    } catch (error) {
      console.error("Failed to list agent sessions:", error)
      setError("Couldn't load agent sessions.")
    } finally {
      setLoading(false)
    }
  }, [setError, setLastUpdatedAt, setLoading, setSessions])

  useEffect(() => {
    if (!isTauri()) return
    void refresh()
    const timer = setInterval(() => {
      void refresh()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  return { sessions, loading, error, lastUpdatedAt, refresh }
}
