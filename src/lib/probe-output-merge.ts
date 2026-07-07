import type { MetricLine, PluginOutput } from "@/lib/plugin-types"

export function isRateLimitedProbeOutput(output: PluginOutput): boolean {
  return output.lines.some(
    (line) =>
      line.type === "badge" &&
      line.label === "Status" &&
      line.text.toLowerCase().includes("rate limited")
  )
}

/**
 * When a plugin is rate-limited it may return status lines without live usage
 * progress (Claude's in-probe cache does not survive a fresh JS runtime). Keep
 * the last-known progress lines so overview cards stay populated.
 */
export function mergeRateLimitedProbeOutput(
  incoming: PluginOutput,
  previous: PluginOutput | null | undefined
): PluginOutput {
  if (!previous?.lines?.length || !isRateLimitedProbeOutput(incoming)) {
    return incoming
  }

  const incomingProgressLabels = new Set(
    incoming.lines
      .filter((line): line is Extract<MetricLine, { type: "progress" }> => line.type === "progress")
      .map((line) => line.label)
  )

  const preservedProgress = previous.lines.filter(
    (line): line is Extract<MetricLine, { type: "progress" }> =>
      line.type === "progress" && !incomingProgressLabels.has(line.label)
  )
  if (preservedProgress.length === 0) {
    return incoming
  }

  const statusIndex = incoming.lines.findIndex(
    (line) => line.type === "badge" && line.label === "Status"
  )
  const insertAt = statusIndex >= 0 ? statusIndex + 1 : 0

  const mergedLines = [...incoming.lines]
  mergedLines.splice(insertAt, 0, ...preservedProgress)

  return {
    ...incoming,
    lines: mergedLines,
  }
}
