import { useEffect, useState } from "react"
import { emit, listen } from "@tauri-apps/api/event"
import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"
import {
  SHARE_PLUGINS_UPDATED,
  SHARE_READY,
  type SharePluginsUpdatedPayload,
} from "@/lib/share-window-events"

/**
 * Data hook for the pop-out share window. Listens for `share:plugins-updated`
 * from the main window and emits `share:ready` once the listener is wired up so
 * the main window can (re)send the current snapshot without a lost-first-event
 * race.
 */
export function useShareWindowData(): DisplayPluginState[] {
  const [plugins, setPlugins] = useState<DisplayPluginState[]>([])

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined

    listen<SharePluginsUpdatedPayload>(SHARE_PLUGINS_UPDATED, (event) => {
      setPlugins(event.payload)
    })
      .then((fn) => {
        if (cancelled) {
          fn()
          return
        }
        unlisten = fn
        emit(SHARE_READY).catch((error) => {
          console.error("Failed to emit share:ready:", error)
        })
      })
      .catch((error) => {
        console.error("Failed to listen for share:plugins-updated:", error)
      })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  return plugins
}
