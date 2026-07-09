import { useEffect, useRef } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { loadPluginSettings, type PluginSettings } from "@/lib/settings"

const TRAY_SETTINGS_DEBOUNCE_MS = 2000

type UsePluginSettingsRefreshArgs = {
  pluginSettings: PluginSettings | null
  setPluginSettings: (value: PluginSettings | null) => void
  setLoadingForPlugins: (ids: string[]) => void
  setErrorForPlugins: (ids: string[], error: string) => void
  startBatch: (pluginIds?: string[]) => Promise<string[] | undefined>
  scheduleTrayIconUpdate: (reason: "probe" | "settings" | "init", delayMs?: number) => void
}

const enabledIds = (settings: PluginSettings) =>
  settings.order.filter((id) => !settings.disabled.includes(id))

/** Reload plugin settings when another window changes them (`plugins:changed`,
 * emitted by e.g. finish_onboarding after the provider pick is saved), so the
 * already-running panel reflects the new enabled set without a restart.
 * Plugins that just became enabled get probed immediately — mirroring the
 * Settings toggle — so they show data (or an error) instead of an empty view. */
export function usePluginSettingsRefresh({
  pluginSettings,
  setPluginSettings,
  setLoadingForPlugins,
  setErrorForPlugins,
  startBatch,
  scheduleTrayIconUpdate,
}: UsePluginSettingsRefreshArgs) {
  // Refs keep the event subscription stable across state changes.
  const currentSettingsRef = useRef(pluginSettings)
  currentSettingsRef.current = pluginSettings
  const actionsRef = useRef({ setPluginSettings, setLoadingForPlugins, setErrorForPlugins, startBatch, scheduleTrayIconUpdate })
  actionsRef.current = { setPluginSettings, setLoadingForPlugins, setErrorForPlugins, startBatch, scheduleTrayIconUpdate }

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    let unlisten: (() => void) | undefined

    const refresh = async () => {
      try {
        const next = await loadPluginSettings()
        if (cancelled) return
        const previous = currentSettingsRef.current
        const actions = actionsRef.current
        actions.setPluginSettings(next)

        if (!previous) return
        const previouslyEnabled = new Set(enabledIds(previous))
        const newlyEnabled = enabledIds(next).filter((id) => !previouslyEnabled.has(id))
        if (newlyEnabled.length === 0) return

        actions.scheduleTrayIconUpdate("settings", TRAY_SETTINGS_DEBOUNCE_MS)
        actions.setLoadingForPlugins(newlyEnabled)
        actions.startBatch(newlyEnabled).catch((error) => {
          console.error("Failed to start probe for enabled plugins:", error)
          actionsRef.current.setErrorForPlugins(newlyEnabled, "Failed to start probe")
        })
      } catch (error) {
        console.error("Failed to reload plugin settings:", error)
      }
    }

    const setup = async () => {
      const stop = await listen("plugins:changed", () => {
        void refresh()
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
  }, [])
}
