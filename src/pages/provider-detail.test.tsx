import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ProviderDetailPage } from "@/pages/provider-detail"

describe("ProviderDetailPage", () => {
  it("shows not found when plugin missing", () => {
    render(<ProviderDetailPage plugin={null} displayMode="used" resetTimerDisplayMode="relative" />)
    expect(screen.getByText("Provider not found")).toBeInTheDocument()
  })

  it("renders ProviderCard with all scope when plugin present", async () => {
    render(
      <ProviderDetailPage
        displayMode="used"
        resetTimerDisplayMode="relative"
        plugin={{
          meta: { id: "a", name: "Alpha", iconUrl: "", lines: [] },
          data: { providerId: "a", displayName: "Alpha", iconUrl: "", lines: [] },
          loading: false,
          error: null,
          lastManualRefreshAt: null,
          lastUpdatedAt: null,
        }}
      />
    )
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0)
  })

  it("renders when plugin data is null (still shows provider name)", () => {
    render(
      <ProviderDetailPage
        displayMode="used"
        resetTimerDisplayMode="relative"
        plugin={{
          meta: { id: "a", name: "Alpha", iconUrl: "", lines: [] },
          data: null,
          loading: false,
          error: null,
          lastManualRefreshAt: null,
          lastUpdatedAt: null,
        }}
      />
    )
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0)
  })

  it("can select the implicit Default account", async () => {
    const onSelectAccount = vi.fn()
    const account = {
      data: null,
      loading: false,
      error: null,
      lastManualRefreshAt: null,
      lastUpdatedAt: null,
    }
    render(
      <ProviderDetailPage
        displayMode="used"
        resetTimerDisplayMode="relative"
        plugin={{
          meta: { id: "claude", name: "Claude", iconUrl: "", lines: [] },
          ...account,
        }}
        accounts={[
          { ...account, accountId: null, label: "Default" },
          { ...account, accountId: "work", label: "Work" },
        ]}
        activeIndex={1}
        onSelectAccount={onSelectAccount}
      />
    )
    await userEvent.click(screen.getAllByRole("tab")[0])
    expect(onSelectAccount).toHaveBeenCalledWith("claude", null)
  })

  it("renders quick links when provided by plugin meta", () => {
    render(
      <ProviderDetailPage
        displayMode="used"
        resetTimerDisplayMode="relative"
        plugin={{
          meta: {
            id: "a",
            name: "Alpha",
            iconUrl: "",
            lines: [],
            links: [{ label: "Status", url: "https://status.example.com" }],
          },
          data: null,
          loading: false,
          error: null,
          lastManualRefreshAt: null,
          lastUpdatedAt: null,
        }}
      />
    )
    expect(screen.getByRole("button", { name: /status/i })).toBeInTheDocument()
  })
})
