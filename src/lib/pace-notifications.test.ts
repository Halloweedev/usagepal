import { describe, expect, it } from "vitest"
import type { MetricLine } from "@/lib/plugin-types"
import {
  deriveObservation,
  evaluate,
  initialNotificationState,
  isBudgetCurrent,
  localDayKey,
  metricKey,
  sanitizeBudgetPercent,
  sanitizeDailyBudgetMap,
  sanitizeProviderBudget,
  transitions,
  type MetricObservation,
  type NotificationState,
  type PaceToggles,
} from "@/lib/pace-notifications"

const ALL_ON: PaceToggles = {
  underTenPercent: true,
  healthyToClose: true,
  closeToRunningOut: true,
  sessionReset: true,
  budgetExceeded: true,
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

  it("suppresses all milestones when usage is 99% or higher", () => {
    const { fires } = run([
      obs("healthy", 0.5),
      obs("runningOut", 0.01),
    ])
    expect(fires[1]).toEqual([])
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
    const { fired } = evaluate(
      providersAt(95),
      new Map(),
      { underTenPercent: false, healthyToClose: false, closeToRunningOut: false, sessionReset: false, budgetExceeded: false },
      1
    )
    expect(fired).toEqual([])
  })

  it("primes on first pass then fires Almost Out when the metric drops under 10%", () => {
    const first = evaluate(providersAt(50), new Map(), ALL_ON, 1) // remaining 0.5 → primes
    expect(first.fired).toEqual([])
    const second = evaluate(providersAt(95), first.nextStates, ALL_ON, 2) // remaining 0.05 → crosses
    expect(second.fired).toHaveLength(1)
    expect(second.fired[0]).toMatchObject({
      key: metricKey("claude", null, "Weekly"),
      milestone: "underTenPercent",
      displayName: "Claude",
      metricLabel: "Weekly",
    })
  })

  it("fires Session Reset only when Session returns to 0% after usage", () => {
    const providersAt = (used: number) => [
      {
        providerId: "claude",
        displayName: "Claude",
        lines: [
          { type: "progress", label: "Session", used, limit: 100, format: { kind: "percent" } } as MetricLine,
        ],
      },
    ]

    const first = evaluate(providersAt(0), new Map(), ALL_ON, 1)
    expect(first.fired).toEqual([])

    const second = evaluate(providersAt(20), first.nextStates, ALL_ON, 2)
    expect(second.fired).toEqual([])

    const third = evaluate(providersAt(0), second.nextStates, ALL_ON, 3)
    expect(third.fired).toHaveLength(1)
    expect(third.fired[0]).toMatchObject({
      key: metricKey("claude", null, "Session"),
      milestone: "sessionReset",
      displayName: "Claude",
      metricLabel: "Session",
    })

    const fourth = evaluate(providersAt(0), third.nextStates, ALL_ON, 4)
    expect(fourth.fired).toEqual([])
  })

  it("fires Session Reset when a used session rolls into a new 0% window", () => {
    const providersAt = (used: number, resetsAt: number) => [
      {
        providerId: "claude",
        displayName: "Claude",
        lines: [
          {
            type: "progress",
            label: "Session",
            used,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: new Date(resetsAt).toISOString(),
          } as MetricLine,
        ],
      },
    ]

    const first = evaluate(providersAt(20, 1000), new Map(), ALL_ON, 1)
    expect(first.fired).toEqual([])

    const second = evaluate(providersAt(0, 2000), first.nextStates, ALL_ON, 2)
    expect(second.fired).toHaveLength(1)
    expect(second.fired[0]).toMatchObject({
      milestone: "sessionReset",
      metricLabel: "Session",
    })
  })

  it("carries forward state for metrics not seen this pass", () => {
    const seeded = new Map<string, NotificationState>([["other:X", initialNotificationState()]])
    const { nextStates } = evaluate(providersAt(50), seeded, ALL_ON, 1)
    expect(nextStates.has("other:X")).toBe(true)
  })

  it("keeps per-account dedup so two accounts of one provider don't cross-fire", () => {
    const session = (used: number) =>
      ({ type: "progress", label: "Session", used, limit: 100, format: { kind: "percent" } }) as MetricLine
    // Two Codex accounts in the same pass: one used, one at 0%. With a
    // provider-only key they collide on `codex:Session`, so the zero-used
    // account inherits the other's "was above zero" state and spuriously fires
    // Session Reset every refresh. Per-account keys keep them independent.
    const twoAccounts = [
      { providerId: "codex", accountId: "work", displayName: "Codex", lines: [session(20)] },
      { providerId: "codex", accountId: "home", displayName: "Codex", lines: [session(0)] },
    ]
    const first = evaluate(twoAccounts, new Map(), ALL_ON, 1)
    expect(first.fired).toEqual([])
    expect(first.nextStates.has(metricKey("codex", "work", "Session"))).toBe(true)
    expect(first.nextStates.has(metricKey("codex", "home", "Session"))).toBe(true)
  })
})

describe("budgetExceeded", () => {
  const DAY_A = "2026-09-15"
  const DAY_B = "2026-09-16"
  // remainingFraction stays neutral so the under-10% edge never interferes — each
  // test drives the budget axis via usedFraction against a snapshot baseline.
  const budgeted = (
    usedFraction: number,
    opts: {
      percent?: number | null
      day?: string | null
      baseline?: number | null
      resetsAtMs?: number | null
    } = {}
  ): MetricObservation => ({
    bucket: "healthy",
    remainingFraction: 0.5,
    usedFraction,
    resetsAtMs: opts.resetsAtMs ?? 1000,
    budgetPercent: opts.percent === undefined ? 20 : opts.percent,
    budgetDay: opts.day === undefined ? DAY_A : opts.day,
    budgetBaseline: opts.baseline === undefined ? 0 : opts.baseline,
  })

  it("primes the first observation without firing, even when already over budget", () => {
    const { fires } = run([budgeted(0.5)])
    expect(fires[0]).toEqual([])
  })

  it("fires when growth since the snapshot crosses the budget", () => {
    const { fires } = run([
      budgeted(0.15, { baseline: 0.1 }),
      budgeted(0.35, { baseline: 0.1 }),
    ])
    expect(fires[1]).toEqual(["budgetExceeded"])
  })

  it("does not fire without a budget set", () => {
    const { fires } = run([
      budgeted(0.1, { percent: null }),
      budgeted(0.9, { percent: null }),
      budgeted(0.9, { percent: 20, day: null }),
    ])
    expect(fires.flat()).toEqual([])
  })

  it("does not fire when the trigger is off", () => {
    const OFF: PaceToggles = { ...ALL_ON, budgetExceeded: false }
    const { fires } = run([budgeted(0.15, { baseline: 0.1 }), budgeted(0.5, { baseline: 0.1 })], OFF)
    expect(fires.flat()).toEqual([])
  })

  it("re-fires after usage falls back below the budget and crosses again", () => {
    const { fires } = run([
      budgeted(0.15, { baseline: 0.1 }),
      budgeted(0.35, { baseline: 0.1 }), // fires
      budgeted(0.2, { baseline: 0.1 }), // recovers, re-arms
      budgeted(0.35, { baseline: 0.1 }), // fires again
    ])
    expect(fires[1]).toEqual(["budgetExceeded"])
    expect(fires[2]).toEqual([])
    expect(fires[3]).toEqual(["budgetExceeded"])
  })

  it("re-arms with a fresh baseline when the budget is re-set", () => {
    const { fires } = run([
      budgeted(0.15, { baseline: 0.1 }),
      budgeted(0.35, { baseline: 0.1 }), // fires
      budgeted(0.35, { baseline: 0.3 }), // re-set at 0.3: delta 0.05, quiet
      budgeted(0.55, { baseline: 0.3 }), // delta 0.25, fires again
    ])
    expect(fires[1]).toEqual(["budgetExceeded"])
    expect(fires[2]).toEqual([])
    expect(fires[3]).toEqual(["budgetExceeded"])
  })

  it("captures a meter unseen at set time without firing, then tracks it", () => {
    const { fires } = run([
      budgeted(0.5, { baseline: null }), // primes, quiet
      budgeted(0.55, { baseline: null }), // first tracked reading captures, quiet
      budgeted(0.6, { baseline: null }), // delta 0.05, quiet
      budgeted(0.8, { baseline: null }), // delta 0.25, fires
    ])
    expect(fires[0]).toEqual([])
    expect(fires[1]).toEqual([])
    expect(fires[2]).toEqual([])
    expect(fires[3]).toEqual(["budgetExceeded"])
  })

  it("re-arms when the provider window restarts mid-day", () => {
    const { fires } = run([
      budgeted(0.15, { baseline: 0.1, resetsAtMs: 1000 }),
      budgeted(0.35, { baseline: 0.1, resetsAtMs: 1000 }), // fires
      budgeted(0.05, { baseline: 0.1, resetsAtMs: 2000 }), // new window drops below, re-arms
      budgeted(0.35, { baseline: 0.1, resetsAtMs: 2000 }), // past snapshot + budget again, fires
    ])
    expect(fires[1]).toEqual(["budgetExceeded"])
    expect(fires[2]).toEqual([])
    expect(fires[3]).toEqual(["budgetExceeded"])
  })

  it("fires when usage jumps past the budget straight to exhaustion", () => {
    const { fires } = run([budgeted(0.1, { percent: 90, baseline: 0 }), budgeted(1, { percent: 90, baseline: 0 })])
    expect(fires[1]).toEqual(["budgetExceeded"])
  })

  it("does not consume the edge when the trigger is off, so re-enabling fires", () => {
    const OFF: PaceToggles = { ...ALL_ON, budgetExceeded: false }
    let state: NotificationState = initialNotificationState()
    ;({ newState: state } = transitions(budgeted(0.15, { baseline: 0.1 }), state, OFF))
    const off = transitions(budgeted(0.35, { baseline: 0.1 }), state, OFF)
    expect(off.fire).toEqual([])
    const on = transitions(budgeted(0.35, { baseline: 0.1 }), off.newState, ALL_ON)
    expect(on.fire).toEqual(["budgetExceeded"])
  })

  it("evaluates daily budgets per provider and reports today's growth", () => {
    const noon = new Date(2026, 8, 16, 12, 0, 0).getTime()
    const lines = (used: number) => [
      { type: "progress", label: "Weekly", used, limit: 100, format: { kind: "percent" } } as MetricLine,
    ]
    const providers = [
      { providerId: "claude", displayName: "Claude", lines: lines(15) },
      { providerId: "codex", displayName: "Codex", lines: lines(15) },
    ]
    const budgets = {
      claude: {
        "2026-09-16": { percent: 20, day: "2026-09-16", baselines: { "claude:Weekly": 0.1 }, setAt: 1 },
      },
    }

    const first = evaluate(providers, new Map(), ALL_ON, noon, budgets, "2026-09-16")
    expect(first.fired).toEqual([])

    const over = [
      { providerId: "claude", displayName: "Claude", lines: lines(40) },
      { providerId: "codex", displayName: "Codex", lines: lines(40) },
    ]
    const second = evaluate(over, first.nextStates, ALL_ON, noon + 1, budgets, "2026-09-16")
    expect(second.fired).toHaveLength(1)
    expect(second.fired[0]).toMatchObject({
      milestone: "budgetExceeded",
      providerId: "claude",
      displayName: "Claude",
      metricLabel: "Weekly",
      budgetPercent: 20,
      usedPercent: 30,
    })
  })

  it("ignores entries from a previous day", () => {
    const lines = (used: number) => [
      { type: "progress", label: "Weekly", used, limit: 100, format: { kind: "percent" } } as MetricLine,
    ]
    const providers = [{ providerId: "claude", displayName: "Claude", lines: lines(90) }]
    const budgets = {
      claude: {
        "2026-09-15": { percent: 20, day: "2026-09-15", baselines: { "claude:Weekly": 0 }, setAt: 1 },
      },
    }

    const first = evaluate(providers, new Map(), ALL_ON, 1, budgets, "2026-09-16")
    expect(first.fired).toEqual([])
    const second = evaluate(providers, first.nextStates, ALL_ON, 2, budgets, "2026-09-16")
    expect(second.fired).toEqual([])
  })
})

describe("sanitizeBudgetPercent", () => {
  it("accepts integers 1–100", () => {
    expect(sanitizeBudgetPercent(1)).toBe(1)
    expect(sanitizeBudgetPercent(20)).toBe(20)
    expect(sanitizeBudgetPercent(100)).toBe(100)
  })

  it("rounds fractional input", () => {
    expect(sanitizeBudgetPercent(19.6)).toBe(20)
  })

  it("rejects out-of-range and non-numeric input", () => {
    expect(sanitizeBudgetPercent(0)).toBeNull()
    expect(sanitizeBudgetPercent(101)).toBeNull()
    expect(sanitizeBudgetPercent(NaN)).toBeNull()
    expect(sanitizeBudgetPercent("20")).toBeNull()
    expect(sanitizeBudgetPercent(null)).toBeNull()
    expect(sanitizeBudgetPercent(undefined)).toBeNull()
  })
})

describe("sanitizeProviderBudget", () => {
  const day = "2026-09-16"

  it("accepts a well-formed entry", () => {
    expect(
      sanitizeProviderBudget({ percent: 20, day, baselines: { "claude:Weekly": 0.1 }, setAt: 7 })
    ).toEqual({ percent: 20, day, baselines: { "claude:Weekly": 0.1 }, setAt: 7 })
  })

  it("rejects malformed entries", () => {
    expect(sanitizeProviderBudget(null)).toBeNull()
    expect(sanitizeProviderBudget(20)).toBeNull()
    expect(sanitizeProviderBudget({ percent: 0, day, baselines: {}, setAt: 1 })).toBeNull()
    expect(sanitizeProviderBudget({ percent: 20, day: "yesterday", baselines: {}, setAt: 1 })).toBeNull()
    expect(sanitizeProviderBudget({ percent: 20, baselines: {}, setAt: 1 })).toBeNull()
    expect(sanitizeProviderBudget({ percent: 20, day, baselines: {} })).toBeNull()
    expect(sanitizeProviderBudget({ percent: 20, day, baselines: {}, setAt: "now" })).toBeNull()
  })

  it("drops invalid baselines but keeps the entry", () => {
    expect(
      sanitizeProviderBudget({ percent: 20, day, baselines: { good: 0.1, bad: -1, nan: NaN, str: "x" }, setAt: 7 })
    ).toEqual({ percent: 20, day, baselines: { good: 0.1 }, setAt: 7 })
  })
})

describe("sanitizeDailyBudgetMap", () => {
  it("keeps valid entries and drops the rest", () => {
    expect(
      sanitizeDailyBudgetMap({
        claude: {
          [localDayKey()]: { percent: 20, day: localDayKey(), baselines: {}, setAt: 1 },
          "2000-01-01": { percent: 20, day: "2000-01-01", baselines: {}, setAt: 1 },
        },
        codex: { "2000-01-01": { percent: 0, day: "2000-01-01", baselines: {}, setAt: 1 } },
        cursor: 50,
        grok: "nope",
      })
    ).toEqual({
      claude: { [localDayKey()]: { percent: 20, day: localDayKey(), baselines: {}, setAt: 1 } },
    })
  })

  it("returns empty for non-objects", () => {
    expect(sanitizeDailyBudgetMap(null)).toEqual({})
    expect(sanitizeDailyBudgetMap("20")).toEqual({})
  })
})

describe("budget day helpers", () => {
  it("formats the local day key", () => {
    expect(localDayKey(new Date(2026, 8, 16, 12))).toBe("2026-09-16")
  })

  it("matches entries only for their own day", () => {
    const entry = { percent: 20, day: "2026-09-16", baselines: {}, setAt: 1 }
    expect(isBudgetCurrent(entry, "2026-09-16")).toBe(true)
    expect(isBudgetCurrent(entry, "2026-09-17")).toBe(false)
    expect(isBudgetCurrent(undefined, "2026-09-16")).toBe(false)
  })
})
