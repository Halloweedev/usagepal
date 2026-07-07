import type { ManifestLine, MetricLine } from "@/lib/plugin-types"

export type ShareLineScope = "overview" | "detail" | "modelBreakdown"

export type ShareableLine = {
  line: MetricLine
  scope: ShareLineScope
  defaultChecked: boolean
}

function toShareLineScope(scope: string): ShareLineScope {
  return scope === "overview" || scope === "detail" ? scope : "detail"
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
    // Only text lines fall back to "modelBreakdown": that's the shape of the
    // runtime-generated per-model rows this classification is meant to catch.
    // Other unmatched line types (e.g. a "Status" badge) default to "detail"
    // instead of being mislabeled as a model.
    const scope: ShareLineScope = manifest ? toShareLineScope(manifest.scope) : line.type === "text" ? "modelBreakdown" : "detail"
    const defaultChecked = scope === "overview" || scope === "modelBreakdown" || line.type === "barChart"
    return { line, scope, defaultChecked }
  })
}
