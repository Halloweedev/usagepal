import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import userEvent from "@testing-library/user-event"
import { ProviderCard } from "@/components/provider-card"
import { UsageSparkline } from "@/components/usage-sparkline"

const POINTS = [
  { label: "5/16", value: 100, valueLabel: "100 tokens" },
  { label: "5/17", value: 500, valueLabel: "500 tokens" }, // peak
  { label: "6/2", value: 50, valueLabel: "50 tokens" }, // latest
]

describe("UsageSparkline", () => {
  it("renders an inline row with an accessible summary", () => {
    render(<UsageSparkline label="Usage Trend" points={POINTS} note="Estimated from local logs" />)
    const sparkline = screen.getByRole("button", { name: /Usage Trend/ })
    expect(sparkline).toHaveAccessibleName(/latest 50 tokens on 6\/2/)
    expect(sparkline).toHaveAccessibleName(/peak 500 tokens/)
    expect(sparkline).toHaveAccessibleName(/Estimated from local logs/)
  })

  it("reveals the detail graph on hover and shows a day's usage when hovering its bar", async () => {
    const user = userEvent.setup()
    render(<UsageSparkline label="Usage Trend" points={POINTS} note="Estimated from local logs" />)

    // Hovering the row opens the larger graph; default readout is the peak.
    await user.hover(screen.getByRole("button", { name: /Usage Trend/ }))
    expect(await screen.findByText("peak 500 tokens")).toBeInTheDocument()

    // The hoverable popup stays open; hovering a day's column shows that day.
    // (fireEvent drives the handler directly — userEvent blocks on the
    // positioner's pointer-events:none, a jsdom artifact since Tailwind
    // classes aren't applied in the test DOM.)
    fireEvent.mouseEnter(screen.getByTitle("5/16: 100 tokens"))
    expect(await screen.findByText("5/16 · 100 tokens")).toBeInTheDocument()
  })

  it("lets keyboard users focus a day's bar to read that day's usage", async () => {
    const user = userEvent.setup()
    render(<UsageSparkline label="Usage Trend" points={POINTS} note="Estimated from local logs" />)

    await user.hover(screen.getByRole("button", { name: /Usage Trend/ }))
    const dayBar = await screen.findByRole("button", { name: "5/16: 100 tokens" })

    fireEvent.focus(dayBar)
    expect(await screen.findByText("5/16 · 100 tokens")).toBeInTheDocument()

    fireEvent.blur(dayBar)
    expect(await screen.findByText("peak 500 tokens")).toBeInTheDocument()
  })

  it("returns nothing when there are no valid points", () => {
    const { container } = render(<UsageSparkline label="Usage Trend" points={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders an inline usage sparkline row inside a ProviderCard", () => {
    render(
      <ProviderCard
        name="Chart"
        displayMode="used"
        lines={[
          {
            type: "barChart",
            label: "Usage Trend",
            points: [
              { label: "2/1", value: 100, valueLabel: "100 tokens" },
              { label: "2/2", value: 400, valueLabel: "400 tokens" },
            ],
            note: "Estimated from local logs",
          },
          { type: "text", label: "gpt-5.5", value: "75%" },
        ]}
      />
    )

    // Single glanceable element; per-day detail lives in the hover/focus graph.
    const sparkline = screen.getByRole("button", { name: /Usage Trend/ })
    expect(sparkline).toHaveAccessibleName(/latest 400 tokens on 2\/2/)
    expect(sparkline).toHaveAccessibleName(/Estimated from local logs/)
    expect(screen.getByText("gpt-5.5")).toBeInTheDocument()
    expect(screen.getByText("75%")).toBeInTheDocument()
  })
})
