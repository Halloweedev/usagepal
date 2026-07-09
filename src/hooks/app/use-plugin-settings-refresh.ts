import { useEffect } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { loadPluginSettings, type PluginSettings } from "@/lib/settings"

/** Reload plugin settings when another window changes them (`plugins:changed`,
 * emitted by e.g. finish_onboarding after the provider pick is saved), so the
 * already-running panel reflects the new enabled set without a restart. */
export function usePluginSettingsRefresh(
  setPluginSettings: (value: PluginSettings | null) => void
) {
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    let unlisten: (() => void) | undefined

    const setup = async () => {
      const stop = await listen("plugins:changed", () => {
        loadPluginSettings()
          .then((settings) => {
            if (!cancelled) setPluginSettings(settings)
          })
          .catch((error) => {
            console.error("Failed to reload plugin settings:", error)
          })
      })
      if (cancelled) {
        stop()
        return
      }
      unlisten = stop
    }

    void setup()

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [setPluginSettings])
}
