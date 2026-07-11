import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ModelsGraphCard, assignModelColors } from "@/components/models-graph-card"
import type { TodayModelUsage } from "@/lib/today-models"

const usage: TodayModelUsage = {
  models: [
    { name: "Opus 4.8", providerId: "claude", providerName: "Claude", brandColor: "#DE7356", todayCost: 12.4, share: 12.4 / 19.7 },
    { name: "Sonnet 5", providerId: "claude", providerName: "Claude", brandColor: "#DE7356", todayCost: 4.1, share: 4.1 / 19.7 },
    { name: "GPT-5.4", providerId: "codex", providerName: "Codex", brandColor: "#74AA9C", todayCost: 3.2, share: 3.2 / 19.7 },
  ],
  providers: [
    { id: "claude", name: "Claude", todayCost: 16.5 },
    { id: "codex", name: "Codex", todayCost: 3.2 },
  ],
  totalCost: 19.7,
}

const baseProps = {
  usage,
  graphStyle: "bar" as const,
  theme: "dark" as const,
  showModelPrices: false,
  showProviderPrices: false,
  showWatermark: true,
  dateLabel: "Jul 10, 2026",
}

describe("ModelsGraphCard", () => {
  it("renders the header, one bar segment and one list row per model", () => {
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

  it("hides prices, provider subtotals and total by default", () => {
    render(<ModelsGraphCard {...baseProps} />)

    expect(screen.queryByText("$12.40")).not.toBeInTheDocument()
    expect(screen.queryByTestId("models-graph-providers")).not.toBeInTheDocument()
    expect(screen.queryByTestId("models-graph-total")).not.toBeInTheDocument()
  })

  it("shows per-model prices and the total when enabled", () => {
    render(<ModelsGraphCard {...baseProps} showModelPrices />)

    expect(screen.getByText("$12.40")).toBeInTheDocument()
    expect(screen.getByTestId("models-graph-total")).toHaveTextContent("Total today")
    expect(screen.getByTestId("models-graph-total")).toHaveTextContent("$19.70")
  })

  it("shows provider subtotals and the total when enabled", () => {
    render(<ModelsGraphCard {...baseProps} showProviderPrices />)

    const providers = screen.getByTestId("models-graph-providers")
    expect(providers).toHaveTextContent("Claude")
    expect(providers).toHaveTextContent("$16.50")
    expect(screen.getByTestId("models-graph-total")).toBeInTheDocument()
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

describe("assignModelColors", () => {
  it("gives same-provider models distinct shades and Others the neutral", () => {
    const others = { name: "Others", providerId: "", providerName: "", brandColor: null, todayCost: 1, share: 0.05, isOthers: true }
    const models = [...usage.models, others]
    const colors = assignModelColors(models, "dark")

    expect(colors.get(models[0])).not.toBe(colors.get(models[1]))
    expect(colors.get(others)).toBe("#757575")
    expect(new Set(models.map((model) => colors.get(model))).size).toBe(4)
  })
})
