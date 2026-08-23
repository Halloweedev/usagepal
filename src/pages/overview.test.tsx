import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { OverviewPage, buildStripSources } from "@/pages/overview"
import type { GroupedProviderView } from "@/hooks/app/group-provider-views"

function view(): GroupedProviderView {
  const acct = (label: string, plan: string) => ({
    accountId: label.toLowerCase(),
    label,
    data: {
      providerId: "claude",
      accountId: label.toLowerCase(),
      displayName: "Claude",
      plan,
      lines: [],
      iconUrl: "",
    },
    loading: false,
    error: null,
    lastManualRefreshAt: null,
    lastUpdatedAt: 1,
  })
  return {
    meta: {
      id: "claude",
      name: "Claude",
      iconUrl: "",
      brandColor: null,
      lines: [],
      links: [],
      primaryCandidates: [],
      weeklyCandidate: null,
      multiTrayLines: [],
      trayPrimaryLabel: null,
      detected: true,
    },
    accounts: [acct("Work", "Max"), acct("Home", "Pro")],
  }
}

describe("OverviewPage multi-account", () => {
  it("renders one swipeable card per provider", () => {
    render(
      <OverviewPage
        groupedPlugins={[view()]}
        displayMode="used"
        resetTimerDisplayMode="relative"
        overviewSpendStripEnabled={false}
      />
    )
    // One card with the provider and active account names in the header, plus
    // pagination dots to swipe between accounts.
    expect(screen.getByText("Claude")).toBeInTheDocument()
    expect(screen.getAllByRole("tab")).toHaveLength(2)
  })

  it("swiping to another account persists the selection", async () => {
    const onSelectAccount = vi.fn()
    render(
      <OverviewPage
        groupedPlugins={[view()]}
        onSelectAccount={onSelectAccount}
        displayMode="used"
        resetTimerDisplayMode="relative"
        overviewSpendStripEnabled={false}
      />
    )
    await userEvent.click(screen.getAllByRole("tab")[1])
    // The card is controlled by the parent's activeIndex, so the contract here
    // is the callback — the card itself switching is covered by ProviderCard.
    expect(onSelectAccount).toHaveBeenCalledWith("claude", "home")
  })

  it("can select the implicit Default account", async () => {
    const grouped = view()
    grouped.accounts = [
      { ...grouped.accounts[0], accountId: null, label: "Default" },
      ...grouped.accounts,
    ]
    grouped.activeIndex = 1
    const onSelectAccount = vi.fn()
    render(
      <OverviewPage
        groupedPlugins={[grouped]}
        onSelectAccount={onSelectAccount}
        displayMode="used"
        resetTimerDisplayMode="relative"
        overviewSpendStripEnabled={false}
      />
    )
    await userEvent.click(screen.getAllByRole("tab")[0])
    expect(onSelectAccount).toHaveBeenCalledWith("claude", null)
  })

  it("renders a single unnamed card for providers without registered accounts", () => {
    const single = view()
    single.accounts = [{ ...single.accounts[0], accountId: null, label: null }]
    render(
      <OverviewPage
        groupedPlugins={[single]}
        displayMode="used"
        resetTimerDisplayMode="relative"
        overviewSpendStripEnabled={false}
      />
    )
    expect(screen.getByText("Claude")).toBeInTheDocument()
    expect(screen.queryByRole("tab")).not.toBeInTheDocument()
  })
})

describe("buildStripSources", () => {
  it("flattens every account into its own strip source", () => {
    const sources = buildStripSources([view()])
    expect(sources).toHaveLength(2)
    expect(sources[0]).toMatchObject({ meta: { id: "claude", name: "Claude" } })
    expect(sources[1]).toMatchObject({ meta: { id: "claude", name: "Claude" } })
  })

  it("yields a single source when no accounts are registered", () => {
    const single = view()
    single.accounts = [{ ...single.accounts[0], accountId: null, label: null }]
    const sources = buildStripSources([single])
    expect(sources).toHaveLength(1)
  })
})