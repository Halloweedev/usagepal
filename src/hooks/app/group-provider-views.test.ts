import { describe, expect, it } from "vitest"
import { flattenAccountSources, groupProviderViews } from "@/hooks/app/group-provider-views"
import type { PluginMeta } from "@/lib/plugin-types"
import type { PluginState } from "@/hooks/app/types"

function meta(id: string): PluginMeta {
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    iconUrl: "",
    brandColor: null,
    lines: [],
    links: [],
    primaryCandidates: [],
    weeklyCandidate: null,
    multiTrayLines: [],
    trayPrimaryLabel: null,
    detected: true,
  }
}
function state(plan: string): PluginState {
  return {
    data: { providerId: "x", accountId: null, displayName: "x", plan, lines: [], iconUrl: "" },
    loading: false,
    error: null,
    lastManualRefreshAt: null,
    lastUpdatedAt: 1,
  }
}

describe("groupProviderViews", () => {
  it("single-account provider yields one unnamed account", () => {
    const views = groupProviderViews([meta("codex")], { codex: state("Plus") }, {})
    expect(views).toHaveLength(1)
    expect(views[0].accounts).toHaveLength(1)
    expect(views[0].accounts[0].accountId).toBeNull()
    expect(views[0].accounts[0].label).toBeNull()
    expect(views[0].accounts[0].data?.plan).toBe("Plus")
  })

  it("multi-account provider yields ordered, labeled account snapshots", () => {
    const pluginStates: Record<string, PluginState> = {
      claude: state("Team"),
      "claude::home": state("Pro"),
      "claude::work": state("Max"),
    }
    const accountsByProvider = {
      claude: [
        { accountId: "work", label: "Work", order: 0 },
        { accountId: "home", label: "Home", order: 1 },
      ],
    }
    const views = groupProviderViews([meta("claude")], pluginStates, accountsByProvider)
    expect(views[0].accounts.map((a) => a.label)).toEqual(["Default", "Work", "Home"])
    expect(views[0].accounts.map((a) => a.data?.plan)).toEqual(["Team", "Max", "Pro"])
  })

  it("account with no probe result yet has null data but keeps its label", () => {
    const accountsByProvider = { claude: [{ accountId: "work", label: "Work", order: 0 }] }
    const views = groupProviderViews([meta("claude")], {}, accountsByProvider)
    expect(views[0].accounts[1].label).toBe("Work")
    expect(views[0].accounts[1].data).toBeNull()
  })

  describe("activeIndex", () => {
    const accountsByProvider = {
      claude: [
        { accountId: "work", label: "Work", order: 0 },
        { accountId: "home", label: "Home", order: 1 },
      ],
    }

    it("defaults to the implicit account when nothing is selected", () => {
      const views = groupProviderViews([meta("claude")], {}, accountsByProvider, {})
      expect(views[0].activeIndex).toBe(0)
    })

    it("points at the persisted selection", () => {
      const views = groupProviderViews([meta("claude")], {}, accountsByProvider, {
        claude: "home",
      })
      expect(views[0].activeIndex).toBe(2)
    })

    it("falls back to the implicit account when the selection no longer exists", () => {
      const views = groupProviderViews([meta("claude")], {}, accountsByProvider, {
        claude: "deleted",
      })
      expect(views[0].activeIndex).toBe(0)
    })

    it("is 0 for a single-account (unregistered) provider", () => {
      const views = groupProviderViews([meta("codex")], { codex: state("Plus") }, {}, {})
      expect(views[0].activeIndex).toBe(0)
    })
  })
})

describe("flattenAccountSources", () => {
  const accountsByProvider = {
    codex: [
      { accountId: "work", label: "Work", order: 0 },
      { accountId: "home", label: "Home", order: 1 },
    ],
  }

  it("yields one source per account snapshot, all sharing the provider meta", () => {
    const views = groupProviderViews(
      [meta("codex")],
      { codex: state("Plus"), "codex::work": state("Team"), "codex::home": state("Pro") },
      accountsByProvider
    )
    const sources = flattenAccountSources(views)
    // Default (implicit) first, then registered accounts in saved order.
    expect(sources).toHaveLength(3)
    expect(sources.map((s) => s.data?.plan)).toEqual(["Plus", "Team", "Pro"])
    expect(sources.every((s) => s.meta.id === "codex")).toBe(true)
  })

  it("keeps null-data snapshots so aggregators see every account", () => {
    const views = groupProviderViews([meta("codex")], { "codex::work": state("Team") }, accountsByProvider)
    const sources = flattenAccountSources(views)
    expect(sources).toHaveLength(3)
    expect(sources[0].data).toBeNull()
    expect(sources[1].data?.plan).toBe("Team")
    expect(sources[2].data).toBeNull()
  })
})
