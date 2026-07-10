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
    // The trend chart is deliberately unlabeled — bars only.
    expect(screen.queryByText("Usage Trend")).not.toBeInTheDocument()
  })

  it("shows the watermark only when enabled", () => {
    const { rerender } = render(
      <ShareCard providerName="Claude" providerIconUrl="/claude.svg" lines={[]} theme="dark" showWatermark={false} />
    )
    expect(screen.queryByTestId("share-card-watermark")).not.toBeInTheDocument()

    rerender(
      <ShareCard providerName="Claude" providerIconUrl="/claude.svg" lines={[]} theme="dark" showWatermark={true} />
    )
    expect(screen.getByTestId("share-card-watermark")).toHaveTextContent("Track your AI usage with UsagePal")
  })

  it("applies literal theme colors independent of the app's dark mode class", () => {
    render(
      <ShareCard providerName="Claude" providerIconUrl="/claude.svg" lines={[]} theme="light" showWatermark={false} />
    )
    expect(screen.getByTestId("share-card-surface")).toHaveClass("bg-white")
    expect(screen.getByTestId("share-card")).toHaveClass("bg-neutral-100", "text-neutral-900")
  })

  it("renders at the wider export size for a legible shared image", () => {
    render(
      <ShareCard providerName="Claude" providerIconUrl="/claude.svg" lines={[]} theme="dark" showWatermark={false} />
    )
    expect(screen.getByTestId("share-card")).toHaveClass("w-[440px]")
  })

  it("keeps the export root full-bleed: no rounded corners or border that would leave transparent pixels", () => {
    render(
      <ShareCard providerName="Claude" providerIconUrl="/claude.svg" lines={[]} theme="dark" showWatermark={false} />
    )
    const root = screen.getByTestId("share-card")
    expect(root.className).not.toMatch(/rounded/)
    expect(root.className).not.toMatch(/\bborder\b/)
  })

  it("shows the plan badge only when a plan is provided", () => {
    const { rerender } = render(
      <ShareCard providerName="Claude" providerIconUrl="/claude.svg" lines={[]} theme="dark" showWatermark={false} />
    )
    expect(screen.queryByTestId("share-card-plan")).not.toBeInTheDocument()

    rerender(
      <ShareCard
        providerName="Claude"
        providerIconUrl="/claude.svg"
        plan="Max 5x"
        lines={[]}
        theme="dark"
        showWatermark={false}
      />
    )
    expect(screen.getByTestId("share-card-plan")).toHaveTextContent("Max 5x")
  })

  it("renders model breakdown lines as an aligned table with a column per enabled metric", () => {
    const modelLine: MetricLine = {
      type: "text",
      label: "Haiku 4.5",
      value: "85.2% · Today $11.44 · 7d $1431 · 30d $6539",
    }

    render(
      <ShareCard
        providerName="Claude"
        providerIconUrl="/claude.svg"
        lines={[modelLine]}
        theme="dark"
        showWatermark={false}
        modelBreakdownLabels={new Set(["Haiku 4.5"])}
        modelDisplay={{ showPercent: true, showToday: true, showSevenDay: false, showThirtyDay: false }}
      />
    )

    expect(screen.getByTestId("share-card-models")).toBeInTheDocument()
    expect(screen.getByText("Model")).toBeInTheDocument()
    expect(screen.getByText("Haiku 4.5")).toBeInTheDocument()
    expect(screen.getByText("85.2%")).toBeInTheDocument()
    expect(screen.getByText("$11.44")).toBeInTheDocument()
    // Disabled columns render neither header nor values.
    expect(screen.queryByText("7d")).not.toBeInTheDocument()
    expect(screen.queryByText("$1431")).not.toBeInTheDocument()
  })

  it("renders a muted dash for metrics a model has no value for", () => {
    const modelLine: MetricLine = {
      type: "text",
      label: "Sonnet 4.6",
      value: "7.3% · 30d $468.56",
    }

    render(
      <ShareCard
        providerName="Claude"
        providerIconUrl="/claude.svg"
        lines={[modelLine]}
        theme="dark"
        showWatermark={false}
        modelBreakdownLabels={new Set(["Sonnet 4.6"])}
        modelDisplay={{ showPercent: true, showToday: true, showSevenDay: false, showThirtyDay: true }}
      />
    )

    expect(screen.getByText("–")).toBeInTheDocument()
    expect(screen.getByText("$468.56")).toBeInTheDocument()
  })

  it("renders the model section without a divider", () => {
    const modelLine: MetricLine = {
      type: "text",
      label: "Haiku 4.5",
      value: "85.2%",
    }

    render(
      <ShareCard
        providerName="Claude"
        providerIconUrl="/claude.svg"
        lines={[PROGRESS_LINE, modelLine]}
        theme="dark"
        showWatermark={false}
        modelBreakdownLabels={new Set(["Haiku 4.5"])}
      />
    )
    expect(screen.getByTestId("share-card-models-section")).not.toHaveClass("border-t")
  })

  it("places the logo watermark inside the main card, as a footer under the info card", () => {
    render(
      <ShareCard
        providerName="Claude"
        providerIconUrl="/claude.svg"
        lines={[PROGRESS_LINE]}
        theme="dark"
        showWatermark={true}
      />
    )

    const mainCard = screen.getByTestId("share-card")
    const surface = screen.getByTestId("share-card-surface")
    const watermark = screen.getByTestId("share-card-watermark")
    expect(mainCard).toContainElement(watermark)
    expect(surface).not.toContainElement(watermark)
    expect(surface.compareDocumentPosition(watermark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(watermark.querySelector("svg[aria-hidden='true']")).toBeTruthy()
    expect(watermark).toHaveTextContent("Track your AI usage with UsagePal")
  })

  it("keeps model lines grouped after other lines regardless of input order", () => {
    const modelLine: MetricLine = {
      type: "text",
      label: "Haiku 4.5",
      value: "85.2%",
    }

    render(
      <ShareCard
        providerName="Claude"
        providerIconUrl="/claude.svg"
        lines={[modelLine, PROGRESS_LINE]}
        theme="dark"
        showWatermark={false}
        modelBreakdownLabels={new Set(["Haiku 4.5"])}
      />
    )

    const progress = screen.getByTestId("share-card-line-progress")
    const models = screen.getByTestId("share-card-models-section")
    expect(progress.compareDocumentPosition(models) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("renders badge lines instead of silently dropping them", () => {
    const badgeLine: MetricLine = {
      type: "badge",
      label: "Status",
      text: "Rate limited",
      color: "#f59e0b",
    }

    render(
      <ShareCard
        providerName="Claude"
        providerIconUrl="/claude.svg"
        lines={[badgeLine]}
        theme="dark"
        showWatermark={false}
      />
    )

    expect(screen.getByTestId("share-card-line-badge")).toBeInTheDocument()
    expect(screen.getByText("Status")).toBeInTheDocument()
    expect(screen.getByText("Rate limited")).toBeInTheDocument()
  })
})
