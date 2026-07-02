import { useEffect, useRef } from "react"
import { isTauri } from "@tauri-apps/api/core"
import {
  isPermissionGranted,
  sendNotification,
} from "@tauri-apps/plugin-notification"
import type { PluginState } from "@/hooks/app/types"
import {
  anyEnabled,
  evaluate,
  MILESTONE_META,
  type NotificationState,
  type ProviderMetrics,
} from "@/lib/pace-notifications"
import { useAppNotificationsStore } from "@/stores/app-notifications-store"

/**
 * Evaluates quota pace milestones on every refresh and delivers OS notifications for the ones that
 * fire. Runs in the (hidden-but-alive) webview alongside the native scheduler: each scheduler tick
 * emits `usage:updated`, which re-hydrates `pluginStates`, which re-runs this evaluation — so alerts
 * fire even while the panel is closed.
 *
 * Dedup state lives in a ref (in-memory): it resets on app restart, which is intentional — the first
 * observation after launch primes the baseline without firing, so an already-bad quota doesn't spam
 * alerts on startup.
 */
export function usePaceNotifications(pluginStates: Record<string, PluginState>) {
  const settings = useAppNotificationsStore((s) => s.settings)
  const hydrate = useAppNotificationsStore((s) => s.hydrate)
  const statesRef = useRef<Map<string, NotificationState>>(new Map())

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    if (!isTauri() || !anyEnabled(settings)) return

    const providers: ProviderMetrics[] = Object.values(pluginStates)
      .map((state) => state.data)
      .filter((data): data is NonNullable<typeof data> => data != null)
      .map((data) => ({
        providerId: data.providerId,
        displayName: data.displayName,
        lines: data.lines,
      }))

    if (providers.length === 0) return

    const { fired, nextStates } = evaluate(providers, statesRef.current, settings, Date.now())
    statesRef.current = nextStates
    if (fired.length === 0) return

    let cancelled = false
    void (async () => {
      let granted = false
      try {
        granted = await isPermissionGranted()
      } catch (error) {
        console.error("Failed to read notification permission:", error)
      }
      // Not granted: leave the fired milestones unmarked so they re-fire once permission is on.
      if (!granted || cancelled) return

      for (const item of fired) {
        const meta = MILESTONE_META[item.milestone]
        try {
          sendNotification({
            title: meta.title,
            body: `${item.displayName} ${item.metricLabel} — ${meta.body}`,
          })
          // Commit the dedup mark only after a successful send.
          statesRef.current.get(item.key)?.firedMilestones.add(item.milestone)
        } catch (error) {
          console.error("Failed to send pace notification:", error)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [pluginStates, settings])
}
