import { useCallback, useEffect, useState } from "react"
import {
  getEnabledPluginIds,
  type AutoUpdateIntervalMinutes,
  type PluginSettings,
} from "@/lib/settings"

type UseProbeAutoUpdateArgs = {
  pluginSettings: PluginSettings | null
  autoUpdateInterval: AutoUpdateIntervalMinutes
}

/**
 * Tracks the *display-only* countdown for the next auto-update.
 *
 * The actual refresh loop now runs natively in Rust
 * (`start_auto_update_scheduler`), so this hook no longer schedules or triggers
 * probes — removing that timer is what lets the hidden panel's WebView throttle
 * its JS. The countdown is seeded from the interval and re-synced whenever the
 * native scheduler emits `usage:updated` (via `useUsageSync`, which calls
 * `resetAutoUpdateSchedule`) or the interval changes.
 */
export function useProbeAutoUpdate({
  pluginSettings,
  autoUpdateInterval,
}: UseProbeAutoUpdateArgs) {
  const [autoUpdateNextAt, setAutoUpdateNextAt] = useState<number | null>(null)

  const computeNextAt = useCallback((): number | null => {
    if (!pluginSettings) return null
    if (getEnabledPluginIds(pluginSettings).length === 0) return null
    return Date.now() + autoUpdateInterval * 60_000
  }, [autoUpdateInterval, pluginSettings])

  useEffect(() => {
    setAutoUpdateNextAt(computeNextAt())
  }, [computeNextAt])

  const resetAutoUpdateSchedule = useCallback(() => {
    setAutoUpdateNextAt(computeNextAt())
  }, [computeNextAt])

  return {
    autoUpdateNextAt,
    setAutoUpdateNextAt,
    resetAutoUpdateSchedule,
  }
}
