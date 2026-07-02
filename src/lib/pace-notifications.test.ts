import { describe, expect, it } from "vitest"
import type { MetricLine } from "@/lib/plugin-types"
import {
  deriveObservation,
  evaluate,
  initialNotificationState,
  metricKey,
  transitions,
  type MetricObservation,
  type NotificationState,
  type PaceToggles,
} from "@/lib/pace-notifications"

const ALL_ON: PaceToggles = {
  underTenPercent: true,
  healthyToClose: true,
  closeToRunningOut: true,
}

const obs = (
  bucket: MetricObservation["bucket"],
  remainingFraction: number,
  resetsAtMs: number | null = 1000
): MetricObservation => ({ bucket, remainingFraction, resetsAtMs })

// Run a sequence of observations through transitions, returning the fired milestones per step.
function run(steps: MetricObservation[], toggles: PaceToggles = ALL_ON) {
  let state = initialNotificationState()
  const fires: string[][] = []
  for (const step of steps) {
    const { fire, newState } = transitions(step, state, toggles)
    // Commit dedup marks as the orchestrator would after successful delivery.
    for (const m of fire) newState.firedMilestones.add(m)
    state = newState
    fires.push(fire)
  }
  return { fires, state }
}

describe("deriveObservation", () => {
  const NOW = 1_000_000
  const PERIOD = 100_000
  const progress = (used: number, extra: Partial<MetricLine> = {}): MetricLine => ({
    type: "progress",
    label: "Weekly",
    used,
    limit: 100,
    format: { kind: "percent" },
    resetsAt: new Date(NOW + PERIOD / 2).toISOString(),
    periodDurationMs: PERIOD,
    ...extra,
  })

  it("returns null for non-progress lines", () => {
    expect(deriveObservation({ type: "text", label: "Balance", value: "$1" }, NOW)).toBeNull()
  })

  it("reports noData when the meter has no positive limit", () => {
    const line: MetricLine = { type: "progress", label: "X", used: 0, limit: 0, format: { kind: "percent" } }
    expect(deriveObservation(line, NOW)?.bucket).toBe("noData")
  })

  it("maps an ahead pace to healthy", () => {
    // used 30, projected ~60 of 100 at half-elapsed → ahead
    const o = deriveObservation(progress(30), NOW)
    expect(o?.bucket).toBe("healthy")
    expect(o?.remainingFraction).toBeCloseTo(0.7)
  })

  it("maps an on-track pace to close", () => {
    // used 48, projected ~96 → on-track
    expect(deriveObservation(progress(48), NOW)?.bucket).toBe("close")
  })

  it("maps a behind pace to runningOut", () => {
    // used 60, projected ~120 → behind
    expect(deriveObservation(progress(60), NOW)?.bucket).toBe("runningOut")
  })

  it("treats used >= limit as runningOut regardless of pace", () => {
    expect(deriveObservation(progress(100), NOW)?.bucket).toBe("runningOut")
  })

  it("is untracked when there is no reset window to project against", () => {
    const line = progress(30, { resetsAt: undefined, periodDurationMs: undefined })
    expect(deriveObservation(line, NOW)?.bucket).toBe("untracked")
  })
})

describe("transitions", () => {
  it("primes the first observation without firing", () => {
    const { fires } = run([obs("close", 0.5)])
    expect(fires[0]).toEqual([])
  })

  it("fires Cutting It Close on a healthy → close edge", () => {
    const { fires } = run([obs("healthy", 0.5), obs("close", 0.5)])
    expect(fires[1]).toEqual(["healthyToClose"])
  })

  it("fires Will Run Out on a close → runningOut edge", () => {
    const { fires } = run([obs("healthy", 0.5), obs("close", 0.5), obs("runningOut", 0.5)])
    expect(fires[2]).toEqual(["closeToRunningOut"])
  })

  it("fires only Will Run Out on a healthy → runningOut jump (skips yellow)", () => {
    const { fires } = run([obs("healthy", 0.5), obs("runningOut", 0.5)])
    expect(fires[1]).toEqual(["closeToRunningOut"])
  })

  it("does not re-fire a milestone already fired this window", () => {
    const { fires } = run([obs("healthy", 0.5), obs("close", 0.5), obs("close", 0.5)])
    expect(fires[2]).toEqual([])
  })

  it("re-fires after improving then worsening again", () => {
    const { fires } = run([
      obs("healthy", 0.5),
      obs("close", 0.5), // fires
      obs("healthy", 0.5), // improves, re-arms
      obs("close", 0.5), // fires again
    ])
    expect(fires[1]).toEqual(["healthyToClose"])
    expect(fires[3]).toEqual(["healthyToClose"])
  })

  it("fires Almost Out when remaining crosses under 10%, and re-arms on recovery", () => {
    const { fires } = run([
      obs("healthy", 0.5),
      obs("healthy", 0.05), // crosses under 10%
      obs("healthy", 0.05), // still under — no re-fire
      obs("healthy", 0.5), // recovers, re-arms
      obs("healthy", 0.08), // crosses again
    ])
    expect(fires[1]).toEqual(["underTenPercent"])
    expect(fires[2]).toEqual([])
    expect(fires[4]).toEqual(["underTenPercent"])
  })

  it("re-fires in a new reset window without re-priming mid-session", () => {
    const { fires } = run([
      obs("healthy", 0.5, 1000),
      obs("close", 0.5, 1000), // fires
      obs("close", 0.5, 2000), // new window resets dedup; still at close → fires again
      obs("healthy", 0.5, 2000), // improves, re-arms
      obs("close", 0.5, 2000), // fires again in the new window
    ])
    expect(fires[1]).toEqual(["healthyToClose"])
    expect(fires[2]).toEqual(["healthyToClose"])
    expect(fires[4]).toEqual(["healthyToClose"])
  })

  it("noData suppresses firing without disturbing recorded signals", () => {
    const { fires } = run([
      obs("healthy", 0.5),
      obs("noData", 1),
      obs("close", 0.5), // still a healthy → close edge across the gap
    ])
    expect(fires[1]).toEqual([])
    expect(fires[2]).toEqual(["healthyToClose"])
  })

  it("does not consume the edge when the trigger is off, so re-enabling fires", () => {
    const OFF: PaceToggles = { ...ALL_ON, healthyToClose: false }
    let state: NotificationState = initialNotificationState()
    ;({ newState: state } = transitions(obs("healthy", 0.5), state, OFF))
    const off = transitions(obs("close", 0.5), state, OFF)
    expect(off.fire).toEqual([])
    // Trigger re-enabled while still in the close bucket → the crossing fires now.
    const on = transitions(obs("close", 0.5), off.newState, ALL_ON)
    expect(on.fire).toEqual(["healthyToClose"])
  })
})

describe("evaluate", () => {
  const providersAt = (used: number) => [
    {
      providerId: "claude",
      displayName: "Claude",
      lines: [
        { type: "progress", label: "Weekly", used, limit: 100, format: { kind: "percent" } } as MetricLine,
      ],
    },
  ]

  it("fires nothing when all toggles are off", () => {
    const { fired } = evaluate(providersAt(95), new Map(), { underTenPercent: false, healthyToClose: false, closeToRunningOut: false }, 1)
    expect(fired).toEqual([])
  })

  it("primes on first pass then fires Almost Out when the metric drops under 10%", () => {
    const first = evaluate(providersAt(50), new Map(), ALL_ON, 1) // remaining 0.5 → primes
    expect(first.fired).toEqual([])
    const second = evaluate(providersAt(95), first.nextStates, ALL_ON, 2) // remaining 0.05 → crosses
    expect(second.fired).toHaveLength(1)
    expect(second.fired[0]).toMatchObject({
      key: metricKey("claude", "Weekly"),
      milestone: "underTenPercent",
      displayName: "Claude",
      metricLabel: "Weekly",
    })
  })

  it("carries forward state for metrics not seen this pass", () => {
    const seeded = new Map<string, NotificationState>([["other:X", initialNotificationState()]])
    const { nextStates } = evaluate(providersAt(50), seeded, ALL_ON, 1)
    expect(nextStates.has("other:X")).toBe(true)
  })
})
