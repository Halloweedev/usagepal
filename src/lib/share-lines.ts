import type { ManifestLine, MetricLine } from "@/lib/plugin-types"

export type ShareLineScope = "overview" | "detail" | "modelBreakdown"

export type ShareableLine = {
  line: MetricLine
  scope: ShareLineScope
  defaultChecked: boolean
}

/**
 * Classifies a provider's current metric lines for the Share screen checklist.
 * Lines with no matching entry in the manifest (e.g. the per-model `%` lines
 * `pushModelUsageLines` generates at runtime, keyed by raw model id) are
 * treated as `"modelBreakdown"` lines.
 */
export function buildShareableLines(
  dataLines: MetricLine[],
  manifestLines: ManifestLine[]
): ShareableLine[] {
  return dataLines.map((line) => {
    const manifest = manifestLines.find((entry) => entry.label === line.label)
    const scope: ShareLineScope = manifest ? manifest.scope : "modelBreakdown"
    const defaultChecked = scope === "overview" || scope === "modelBreakdown" || line.type === "barChart"
    return { line, scope, defaultChecked }
  })
}
