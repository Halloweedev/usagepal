import type { PluginMeta, PluginOutput } from "@/lib/plugin-types"
import type { AccountsByProvider, PluginSettings } from "@/lib/settings"
import { DEFAULT_DISPLAY_MODE, type DisplayMode } from "@/lib/settings"
import { clamp01 } from "@/lib/utils"
import { selectEscalatedLine } from "@/lib/metric-escalation"

type ProgressLine = Extract<PluginOutput["lines"][number], { type: "progress" }>
type UsableProgressLine = ProgressLine & { used: number; limit: number }

type PluginState = {
  data: PluginOutput | null
  loading: boolean
  error: string | null
}

export type TrayPrimaryBar = {
  id: string
  fraction?: number
  /** Label of the metric line that produced this bar (when data is available). */
  label?: string
  /** True when the value came from the provider's declared weekly line. */
  weekly?: boolean
}

function isUsableProgressLine(line: PluginOutput["lines"][number]): line is UsableProgressLine {
  return line.type === "progress" && line.used != null && line.limit != null
}

/**
 * The `pluginStates` key the tray should read for a provider. Probe/cache state
 * is keyed `providerId::accountId` (see `stateKey` in use-probe-state) once a
 * provider has registered accounts, so the bare `providerId` key is empty for
 * those providers. The tray follows the primary (lowest-`order`) account; with
 * no registered accounts it falls back to the bare `providerId` — keeping the
 * single-account path byte-for-byte unchanged.
 */
export function resolveTrayStateKey(
  providerId: string,
  accountsByProvider: AccountsByProvider,
): string {
  const accounts = accountsByProvider[providerId]
  if (!accounts || accounts.length === 0) return providerId
  const primary = accounts.reduce((best, acct) => (acct.order < best.order ? acct : best))
  return `${providerId}::${primary.accountId}`
}

export function getTrayPrimaryBars(args: {
  pluginsMeta: PluginMeta[]
  pluginSettings: PluginSettings | null
  pluginStates: Record<string, PluginState | undefined>
  maxBars?: number
  displayMode?: DisplayMode
  pluginId?: string
  preferWeekly?: boolean
  accountsByProvider?: AccountsByProvider
}): TrayPrimaryBar[] {
  const {
    pluginsMeta,
    pluginSettings,
    pluginStates,
    maxBars = 4,
    displayMode = DEFAULT_DISPLAY_MODE,
    pluginId,
    preferWeekly = false,
    accountsByProvider = {},
  } = args
  if (!pluginSettings) return []

  const metaById = new Map(pluginsMeta.map((p) => [p.id, p]))
  const disabled = new Set(pluginSettings.disabled)
  const orderedIds = pluginId
    ? [pluginId]
    : pluginSettings.order

  const out: TrayPrimaryBar[] = []
  for (const id of orderedIds) {
    if (disabled.has(id)) continue
    const meta = metaById.get(id)
    if (!meta) continue
    
    // Skip plugins with no primary metric. Weekly mode is an override of the
    // primary (see preferWeekly below), not a standalone mode — so a provider
    // must define primaryCandidates to appear in the menubar; a weekly-only
    // provider is intentionally skipped.
    if (!meta.primaryCandidates || meta.primaryCandidates.length === 0) continue

    const state = pluginStates[resolveTrayStateKey(id, accountsByProvider)]
    const data = state?.data ?? null

    let fraction: number | undefined
    let label: string | undefined
    let weekly: true | undefined
    if (data) {
      // A metric that has crossed its manifest-declared escalation threshold
      // takes over the bar, overriding both the primary candidate and weekly
      // mode — a nearly-maxed limit matters more than the default view.
      const escalated = selectEscalatedLine(data.lines, meta.lines)
      if (escalated) {
        label = escalated.label
        const shownAmount =
          displayMode === "used"
            ? escalated.used
            : escalated.limit - escalated.used
        fraction = clamp01(shownAmount / escalated.limit)
      } else {
        const trayPrimaryLabel = meta.trayPrimaryLabel ?? undefined
        const hasTrayPrimary =
          trayPrimaryLabel !== undefined &&
          data.lines.some((line) => isUsableProgressLine(line) && line.label === trayPrimaryLabel)

        // Prefer the declared weekly line when requested and present in data.
        const weeklyLabel = preferWeekly ? meta.weeklyCandidate : undefined
        const usesWeekly =
          !hasTrayPrimary &&
          weeklyLabel !== undefined &&
          data.lines.some((line) => isUsableProgressLine(line) && line.label === weeklyLabel)

        // Otherwise fall back to the first primary candidate that exists in data.
        const metricLabel = hasTrayPrimary
          ? trayPrimaryLabel
          : usesWeekly
            ? weeklyLabel
            : meta.primaryCandidates.find((candidate) =>
                data.lines.some((line) => isUsableProgressLine(line) && line.label === candidate)
              )

        if (metricLabel) {
          label = metricLabel
          weekly = usesWeekly || undefined
          const metricLine = data.lines.find(
            (line): line is UsableProgressLine =>
              isUsableProgressLine(line) && line.label === metricLabel
          )
          if (metricLine && metricLine.limit > 0) {
            const shownAmount =
              displayMode === "used"
                ? metricLine.used
                : metricLine.limit - metricLine.used
            fraction = clamp01(shownAmount / metricLine.limit)
          }
        }
      }
    }

    out.push({ id, fraction, label, weekly })
    if (out.length >= maxBars) break
  }

  return out
}

export function getTrayWeeklyFraction(args: {
  pluginId: string
  pluginsMeta: PluginMeta[]
  pluginSettings: PluginSettings | null
  pluginStates: Record<string, PluginState | undefined>
  displayMode?: DisplayMode
  accountsByProvider?: AccountsByProvider
}): number | undefined {
  const {
    pluginId,
    pluginsMeta,
    pluginSettings,
    pluginStates,
    displayMode = DEFAULT_DISPLAY_MODE,
    accountsByProvider = {},
  } = args
  if (!pluginSettings) return undefined
  if (pluginSettings.disabled.includes(pluginId)) return undefined

  const meta = pluginsMeta.find((p) => p.id === pluginId)
  const weeklyLabel = meta?.weeklyCandidate
  if (!weeklyLabel) return undefined

  const data = pluginStates[resolveTrayStateKey(pluginId, accountsByProvider)]?.data ?? null
  if (!data) return undefined

  const metricLine = data.lines.find(
    (line): line is UsableProgressLine =>
      isUsableProgressLine(line) && line.label === weeklyLabel
  )
  if (!metricLine || metricLine.limit <= 0) return undefined

  const shownAmount =
    displayMode === "used"
      ? metricLine.used
      : metricLine.limit - metricLine.used
  return clamp01(shownAmount / metricLine.limit)
}

function getProgressLineFraction(
  data: PluginOutput | null,
  label: string,
  displayMode: DisplayMode,
): number | undefined {
  if (!data) return undefined

  const metricLine = data.lines.find(
    (line): line is UsableProgressLine =>
      isUsableProgressLine(line) && line.label === label
  )
  if (!metricLine || metricLine.limit <= 0) return undefined

  const shownAmount =
    displayMode === "used"
      ? metricLine.used
      : metricLine.limit - metricLine.used
  return clamp01(shownAmount / metricLine.limit)
}

export type TrayMultiProviderMetrics = {
  sessionFraction?: number
  weeklyFraction?: number
}

export function getTrayMultiProviderMetrics(args: {
  pluginId: string
  pluginsMeta: PluginMeta[]
  pluginSettings: PluginSettings | null
  pluginStates: Record<string, PluginState | undefined>
  displayMode?: DisplayMode
  accountsByProvider?: AccountsByProvider
}): TrayMultiProviderMetrics {
  const {
    pluginId,
    pluginsMeta,
    pluginSettings,
    pluginStates,
    displayMode = DEFAULT_DISPLAY_MODE,
    accountsByProvider = {},
  } = args
  if (!pluginSettings) return {}
  if (pluginSettings.disabled.includes(pluginId)) return {}

  const meta = pluginsMeta.find((p) => p.id === pluginId)
  const multiTrayLines = meta?.multiTrayLines ?? []
  if (multiTrayLines.length > 0) {
    const data = pluginStates[resolveTrayStateKey(pluginId, accountsByProvider)]?.data ?? null
    return {
      sessionFraction: multiTrayLines[0]
        ? getProgressLineFraction(data, multiTrayLines[0], displayMode)
        : undefined,
      weeklyFraction: multiTrayLines[1]
        ? getProgressLineFraction(data, multiTrayLines[1], displayMode)
        : undefined,
    }
  }

  const sessionFraction = getTrayPrimaryBars({
    pluginsMeta,
    pluginSettings,
    pluginStates,
    maxBars: 1,
    displayMode,
    pluginId,
    preferWeekly: false,
    accountsByProvider,
  })[0]?.fraction

  const weeklyFraction = getTrayWeeklyFraction({
    pluginId,
    pluginsMeta,
    pluginSettings,
    pluginStates,
    displayMode,
    accountsByProvider,
  })

  return { sessionFraction, weeklyFraction }
}
