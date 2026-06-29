import { useCallback, useEffect } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import type { CachedUsageSnapshot } from "@/hooks/app/use-probe-state"

type UseUsageSyncArgs = {
  applyCachedSnapshots: (snapshots: CachedUsageSnapshot[]) => void
  /**
   * Called with the native scheduler's next-run time (unix ms), or null if it
   * hasn't scheduled yet. Lets the countdown track the real schedule rather
   * than resetting to a full interval on every hydrate.
   */
  onNextUpdateAt: (nextUpdateAt: number | null) => void
}

/**
 * Hydrates plugin state from the native usage cache.
 *
 * The Rust auto-update scheduler probes in the background and emits
 * `usage:updated`. While the panel is hidden its WebView may be throttled and
 * miss those events, so we re-hydrate on three triggers: once on mount (instant
 * data on launch), on every `usage:updated`, and whenever the document becomes
 * visible again (panel re-opened). Each hydrate also reads the scheduler's
 * authoritative next-run time so the countdown stays accurate.
 */
export function useUsageSync({ applyCachedSnapshots, onNextUpdateAt }: UseUsageSyncArgs) {
  const hydrate = useCallback(async () => {
    if (!isTauri()) return
    try {
      const [snapshots, nextUpdateAt] = await Promise.all([
        invoke<CachedUsageSnapshot[]>("get_cached_usage"),
        invoke<number | null>("get_next_update_at"),
      ])
      applyCachedSnapshots(snapshots)
      onNextUpdateAt(typeof nextUpdateAt === "number" ? nextUpdateAt : null)
    } catch (error) {
      console.error("Failed to hydrate cached usage:", error)
    }
  }, [applyCachedSnapshots, onNextUpdateAt])

  useEffect(() => {
    void hydrate()

    let cancelled = false
    let unlisten: (() => void) | undefined

    if (isTauri()) {
      listen("usage:updated", () => {
        void hydrate()
      })
        .then((fn) => {
          if (cancelled) fn()
          else unlisten = fn
        })
        .catch((error) => {
          console.error("Failed to listen for usage:updated:", error)
        })
    }

    const handleVisibility = () => {
      if (!document.hidden) void hydrate()
    }
    document.addEventListener("visibilitychange", handleVisibility)

    return () => {
      cancelled = true
      unlisten?.()
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [hydrate])
}
