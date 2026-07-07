import { useCallback, useEffect, useRef, useState } from "react"
import type { CachedPluginSnapshot } from "@/bindings"
import type { PluginOutput } from "@/lib/plugin-types"
import type { PluginState } from "@/hooks/app/types"
import { mergeRateLimitedProbeOutput } from "@/lib/probe-output-merge"

export type CachedUsageSnapshot = CachedPluginSnapshot

type UseProbeStateArgs = {
  onProbeResult?: () => void
}

export function useProbeState({ onProbeResult }: UseProbeStateArgs) {
  const [pluginStates, setPluginStates] = useState<Record<string, PluginState>>({})

  const pluginStatesRef = useRef(pluginStates)
  useEffect(() => {
    pluginStatesRef.current = pluginStates
  }, [pluginStates])

  const manualRefreshIdsRef = useRef<Set<string>>(new Set())

  const updatePluginStates = useCallback(
    (
      updater: (
        previousStates: Record<string, PluginState>
      ) => Record<string, PluginState>
    ) => {
      const nextStates = updater(pluginStatesRef.current)
      pluginStatesRef.current = nextStates
      setPluginStates(nextStates)
    },
    []
  )

  const getErrorMessage = useCallback((output: PluginOutput) => {
    if (output.lines.length !== 1) return null
    const line = output.lines[0]
    if (line.type === "badge" && line.label === "Error") {
      return line.text || "Couldn't update data. Try again?"
    }
    return null
  }, [])

  const setLoadingForPlugins = useCallback((ids: string[]) => {
    updatePluginStates((prev) => {
      const next = { ...prev }
      for (const id of ids) {
        const existing = prev[id]
        next[id] = {
          data: existing?.data ?? null,
          loading: true,
          error: null,
          lastManualRefreshAt: existing?.lastManualRefreshAt ?? null,
          lastUpdatedAt: existing?.lastUpdatedAt ?? null,
        }
      }
      return next
    })
  }, [updatePluginStates])

  const setErrorForPlugins = useCallback((ids: string[], error: string) => {
    updatePluginStates((prev) => {
      const next = { ...prev }
      for (const id of ids) {
        const existing = prev[id]
        next[id] = {
          data: existing?.data ?? null,
          loading: false,
          error,
          lastManualRefreshAt: existing?.lastManualRefreshAt ?? null,
          lastUpdatedAt: existing?.lastUpdatedAt ?? null,
        }
      }
      return next
    })
  }, [updatePluginStates])

  const handleProbeResult = useCallback(
    (output: PluginOutput) => {
      const errorMessage = getErrorMessage(output)
      const isManual = manualRefreshIdsRef.current.has(output.providerId)
      if (isManual) {
        manualRefreshIdsRef.current.delete(output.providerId)
      }

      const now = Date.now()
      updatePluginStates((prev) => {
        const existing = prev[output.providerId]
        const nextData = errorMessage
          ? (existing?.data ?? null)
          : mergeRateLimitedProbeOutput(output, existing?.data)
        return {
          ...prev,
          [output.providerId]: {
            data: nextData,
            loading: false,
            error: errorMessage,
            lastManualRefreshAt: !errorMessage && isManual
              ? now
              : existing?.lastManualRefreshAt ?? null,
            lastUpdatedAt: errorMessage ? (existing?.lastUpdatedAt ?? null) : now,
          },
        }
      })

      onProbeResult?.()
    },
    [getErrorMessage, onProbeResult, updatePluginStates]
  )

  /**
   * Populate plugin state from cached snapshots (native scheduler / hydrate on
   * open). The cache only holds successful outputs, so this clears stale errors
   * and shows last-known-good data. Plugins mid manual-refresh are skipped so
   * an in-flight refresh isn't clobbered, and `lastUpdatedAt` reflects the real
   * fetch time from the cache rather than "now".
   */
  const applyCachedSnapshots = useCallback(
    (snapshots: CachedUsageSnapshot[]) => {
      if (!Array.isArray(snapshots) || snapshots.length === 0) return
      updatePluginStates((prev) => {
        const next = { ...prev }
        for (const snapshot of snapshots) {
          const existing = prev[snapshot.providerId]
          if (existing?.loading) continue
          const fetchedMs = Date.parse(snapshot.fetchedAt)
          next[snapshot.providerId] = {
            data: {
              providerId: snapshot.providerId,
              displayName: snapshot.displayName,
              plan: snapshot.plan,
              lines: snapshot.lines,
              iconUrl: existing?.data?.iconUrl ?? "",
            },
            loading: false,
            error: null,
            lastManualRefreshAt: existing?.lastManualRefreshAt ?? null,
            lastUpdatedAt: Number.isFinite(fetchedMs)
              ? fetchedMs
              : existing?.lastUpdatedAt ?? Date.now(),
          }
        }
        return next
      })

      // Mirror handleProbeResult: signal the tray to re-render from the
      // hydrated data. Without this, scheduler-driven refreshes (e.g. after
      // wake-from-sleep, via `usage:updated`) update pluginStates — so the
      // in-app view refreshes — but the tray icon keeps stale fractions.
      onProbeResult?.()
    },
    [onProbeResult, updatePluginStates]
  )

  return {
    pluginStates,
    pluginStatesRef,
    manualRefreshIdsRef,
    setLoadingForPlugins,
    setErrorForPlugins,
    handleProbeResult,
    applyCachedSnapshots,
  }
}
