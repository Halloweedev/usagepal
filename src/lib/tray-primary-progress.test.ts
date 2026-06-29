import { describe, expect, it } from "vitest"

import { getTrayPrimaryBars } from "@/lib/tray-primary-progress"

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
      primaryCandidates: ["Usage"],
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
          primaryCandidates: ["Session"],
          lines: [],
        },
        {
          id: "b",
          name: "B",
          iconUrl: "",
          primaryCandidates: ["Session"],
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
          primaryCandidates: ["Session"],
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
          primaryCandidates: ["Plan usage"],
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
          primaryCandidates: ["Plan usage"],
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
          primaryCandidates: ["Session"],
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
          primaryCandidates: ["Credits", "Plan usage"], // Credits first, Plan usage fallback
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
          primaryCandidates: ["Credits", "Plan usage"],
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
          primaryCandidates: [],
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
        primaryCandidates: ["Session", "Weekly", "Extra usage spent"],
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
      primaryCandidates: ["Session"],
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
            primaryCandidates: ["Session"],
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
})
