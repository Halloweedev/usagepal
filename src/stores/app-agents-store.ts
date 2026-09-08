import { create } from "zustand"
import type { AgentSession } from "@/bindings"

type AppAgentsStore = {
  sessions: AgentSession[]
  loading: boolean
  error: string | null
  lastUpdatedAt: number | null
  setSessions: (sessions: AgentSession[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setLastUpdatedAt: (value: number | null) => void
  resetState: () => void
}

const initialState = {
  sessions: [] as AgentSession[],
  loading: false,
  error: null as string | null,
  lastUpdatedAt: null as number | null,
}

export const useAppAgentsStore = create<AppAgentsStore>((set) => ({
  ...initialState,
  setSessions: (sessions) => set({ sessions }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setLastUpdatedAt: (lastUpdatedAt) => set({ lastUpdatedAt }),
  resetState: () => set(initialState),
}))
