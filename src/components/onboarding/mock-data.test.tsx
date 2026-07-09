import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/components/ui/tooltip", () => import("@/test/tooltip-mock"))

import { ProviderCard } from "@/components/provider-card"
import { makeMockClaudeLines, makeMockCodexLines } from "@/components/onboarding/mock-data"

describe("onboarding mock data", () => {
  it("renders the Claude miniature lines through ProviderCard", () => {
    render(
      <ProviderCard
        name="Claude"
        plan="Max"
        showSeparator={false}
        lines={makeMockClaudeLines()}
        skeletonLines={[]}
        displayMode="left"
        resetTimerDisplayMode="relative"
      />
    )
    expect(screen.getByText("Session")).toBeInTheDocument()
    expect(screen.getByText("Weekly limit")).toBeInTheDocument()
    expect(screen.getByText("68% left")).toBeInTheDocument()
    expect(screen.getAllByText(/^Resets in /).length).toBe(2)
  })

  it("renders the Codex miniature lines through ProviderCard", () => {
    render(
      <ProviderCard
        name="Codex"
        plan="Plus"
        showSeparator={false}
        lines={makeMockCodexLines()}
        skeletonLines={[]}
        displayMode="left"
        resetTimerDisplayMode="relative"
      />
    )
    expect(screen.getByText("5h limit")).toBeInTheDocument()
    expect(screen.getByText("62% left")).toBeInTheDocument()
    expect(screen.getByText("Rate Limit Resets")).toBeInTheDocument()
    expect(screen.getByText("1 available")).toBeInTheDocument()
  })

  it("puts the Codex weekly line over pace so the flame and deficit show", () => {
    render(
      <ProviderCard
        name="Codex"
        plan="Plus"
        showSeparator={false}
        lines={makeMockCodexLines()}
        skeletonLines={[]}
        displayMode="left"
        resetTimerDisplayMode="relative"
      />
    )
    expect(screen.getByText("Weekly limit")).toBeInTheDocument()
    expect(screen.getByLabelText("Will run out")).toBeInTheDocument()
    expect(screen.getByText(/\d+% short/)).toBeInTheDocument()
  })
})
