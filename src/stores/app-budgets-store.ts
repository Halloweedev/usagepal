import { create } from "zustand"
import { loadBudgetMap, saveBudgetMap } from "@/lib/settings"
import {
  localDayKey,
  sanitizeBudgetPercent,
  type DailyBudgetMap,
} from "@/lib/pace-notifications"

type AppBudgetsStore = {
  budgets: DailyBudgetMap
  hydrated: boolean
  /** Load persisted budgets once on startup. Safe to call repeatedly. */
  hydrate: () => Promise<void>
  /**
   * Set the budget for a provider on one local day (1–100, defaults to today),
   * snapshotting each meter's current usage so a same-day budget counts from now.
   * Pass null to clear that day. `snapshot` maps metric keys (see `metricKey`)
   * to used fractions. Persists.
   */
  setBudget: (
    providerId: string,
    percent: number | null,
    snapshot?: Record<string, number>,
    day?: string
  ) => void
  resetState: () => void
}

const initialState = {
  budgets: {} as DailyBudgetMap,
  hydrated: false,
}

async function loadBudgets(): Promise<DailyBudgetMap> {
  return loadBudgetMap()
}

async function saveBudgets(budgets: DailyBudgetMap): Promise<void> {
  return saveBudgetMap(budgets)
}

function sanitizeSnapshot(snapshot: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  if (!snapshot) return out
  for (const [key, used] of Object.entries(snapshot)) {
    if (typeof used === "number" && Number.isFinite(used) && used >= 0) {
      out[key] = used
    }
  }
  return out
}

export const useAppBudgetsStore = create<AppBudgetsStore>((set, get) => ({
  ...initialState,
  hydrate: async () => {
    if (get().hydrated) return
    try {
      const budgets = await loadBudgets()
      set({ budgets, hydrated: true })
    } catch (error) {
      console.error("Failed to load usage budgets:", error)
      set({ hydrated: true })
    }
  },
  setBudget: (providerId, percent, snapshot, day = localDayKey()) => {
    const clean = percent == null ? null : sanitizeBudgetPercent(percent)
    const next = { ...get().budgets }
    const days = { ...(next[providerId] ?? {}) }
    if (clean == null) {
      delete days[day]
    } else {
      days[day] = {
        percent: clean,
        day,
        baselines: sanitizeSnapshot(snapshot),
        setAt: Date.now(),
      }
    }
    if (Object.keys(days).length === 0) delete next[providerId]
    else next[providerId] = days
    set({ budgets: next })
    void saveBudgets(next).catch((error) => {
      console.error("Failed to save usage budgets:", error)
    })
  },
  resetState: () => set({ budgets: {}, hydrated: false }),
}))
