import { create } from "zustand"
import { loadBudgetMap, saveBudgetMap } from "@/lib/settings"
import { sanitizeBudgetPercent, type BudgetMap } from "@/lib/pace-notifications"

type AppBudgetsStore = {
  budgets: BudgetMap
  hydrated: boolean
  /** Load persisted budgets once on startup. Safe to call repeatedly. */
  hydrate: () => Promise<void>
  /** Set a provider's budget percent (1–100), or clear it with null. Persists. */
  setBudget: (providerId: string, percent: number | null) => void
  resetState: () => void
}

const initialState = {
  budgets: {} as BudgetMap,
  hydrated: false,
}

async function loadBudgets(): Promise<BudgetMap> {
  return loadBudgetMap()
}

async function saveBudgets(budgets: BudgetMap): Promise<void> {
  return saveBudgetMap(budgets)
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
  setBudget: (providerId, percent) => {
    const clean = percent == null ? null : sanitizeBudgetPercent(percent)
    const next = { ...get().budgets }
    if (clean == null) delete next[providerId]
    else next[providerId] = clean
    set({ budgets: next })
    void saveBudgets(next).catch((error) => {
      console.error("Failed to save usage budgets:", error)
    })
  },
  resetState: () => set({ budgets: {}, hydrated: false }),
}))
