import type { MetricLine } from "@/lib/plugin-types"
import { calculatePaceStatus } from "@/lib/pace-status"

/**
 * Quota pace notifications. Ported from the pure milestone logic so the firing rules stay
 * unit-testable, independent of the notification transport (Tauri) and the React refresh loop.
 *
 * A milestone fires once per reset window per metric, on a *worsening edge* — never at launch on an
 * already-bad quota, and never repeatedly while the quota sits in the same bucket.
 */

/** One of the quota milestones a user can be alerted about. */
export type PaceMilestone = "underTenPercent" | "healthyToClose" | "closeToRunningOut" | "sessionReset"

export const PACE_MILESTONES: PaceMilestone[] = [
  "underTenPercent",
  "healthyToClose",
  "closeToRunningOut",
  "sessionReset",
]

/** The pace-severity bucket a metric is in. `untracked` carries no trustworthy pace. */
export type PaceBucket = "untracked" | "healthy" | "close" | "runningOut"

/** User-facing copy for each milestone: the Settings row, the notification title, and the tooltip. */
export const MILESTONE_META: Record<
  PaceMilestone,
  { label: string; title: string; body: string; tooltip: string }
> = {
  underTenPercent: {
    label: "Almost Out",
    title: "Almost Out",
    body: "Under 10% usage remaining for this window.",
    tooltip: "Alert when a limit drops below 10% remaining.",
  },
  healthyToClose: {
    label: "Cutting It Close",
    title: "Cutting It Close",
    body: "Projected to finish close to your limit.",
    tooltip: "Alert when a limit is projected to finish with little left.",
  },
  closeToRunningOut: {
    label: "Will Run Out",
    title: "Will Run Out",
    body: "Projected to finish before the limit resets.",
    tooltip: "Alert when a limit is projected to finish before it resets.",
  },
  sessionReset: {
    label: "Session Reset",
    title: "Session Reset",
    body: "Back to 0% used.",
    tooltip: "Alert when a session returns to 0% used.",
  },
}

/** Which per-milestone toggles are currently on. */
export type PaceToggles = {
  underTenPercent: boolean
  healthyToClose: boolean
  closeToRunningOut: boolean
  sessionReset: boolean
}

export const anyEnabled = (t: PaceToggles): boolean =>
  t.underTenPercent || t.healthyToClose || t.closeToRunningOut || t.sessionReset

/** Deduplication state for one metric, persisted across refresh passes. */
export type NotificationState = {
  /** Reset instant of the window the fired flags belong to; advancing it clears the fired set. */
  resetsAtMs: number | null
  /** Milestones already alerted in the current window. */
  firedMilestones: Set<PaceMilestone>
  /** Bucket observed on the previous evaluation, so a worsening transition can be detected. */
  previousBucket: PaceBucket
  /** Whether remaining was under 10% previously, so crossing under-10% is an edge. */
  wasUnderTenPercent: boolean
  /** Whether this metric previously had non-zero usage, so a reset to 0% is an edge. */
  wasAboveZeroUsed: boolean
  /** True once the first real observation is recorded as the baseline (no firing before then). */
  primed: boolean
}

export const initialNotificationState = (): NotificationState => ({
  resetsAtMs: null,
  firedMilestones: new Set(),
  previousBucket: "untracked",
  wasUnderTenPercent: false,
  wasAboveZeroUsed: false,
  primed: false,
})

/** One metric's observation this pass. `bucket: "noData"` means the tile has no usable meter. */
export type MetricObservation = {
  bucket: PaceBucket | "noData"
  /** Remaining share of the limit, 0..1. */
  remainingFraction: number
  /** Used share of the limit, 0..1. */
  usedFraction?: number
  resetsAtMs: number | null
  /** True for the provider's rolling session meter. */
  isSession?: boolean
}

export type PaceTransition = {
  fire: PaceMilestone[]
  newState: NotificationState
}

const SEVERITY: Record<PaceBucket, number> = {
  untracked: -1,
  healthy: 0,
  close: 1,
  runningOut: 2,
}

const clone = (state: NotificationState): NotificationState => ({
  resetsAtMs: state.resetsAtMs,
  firedMilestones: new Set(state.firedMilestones),
  previousBucket: state.previousBucket,
  wasUnderTenPercent: state.wasUnderTenPercent,
  wasAboveZeroUsed: state.wasAboveZeroUsed,
  primed: state.primed,
})

/**
 * Whether a milestone is a candidate to fire this pass (toggle on, not already fired this window).
 * Does NOT mark it fired — the caller commits the dedup mark only after delivery succeeds, so a
 * skipped/failed delivery doesn't consume the edge.
 */
function maybeFire(
  milestone: PaceMilestone,
  fire: PaceMilestone[],
  state: NotificationState,
  toggles: PaceToggles
): boolean {
  if (!toggles[milestone] || state.firedMilestones.has(milestone)) return false
  fire.push(milestone)
  return true
}

/**
 * Decide which milestones to fire for one metric this pass, and the state to persist. Rules mirror
 * the reference logic: a later reset clears dedup; the two pace edges fire only on a worsening step
 * between adjacent buckets; under-10% fires the first time remaining crosses under 10% and re-arms on
 * recovery; `noData` suppresses everything without disturbing recorded signals; and the first real
 * observation is recorded as a baseline without firing.
 */
export function transitions(
  obs: MetricObservation,
  previous: NotificationState,
  toggles: PaceToggles
): PaceTransition {
  const next = clone(previous)
  const { bucket, remainingFraction, resetsAtMs } = obs
  const usedFraction = obs.usedFraction ?? Math.min(1, Math.max(0, 1 - remainingFraction))

  // New window: reset dedup. A strictly later reset (or a reset appearing where there was none) starts
  // fresh; a nil-or-equal reset keeps the window.
  if (resetsAtMs != null && (previous.resetsAtMs == null || resetsAtMs > previous.resetsAtMs)) {
    next.firedMilestones = new Set()
    next.wasUnderTenPercent = false
    next.previousBucket = "untracked"
    // Keep wasAboveZeroUsed: a session reset is detected by seeing a used session return to 0% in
    // the next window.
  }
  next.resetsAtMs = resetsAtMs ?? previous.resetsAtMs

  // No real data backing the tile: skip without disturbing recorded signals.
  if (bucket === "noData") {
    return { fire: [], newState: next }
  }

  const currentBucket: PaceBucket = bucket

  // First real observation: record it as the baseline without firing, so a quota already in a bad
  // state when the app opens doesn't spam alerts at launch.
  if (!next.primed) {
    next.primed = true
    next.previousBucket = currentBucket
    next.wasUnderTenPercent = remainingFraction < 0.1
    next.wasAboveZeroUsed = usedFraction > 0
    next.firedMilestones = new Set()
    return { fire: [], newState: next }
  }

  const fire: PaceMilestone[] = []

  const resetToZero = obs.isSession === true && usedFraction === 0 && next.wasAboveZeroUsed
  if (resetToZero) {
    maybeFire("sessionReset", fire, next, toggles)
  }
  if (usedFraction > 0) {
    next.firedMilestones.delete("sessionReset")
  }
  next.wasAboveZeroUsed = usedFraction > 0

  // Once a metric is effectively exhausted, pace alerts are no longer useful and read as stale noise.
  // Record the exhausted state so the same crossing is not replayed later, then suppress all milestones.
  if (usedFraction >= 0.99) {
    next.previousBucket = currentBucket
    next.wasUnderTenPercent = true
    return { fire: [], newState: next }
  }

  // Pace-verdict edges — only for live-pace states. "Cutting It Close" fires when the metric is
  // currently `close` having been below it; "Will Run Out" when severity reaches `runningOut` having
  // been below it. A jump straight from healthy to runningOut fires Will Run Out only.
  if (currentBucket !== "untracked") {
    const previousSeverity = SEVERITY[next.previousBucket]
    const currentSeverity = SEVERITY[currentBucket]
    let paceFired = false
    if (currentBucket === "close" && previousSeverity < SEVERITY.close) {
      if (maybeFire("healthyToClose", fire, next, toggles)) paceFired = true
    }
    if (currentSeverity >= SEVERITY.runningOut && previousSeverity < SEVERITY.runningOut) {
      if (maybeFire("closeToRunningOut", fire, next, toggles)) paceFired = true
    }
    // Improving pace clears the now-irrelevant fired flags so a later worsening re-fires them.
    if (currentSeverity < previousSeverity) {
      if (currentSeverity <= SEVERITY.healthy) next.firedMilestones.delete("healthyToClose")
      if (currentSeverity <= SEVERITY.close) next.firedMilestones.delete("closeToRunningOut")
    }
    // Advance the recorded bucket only when a worsening was actually alerted (or there was no
    // worsening), so a crossing no enabled trigger caught isn't silently consumed.
    if (currentSeverity <= previousSeverity || paceFired) {
      next.previousBucket = currentBucket
    }
  }

  // Under-10%-remaining edge, tracked independently of the pace verdict.
  const underNow = remainingFraction < 0.1
  const underCrossed = underNow && !next.wasUnderTenPercent
  let underFired = false
  if (underCrossed && maybeFire("underTenPercent", fire, next, toggles)) {
    underFired = true
  }
  if (!underNow) {
    next.firedMilestones.delete("underTenPercent")
  }
  if (!underCrossed || underFired) {
    next.wasUnderTenPercent = underNow
  }

  return { fire, newState: next }
}

/**
 * Derive a metric's pace observation from a rendered line. Only progress meters with a positive
 * limit carry a pace story; everything else is skipped (returns null). Our pace verdict maps
 * ahead → healthy, on-track → close, behind → runningOut; a metric with data but no computable pace
  * (no reset window, or too early in the period) is `untracked` but still evaluated for under-10%
  * and reset notifications.
 */
export function deriveObservation(line: MetricLine, nowMs: number): MetricObservation | null {
  if (line.type !== "progress") return null

  const { used, limit } = line
  if (used == null || limit == null || !Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
    return { bucket: "noData", remainingFraction: 1, resetsAtMs: null }
  }

  const usedFraction = Math.min(1, Math.max(0, used / limit))
  const remainingFraction = Math.min(1, Math.max(0, (limit - used) / limit))
  const resetsAtMs = line.resetsAt ? Date.parse(line.resetsAt) : null

  if (used >= limit) {
    return { bucket: "runningOut", remainingFraction, usedFraction, resetsAtMs }
  }

  let bucket: PaceBucket = "untracked"
  if (resetsAtMs != null && Number.isFinite(resetsAtMs) && line.periodDurationMs) {
    const pace = calculatePaceStatus(used, limit, resetsAtMs, line.periodDurationMs, nowMs)
    if (pace) {
      bucket = pace.status === "ahead" ? "healthy" : pace.status === "on-track" ? "close" : "runningOut"
    }
  }

  return { bucket, remainingFraction, usedFraction, resetsAtMs: Number.isFinite(resetsAtMs) ? resetsAtMs : null }
}

/** Stable per-metric key so dedup state follows a metric across refreshes. */
export const metricKey = (providerId: string, label: string): string => `${providerId}:${label}`

/** A provider's rendered metrics, as fed to `evaluate`. */
export type ProviderMetrics = {
  providerId: string
  displayName: string
  lines: MetricLine[]
}

/** A milestone that should be delivered now, with the context needed to write the notification. */
export type FiredNotification = {
  key: string
  milestone: PaceMilestone
  providerId: string
  displayName: string
  metricLabel: string
}

/**
 * Evaluate every provider's metrics against the persisted dedup state. Returns the milestones to fire
 * now and the next state map. Fired candidates are NOT yet marked in the returned state — the caller
 * marks each one only after its notification is delivered, so a failed/blocked delivery re-fires next
 * pass. States for metrics not seen this pass are carried forward unchanged.
 */
export function evaluate(
  providers: ProviderMetrics[],
  states: Map<string, NotificationState>,
  toggles: PaceToggles,
  nowMs: number
): { fired: FiredNotification[]; nextStates: Map<string, NotificationState> } {
  const nextStates = new Map(states)
  const fired: FiredNotification[] = []

  if (!anyEnabled(toggles)) return { fired, nextStates }

  for (const provider of providers) {
    for (const line of provider.lines) {
      const obs = deriveObservation(line, nowMs)
      if (!obs) continue

      const key = metricKey(provider.providerId, line.label)
      const previous = nextStates.get(key) ?? initialNotificationState()
      const { fire, newState } = transitions({ ...obs, isSession: line.label === "Session" }, previous, toggles)
      nextStates.set(key, newState)

      for (const milestone of fire) {
        fired.push({
          key,
          milestone,
          providerId: provider.providerId,
          displayName: provider.displayName,
          metricLabel: line.label,
        })
      }
    }
  }

  return { fired, nextStates }
}
