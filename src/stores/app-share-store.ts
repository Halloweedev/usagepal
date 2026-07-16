import { create } from "zustand"
import {
  DEFAULT_SHARE_SETTINGS,
  loadShareSettings,
  saveShareSettings,
  type ShareSettings,
} from "@/lib/settings"
import type { UsagePeriod } from "@/lib/today-models"

type AppShareStore = {
  settings: ShareSettings
  hydrated: boolean
  /** One-shot graph-period handoff for "share this view" navigation. Kept out
   * of the persisted settings — the share page still opens on Today normally. */
  pendingGraphPeriod: UsagePeriod | null
  /** Load persisted share options once on startup. Safe to call repeatedly. */
  hydrate: () => Promise<void>
  /** Merge a partial change into the options and persist the whole object. */
  patch: (partial: Partial<ShareSettings>) => void
  setPendingGraphPeriod: (period: UsagePeriod) => void
  /** Read and clear the pending graph period (consumed by the share page on mount). */
  takePendingGraphPeriod: () => UsagePeriod | null
  resetState: () => void
}

const initialState = {
  settings: { ...DEFAULT_SHARE_SETTINGS },
  hydrated: false,
  pendingGraphPeriod: null,
}

export const useAppShareStore = create<AppShareStore>((set, get) => ({
  ...initialState,
  hydrate: async () => {
    if (get().hydrated) return
    try {
      const settings = await loadShareSettings()
      set({ settings, hydrated: true })
    } catch (error) {
      console.error("Failed to load share settings:", error)
      set({ hydrated: true })
    }
  },
  patch: (partial) => {
    const next = { ...get().settings, ...partial }
    set({ settings: next })
    void saveShareSettings(next).catch((error) => {
      console.error("Failed to save share settings:", error)
    })
  },
  setPendingGraphPeriod: (period) => set({ pendingGraphPeriod: period }),
  takePendingGraphPeriod: () => {
    const period = get().pendingGraphPeriod
    if (period != null) set({ pendingGraphPeriod: null })
    return period
  },
  resetState: () => set({ settings: { ...DEFAULT_SHARE_SETTINGS }, hydrated: false, pendingGraphPeriod: null }),
}))
