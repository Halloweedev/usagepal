import type { ManifestLine, MetricLine } from "@/lib/plugin-types"

type ProgressLine = Extract<MetricLine, { type: "progress" }>
type UsableProgressLine = ProgressLine & { used: number; limit: number }

function isUsableProgressLine(line: MetricLine): line is UsableProgressLine {
  return line.type === "progress" && line.used != null && line.limit != null
}

/**
 * The runtime progress line that has crossed its manifest-declared
 * `escalateAtPercent` threshold and should take over the overview card and the
 * menubar tray. Returns the most-critical one (highest `used / limit`) when
 * several cross, or `undefined` when none do. The condition is based on real
 * usage (`used / limit`), independent of the used/left display mode.
 */
export function selectEscalatedLine(
  lines: MetricLine[],
  manifestLines: ManifestLine[]
): UsableProgressLine | undefined {
  const thresholds = new Map<string, number>()
  for (const line of manifestLines) {
    if (
      line.type === "progress" &&
      typeof line.escalateAtPercent === "number" &&
      line.escalateAtPercent >= 0 &&
      line.escalateAtPercent <= 100
    ) {
      thresholds.set(line.label, line.escalateAtPercent)
    }
  }
  if (thresholds.size === 0) return undefined

  let best: UsableProgressLine | undefined
  let bestFraction = -1
  for (const line of lines) {
    if (!isUsableProgressLine(line)) continue
    if (line.limit <= 0) continue
    const threshold = thresholds.get(line.label)
    if (threshold === undefined) continue
    const fraction = line.used / line.limit
    if (fraction >= threshold / 100 && fraction > bestFraction) {
      best = line
      bestFraction = fraction
    }
  }
  return best
}
