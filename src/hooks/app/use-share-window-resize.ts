import { useEffect, useRef, useState } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { getCurrentWindow, PhysicalSize, currentMonitor } from "@tauri-apps/api/window"
import { SHARE_WINDOW_LABEL, SHARE_WINDOW_WIDTH } from "@/lib/share-window"

const MAX_HEIGHT_FALLBACK_PX = 600
const MAX_HEIGHT_FRACTION_OF_MONITOR = 0.8
const OUTER_PADDING_Y_PX = 48

export function useShareWindowResize() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [maxContentHeightPx, setMaxContentHeightPx] = useState<number | null>(null)
  const maxContentHeightPxRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isTauri()) return
    const container = containerRef.current
    if (!container) return

    let cancelled = false

    const resizeWindow = async () => {
      if (cancelled) return

      try {
        const currentWindow = getCurrentWindow()
        if (currentWindow.label !== SHARE_WINDOW_LABEL) return

        const factor = window.devicePixelRatio
        const width = Math.ceil(SHARE_WINDOW_WIDTH * factor)
        const desiredHeightLogical = Math.max(1, container.scrollHeight)

        let maxHeightPhysical: number | null = null
        let maxHeightLogical: number | null = null

        try {
          const monitor = await currentMonitor()
          if (monitor) {
            maxHeightPhysical = Math.floor(monitor.size.height * MAX_HEIGHT_FRACTION_OF_MONITOR)
            maxHeightLogical = Math.floor(maxHeightPhysical / factor)
          }
        } catch {
          // fall through to fallback
        }

        if (maxHeightLogical === null) {
          const screenAvailHeight = Number(window.screen?.availHeight) || MAX_HEIGHT_FALLBACK_PX
          maxHeightLogical = Math.floor(screenAvailHeight * MAX_HEIGHT_FRACTION_OF_MONITOR)
          maxHeightPhysical = Math.floor(maxHeightLogical * factor)
        }

        const innerMaxLogical = Math.max(1, maxHeightLogical - OUTER_PADDING_Y_PX)
        if (maxContentHeightPxRef.current !== innerMaxLogical) {
          maxContentHeightPxRef.current = innerMaxLogical
          setMaxContentHeightPx(innerMaxLogical)
        }

        const desiredHeightPhysical = Math.ceil(desiredHeightLogical * factor)
        const height = Math.ceil(Math.min(desiredHeightPhysical, maxHeightPhysical!))

        await currentWindow.setSize(new PhysicalSize(width, height))
      } catch (error) {
        console.error("Failed to resize share window:", error)
      }
    }

    void resizeWindow()

    const observer = new ResizeObserver(() => {
      void resizeWindow()
    })
    observer.observe(container)

    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [])

  return {
    containerRef,
    maxContentHeightPx,
  }
}
