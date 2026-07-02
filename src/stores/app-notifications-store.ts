import { create } from "zustand"
import {
  DEFAULT_PACE_NOTIFICATION_SETTINGS,
  loadPaceNotificationSettings,
  savePaceNotificationSettings,
  type PaceNotificationSettings,
} from "@/lib/settings"

type AppNotificationsStore = {
  settings: PaceNotificationSettings
  hydrated: boolean
  /** Load persisted toggles once on startup. Safe to call repeatedly. */
  hydrate: () => Promise<void>
  /** Flip one milestone toggle and persist it. */
  setToggle: (key: keyof PaceNotificationSettings, value: boolean) => void
  resetState: () => void
}

const initialState = {
  settings: { ...DEFAULT_PACE_NOTIFICATION_SETTINGS },
  hydrated: false,
}

export const useAppNotificationsStore = create<AppNotificationsStore>((set, get) => ({
  ...initialState,
  hydrate: async () => {
    if (get().hydrated) return
    try {
      const settings = await loadPaceNotificationSettings()
      set({ settings, hydrated: true })
    } catch (error) {
      console.error("Failed to load pace notification settings:", error)
      set({ hydrated: true })
    }
  },
  setToggle: (key, value) => {
    const next = { ...get().settings, [key]: value }
    set({ settings: next })
    void savePaceNotificationSettings(next).catch((error) => {
      console.error("Failed to save pace notification settings:", error)
    })
  },
  resetState: () => set({ settings: { ...DEFAULT_PACE_NOTIFICATION_SETTINGS }, hydrated: false }),
}))
