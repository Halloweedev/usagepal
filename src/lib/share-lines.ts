import type { ManifestLine, MetricLine } from "@/lib/plugin-types"

export type ShareLineScope = "overview" | "detail" | "modelBreakdown"

export type ShareableLine = {
  line: MetricLine
  scope: ShareLineScope
  defaultChecked: boolean
}

export type ModelCostPeriod = { suffix: string; label: string }

/**
 * Suffixes the per-model, per-period cost lines carry (see
 * `pushModelCostLines` in plugins/claude/plugin.js and plugins/codex/plugin.js).
 */
export const MODEL_COST_PERIODS: ModelCostPeriod[] = [
  { suffix: " · Today", label: "Today" },
  { suffix: " · 7d", label: "7d" },
  { suffix: " · 30d", label: "30d" },
]

/** Finds the period a model-cost line's label belongs to, if any. */
export function matchModelCostPeriod(label: string): ModelCostPeriod | undefined {
  return MODEL_COST_PERIODS.find((period) => label.endsWith(period.suffix))
}

/**
 * Classifies a provider's current metric lines for the Share screen checklist.
 * Lines with no matching entry in the manifest (e.g. the per-model `%` lines
 * `pushModelUsageLines` generates at runtime, keyed by raw model id) are
 * treated as `"modelBreakdown"` lines (checked by default) — except the
 * per-model *cost* lines `pushModelCostLines` generates (suffixed
 * ` · Today`/` · 7d`/` · 30d`), which are `"detail"` scope (unchecked by
 * default) since they're a deeper, opt-in breakdown rather than the default
 * overview.
 */
export function buildShareableLines(
  dataLines: MetricLine[],
  manifestLines: ManifestLine[]
): ShareableLine[] {
  return dataLines.map((line) => {
    const manifest = manifestLines.find((entry) => entry.label === line.label)
    const scope: ShareLineScope = manifest
      ? manifest.scope
      : matchModelCostPeriod(line.label)
        ? "detail"
        : "modelBreakdown"
    const defaultChecked = scope === "overview" || scope === "modelBreakdown" || line.type === "barChart"
    return { line, scope, defaultChecked }
  })
}
