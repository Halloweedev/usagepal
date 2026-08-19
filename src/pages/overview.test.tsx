import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { OverviewPage } from "@/pages/overview"
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
  it("renders one card per provider with account dots", () => {
    render(
      <OverviewPage
        plugins={[]}
        groupedPlugins={[view()]}
        displayMode="used"
        resetTimerDisplayMode="relative"
        overviewSpendStripEnabled={false}
      />
    )
    expect(screen.getAllByRole("tab")).toHaveLength(2)
    expect(screen.getByText("Claude")).toBeInTheDocument()
  })
})
