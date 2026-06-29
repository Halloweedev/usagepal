import { create } from "zustand"
import {
  activate as klActivate,
  hasEntitlement as klHasEntitlement,
  validate as klValidate,
} from "tauri-plugin-keylight-api"

/** Entitlement a donor key must carry. Mirrors SUPPORTER_ENTITLEMENT in Rust. */
export const SUPPORTER_ENTITLEMENT = "supporter"

const ACTIVATED_FLAG = "keylight.hasActivated"

export type LicenseStatus = "unlicensed" | "active" | "checking" | "error"

type AppLicenseStore = {
  status: LicenseStatus
  /** Cached per-feature checks; the plugin has no "list entitlements" call. */
  entitlements: Record<string, boolean>
  lastError?: string
  /** Was a key ever activated on this device? Persisted so free users skip launch validation. */
  hasActivated: boolean
  activate: (key: string) => Promise<void>
  refresh: () => Promise<void>
}

function readActivated(): boolean {
  try {
    return localStorage.getItem(ACTIVATED_FLAG) === "true"
  } catch {
    return false
  }
}

function writeActivated(): void {
  try {
    localStorage.setItem(ACTIVATED_FLAG, "true")
  } catch {
    // localStorage unavailable — non-fatal; launch validation just won't run.
  }
}

export const useAppLicenseStore = create<AppLicenseStore>((set, get) => ({
  status: "unlicensed",
  entitlements: {},
  hasActivated: readActivated(),

  activate: async (key: string) => {
    const trimmed = key.trim()
    if (!trimmed) return
    set({ status: "checking", lastError: undefined })
    try {
      const ok = await klActivate(trimmed)
      if (!ok) {
        set({ status: "error", lastError: "This key isn't valid or has expired." })
        return
      }
      writeActivated()
      set({ hasActivated: true })
      await get().refresh()
    } catch (error) {
      console.error("keylight: activate failed", error)
      set({ status: "error", lastError: "Couldn't activate this key. Please try again." })
    }
  },

  refresh: async () => {
    set({ status: "checking", lastError: undefined })
    try {
      const valid = await klValidate()
      if (!valid) {
        set({ status: "unlicensed", entitlements: {} })
        return
      }
      const supporter = await klHasEntitlement(SUPPORTER_ENTITLEMENT)
      set({ status: "active", entitlements: { [SUPPORTER_ENTITLEMENT]: supporter } })
    } catch (error) {
      console.error("keylight: validate failed", error)
      set({ status: "error", lastError: "Couldn't check your license." })
    }
  },
}))
