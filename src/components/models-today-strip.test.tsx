import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/ui/tooltip", () => import("@/test/tooltip-mock"))

const { loadOverviewGraphStyleMock, saveOverviewGraphStyleMock } = vi.hoisted(() => ({
  loadOverviewGraphStyleMock: vi.fn(),
  saveOverviewGraphStyleMock: vi.fn(),
}))

vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings")
  return {
    ...actual,
    loadOverviewGraphStyle: loadOverviewGraphStyleMock,
    saveOverviewGraphStyle: saveOverviewGraphStyleMock,
  }
})

import { ModelsTodayStrip } from "@/components/models-today-strip"
import type { TodayModelsSource } from "@/lib/today-models"

function makeSource(
  meta: { id: string; name: string; brandColor: string },
  models: [string, string][]
): TodayModelsSource {
  return {
    meta: { ...meta, lines: [] },
    data: {
      lines: models.map(([label, value]) => ({
        type: "text" as const,
        label,
        value,
        color: null,
        subtitle: null,
        resetExpiry: null,
      })),
    },
  }
}

const claude = makeSource({ id: "claude", name: "Claude", brandColor: "#DE7356" }, [
  ["Opus 4.8", "62% · Today $12.40"],
  ["Sonnet 5", "30% · Today $4.10"],
])
const codex = makeSource({ id: "codex", name: "Codex", brandColor: "#74AA9C" }, [
  ["GPT-5.4", "16% · Today $3.20"],
])

describe("ModelsTodayStrip", () => {
  beforeEach(() => {
    loadOverviewGraphStyleMock.mockReset().mockResolvedValue("compact")
    saveOverviewGraphStyleMock.mockReset().mockResolvedValue(undefined)
  })

  it("renders nothing without today data", async () => {
    const { container } = render(
      <ModelsTodayStrip plugins={[makeSource({ id: "claude", name: "Claude", brandColor: "#DE7356" }, [["Opus 4.8", "62%"]])]} />
    )
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it("renders one bar segment and one legend chip per provider, percentages only", async () => {
    render(<ModelsTodayStrip plugins={[claude, codex]} />)

    expect(screen.getByText("Models today")).toBeInTheDocument()
    expect(await screen.findByTestId("strip-bar")).toBeInTheDocument()
    expect(screen.getAllByTestId("strip-segment")).toHaveLength(2)
    const chips = screen.getAllByTestId("strip-legend-chip")
    expect(chips).toHaveLength(2)
    expect(chips[0]).toHaveTextContent("Claude 84%")
    expect(chips[1]).toHaveTextContent("Codex 16%")
    expect(chips[0]).not.toHaveTextContent("$")
    expect(screen.queryByRole("button", { name: "Share models graph" })).not.toBeInTheDocument()
  })

  it("shows provider total and per-model rows in the tooltip", async () => {
    render(<ModelsTodayStrip plugins={[claude, codex]} />)
    await screen.findByTestId("strip-bar")

    // tooltip-mock renders content inline; within-provider percentages
    expect(screen.getAllByText("$16.50").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Opus 4.8").length).toBeGreaterThan(0)
    expect(screen.getAllByText(/75%/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/25%/).length).toBeGreaterThan(0)
    expect(screen.getAllByText("$12.40").length).toBeGreaterThan(0)
  })

  it("toggles to the donut view and persists the choice", async () => {
    const user = userEvent.setup()
    render(<ModelsTodayStrip plugins={[claude, codex]} />)
    await screen.findByTestId("strip-bar")

    await user.click(screen.getByRole("button", { name: "Show detailed view" }))

    expect(screen.queryByTestId("strip-bar")).not.toBeInTheDocument()
    expect(screen.getByTestId("strip-donut")).toBeInTheDocument()
    expect(screen.getAllByTestId("strip-donut-segment")).toHaveLength(2)
    expect(screen.getByText("$19.70")).toBeInTheDocument()
    const rows = screen.getAllByTestId("strip-provider-row")
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent("Claude")
    expect(rows[0]).toHaveTextContent("$16.50")
    expect(saveOverviewGraphStyleMock).toHaveBeenCalledWith("detailed")
    expect(screen.getByRole("button", { name: "Show compact view" })).toBeInTheDocument()
  })

  it("hydrates a persisted detailed style on mount", async () => {
    loadOverviewGraphStyleMock.mockResolvedValue("detailed")
    render(<ModelsTodayStrip plugins={[claude, codex]} />)

    expect(await screen.findByTestId("strip-donut")).toBeInTheDocument()
    expect(screen.queryByTestId("strip-bar")).not.toBeInTheDocument()
  })
})
