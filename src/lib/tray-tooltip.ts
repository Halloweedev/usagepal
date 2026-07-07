import type { PluginMeta } from "@/lib/plugin-types"
import type { TrayPrimaryBar } from "@/lib/tray-primary-progress"

/**
 * Formats a fraction (0.0 - 1.0) into a percentage string (0% - 100%).
 */
export function formatTrayPercentText(fraction: number | undefined): string {
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) return "--%"
  const clampedFraction = Math.max(0, Math.min(1, fraction))
  return `${Math.round(clampedFraction * 100)}%`
}

export function formatTrayPercentIfPresent(
  fraction: number | undefined,
): string | undefined {
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) return undefined
  return formatTrayPercentText(fraction)
}

/**
 * Creates a multi-line tooltip string for the tray icon.
 * Lists the app name followed by enabled plugins and their usage percentages.
 *
 * In weekly mode, lines are tagged with their metric label only when the list
 * is mixed (at least one provider fell back from weekly). When every provider
 * is showing weekly, the tags are redundant and omitted.
 */
export function formatTrayTooltip(
  bars: TrayPrimaryBar[],
  pluginsMeta: PluginMeta[],
  weeklyMode = false
): string {
  const lines = ["UsagePal"]
  if (bars.length === 0) return lines[0]!

  const resolved = bars.filter((bar) => bar.label !== undefined)
  const hasFallback = resolved.some((bar) => !bar.weekly)
  const showTags = weeklyMode && resolved.length > 0 && hasFallback

  const metaById = new Map(pluginsMeta.map((p) => [p.id, p]))
  for (const bar of bars) {
    const meta = metaById.get(bar.id)
    if (!meta) continue
    const percent = formatTrayPercentText(bar.fraction)
    if (showTags && bar.label) {
      lines.push(`${meta.name}: ${percent} · ${bar.label}`)
    } else {
      lines.push(`${meta.name}: ${percent}`)
    }
  }
  return lines.join("\n")
}
