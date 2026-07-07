import { describe, expect, it } from "vitest"

import { getTrayPrimaryBars, getTrayWeeklyFraction, getTrayMultiProviderMetrics } from "@/lib/tray-primary-progress"

describe("getTrayPrimaryBars", () => {
  it("returns empty when settings missing", () => {
    const bars = getTrayPrimaryBars({
      pluginsMeta: [],
      pluginSettings: null,
      pluginStates: {},
    })
    expect(bars).toEqual([])
  })

  it("keeps plugin order, filters disabled, limits to 4", () => {
    const pluginsMeta = ["a", "b", "c", "d", "e"].map((id) => ({
      id,
      name: id.toUpperCase(),
      iconUrl: "",
      primaryCandidates: ["Usage"], detected: true,
      lines: [],
    }))

    const bars = getTrayPrimaryBars({
      pluginsMeta,
      pluginSettings: { order: ["a", "b", "c", "d", "e"], disabled: ["c"] },
      pluginStates: {},
    })

    expect(bars.map((b) => b.id)).toEqual(["a", "b", "d", "e"])
  })

  it("can target a specific plugin id for tray rendering", () => {
    const bars = getTrayPrimaryBars({
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: ["Session"], detected: true,
          lines: [],
        },
        {
          id: "b",
          name: "B",
          iconUrl: "",
          primaryCandidates: ["Session"], detected: true,
          lines: [],
        },
      ],
      pluginSettings: { order: ["a", "b"], disabled: [] },
      pluginStates: {
        b: {
          data: {
            providerId: "b",
            displayName: "B",
            iconUrl: "",
            lines: [
              {
                type: "progress",
                label: "Session",
                used: 25,
                limit: 100,
                format: { kind: "percent" },
              },
            ],
          },
          loading: false,
          error: null,
        },
      },
      pluginId: "b",
    })

    expect(bars).toEqual([{ id: "b", fraction: 0.75, label: "Session" }])
  })

  it("includes plugins with primary candidates even when no data (fraction undefined)", () => {
    const bars = getTrayPrimaryBars({
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: ["Session"], detected: true,
          lines: [],
        },
      ],
      pluginSettings: { order: ["a"], disabled: [] },
      pluginStates: { a: { data: null, loading: false, error: null } },
    })
    expect(bars).toEqual([{ id: "a", fraction: undefined }])
  })

  it("computes fraction from matching progress label and clamps 0..1", () => {
    const bars = getTrayPrimaryBars({
      displayMode: "used",
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: ["Plan usage"], detected: true,
          lines: [],
        },
      ],
      pluginSettings: { order: ["a"], disabled: [] },
      pluginStates: {
        a: {
          data: {
            providerId: "a",
            displayName: "A",
            iconUrl: "",
            lines: [
              {
                type: "progress",
                label: "Plan usage",
                used: 150,
                limit: 100,
                format: { kind: "dollars" },
              },
            ],
          },
          loading: false,
          error: null,
        },
      },
    })

    expect(bars).toEqual([{ id: "a", fraction: 1, label: "Plan usage" }])
  })

  it("does not compute fraction when limit is 0", () => {
    const bars = getTrayPrimaryBars({
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: ["Plan usage"], detected: true,
          lines: [],
        },
      ],
      pluginSettings: { order: ["a"], disabled: [] },
      pluginStates: {
        a: {
          data: {
            providerId: "a",
            displayName: "A",
            iconUrl: "",
            lines: [
              {
                type: "progress",
                label: "Plan usage",
                used: 10,
                limit: 0,
                format: { kind: "percent" },
              },
            ],
          },
          loading: false,
          error: null,
        },
      },
    })
    expect(bars).toEqual([{ id: "a", fraction: undefined, label: "Plan usage" }])
  })

  it("respects displayMode=left", () => {
    const bars = getTrayPrimaryBars({
      displayMode: "left",
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: ["Session"], detected: true,
          lines: [],
        },
      ],
      pluginSettings: { order: ["a"], disabled: [] },
      pluginStates: {
        a: {
          data: {
            providerId: "a",
            displayName: "A",
            iconUrl: "",
            lines: [
              {
                type: "progress",
                label: "Session",
                used: 25,
                limit: 100,
                format: { kind: "percent" },
              },
            ],
          },
          loading: false,
          error: null,
        },
      },
    })
    expect(bars).toEqual([{ id: "a", fraction: 0.75, label: "Session" }])
  })

  it("picks first available candidate from primaryCandidates", () => {
    const bars = getTrayPrimaryBars({
      displayMode: "used",
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: ["Credits", "Plan usage"], // Credits first, Plan usage fallback, detected: true,
          lines: [],
        },
      ],
      pluginSettings: { order: ["a"], disabled: [] },
      pluginStates: {
        a: {
          data: {
            providerId: "a",
            displayName: "A",
            iconUrl: "",
            lines: [
              // Only Plan usage available, Credits missing
              {
                type: "progress",
                label: "Plan usage",
                used: 50,
                limit: 100,
                format: { kind: "dollars" },
              },
            ],
          },
          loading: false,
          error: null,
        },
      },
    })
    expect(bars).toEqual([{ id: "a", fraction: 0.5, label: "Plan usage" }])
  })

  it("uses first candidate when both are available", () => {
    const bars = getTrayPrimaryBars({
      displayMode: "used",
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: ["Credits", "Plan usage"], detected: true,
          lines: [],
        },
      ],
      pluginSettings: { order: ["a"], disabled: [] },
      pluginStates: {
        a: {
          data: {
            providerId: "a",
            displayName: "A",
            iconUrl: "",
            lines: [
              {
                type: "progress",
                label: "Credits",
                used: 20,
                limit: 100,
                format: { kind: "dollars" },
              },
              {
                type: "progress",
                label: "Plan usage",
                used: 80,
                limit: 100,
                format: { kind: "dollars" },
              },
            ],
          },
          loading: false,
          error: null,
        },
      },
    })
    // Should use Credits (20/100 = 0.2), not Plan usage (80/100 = 0.8)
    expect(bars).toEqual([{ id: "a", fraction: 0.2, label: "Credits" }])
  })

  it("skips plugins with empty primaryCandidates", () => {
    const bars = getTrayPrimaryBars({
      pluginsMeta: [
        {
          id: "a",
          name: "A",
          iconUrl: "",
          primaryCandidates: [], detected: true,
          lines: [],
        },
      ],
      pluginSettings: { order: ["a"], disabled: [] },
      pluginStates: {},
    })
    expect(bars).toEqual([])
  })

  it("handles Claude fallback from Session to Weekly to Extra usage spent", () => {
    const pluginsMeta = [
      {
        id: "claude",
        name: "Claude",
        iconUrl: "",
        primaryCandidates: ["Session", "Weekly", "Extra usage spent"], detected: true,
        lines: [],
      },
    ]

    const runTest = (
      lines: Array<{
        type: "progress"
        label: string
        used: number
        limit: number
        format: { kind: "dollars" | "percent" }
      }>
    ) => {
      return getTrayPrimaryBars({
        displayMode: "used",
        pluginsMeta,
        pluginSettings: { order: ["claude"], disabled: [] },
        pluginStates: {
          claude: {
            data: {
              providerId: "claude",
              displayName: "Claude",
              iconUrl: "",
              lines,
            },
            loading: false,
            error: null,
          },
        },
      })
    }

    // Case 1: Only Extra usage spent is available (e.g. Claude Enterprise/Team account overage)
    expect(
      runTest([
        {
          type: "progress",
          label: "Extra usage spent",
          used: 30,
          limit: 100,
          format: { kind: "dollars" },
        },
      ])
    ).toEqual([{ id: "claude", fraction: 0.3, label: "Extra usage spent" }])

    // Case 2: Weekly is available (but Session is not)
    expect(
      runTest([
        {
          type: "progress",
          label: "Weekly",
          used: 40,
          limit: 100,
          format: { kind: "percent" },
        },
        {
          type: "progress",
          label: "Extra usage spent",
          used: 30,
          limit: 100,
          format: { kind: "dollars" },
        },
      ])
    ).toEqual([{ id: "claude", fraction: 0.4, label: "Weekly" }])

    // Case 3: Session is available alongside Weekly and Extra usage spent (Session should win)
    expect(
      runTest([
        {
          type: "progress",
          label: "Session",
          used: 50,
          limit: 100,
          format: { kind: "percent" },
        },
        {
          type: "progress",
          label: "Weekly",
          used: 40,
          limit: 100,
          format: { kind: "percent" },
        },
        {
          type: "progress",
          label: "Extra usage spent",
          used: 30,
          limit: 100,
          format: { kind: "dollars" },
        },
      ])
    ).toEqual([{ id: "claude", fraction: 0.5, label: "Session" }])
  })

  describe("weekly metric preference", () => {
    const metaWithWeekly = {
      id: "a",
      name: "A",
      iconUrl: "",
      primaryCandidates: ["Session"], detected: true,
      weeklyCandidate: "Weekly",
      lines: [],
    }

    const sessionAndWeeklyData = {
      a: {
        data: {
          providerId: "a",
          displayName: "A",
          iconUrl: "",
          lines: [
            {
              type: "progress" as const,
              label: "Session",
              used: 20,
              limit: 100,
              format: { kind: "percent" as const },
            },
            {
              type: "progress" as const,
              label: "Weekly",
              used: 60,
              limit: 100,
              format: { kind: "percent" as const },
            },
          ],
        },
        loading: false,
        error: null,
      },
    }

    it("prefers the weekly candidate when preferWeekly is set", () => {
      const bars = getTrayPrimaryBars({
        displayMode: "used",
        preferWeekly: true,
        pluginsMeta: [metaWithWeekly],
        pluginSettings: { order: ["a"], disabled: [] },
        pluginStates: sessionAndWeeklyData,
      })
      expect(bars).toEqual([{ id: "a", fraction: 0.6, label: "Weekly", weekly: true }])
    })

    it("ignores the weekly candidate when preferWeekly is false", () => {
      const bars = getTrayPrimaryBars({
        displayMode: "used",
        pluginsMeta: [metaWithWeekly],
        pluginSettings: { order: ["a"], disabled: [] },
        pluginStates: sessionAndWeeklyData,
      })
      expect(bars).toEqual([{ id: "a", fraction: 0.2, label: "Session" }])
    })

    it("falls back to primary when the provider has no weekly candidate", () => {
      const bars = getTrayPrimaryBars({
        displayMode: "used",
        preferWeekly: true,
        pluginsMeta: [
          {
            id: "a",
            name: "A",
            iconUrl: "",
            primaryCandidates: ["Session"], detected: true,
            lines: [],
          },
        ],
        pluginSettings: { order: ["a"], disabled: [] },
        pluginStates: sessionAndWeeklyData,
      })
      expect(bars).toEqual([{ id: "a", fraction: 0.2, label: "Session" }])
    })

    it("falls back to primary when the weekly candidate is absent from data", () => {
      const bars = getTrayPrimaryBars({
        displayMode: "used",
        preferWeekly: true,
        pluginsMeta: [metaWithWeekly],
        pluginSettings: { order: ["a"], disabled: [] },
        pluginStates: {
          a: {
            data: {
              providerId: "a",
              displayName: "A",
              iconUrl: "",
              lines: [
                {
                  type: "progress",
                  label: "Session",
                  used: 20,
                  limit: 100,
                  format: { kind: "percent" },
                },
              ],
            },
            loading: false,
            error: null,
          },
        },
      })
      expect(bars).toEqual([{ id: "a", fraction: 0.2, label: "Session" }])
    })
  })

  it("escalated line overrides the primary candidate", () => {
    const bars = getTrayPrimaryBars({
      displayMode: "used",
      pluginsMeta: [
        {
          id: "oc",
          name: "OpenCode",
          iconUrl: "",
          primaryCandidates: ["Session"], detected: true,
          lines: [
            { type: "progress", label: "Session", scope: "overview" },
            { type: "progress", label: "Monthly", scope: "detail", escalateAtPercent: 98 },
          ],
        },
      ],
      pluginSettings: { order: ["oc"], disabled: [] },
      pluginStates: {
        oc: {
          data: {
            providerId: "oc",
            displayName: "OpenCode",
            iconUrl: "",
            lines: [
              { type: "progress", label: "Session", used: 0, limit: 100, format: { kind: "percent" } },
              { type: "progress", label: "Monthly", used: 99, limit: 100, format: { kind: "percent" } },
            ],
          },
          loading: false,
          error: null,
        },
      },
    })

    expect(bars).toEqual([{ id: "oc", fraction: 0.99, label: "Monthly" }])
  })

  it("escalated bar fraction respects displayMode=left", () => {
    const bars = getTrayPrimaryBars({
      displayMode: "left",
      pluginsMeta: [
        {
          id: "oc",
          name: "OpenCode",
          iconUrl: "",
          primaryCandidates: ["Session"], detected: true,
          lines: [
            { type: "progress", label: "Session", scope: "overview" },
            { type: "progress", label: "Monthly", scope: "detail", escalateAtPercent: 98 },
          ],
        },
      ],
      pluginSettings: { order: ["oc"], disabled: [] },
      pluginStates: {
        oc: {
          data: {
            providerId: "oc",
            displayName: "OpenCode",
            iconUrl: "",
            lines: [
              { type: "progress", label: "Session", used: 0, limit: 100, format: { kind: "percent" } },
              { type: "progress", label: "Monthly", used: 99, limit: 100, format: { kind: "percent" } },
            ],
          },
          loading: false,
          error: null,
        },
      },
    })

    expect(bars).toEqual([{ id: "oc", fraction: 0.01, label: "Monthly" }])
  })

  it("escalated line overrides weekly mode", () => {
    const bars = getTrayPrimaryBars({
      displayMode: "used",
      preferWeekly: true,
      pluginsMeta: [
        {
          id: "oc",
          name: "OpenCode",
          iconUrl: "",
          primaryCandidates: ["Session"], detected: true,
          weeklyCandidate: "Weekly",
          lines: [
            { type: "progress", label: "Weekly", scope: "overview", escalateAtPercent: undefined },
            { type: "progress", label: "Monthly", scope: "detail", escalateAtPercent: 98 },
          ],
        },
      ],
      pluginSettings: { order: ["oc"], disabled: [] },
      pluginStates: {
        oc: {
          data: {
            providerId: "oc",
            displayName: "OpenCode",
            iconUrl: "",
            lines: [
              { type: "progress", label: "Weekly", used: 40, limit: 100, format: { kind: "percent" } },
              { type: "progress", label: "Monthly", used: 100, limit: 100, format: { kind: "percent" } },
            ],
          },
          loading: false,
          error: null,
        },
      },
    })

    expect(bars).toEqual([{ id: "oc", fraction: 1, label: "Monthly" }])
  })

  it("does not escalate when below threshold (keeps primary)", () => {
    const bars = getTrayPrimaryBars({
      displayMode: "used",
      pluginsMeta: [
        {
          id: "oc",
          name: "OpenCode",
          iconUrl: "",
          primaryCandidates: ["Session"], detected: true,
          lines: [
            { type: "progress", label: "Session", scope: "overview" },
            { type: "progress", label: "Monthly", scope: "detail", escalateAtPercent: 98 },
          ],
        },
      ],
      pluginSettings: { order: ["oc"], disabled: [] },
      pluginStates: {
        oc: {
          data: {
            providerId: "oc",
            displayName: "OpenCode",
            iconUrl: "",
            lines: [
              { type: "progress", label: "Session", used: 20, limit: 100, format: { kind: "percent" } },
              { type: "progress", label: "Monthly", used: 50, limit: 100, format: { kind: "percent" } },
            ],
          },
          loading: false,
          error: null,
        },
      },
    })

    expect(bars).toEqual([{ id: "oc", fraction: 0.2, label: "Session" }])
  })

  describe("trayPrimaryLabel override", () => {
    const cursorMeta = {
      id: "cursor",
      name: "Cursor",
      iconUrl: "",
      primaryCandidates: ["Credits", "Total usage", "Requests"],
      trayPrimaryLabel: "Total usage",
      multiTrayLines: ["Auto usage", "API usage"],
      detected: true,
      lines: [],
    }

    const cursorData = {
      providerId: "cursor",
      displayName: "Cursor",
      iconUrl: "",
      lines: [
        { type: "progress" as const, label: "Credits", used: 10, limit: 100, format: { kind: "dollars" as const } },
        { type: "progress" as const, label: "Total usage", used: 42, limit: 100, format: { kind: "percent" as const } },
        { type: "progress" as const, label: "Auto usage", used: 70, limit: 100, format: { kind: "percent" as const } },
        { type: "progress" as const, label: "API usage", used: 30, limit: 100, format: { kind: "percent" as const } },
      ],
    }

    it("uses trayPrimaryLabel for provider/bars styles instead of first primary candidate", () => {
      const bars = getTrayPrimaryBars({
        displayMode: "used",
        pluginsMeta: [cursorMeta],
        pluginSettings: { order: ["cursor"], disabled: [] },
        pluginStates: {
          cursor: { data: cursorData, loading: false, error: null },
        },
        pluginId: "cursor",
      })

      expect(bars).toEqual([{ id: "cursor", fraction: 0.42, label: "Total usage" }])
    })

    it("keeps non-Cursor primary candidate behavior unchanged", () => {
      const bars = getTrayPrimaryBars({
        displayMode: "used",
        pluginsMeta: [
          {
            id: "claude",
            name: "Claude",
            iconUrl: "",
            primaryCandidates: ["Session"],
            detected: true,
            lines: [],
          },
        ],
        pluginSettings: { order: ["claude"], disabled: [] },
        pluginStates: {
          claude: {
            data: {
              providerId: "claude",
              displayName: "Claude",
              iconUrl: "",
              lines: [
                { type: "progress", label: "Session", used: 25, limit: 100, format: { kind: "percent" } },
              ],
            },
            loading: false,
            error: null,
          },
        },
      })

      expect(bars).toEqual([{ id: "claude", fraction: 0.25, label: "Session" }])
    })
  })
})

describe("getTrayMultiProviderMetrics", () => {
  const cursorMeta = {
    id: "cursor",
    name: "Cursor",
    iconUrl: "",
    primaryCandidates: ["Credits", "Total usage"],
    trayPrimaryLabel: "Total usage",
    multiTrayLines: ["Auto usage", "API usage"],
    detected: true,
    lines: [],
  }

  const cursorData = {
    providerId: "cursor",
    displayName: "Cursor",
    iconUrl: "",
    lines: [
      { type: "progress" as const, label: "Credits", used: 10, limit: 100, format: { kind: "dollars" as const } },
      { type: "progress" as const, label: "Total usage", used: 42, limit: 100, format: { kind: "percent" as const } },
      { type: "progress" as const, label: "Auto usage", used: 70, limit: 100, format: { kind: "percent" as const } },
      { type: "progress" as const, label: "API usage", used: 30, limit: 100, format: { kind: "percent" as const } },
    ],
  }

  it("uses multiTrayLines for Cursor multi style (Auto + API)", () => {
    const metrics = getTrayMultiProviderMetrics({
      pluginId: "cursor",
      pluginsMeta: [cursorMeta],
      pluginSettings: { order: ["cursor"], disabled: [] },
      pluginStates: {
        cursor: { data: cursorData, loading: false, error: null },
      },
      displayMode: "used",
    })

    expect(metrics).toEqual({ sessionFraction: 0.7, weeklyFraction: 0.3 })
  })

  it("falls back to primary + weekly for providers without multiTrayLines", () => {
    const metrics = getTrayMultiProviderMetrics({
      pluginId: "claude",
      pluginsMeta: [
        {
          id: "claude",
          name: "Claude",
          iconUrl: "",
          primaryCandidates: ["Session"],
          weeklyCandidate: "Weekly",
          multiTrayLines: [],
          detected: true,
          lines: [],
        },
      ],
      pluginSettings: { order: ["claude"], disabled: [] },
      pluginStates: {
        claude: {
          data: {
            providerId: "claude",
            displayName: "Claude",
            iconUrl: "",
            lines: [
              { type: "progress", label: "Session", used: 20, limit: 100, format: { kind: "percent" } },
              { type: "progress", label: "Weekly", used: 60, limit: 100, format: { kind: "percent" } },
            ],
          },
          loading: false,
          error: null,
        },
      },
      displayMode: "used",
    })

    expect(metrics).toEqual({ sessionFraction: 0.2, weeklyFraction: 0.6 })
  })
})

const claudeMeta = {
  id: "claude",
  name: "Claude",
  iconUrl: "",
  primaryCandidates: ["Session"],
  weeklyCandidate: "Weekly",
  lines: [],
}

const sessionWeeklyData = {
  providerId: "claude",
  displayName: "Claude",
  iconUrl: "",
  lines: [
    { type: "progress" as const, label: "Session", used: 100, limit: 100, format: { kind: "percent" as const } },
    { type: "progress" as const, label: "Weekly", used: 36, limit: 100, format: { kind: "percent" as const } },
  ],
}

describe("getTrayWeeklyFraction", () => {
  it("returns undefined when weeklyCandidate missing", () => {
    expect(
      getTrayWeeklyFraction({
        pluginId: "a",
        pluginsMeta: [{ id: "a", name: "A", iconUrl: "", primaryCandidates: ["Session"], lines: [] }],
        pluginSettings: { order: ["a"], disabled: [] },
        pluginStates: {},
      })
    ).toBeUndefined()
  })

  it("returns weekly fraction with displayMode left (default)", () => {
    expect(
      getTrayWeeklyFraction({
        pluginId: "claude",
        pluginsMeta: [claudeMeta],
        pluginSettings: { order: ["claude"], disabled: [] },
        pluginStates: {
          claude: { data: sessionWeeklyData, loading: false, error: null },
        },
      })
    ).toBe(0.64)
  })

  it("returns 0 when weekly usage is full (left mode)", () => {
    expect(
      getTrayWeeklyFraction({
        pluginId: "claude",
        pluginsMeta: [claudeMeta],
        pluginSettings: { order: ["claude"], disabled: [] },
        pluginStates: {
          claude: {
            data: {
              ...sessionWeeklyData,
              lines: [
                sessionWeeklyData.lines[0],
                { type: "progress", label: "Weekly", used: 100, limit: 100, format: { kind: "percent" } },
              ],
            },
            loading: false,
            error: null,
          },
        },
      })
    ).toBe(0)
  })

  it("returns undefined when weekly line absent from runtime data", () => {
    expect(
      getTrayWeeklyFraction({
        pluginId: "claude",
        pluginsMeta: [claudeMeta],
        pluginSettings: { order: ["claude"], disabled: [] },
        pluginStates: {
          claude: {
            data: { ...sessionWeeklyData, lines: [sessionWeeklyData.lines[0]] },
            loading: false,
            error: null,
          },
        },
      })
    ).toBeUndefined()
  })

  it("does not return escalated primary fraction when escalation active", () => {
    const metaWithEscalation = {
      ...claudeMeta,
      lines: [{ type: "progress" as const, label: "Monthly", scope: "detail", escalateAtPercent: 98 }],
    }
    expect(
      getTrayWeeklyFraction({
        pluginId: "claude",
        pluginsMeta: [metaWithEscalation],
        pluginSettings: { order: ["claude"], disabled: [] },
        pluginStates: {
          claude: {
            data: {
              ...sessionWeeklyData,
              lines: [
                ...sessionWeeklyData.lines,
                { type: "progress", label: "Monthly", used: 99, limit: 100, format: { kind: "percent" } },
              ],
            },
            loading: false,
            error: null,
          },
        },
      })
    ).toBe(0.64)
  })
})

const cursorMeta = {
  id: "cursor",
  name: "Cursor",
  iconUrl: "",
  primaryCandidates: ["Credits", "Total usage"],
  weeklyCandidate: null,
  multiTrayLines: ["Auto usage", "API usage"],
  lines: [],
}

const cursorUsageData = {
  providerId: "cursor",
  displayName: "Cursor",
  iconUrl: "",
  lines: [
    { type: "progress" as const, label: "Credits", used: 10, limit: 100, format: { kind: "dollars" as const } },
    { type: "progress" as const, label: "Total usage", used: 55, limit: 100, format: { kind: "percent" as const } },
    { type: "progress" as const, label: "Auto usage", used: 42, limit: 100, format: { kind: "percent" as const } },
    { type: "progress" as const, label: "API usage", used: 18, limit: 100, format: { kind: "percent" as const } },
  ],
}

describe("getTrayMultiProviderMetrics", () => {
  it("uses multiTrayLines for Cursor instead of primary and weekly", () => {
    expect(
      getTrayMultiProviderMetrics({
        displayMode: "used",
        pluginId: "cursor",
        pluginsMeta: [cursorMeta],
        pluginSettings: { order: ["cursor"], disabled: [] },
        pluginStates: {
          cursor: { data: cursorUsageData, loading: false, error: null },
        },
      })
    ).toEqual({ sessionFraction: 0.42, weeklyFraction: 0.18 })
  })

  it("falls back to primary and weekly when multiTrayLines is empty", () => {
    expect(
      getTrayMultiProviderMetrics({
        displayMode: "used",
        pluginId: "claude",
        pluginsMeta: [claudeMeta],
        pluginSettings: { order: ["claude"], disabled: [] },
        pluginStates: {
          claude: { data: sessionWeeklyData, loading: false, error: null },
        },
      })
    ).toEqual({ sessionFraction: 1, weeklyFraction: 0.36 })
  })

  it("omits missing multiTray line when only one label is present in data", () => {
    expect(
      getTrayMultiProviderMetrics({
        displayMode: "used",
        pluginId: "cursor",
        pluginsMeta: [cursorMeta],
        pluginSettings: { order: ["cursor"], disabled: [] },
        pluginStates: {
          cursor: {
            data: {
              ...cursorUsageData,
              lines: cursorUsageData.lines.filter((line) => line.label !== "API usage"),
            },
            loading: false,
            error: null,
          },
        },
      })
    ).toEqual({ sessionFraction: 0.42, weeklyFraction: undefined })
  })
})
