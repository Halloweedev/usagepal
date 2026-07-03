import { emit, listen } from "@tauri-apps/api/event"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"
import { SHARE_PLUGINS_UPDATED, SHARE_READY } from "@/lib/share-window-events"

export const SHARE_WINDOW_LABEL = "share"
export const SHARE_WINDOW_WIDTH = 920

/**
 * Opens (or focuses) the dedicated share pop-out window and seeds it with the
 * current plugin snapshot.
 *
 * If the window already exists it is shown, focused, and re-sent the payload.
 * Otherwise a fresh `WebviewWindow` is created; the payload is emitted once the
 * window reports `tauri://created`, with a `share:ready` handshake as a backup
 * in case the window mounts before that event is delivered. `onClosed` fires
 * once, when a freshly-created window is destroyed (e.g. the user closes it),
 * so the caller can stop treating it as open.
 *
 * Failures are logged loudly per AGENTS.md rather than swallowed silently.
 */
export async function openShareWindow(
  plugins: DisplayPluginState[],
  onClosed?: () => void
): Promise<void> {
  try {
    const existing = await WebviewWindow.getByLabel(SHARE_WINDOW_LABEL)
    if (existing) {
      await existing.show()
      await existing.setFocus()
      await emit(SHARE_PLUGINS_UPDATED, plugins)
      return
    }

    const shareWindow = new WebviewWindow(SHARE_WINDOW_LABEL, {
      url: "/",
      title: "Share Usage",
      width: SHARE_WINDOW_WIDTH,
      height: 480,
      resizable: true,
      center: true,
    })

    let unlistenReady: (() => void) | undefined
    unlistenReady = await listen(SHARE_READY, () => {
      emit(SHARE_PLUGINS_UPDATED, plugins).catch((error) => {
        console.error("Failed to send share payload on ready:", error)
      })
      unlistenReady?.()
    })

    shareWindow.once("tauri://created", () => {
      emit(SHARE_PLUGINS_UPDATED, plugins).catch((error) => {
        console.error("Failed to send share payload on create:", error)
      })
    })

    shareWindow.once("tauri://error", (event) => {
      console.error("Failed to create share window:", event)
      unlistenReady?.()
      onClosed?.()
    })

    shareWindow.once("tauri://destroyed", () => {
      onClosed?.()
    })
  } catch (error) {
    console.error("Failed to open share window:", error)
    onClosed?.()
  }
}
