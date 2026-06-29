import { useCallback } from "react"
import { useProbeEvents } from "@/hooks/use-probe-events"
import {
  type AutoUpdateIntervalMinutes,
  type PluginSettings,
} from "@/lib/settings"
import { useProbeAutoUpdate } from "@/hooks/app/use-probe-auto-update"
import { useProbeRefreshActions } from "@/hooks/app/use-probe-refresh-actions"
import { useProbeState } from "@/hooks/app/use-probe-state"
import { useUsageSync } from "@/hooks/app/use-usage-sync"

type UseProbeArgs = {
  pluginSettings: PluginSettings | null
  autoUpdateInterval: AutoUpdateIntervalMinutes
  onProbeResult?: () => void
}

export function useProbe({
  pluginSettings,
  autoUpdateInterval,
  onProbeResult,
}: UseProbeArgs) {
  const {
    pluginStates,
    pluginStatesRef,
    manualRefreshIdsRef,
    setLoadingForPlugins,
    setErrorForPlugins,
    handleProbeResult,
    applyCachedSnapshots,
  } = useProbeState({ onProbeResult })

  const handleBatchComplete = useCallback(() => {}, [])

  const { startBatch } = useProbeEvents({
    onResult: handleProbeResult,
    onBatchComplete: handleBatchComplete,
  })

  const {
    autoUpdateNextAt,
    setAutoUpdateNextAt,
    resetAutoUpdateSchedule,
  } = useProbeAutoUpdate({
    pluginSettings,
    autoUpdateInterval,
  })

  // The native scheduler owns the refresh loop; hydrate the UI from its cache
  // on mount, on `usage:updated`, and when the panel becomes visible. Anchor the
  // countdown to the scheduler's real next-run time so opening the panel doesn't
  // reset it; fall back to a local estimate if the scheduler hasn't reported yet.
  const handleNextUpdateAt = useCallback(
    (nextUpdateAt: number | null) => {
      if (typeof nextUpdateAt === "number" && nextUpdateAt > 0) {
        setAutoUpdateNextAt(nextUpdateAt)
      } else {
        resetAutoUpdateSchedule()
      }
    },
    [resetAutoUpdateSchedule, setAutoUpdateNextAt]
  )

  useUsageSync({
    applyCachedSnapshots,
    onNextUpdateAt: handleNextUpdateAt,
  })

  const { handleRetryPlugin, handleRefreshAll } = useProbeRefreshActions({
    pluginSettings,
    pluginStatesRef,
    manualRefreshIdsRef,
    resetAutoUpdateSchedule,
    setLoadingForPlugins,
    setErrorForPlugins,
    startBatch,
  })

  return {
    pluginStates,
    setLoadingForPlugins,
    setErrorForPlugins,
    startBatch,
    autoUpdateNextAt,
    setAutoUpdateNextAt,
    handleRetryPlugin,
    handleRefreshAll,
  }
}
