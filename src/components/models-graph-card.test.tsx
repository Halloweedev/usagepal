import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ModelsGraphCard, assignEntryColors } from "@/components/models-graph-card"
import type { GraphEntry } from "@/lib/today-models"

const modelEntries: GraphEntry[] = [
  { key: "claude::Opus 4.8", name: "Opus 4.8", providerId: "claude", brandColor: "#DE7356", todayCost: 12.4, tokenCount: 94_000_000, share: 12.4 / 19.7 },
  { key: "claude::Sonnet 5", name: "Sonnet 5", providerId: "claude", brandColor: "#DE7356", todayCost: 4.1, tokenCount: 31_000_000, share: 4.1 / 19.7 },
  { key: "codex::GPT-5.4", name: "GPT-5.4", providerId: "codex", brandColor: "#74AA9C", todayCost: 3.2, tokenCount: null, share: 3.2 / 19.7 },
]

const providerEntries: GraphEntry[] = [
  { key: "claude", name: "Claude", providerId: "claude", brandColor: "#DE7356", todayCost: 16.5, tokenCount: 125_000_000, share: 16.5 / 19.7 },
  { key: "codex", name: "Codex", providerId: "codex", brandColor: "#74AA9C", todayCost: 3.2, tokenCount: null, share: 3.2 / 19.7 },
]

const baseProps = {
  entries: modelEntries,
  totalCost: 19.7,
  totalTokens: 125_000_000,
  metric: "price" as const,
  groupBy: "model" as const,
  graphStyle: "bar" as const,
  theme: "dark" as const,
  showBreakdown: true,
  showTotal: true,
  showDate: true,
  showWatermark: true,
  dateLabel: "Jul 10, 2026",
}

describe("ModelsGraphCard", () => {
  it("renders the header, one bar segment and one list row per entry", () => {
    render(<ModelsGraphCard {...baseProps} />)

    expect(screen.getByText("Model Spend today")).toBeInTheDocument()
    expect(screen.getByText("Jul 10, 2026")).toBeInTheDocument()
    expect(screen.getAllByTestId("models-graph-segment")).toHaveLength(3)
    expect(screen.getAllByTestId("models-graph-row").map((row) => row.textContent)).toEqual([
      "Opus 4.8",
      "Sonnet 5",
      "GPT-5.4",
    ])
    expect(screen.getByText("$12.40")).toBeInTheDocument()
  })

  it("titles the card by grouping and metric", () => {
    render(<ModelsGraphCard {...baseProps} entries={providerEntries} groupBy="provider" metric="usage" />)

    expect(screen.getByText("Token Usage today")).toBeInTheDocument()
    expect(screen.getByText("125M")).toBeInTheDocument()
    expect(screen.getAllByTestId("models-graph-row").map((row) => row.textContent)).toEqual(["Claude", "Codex"])
  })

  it("weaves periodLabel into metric headings", () => {
    render(
      <ModelsGraphCard
        {...baseProps}
        periodLabel="yesterday"
        metric="pricePerM"
        graphStyle="donut"
        showTotal={false}
      />
    )

    expect(screen.getByText("Model Token Price yesterday")).toBeInTheDocument()
    expect(screen.getAllByText("$0.13/MTok").length).toBe(2)
    expect(screen.queryByTestId("models-graph-total")).not.toBeInTheDocument()
  })

  it("hides the top-right date when showDate is off", () => {
    render(<ModelsGraphCard {...baseProps} showDate={false} />)

    expect(screen.getByText("Model Spend today")).toBeInTheDocument()
    expect(screen.queryByText("Jul 10, 2026")).not.toBeInTheDocument()
  })

  it("shows the bar total for the active metric", () => {
    render(<ModelsGraphCard {...baseProps} />)

    expect(screen.getByTestId("models-graph-total")).toHaveTextContent("Total Spend today")
    expect(screen.getByTestId("models-graph-total")).toHaveTextContent("$19.70")
  })

  it("shows usage values in the breakdown when sharing usage", () => {
    render(<ModelsGraphCard {...baseProps} metric="usage" showTotal={false} />)

    expect(screen.getByText("94M")).toBeInTheDocument()
    expect(screen.getByText("31M")).toBeInTheDocument()
    expect(screen.getByText("—")).toBeInTheDocument()
  })

  it("hides the breakdown list when disabled but keeps the bar", () => {
    render(<ModelsGraphCard {...baseProps} showBreakdown={false} />)

    expect(screen.queryByTestId("models-graph-list")).not.toBeInTheDocument()
    expect(screen.getByTestId("models-graph-bar")).toBeInTheDocument()
    expect(screen.getByTestId("models-graph-total")).toBeInTheDocument()
  })

  it("hides the donut center total when Total is off", () => {
    render(<ModelsGraphCard {...baseProps} graphStyle="donut" showTotal={false} />)

    expect(screen.getByTestId("models-graph-donut")).toBeInTheDocument()
    expect(screen.queryByText("$20")).not.toBeInTheDocument()
    expect(screen.queryByTestId("models-graph-total")).not.toBeInTheDocument()
  })

  it("shows the donut center total when Total is on", () => {
    render(<ModelsGraphCard {...baseProps} graphStyle="donut" />)

    expect(screen.queryByTestId("models-graph-bar")).not.toBeInTheDocument()
    expect(screen.getByTestId("models-graph-donut")).toBeInTheDocument()
    expect(screen.getByText("$20")).toBeInTheDocument()
    expect(screen.queryByTestId("models-graph-total")).not.toBeInTheDocument()
  })

  it("carries the watermark, toggleable", () => {
    const { rerender } = render(<ModelsGraphCard {...baseProps} />)
    expect(screen.getByTestId("share-card-watermark")).toHaveTextContent("Track your AI usage with UsagePal")

    rerender(<ModelsGraphCard {...baseProps} showWatermark={false} />)
    expect(screen.queryByTestId("share-card-watermark")).not.toBeInTheDocument()
  })
})

describe("assignEntryColors", () => {
  it("model mode: same-provider models get distinct shades, Others the neutral", () => {
    const others: GraphEntry = { key: "::Others", name: "Others", providerId: "", brandColor: null, todayCost: 1, tokenCount: null, share: 0.05, isOthers: true }
    const colors = assignEntryColors([...modelEntries, others], "model", "dark")

    expect(colors.get("claude::Opus 4.8")).not.toBe(colors.get("claude::Sonnet 5"))
    expect(colors.get("::Others")).toBe("#757575")
    const opus = colors.get("claude::Opus 4.8")!
    const sonnet = colors.get("claude::Sonnet 5")!
    expect(opus).not.toBe(sonnet)
  })

  it("provider mode: each provider slice gets its own brand hue", () => {
    const colors = assignEntryColors(providerEntries, "provider", "dark")

    expect(colors.get("claude")).toBeTruthy()
    expect(colors.get("claude")).not.toBe(colors.get("codex"))
  })
})
