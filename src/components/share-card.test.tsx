import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ShareCard } from "@/components/share-card"
import type { MetricLine } from "@/lib/plugin-types"

const PROGRESS_LINE: MetricLine = {
  type: "progress",
  label: "Session",
  used: 40,
  limit: 100,
  format: { kind: "percent" },
}

const TEXT_LINE: MetricLine = {
  type: "text",
  label: "claude-sonnet-5",
  value: "62%",
}

const BARCHART_LINE: MetricLine = {
  type: "barChart",
  label: "Usage Trend",
  points: [
    { label: "7/1", value: 10 },
    { label: "7/2", value: 20 },
  ],
}

describe("ShareCard", () => {
  it("renders only the passed lines, in order", () => {
    render(
      <ShareCard
        providerName="Claude"
        providerIconUrl="/claude.svg"
        lines={[PROGRESS_LINE, TEXT_LINE, BARCHART_LINE]}
        theme="dark"
        showWatermark={false}
      />
    )

    expect(screen.getAllByTestId(/share-card-line-/).map((el) => el.dataset.testid)).toEqual([
      "share-card-line-progress",
      "share-card-line-text",
      "share-card-line-barchart",
    ])
    expect(screen.getByText("Session")).toBeInTheDocument()
    expect(screen.getByText("claude-sonnet-5")).toBeInTheDocument()
    expect(screen.getByText("Usage Trend")).toBeInTheDocument()
  })

  it("shows the watermark only when enabled", () => {
    const { rerender } = render(
      <ShareCard providerName="Claude" providerIconUrl="/claude.svg" lines={[]} theme="dark" showWatermark={false} />
    )
    expect(screen.queryByTestId("share-card-watermark")).not.toBeInTheDocument()

    rerender(
      <ShareCard providerName="Claude" providerIconUrl="/claude.svg" lines={[]} theme="dark" showWatermark={true} />
    )
    expect(screen.getByTestId("share-card-watermark")).toHaveTextContent("Shared via UsagePal")
  })

  it("applies literal theme colors independent of the app's dark mode class", () => {
    render(
      <ShareCard providerName="Claude" providerIconUrl="/claude.svg" lines={[]} theme="light" showWatermark={false} />
    )
    expect(screen.getByTestId("share-card")).toHaveClass("bg-white", "text-neutral-900")
  })
})
