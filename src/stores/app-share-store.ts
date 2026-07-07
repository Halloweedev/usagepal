import { create } from "zustand"
import {
  DEFAULT_SHARE_SETTINGS,
  loadShareSettings,
  saveShareSettings,
  type ShareSettings,
} from "@/lib/settings"

type AppShareStore = {
  settings: ShareSettings
  hydrated: boolean
  /** Load persisted share options once on startup. Safe to call repeatedly. */
  hydrate: () => Promise<void>
  /** Merge a partial change into the options and persist the whole object. */
  patch: (partial: Partial<ShareSettings>) => void
  resetState: () => void
}

const initialState = {
  settings: { ...DEFAULT_SHARE_SETTINGS },
  hydrated: false,
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
  resetState: () => set({ settings: { ...DEFAULT_SHARE_SETTINGS }, hydrated: false }),
}))
