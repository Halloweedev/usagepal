import { useCallback, useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { resolveResource } from "@tauri-apps/api/path"
import { TrayIcon, type TrayIconEvent } from "@tauri-apps/api/tray"
import type { PluginMeta } from "@/lib/plugin-types"
import type { DisplayMode, MenubarIconStyle, MenubarMetric, PluginSettings } from "@/lib/settings"
import { getEnabledPluginIds } from "@/lib/settings"
import { getTrayIconSizePx, renderTrayBarsIcon } from "@/lib/tray-bars-icon"
import { getTrayPrimaryBars, getTrayWeeklyFraction, type TrayPrimaryBar } from "@/lib/tray-primary-progress"
import {
  formatTrayPercentIfPresent,
  formatTrayPercentText,
  formatTrayTooltip,
  formatTrayTooltipMulti,
  type TrayMultiProviderRow,
} from "@/lib/tray-tooltip"
import type { PluginState } from "@/hooks/app/types"

type TrayUpdateReason = "probe" | "settings" | "init"

const MULTI_TRAY_IDS = ["tray", "tray-multi-1", "tray-multi-2"] as const
const MULTI_AUX_TRAY_IDS = ["tray-multi-1", "tray-multi-2"] as const
const MULTI_MAX_PROVIDERS = 3

type UseTrayIconArgs = {
  pluginsMeta: PluginMeta[]
  pluginSettings: PluginSettings | null
  pluginStates: Record<string, PluginState>
  displayMode: DisplayMode
  menubarIconStyle: MenubarIconStyle
  menubarMetric: MenubarMetric
  activeView: string
}

export type TrayMultiProviderPreview = {
  id: string
  iconUrl?: string
  sessionText?: string
  weeklyText?: string
}

export type TraySettingsPreview = {
  bars: TrayPrimaryBar[]
  providerBars: TrayPrimaryBar[]
  providerIconUrl?: string
  providerPercentText: string
  multiProviders: TrayMultiProviderPreview[]
}

const EMPTY_TRAY_SETTINGS_PREVIEW: TraySettingsPreview = {
  bars: [],
  providerBars: [],
  providerPercentText: "--%",
  multiProviders: [],
}

function isSameTraySettingsPreview(a: TraySettingsPreview, b: TraySettingsPreview): boolean {
  if (a.providerIconUrl !== b.providerIconUrl) return false
  if (a.providerPercentText !== b.providerPercentText) return false
  if (a.bars.length !== b.bars.length) return false
  if (a.providerBars.length !== b.providerBars.length) return false
  for (let i = 0; i < a.bars.length; i += 1) {
    if (a.bars[i]?.id !== b.bars[i]?.id) return false
    if (a.bars[i]?.fraction !== b.bars[i]?.fraction) return false
  }
  for (let i = 0; i < a.providerBars.length; i += 1) {
    if (a.providerBars[i]?.id !== b.providerBars[i]?.id) return false
    if (a.providerBars[i]?.fraction !== b.providerBars[i]?.fraction) return false
  }
  if (a.multiProviders.length !== b.multiProviders.length) return false
  for (let i = 0; i < a.multiProviders.length; i += 1) {
    const left = a.multiProviders[i]
    const right = b.multiProviders[i]
    if (left?.id !== right?.id) return false
    if (left?.iconUrl !== right?.iconUrl) return false
    if (left?.sessionText !== right?.sessionText) return false
    if (left?.weeklyText !== right?.weeklyText) return false
  }
  return true
}

export function useTrayIcon({
  pluginsMeta,
  pluginSettings,
  pluginStates,
  displayMode,
  menubarIconStyle,
  menubarMetric,
  activeView,
}: UseTrayIconArgs) {
  const trayRef = useRef<TrayIcon | null>(null)
  const multiTrayRefs = useRef<Map<string, TrayIcon>>(new Map())
  const trayGaugeIconPathRef = useRef<string | null>(null)
  const trayUpdateTimerRef = useRef<number | null>(null)
  const trayUpdatePendingRef = useRef(false)
  const trayUpdateQueuedRef = useRef(false)
  const [trayReady, setTrayReady] = useState(false)
  const [traySettingsPreview, setTraySettingsPreview] = useState<TraySettingsPreview>(
    EMPTY_TRAY_SETTINGS_PREVIEW
  )

  const pluginsMetaRef = useRef(pluginsMeta)
  const pluginSettingsRef = useRef(pluginSettings)
  const pluginStatesRef = useRef(pluginStates)
  const displayModeRef = useRef(displayMode)
  const menubarIconStyleRef = useRef(menubarIconStyle)
  const menubarMetricRef = useRef(menubarMetric)
  const activeViewRef = useRef(activeView)
  const lastTrayProviderIdRef = useRef<string | null>(null)

  const handleAuxTrayClick = useCallback((event: TrayIconEvent) => {
    if (event.type !== "Click") return
    if (event.button !== "Left" || event.buttonState !== "Up") return
    const scale = window.devicePixelRatio || 1
    const pos = event.rect.position
    const size = event.rect.size
    void invoke("toggle_panel_at_tray_rect", {
      rect: {
        x: pos.x / scale,
        y: pos.y / scale,
        width: size.width / scale,
        height: size.height / scale,
      },
    }).catch((e) => console.error("aux tray click failed:", e))
  }, [])

  // Single sync effect replaces 7 individual useRef+useEffect pairs.
  // No deps array = runs after every render, keeping refs current for the
  // `scheduleTrayIconUpdate` callback without forcing it to be recreated.
  useEffect(() => {
    pluginsMetaRef.current = pluginsMeta
    pluginSettingsRef.current = pluginSettings
    pluginStatesRef.current = pluginStates
    displayModeRef.current = displayMode
    menubarIconStyleRef.current = menubarIconStyle
    menubarMetricRef.current = menubarMetric
    activeViewRef.current = activeView
  })

  const scheduleTrayIconUpdate = useCallback((
    _reason: TrayUpdateReason,
    delayMs = 0,
  ) => {
    if (trayUpdateTimerRef.current !== null) {
      window.clearTimeout(trayUpdateTimerRef.current)
      trayUpdateTimerRef.current = null
    }

    trayUpdateTimerRef.current = window.setTimeout(() => {
      void (async () => {
      trayUpdateTimerRef.current = null
      if (trayUpdatePendingRef.current) {
        trayUpdateQueuedRef.current = true
        return
      }
      trayUpdatePendingRef.current = true

      const finalizeUpdate = () => {
        trayUpdatePendingRef.current = false
        if (!trayUpdateQueuedRef.current) return
        trayUpdateQueuedRef.current = false
        scheduleTrayIconUpdate("probe", 0)
      }

      const tray = trayRef.current
      if (!tray) {
        finalizeUpdate()
        return
      }

      async function removeAuxTrays(): Promise<void> {
        for (const id of MULTI_AUX_TRAY_IDS) {
          try {
            await TrayIcon.removeById(id)
          } catch {
            // already removed
          }
          multiTrayRefs.current.delete(id)
        }
      }

      async function ensureMultiTray(id: string, isPrimary: boolean): Promise<TrayIcon> {
        const cached = multiTrayRefs.current.get(id)
        if (cached) return cached

        if (isPrimary) {
          const primaryTray = trayRef.current ?? (await TrayIcon.getById("tray"))
          if (!primaryTray) throw new Error("primary tray icon missing")
          multiTrayRefs.current.set(id, primaryTray)
          return primaryTray
        }

        const auxTray = await TrayIcon.new({
          id,
          iconAsTemplate: true,
          action: handleAuxTrayClick,
        })
        multiTrayRefs.current.set(id, auxTray)
        return auxTray
      }

      const maybeSetTitle = (tray as TrayIcon & { setTitle?: (value: string) => Promise<void> }).setTitle
      const setTitleFn =
        typeof maybeSetTitle === "function" ? (value: string) => maybeSetTitle.call(tray, value) : null
      const supportsNativeTrayTitle = setTitleFn !== null
      const setTrayTitle = (title: string) => {
        if (setTitleFn) {
          return setTitleFn(title)
        }
        return Promise.resolve()
      }

      const maybeSetTooltip = (tray as TrayIcon & { setTooltip?: (value: string) => Promise<void> }).setTooltip
      const setTooltipFn =
        typeof maybeSetTooltip === "function" ? (value: string) => maybeSetTooltip.call(tray, value) : null
      const setTrayTooltip = (tooltip: string) => {
        if (setTooltipFn) {
          return setTooltipFn(tooltip)
        }
        return Promise.resolve()
      }

      const restoreGaugeIcon = () => {
        const gaugePath = trayGaugeIconPathRef.current
        if (gaugePath) {
          Promise.all([
            tray.setIcon(gaugePath),
            tray.setIconAsTemplate(true),
            setTrayTitle(""),
            setTrayTooltip("UsagePal"),
          ])
            .catch((e) => {
              console.error("Failed to restore tray gauge icon:", e)
            })
            .finally(() => {
              finalizeUpdate()
            })
        } else {
          finalizeUpdate()
        }
      }

      const currentSettings = pluginSettingsRef.current
      if (!currentSettings) {
        setTraySettingsPreview(EMPTY_TRAY_SETTINGS_PREVIEW)
        await removeAuxTrays()
        restoreGaugeIcon()
        return
      }

      const enabledPluginIds = getEnabledPluginIds(currentSettings)
      if (enabledPluginIds.length === 0) {
        setTraySettingsPreview(EMPTY_TRAY_SETTINGS_PREVIEW)
        await removeAuxTrays()
        restoreGaugeIcon()
        return
      }

      const style = menubarIconStyleRef.current
      const sizePx = getTrayIconSizePx(window.devicePixelRatio)

      if (style === "multi") {
        try {
          const providerIds = getTrayPrimaryBars({
            pluginsMeta: pluginsMetaRef.current,
            pluginSettings: currentSettings,
            pluginStates: pluginStatesRef.current,
            maxBars: MULTI_MAX_PROVIDERS,
            displayMode: displayModeRef.current,
            preferWeekly: false,
          }).map((b) => b.id)

          const multiRows: TrayMultiProviderRow[] = []
          const multiPreview: TrayMultiProviderPreview[] = []

          for (let i = 0; i < MULTI_MAX_PROVIDERS; i += 1) {
            const trayId = MULTI_TRAY_IDS[i]
            if (i >= providerIds.length) {
              if (i > 0) {
                await TrayIcon.removeById(trayId).catch(() => {})
                multiTrayRefs.current.delete(trayId)
              }
              continue
            }

            const pluginId = providerIds[i]!
            const sessionFraction = getTrayPrimaryBars({
              pluginsMeta: pluginsMetaRef.current,
              pluginSettings: currentSettings,
              pluginStates: pluginStatesRef.current,
              maxBars: 1,
              displayMode: displayModeRef.current,
              pluginId,
              preferWeekly: false,
            })[0]?.fraction

            const weeklyFraction = getTrayWeeklyFraction({
              pluginId,
              pluginsMeta: pluginsMetaRef.current,
              pluginSettings: currentSettings,
              pluginStates: pluginStatesRef.current,
              displayMode: displayModeRef.current,
            })

            const sessionText = formatTrayPercentIfPresent(sessionFraction)
            const weeklyText = formatTrayPercentIfPresent(weeklyFraction)
            const providerIconUrl = pluginsMetaRef.current.find((p) => p.id === pluginId)?.iconUrl

            multiRows.push({ id: pluginId, sessionFraction, weeklyFraction })
            multiPreview.push({ id: pluginId, iconUrl: providerIconUrl, sessionText, weeklyText })

            const img = await renderTrayBarsIcon({
              bars: [],
              sizePx,
              style: "provider",
              percentText: sessionText,
              secondaryPercentText: weeklyText,
              providerIconUrl,
            })

            const trayItem = await ensureMultiTray(trayId, i === 0)
            await trayItem.setIcon(img)
            await trayItem.setIconAsTemplate(true)
            if (setTitleFn) await setTitleFn("")
            if (i === 0) {
              await setTrayTooltip(formatTrayTooltipMulti(multiRows, pluginsMetaRef.current))
            }
          }

          setTraySettingsPreview((prev) => {
            const next = { ...EMPTY_TRAY_SETTINGS_PREVIEW, multiProviders: multiPreview }
            return isSameTraySettingsPreview(prev, next) ? prev : next
          })
        } catch (e) {
          console.error("Failed to update multi tray icons:", e)
        } finally {
          finalizeUpdate()
        }
        return
      }

      await removeAuxTrays()

      const preferWeekly = menubarMetricRef.current === "weekly"
      const nextActiveView = activeViewRef.current
      const activeProviderId =
        nextActiveView !== "home" && nextActiveView !== "settings" ? nextActiveView : null

      let trayProviderId: string | null = null
      if (activeProviderId && enabledPluginIds.includes(activeProviderId)) {
        trayProviderId = activeProviderId
      } else if (
        lastTrayProviderIdRef.current &&
        enabledPluginIds.includes(lastTrayProviderIdRef.current)
      ) {
        trayProviderId = lastTrayProviderIdRef.current
      } else {
        trayProviderId = enabledPluginIds[0] ?? null
      }

      const barsForPreview = getTrayPrimaryBars({
        pluginsMeta: pluginsMetaRef.current,
        pluginSettings: currentSettings,
        pluginStates: pluginStatesRef.current,
        maxBars: 4,
        displayMode: displayModeRef.current,
        preferWeekly,
      })

      const providerBars = trayProviderId
        ? getTrayPrimaryBars({
            pluginsMeta: pluginsMetaRef.current,
            pluginSettings: currentSettings,
            pluginStates: pluginStatesRef.current,
            maxBars: 1,
            displayMode: displayModeRef.current,
            pluginId: trayProviderId,
            preferWeekly,
          })
        : []

      const providerIconUrl = trayProviderId
        ? pluginsMetaRef.current.find((plugin) => plugin.id === trayProviderId)?.iconUrl
        : undefined
      const providerPercentText = formatTrayPercentText(providerBars[0]?.fraction)

      const nextPreview: TraySettingsPreview = {
        bars: barsForPreview,
        providerBars,
        providerIconUrl,
        providerPercentText,
        multiProviders: [],
      }
      setTraySettingsPreview((prev) =>
        isSameTraySettingsPreview(prev, nextPreview) ? prev : nextPreview
      )

      const tooltipBars = getTrayPrimaryBars({
        pluginsMeta: pluginsMetaRef.current,
        pluginSettings: currentSettings,
        pluginStates: pluginStatesRef.current,
        maxBars: 20, // Show more in tooltip
        displayMode: displayModeRef.current,
        preferWeekly,
      })
      const tooltip = formatTrayTooltip(tooltipBars, pluginsMetaRef.current, preferWeekly)
      const updateTooltip = () => setTrayTooltip(tooltip)

      if (style === "bars") {
        renderTrayBarsIcon({
          bars: barsForPreview,
          sizePx,
          style: "bars",
        })
          .then(async (img) => {
            await tray.setIcon(img)
            await tray.setIconAsTemplate(true)
            await setTrayTitle("")
            await updateTooltip()
          })
          .catch((e) => {
            console.error("Failed to update tray icon:", e)
          })
          .finally(() => {
            finalizeUpdate()
          })
        return
      }

      if (!trayProviderId) {
        restoreGaugeIcon()
        return
      }
      lastTrayProviderIdRef.current = trayProviderId

      if (style === "donut") {
        renderTrayBarsIcon({
          bars: providerBars,
          sizePx,
          style: "donut",
          providerIconUrl,
        })
          .then(async (img) => {
            await tray.setIcon(img)
            await tray.setIconAsTemplate(true)
            await setTrayTitle("")
            await updateTooltip()
          })
          .catch((e) => {
            console.error("Failed to update tray icon:", e)
          })
          .finally(() => {
            finalizeUpdate()
          })
        return
      }

      renderTrayBarsIcon({
        bars: providerBars,
        sizePx,
        style: "provider",
        percentText: supportsNativeTrayTitle ? undefined : providerPercentText,
        providerIconUrl,
      })
        .then(async (img) => {
          await tray.setIcon(img)
          await tray.setIconAsTemplate(true)
          await setTrayTitle(providerPercentText)
          await updateTooltip()
        })
        .catch((e) => {
          console.error("Failed to update tray icon:", e)
        })
        .finally(() => {
          finalizeUpdate()
        })
      })().catch((e) => {
        console.error("Failed to schedule tray icon update:", e)
      })
    }, delayMs)
  }, [handleAuxTrayClick])

  const trayInitializedRef = useRef(false)
  useEffect(() => {
    if (trayInitializedRef.current) return
    let cancelled = false

    ;(async () => {
      try {
        const tray = await TrayIcon.getById("tray")
        if (cancelled) return
        trayRef.current = tray
        trayInitializedRef.current = true

        try {
          trayGaugeIconPathRef.current = await resolveResource("icons/tray-icon.png")
        } catch (e) {
          console.error("Failed to resolve tray gauge icon resource:", e)
        }

        if (cancelled) return
        setTrayReady(true)
      } catch (e) {
        console.error("Failed to load tray icon handle:", e)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!trayReady) return
    if (!pluginSettings) return
    if (pluginsMeta.length === 0) return
    scheduleTrayIconUpdate("init", 0)
  }, [pluginsMeta.length, pluginSettings, scheduleTrayIconUpdate, trayReady])

  useEffect(() => {
    if (!trayReady) return
    scheduleTrayIconUpdate("settings", 0)
  }, [activeView, menubarIconStyle, menubarMetric, scheduleTrayIconUpdate, trayReady])

  useEffect(() => {
    return () => {
      if (trayUpdateTimerRef.current !== null) {
        window.clearTimeout(trayUpdateTimerRef.current)
        trayUpdateTimerRef.current = null
      }
      trayUpdatePendingRef.current = false
      trayUpdateQueuedRef.current = false
    }
  }, [])

  return {
    scheduleTrayIconUpdate,
    traySettingsPreview,
  }
}
