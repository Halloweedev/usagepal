import { describe, expect, it } from "vitest"
import { groupProviderViews } from "@/hooks/app/group-provider-views"
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
    expect(views[0].accounts.map((a) => a.label)).toEqual(["Work", "Home"])
    expect(views[0].accounts.map((a) => a.data?.plan)).toEqual(["Max", "Pro"])
  })

  it("account with no probe result yet has null data but keeps its label", () => {
    const accountsByProvider = { claude: [{ accountId: "work", label: "Work", order: 0 }] }
    const views = groupProviderViews([meta("claude")], {}, accountsByProvider)
    expect(views[0].accounts[0].label).toBe("Work")
    expect(views[0].accounts[0].data).toBeNull()
  })
})
