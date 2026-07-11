import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/ui/tooltip", () => import("@/test/tooltip-mock"))

const { loadShareSettingsMock, saveShareSettingsMock } = vi.hoisted(() => ({
  loadShareSettingsMock: vi.fn(),
  saveShareSettingsMock: vi.fn(),
}))

vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings")
  return {
    ...actual,
    loadShareSettings: loadShareSettingsMock,
    saveShareSettings: saveShareSettingsMock,
  }
})

import { ModelsTodayStrip } from "@/components/models-today-strip"
import type { TodayModelsSource } from "@/lib/today-models"
import { useAppShareStore } from "@/stores/app-share-store"
import { useAppUiStore } from "@/stores/app-ui-store"

function makeSource(models: [string, string][]): TodayModelsSource {
  return {
    meta: { id: "claude", name: "Claude", brandColor: "#DE7356", lines: [] },
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

const withToday = makeSource([
  ["Opus 4.8", "62% · Today $12.40"],
  ["Sonnet 5", "30% · Today $4.10"],
  ["Haiku 4.5", "5% · Today $1.00"],
  ["Opus 4.7", "3% · Today $0.50"],
])

describe("ModelsTodayStrip", () => {
  beforeEach(() => {
    saveShareSettingsMock.mockResolvedValue(undefined)
    useAppShareStore.getState().resetState()
    useAppUiStore.setState({ activeView: "home" })
  })

  it("renders nothing without today data", () => {
    const { container } = render(<ModelsTodayStrip plugins={[makeSource([["Opus 4.8", "62%"]])]} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders one segment per model and legend chips for the top 3", () => {
    render(<ModelsTodayStrip plugins={[withToday]} />)

    expect(screen.getByText("Models today")).toBeInTheDocument()
    expect(screen.getAllByTestId("strip-segment")).toHaveLength(4)
    const chips = screen.getAllByTestId("strip-legend-chip")
    expect(chips).toHaveLength(3)
    expect(chips[0]).toHaveTextContent("Opus 4.8")
    expect(chips[0]).toHaveTextContent("69%")
  })

  it("keeps prices out of the resting view but in the tooltips", () => {
    render(<ModelsTodayStrip plugins={[withToday]} />)

    // tooltip-mock renders content inline; the chip itself has no dollar text
    expect(screen.getAllByTestId("strip-legend-chip")[0]).not.toHaveTextContent("$")
    expect(screen.getAllByText("$12.40").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Provider").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Share today").length).toBeGreaterThan(0)
  })

  it("jumps to the Share view preselected on All", async () => {
    const user = userEvent.setup()
    render(<ModelsTodayStrip plugins={[withToday]} />)

    await user.click(screen.getByRole("button", { name: "Share models graph" }))

    expect(useAppUiStore.getState().activeView).toBe("share")
    expect(useAppShareStore.getState().settings.selectedId).toBe("all")
  })
})
