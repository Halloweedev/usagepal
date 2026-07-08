import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({
    children,
    render: renderProp,
    ...props
  }: {
    children?: ReactNode
    render?: ((props: Record<string, unknown>) => ReactNode) | ReactNode
  }) => {
    if (typeof renderProp === "function") return renderProp({ ...props, children })
    if (renderProp) return renderProp
    return <div {...props}>{children}</div>
  },
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

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
    expect(screen.getByText("Credits")).toBeInTheDocument()
    expect(screen.getByText("$38.20 left")).toBeInTheDocument()
  })
})
