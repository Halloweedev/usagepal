import { useState, useEffect, useCallback, useRef } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { check, type Update } from "@tauri-apps/plugin-updater"
import type { BetaUpdateInfo, BetaUpdateProgress } from "@/bindings"

// Relaunch through our own command, not the process plugin's `relaunch()`.
// That plugin spawns the inner Mach-O binary directly, which recent macOS no
// longer launches after the updater has swapped the .app bundle — the app just
// quits. `relaunch_app` hands off to LaunchServices (`open`) instead.
const RELAUNCH_COMMAND = "relaunch_app"

export type UpdateChannel = "stable" | "beta"

const INDETERMINATE_PROGRESS = -1
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000
const UP_TO_DATE_RESET_MS = 3000

declare global {
  // eslint-disable-next-line no-var
  var __USAGEPAL_ENABLE_UPDATES__: boolean | undefined
}

function areAppUpdatesEnabled() {
  return globalThis.__USAGEPAL_ENABLE_UPDATES__ ?? true
}

function getDownloadProgress(downloadedBytes: number, totalBytes: number | null): number | null {
  if (!totalBytes || totalBytes <= 0) return null
  return Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
}

export type UpdateStatus =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "choice"; stableVersion: string; betaVersion: string }
  | { status: "up-to-date" }
  | { status: "downloading"; progress: number } // 0-100, or -1 if indeterminate
  | { status: "installing" }
  | { status: "ready"; channel: UpdateChannel; version: string }
  | { status: "error"; message: string }

interface UseAppUpdateOptions {
  betaUpdatesEnabled?: boolean
}

interface UseAppUpdateReturn {
  updateStatus: UpdateStatus
  triggerInstall: () => void
  chooseUpdate: (channel: UpdateChannel) => void
  checkForUpdates: () => void
}

export function useAppUpdate({ betaUpdatesEnabled = false }: UseAppUpdateOptions = {}): UseAppUpdateReturn {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: "idle" })
  const statusRef = useRef<UpdateStatus>({ status: "idle" })
  const updateRef = useRef<Update | null>(null)
  const betaUpdateReadyRef = useRef(false)
  const channelCycleRef = useRef(0)
  const downloadingUpdateRef = useRef<{ channel: UpdateChannel; version: string } | null>(null)
  const mountedRef = useRef(true)
  const inFlightRef = useRef({ checking: false, downloading: false, installing: false })
  const previousBetaUpdatesEnabledRef = useRef(betaUpdatesEnabled)
  const suppressNextAutomaticCheckRef = useRef(false)
  const upToDateTimeoutRef = useRef<number | null>(null)

  const setStatus = useCallback((next: UpdateStatus) => {
    statusRef.current = next
    if (!mountedRef.current) return
    setUpdateStatus(next)
  }, [])

  const scheduleUpToDateReset = useCallback(() => {
    setStatus({ status: "up-to-date" })
    upToDateTimeoutRef.current = window.setTimeout(() => {
      upToDateTimeoutRef.current = null
      if (mountedRef.current) setStatus({ status: "idle" })
    }, UP_TO_DATE_RESET_MS)
  }, [setStatus])

  const downloadBetaUpdate = useCallback(async (version: string, channelCycle: number) => {
    inFlightRef.current.downloading = true
    downloadingUpdateRef.current = { channel: "beta", version }
    setStatus({ status: "downloading", progress: INDETERMINATE_PROGRESS })
    try {
      await invoke("download_beta_update")
      if (channelCycle !== channelCycleRef.current) return
      betaUpdateReadyRef.current = true
      if (mountedRef.current) setStatus({ status: "ready", channel: "beta", version })
    } catch (err) {
      betaUpdateReadyRef.current = false
      if (channelCycle !== channelCycleRef.current) return
      console.error("Beta update download failed:", err)
      if (mountedRef.current) setStatus({ status: "error", message: "Download failed" })
    } finally {
      inFlightRef.current.downloading = false
      downloadingUpdateRef.current = null
    }
  }, [setStatus])

  const downloadStableUpdate = useCallback(async (update: Update, version: string, channelCycle: number) => {
    updateRef.current = update
    inFlightRef.current.downloading = true
    downloadingUpdateRef.current = { channel: "stable", version }
    setStatus({ status: "downloading", progress: INDETERMINATE_PROGRESS })

    let totalBytes: number | null = null
    let downloadedBytes = 0

    try {
      await update.download((event) => {
        if (channelCycle !== channelCycleRef.current) return
        if (!mountedRef.current) return
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? null
          downloadedBytes = 0
          setStatus({
            status: "downloading",
            progress: totalBytes ? 0 : INDETERMINATE_PROGRESS,
          })
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength
          const progress = getDownloadProgress(downloadedBytes, totalBytes)
          if (progress !== null) setStatus({ status: "downloading", progress })
        } else if (event.event === "Finished") {
          setStatus({ status: "ready", channel: "stable", version })
        }
      })
      if (channelCycle !== channelCycleRef.current) return
      setStatus({ status: "ready", channel: "stable", version })
    } catch (err) {
      if (channelCycle !== channelCycleRef.current) return
      console.error("Update download failed:", err)
      setStatus({ status: "error", message: "Download failed" })
    } finally {
      inFlightRef.current.downloading = false
      downloadingUpdateRef.current = null
    }
  }, [setStatus])

  const checkForUpdates = useCallback(async () => {
    if (!areAppUpdatesEnabled()) return
    if (!isTauri()) return
    if (inFlightRef.current.checking || inFlightRef.current.downloading || inFlightRef.current.installing) return
    if (statusRef.current.status === "ready" || statusRef.current.status === "choice") return

    // Clear any pending up-to-date timeout
    if (upToDateTimeoutRef.current !== null) {
      clearTimeout(upToDateTimeoutRef.current)
      upToDateTimeoutRef.current = null
    }
    inFlightRef.current.checking = true
    setStatus({ status: "checking" })
    const channelCycle = channelCycleRef.current
    try {
      if (betaUpdatesEnabled) {
        const [stableUpdate, betaUpdate] = await Promise.all([
          check(),
          invoke<BetaUpdateInfo | null>("check_beta_update"),
        ])
        inFlightRef.current.checking = false
        if (channelCycle !== channelCycleRef.current) return
        if (!mountedRef.current) return
        if (stableUpdate && betaUpdate) {
          updateRef.current = stableUpdate
          betaUpdateReadyRef.current = false
          setStatus({ status: "choice", stableVersion: stableUpdate.version, betaVersion: betaUpdate.version })
          return
        }

        if (stableUpdate) {
          await downloadStableUpdate(stableUpdate, stableUpdate.version, channelCycle)
          return
        }

        if (!betaUpdate) {
          betaUpdateReadyRef.current = false
          scheduleUpToDateReset()
          return
        }

        await downloadBetaUpdate(betaUpdate.version, channelCycle)
        return
      }

      const update = await check()
      inFlightRef.current.checking = false
      if (channelCycle !== channelCycleRef.current) return
      if (!mountedRef.current) return
      if (!update) {
        scheduleUpToDateReset()
        return
      }
      await downloadStableUpdate(update, update.version, channelCycle)
    } catch (err) {
      inFlightRef.current.checking = false
      if (channelCycle !== channelCycleRef.current) return
      if (!mountedRef.current) return
      console.error("Update check failed:", err)
      setStatus({ status: "error", message: "Update check failed" })
    }
  }, [betaUpdatesEnabled, downloadBetaUpdate, downloadStableUpdate, scheduleUpToDateReset, setStatus])

  useEffect(() => {
    if (previousBetaUpdatesEnabledRef.current === betaUpdatesEnabled) return

    previousBetaUpdatesEnabledRef.current = betaUpdatesEnabled
    channelCycleRef.current += 1
    betaUpdateReadyRef.current = false
    updateRef.current = null
    inFlightRef.current = { checking: false, downloading: false, installing: false }
    if (upToDateTimeoutRef.current !== null) {
      clearTimeout(upToDateTimeoutRef.current)
      upToDateTimeoutRef.current = null
    }
    statusRef.current = { status: "idle" }
    setUpdateStatus({ status: "idle" })
    suppressNextAutomaticCheckRef.current = true
  }, [betaUpdatesEnabled])

  useEffect(() => {
    if (!betaUpdatesEnabled || !isTauri()) return

    let totalBytes: number | null = null
    let downloadedBytes = 0
    let unlisten: (() => void) | undefined
    let disposed = false

    void listen<BetaUpdateProgress>("beta-update:progress", (event) => {
      if (!mountedRef.current) return
      const payload = event.payload
      if (payload.event === "Started") {
        totalBytes = payload.data.content_length
        downloadedBytes = 0
        setStatus({ status: "downloading", progress: totalBytes ? 0 : INDETERMINATE_PROGRESS })
      } else if (payload.event === "Progress") {
        downloadedBytes += payload.data.chunk_length ?? 0
        const progress = getDownloadProgress(downloadedBytes, totalBytes)
        if (progress !== null) setStatus({ status: "downloading", progress })
      } else if (payload.event === "Finished") {
        const update = downloadingUpdateRef.current
        if (update) setStatus({ status: "ready", ...update })
      }
    }).then((cleanup) => {
      if (disposed) {
        cleanup()
        return
      }
      unlisten = cleanup
    }).catch((error) => {
      console.error("Failed to listen for beta update progress:", error)
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [betaUpdatesEnabled, setStatus])

  useEffect(() => {
    mountedRef.current = true
    if (!areAppUpdatesEnabled()) {
      setStatus({ status: "idle" })
      return () => {
        mountedRef.current = false
      }
    }
    if (suppressNextAutomaticCheckRef.current) {
      suppressNextAutomaticCheckRef.current = false
    } else {
      void checkForUpdates()
    }

    const intervalId = setInterval(() => {
      void checkForUpdates()
    }, UPDATE_CHECK_INTERVAL_MS)

    return () => {
      mountedRef.current = false
      clearInterval(intervalId)
      if (upToDateTimeoutRef.current !== null) {
        clearTimeout(upToDateTimeoutRef.current)
      }
    }
  }, [checkForUpdates])

  const chooseUpdate = useCallback(async (channel: UpdateChannel) => {
    if (!areAppUpdatesEnabled()) return
    if (!isTauri()) return
    if (statusRef.current.status !== "choice") return
    if (inFlightRef.current.checking || inFlightRef.current.downloading || inFlightRef.current.installing) return

    const choice = statusRef.current
    const channelCycle = channelCycleRef.current
    if (channel === "stable") {
      const update = updateRef.current
      if (!update) return
      await downloadStableUpdate(update, choice.stableVersion, channelCycle)
      return
    }

    await downloadBetaUpdate(choice.betaVersion, channelCycle)
  }, [downloadBetaUpdate, downloadStableUpdate])

  const triggerInstall = useCallback(async () => {
    if (!areAppUpdatesEnabled()) return
    if (!isTauri()) return
    const readyStatus = statusRef.current.status === "ready" ? statusRef.current : null
    if (readyStatus?.channel === "beta") {
      if (!betaUpdateReadyRef.current) return
      if (inFlightRef.current.installing || inFlightRef.current.downloading) return

      try {
        inFlightRef.current.installing = true
        setStatus({ status: "installing" })
        await invoke("install_beta_update")
        await invoke(RELAUNCH_COMMAND)
        betaUpdateReadyRef.current = false
        setStatus({ status: "idle" })
      } catch (err) {
        console.error("Beta update install failed:", err)
        setStatus({ status: "error", message: "Install failed" })
      } finally {
        inFlightRef.current.installing = false
      }
      return
    }

    const update = updateRef.current
    if (!update) return
    if (!readyStatus || readyStatus.channel !== "stable") return
    if (inFlightRef.current.installing || inFlightRef.current.downloading) return

    try {
      inFlightRef.current.installing = true
      setStatus({ status: "installing" })
      await update.install()
      await invoke(RELAUNCH_COMMAND)
      setStatus({ status: "idle" })
    } catch (err) {
      console.error("Update install failed:", err)
      setStatus({ status: "error", message: "Install failed" })
    } finally {
      inFlightRef.current.installing = false
    }
  }, [setStatus])

  return { updateStatus, triggerInstall, chooseUpdate, checkForUpdates }
}
