import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ModelsGraphCard, assignEntryColors } from "@/components/models-graph-card"
import type { GraphEntry } from "@/lib/today-models"

const modelEntries: GraphEntry[] = [
  { key: "claude::Opus 4.8", name: "Opus 4.8", providerId: "claude", brandColor: "#DE7356", todayCost: 12.4, share: 12.4 / 19.7 },
  { key: "claude::Sonnet 5", name: "Sonnet 5", providerId: "claude", brandColor: "#DE7356", todayCost: 4.1, share: 4.1 / 19.7 },
  { key: "codex::GPT-5.4", name: "GPT-5.4", providerId: "codex", brandColor: "#74AA9C", todayCost: 3.2, share: 3.2 / 19.7 },
]

const providerEntries: GraphEntry[] = [
  { key: "claude", name: "Claude", providerId: "claude", brandColor: "#DE7356", todayCost: 16.5, share: 16.5 / 19.7 },
  { key: "codex", name: "Codex", providerId: "codex", brandColor: "#74AA9C", todayCost: 3.2, share: 3.2 / 19.7 },
]

const baseProps = {
  entries: modelEntries,
  totalCost: 19.7,
  groupBy: "model" as const,
  graphStyle: "bar" as const,
  theme: "dark" as const,
  showPrices: false,
  showWatermark: true,
  dateLabel: "Jul 10, 2026",
}

describe("ModelsGraphCard", () => {
  it("renders the header, one bar segment and one list row per entry", () => {
    render(<ModelsGraphCard {...baseProps} />)

    expect(screen.getByText("Models used today")).toBeInTheDocument()
    expect(screen.getByText("Jul 10, 2026")).toBeInTheDocument()
    expect(screen.getAllByTestId("models-graph-segment")).toHaveLength(3)
    expect(screen.getAllByTestId("models-graph-row").map((row) => row.textContent)).toEqual([
      "Opus 4.8",
      "Sonnet 5",
      "GPT-5.4",
    ])
    expect(screen.getByText("63%")).toBeInTheDocument()
  })

  it("titles the card by grouping (Usage for providers)", () => {
    render(<ModelsGraphCard {...baseProps} entries={providerEntries} groupBy="provider" />)

    expect(screen.getByText("Usage today")).toBeInTheDocument()
    expect(screen.getAllByTestId("models-graph-row").map((row) => row.textContent)).toEqual(["Claude", "Codex"])
    expect(screen.getAllByTestId("models-graph-segment")).toHaveLength(2)
  })

  it("weaves a non-today periodLabel into the headings", () => {
    render(<ModelsGraphCard {...baseProps} periodLabel="yesterday" graphStyle="donut" showPrices />)

    expect(screen.getByText("Models used yesterday")).toBeInTheDocument()
    expect(screen.getByTestId("models-graph-total")).toHaveTextContent("Total yesterday")
    expect(screen.getByText("yesterday")).toBeInTheDocument()
  })

  it("hides prices and total by default", () => {
    render(<ModelsGraphCard {...baseProps} />)

    expect(screen.queryByText("$12.40")).not.toBeInTheDocument()
    expect(screen.queryByTestId("models-graph-total")).not.toBeInTheDocument()
  })

  it("shows per-entry prices and the total when enabled", () => {
    render(<ModelsGraphCard {...baseProps} showPrices />)

    expect(screen.getByText("$12.40")).toBeInTheDocument()
    expect(screen.getByTestId("models-graph-total")).toHaveTextContent("Total today")
    expect(screen.getByTestId("models-graph-total")).toHaveTextContent("$19.70")
  })

  it("swaps the bar for a donut with the centered total", () => {
    render(<ModelsGraphCard {...baseProps} graphStyle="donut" />)

    expect(screen.queryByTestId("models-graph-bar")).not.toBeInTheDocument()
    expect(screen.getByTestId("models-graph-donut")).toBeInTheDocument()
    expect(screen.getByText("$19.70")).toBeInTheDocument()
    expect(screen.getByText("today")).toBeInTheDocument()
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
    const others: GraphEntry = { key: "::Others", name: "Others", providerId: "", brandColor: null, todayCost: 1, share: 0.05, isOthers: true }
    const colors = assignEntryColors([...modelEntries, others], "model", "dark")

    expect(colors.get("claude::Opus 4.8")).not.toBe(colors.get("claude::Sonnet 5"))
    expect(colors.get("::Others")).toBe("#757575")
  })

  it("provider mode: each provider slice gets its own brand hue", () => {
    const colors = assignEntryColors(providerEntries, "provider", "dark")

    expect(colors.get("claude")).toBeTruthy()
    expect(colors.get("claude")).not.toBe(colors.get("codex"))
  })
})
