import type { MetricLine } from "@/lib/plugin-types"

/** Sample provider lines for the onboarding miniatures. Timestamps are computed
 * from `now` so countdowns always sit in the future and pace dots stay green/yellow. */

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export function makeMockClaudeLines(now: number = Date.now()): MetricLine[] {
  return [
    {
      type: "progress",
      label: "Session",
      used: 32,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: new Date(now + 2 * HOUR_MS + 47 * MINUTE_MS).toISOString(),
      periodDurationMs: 5 * HOUR_MS,
      color: null,
    },
    {
      type: "progress",
      label: "Weekly limit",
      used: 61,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: new Date(now + 4 * DAY_MS + 17 * HOUR_MS).toISOString(),
      periodDurationMs: 7 * DAY_MS,
      color: null,
    },
  ]
}

export function makeMockCodexLines(now: number = Date.now()): MetricLine[] {
  return [
    {
      type: "progress",
      label: "5h limit",
      used: 38,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: new Date(now + 2 * HOUR_MS + 12 * MINUTE_MS).toISOString(),
      periodDurationMs: 5 * HOUR_MS,
      color: null,
    },
    {
      type: "text",
      label: "Credits",
      value: "$38.20 left",
      color: null,
      subtitle: null,
      resetExpiry: [new Date(now + 30 * DAY_MS).toISOString()],
    },
  ]
}
