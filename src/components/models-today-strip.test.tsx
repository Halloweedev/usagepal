import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/ui/tooltip", () => import("@/test/tooltip-mock"))

const {
  loadOverviewGraphStyleMock,
  saveOverviewGraphStyleMock,
  loadOverviewGraphGroupByMock,
  saveOverviewGraphGroupByMock,
  loadOverviewStripMetricMock,
  saveOverviewStripMetricMock,
  saveShareSettingsMock,
} = vi.hoisted(() => ({
  loadOverviewGraphStyleMock: vi.fn(),
  saveOverviewGraphStyleMock: vi.fn(),
  loadOverviewGraphGroupByMock: vi.fn(),
  saveOverviewGraphGroupByMock: vi.fn(),
  loadOverviewStripMetricMock: vi.fn(),
  saveOverviewStripMetricMock: vi.fn(),
  saveShareSettingsMock: vi.fn(),
}))

vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings")
  return {
    ...actual,
    loadOverviewGraphStyle: loadOverviewGraphStyleMock,
    saveOverviewGraphStyle: saveOverviewGraphStyleMock,
    loadOverviewGraphGroupBy: loadOverviewGraphGroupByMock,
    saveOverviewGraphGroupBy: saveOverviewGraphGroupByMock,
    loadOverviewStripMetric: loadOverviewStripMetricMock,
    saveOverviewStripMetric: saveOverviewStripMetricMock,
    saveShareSettings: saveShareSettingsMock,
  }
})

import { ModelsTodayStrip } from "@/components/models-today-strip"
import type { TodayModelsSource } from "@/lib/today-models"
import { useAppShareStore } from "@/stores/app-share-store"
import { useAppUiStore } from "@/stores/app-ui-store"

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
    loadOverviewGraphStyleMock.mockReset().mockResolvedValue("donut")
    saveOverviewGraphStyleMock.mockReset().mockResolvedValue(undefined)
    loadOverviewGraphGroupByMock.mockReset().mockResolvedValue("provider")
    saveOverviewGraphGroupByMock.mockReset().mockResolvedValue(undefined)
    loadOverviewStripMetricMock.mockReset().mockResolvedValue("price")
    saveOverviewStripMetricMock.mockReset().mockResolvedValue(undefined)
    saveShareSettingsMock.mockReset().mockResolvedValue(undefined)
    useAppShareStore.getState().resetState()
    useAppUiStore.getState().setActiveView("home")
  })

  it("renders nothing without today data", async () => {
    const { container } = render(
      <ModelsTodayStrip plugins={[makeSource({ id: "claude", name: "Claude", brandColor: "#DE7356" }, [["Opus 4.8", "62%"]])]} />
    )
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it("renders donut provider view by default", async () => {
    render(<ModelsTodayStrip plugins={[claude, codex]} />)

    expect(screen.getByRole("radio", { name: "Today" })).toHaveAttribute("aria-checked", "true")
    expect(await screen.findByTestId("strip-donut")).toBeInTheDocument()
    expect(screen.getAllByTestId("strip-donut-segment")).toHaveLength(2)
    const rows = screen.getAllByTestId("strip-entry-row")
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText("Claude")).toBeInTheDocument()
    expect(within(rows[1]).getByText("Codex")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Show models" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Donut chart" })).toBeInTheDocument()
  })

  it("lists every provider that used a model in the model hover", async () => {
    loadOverviewGraphGroupByMock.mockResolvedValue("model")
    const opencode = makeSource({ id: "opencode-go", name: "OpenCode Go", brandColor: "#000000" }, [
      ["GLM 5.2", "100% · Today $4.00"],
    ])
    const clinePass = makeSource({ id: "cline-pass", name: "ClinePass", brandColor: "#F59E0B" }, [
      ["GLM 5.2", "100% · Today $1.50"],
    ])
    render(<ModelsTodayStrip plugins={[opencode, clinePass]} />)

    const row = await screen.findByTestId("strip-entry-row")
    expect(within(row).getByText("GLM 5.2")).toBeInTheDocument()
    expect(screen.getAllByText("OpenCode Go · ClinePass").length).toBeGreaterThan(0)
  })

  it("switches windows on period tab click and disables empty periods", async () => {
    const user = userEvent.setup()
    const claudeP = makeSource({ id: "claude", name: "Claude", brandColor: "#DE7356" }, [
      ["Opus 4.8", "70% · Today $12.40 · 30d $200.00"],
      ["Sonnet 5", "30% · Today $4.10 · 30d $50.00"],
    ])
    const codexP = makeSource({ id: "codex", name: "Codex", brandColor: "#74AA9C" }, [
      ["Today", "$400.00 · 333M"],
      ["Last 30 Days", "$800.00 · 563M"],
      ["GPT-5.6 Sol", "99.7%"],
      ["GPT-5.5", "0.3%"],
    ])
    render(<ModelsTodayStrip plugins={[claudeP, codexP]} />)
    await screen.findByTestId("strip-donut")

    expect(screen.getByRole("radio", { name: "Yesterday" })).toBeDisabled()
    expect(screen.getAllByText("GPT-5.6 Sol").length).toBeGreaterThan(0)
    expect(screen.getAllByText("$398.80").length).toBeGreaterThan(0)

    await user.click(screen.getByRole("radio", { name: "30 Days" }))

    expect(screen.getByRole("radio", { name: "30 Days" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getAllByText("$797.60").length).toBeGreaterThan(0)
    expect(screen.queryByText("$398.80")).not.toBeInTheDocument()
  })

  it("shows model and provider in the tooltip", async () => {
    loadOverviewGraphGroupByMock.mockResolvedValue("model")
    render(<ModelsTodayStrip plugins={[claude, codex]} />)
    await screen.findByTestId("strip-donut")

    expect(screen.getAllByText("Opus 4.8").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Claude").length).toBeGreaterThan(0)
    expect(screen.getAllByText("$12.40").length).toBeGreaterThan(0)
  })

  it("toggles to bar view and persists the choice", async () => {
    const user = userEvent.setup()
    render(<ModelsTodayStrip plugins={[claude, codex]} />)
    await screen.findByTestId("strip-donut")

    await user.click(screen.getByRole("button", { name: "Donut chart" }))

    expect(screen.queryByTestId("strip-donut")).not.toBeInTheDocument()
    expect(screen.getByTestId("strip-bar")).toBeInTheDocument()
    expect(screen.getAllByTestId("strip-segment")).toHaveLength(2)
    expect(saveOverviewGraphStyleMock).toHaveBeenCalledWith("bar")
    expect(screen.getByRole("button", { name: "Bar chart" })).toBeInTheDocument()
  })

  it("toggles to model grouping and persists the choice", async () => {
    const user = userEvent.setup()
    loadOverviewGraphStyleMock.mockResolvedValue("bar")
    render(<ModelsTodayStrip plugins={[claude, codex]} />)
    await screen.findByTestId("strip-bar")

    await user.click(screen.getByRole("button", { name: "Show models" }))

    expect(screen.getAllByTestId("strip-segment")).toHaveLength(3)
    const chips = screen.getAllByTestId("strip-legend-chip")
    expect(within(chips[0]).getByText("Opus 4.8")).toBeInTheDocument()
    expect(within(chips[0]).getByText("63%")).toBeInTheDocument()
    expect(within(chips[1]).getByText("Sonnet 5")).toBeInTheDocument()
    expect(within(chips[1]).getByText("21%")).toBeInTheDocument()
    expect(within(chips[2]).getByText("GPT-5.4")).toBeInTheDocument()
    expect(within(chips[2]).getByText("16%")).toBeInTheDocument()
    expect(saveOverviewGraphGroupByMock).toHaveBeenCalledWith("model")
    expect(screen.getByRole("button", { name: "Show providers" })).toBeInTheDocument()
  })

  it("toggles to token metric on value click and persists the choice", async () => {
    const user = userEvent.setup()
    const codexTokens = makeSource({ id: "codex", name: "Codex", brandColor: "#74AA9C" }, [
      ["Today", "$400.00 · 333M"],
      ["GPT-5.6 Sol", "99.7%"],
      ["GPT-5.5", "0.3%"],
    ])
    render(<ModelsTodayStrip plugins={[codexTokens]} />)
    await screen.findByTestId("strip-donut")

    expect(screen.getAllByText("$398.80").length).toBeGreaterThan(0)

    await user.click(screen.getAllByTestId("strip-metric-toggle")[0])

    const row = screen.getByTestId("strip-entry-row")
    expect(within(row).getByText("333M")).toBeInTheDocument()
    expect(within(row).queryByText("$398.80")).not.toBeInTheDocument()
    expect(screen.getByText("Million")).toBeInTheDocument()
    expect(saveOverviewStripMetricMock).toHaveBeenCalledWith("usage")
  })

  it("hydrates persisted usage metric and shows an em dash for unknown tokens", async () => {
    loadOverviewStripMetricMock.mockResolvedValue("usage")
    render(<ModelsTodayStrip plugins={[claude, codex]} />)
    await screen.findByTestId("strip-donut")

    const toggles = await screen.findAllByTestId("strip-metric-toggle")
    expect(toggles).toHaveLength(2)
    for (const toggle of toggles) expect(toggle).toHaveTextContent("—")
  })

  it("shows token values in the bar legend in usage metric", async () => {
    loadOverviewStripMetricMock.mockResolvedValue("usage")
    loadOverviewGraphStyleMock.mockResolvedValue("bar")
    const codexTokens = makeSource({ id: "codex", name: "Codex", brandColor: "#74AA9C" }, [
      ["Today", "$400.00 · 333M"],
      ["GPT-5.6 Sol", "99.7%"],
      ["GPT-5.5", "0.3%"],
    ])
    render(<ModelsTodayStrip plugins={[codexTokens]} />)
    await screen.findByTestId("strip-bar")

    const chips = await screen.findAllByTestId("strip-legend-chip")
    expect(within(chips[0]).getByText("333M")).toBeInTheDocument()
    expect(within(chips[0]).queryByText("100%")).not.toBeInTheDocument()
  })

  it("shows token details in provider tooltips in usage metric", async () => {
    loadOverviewStripMetricMock.mockResolvedValue("usage")
    const codexTokens = makeSource({ id: "codex", name: "Codex", brandColor: "#74AA9C" }, [
      ["Today", "$400.00 · 333M"],
      ["GPT-5.6 Sol", "99.7%"],
      ["GPT-5.5", "0.3%"],
    ])
    render(<ModelsTodayStrip plugins={[codexTokens]} />)
    await screen.findByTestId("strip-donut")

    // Tooltip header leads with tokens, cost + $/MTok demoted to a muted line.
    expect(screen.getAllByText("333M").length).toBeGreaterThan(1)
    expect(screen.getAllByText("$400.00").length).toBeGreaterThan(0)
    expect(screen.getAllByText("$1.20/MTok").length).toBeGreaterThan(0)
    // Per-model rows show allocated token counts instead of cost.
    expect(screen.getAllByText("332M").length).toBeGreaterThan(0)
    expect(screen.getAllByText("999K").length).toBeGreaterThan(0)
    expect(screen.queryByText("$398.80")).not.toBeInTheDocument()
  })

  it("shows token details in model tooltips in usage metric", async () => {
    loadOverviewStripMetricMock.mockResolvedValue("usage")
    loadOverviewGraphGroupByMock.mockResolvedValue("model")
    const codexTokens = makeSource({ id: "codex", name: "Codex", brandColor: "#74AA9C" }, [
      ["Today", "$400.00 · 333M"],
      ["GPT-5.6 Sol", "99.7%"],
      ["GPT-5.5", "0.3%"],
    ])
    render(<ModelsTodayStrip plugins={[codexTokens]} />)
    await screen.findByTestId("strip-donut")

    expect(screen.getAllByText("332M").length).toBeGreaterThan(1)
    expect(screen.getAllByText("$398.80").length).toBeGreaterThan(0)
    expect(screen.getAllByText("$1.20/MTok").length).toBeGreaterThan(0)
  })

  it("opens the share page carrying over the strip's current view", async () => {
    const user = userEvent.setup()
    loadOverviewGraphGroupByMock.mockResolvedValue("model")
    loadOverviewStripMetricMock.mockResolvedValue("usage")
    render(<ModelsTodayStrip plugins={[claude, codex]} />)
    await screen.findByTestId("strip-donut")

    await user.click(screen.getByRole("button", { name: "Share this view" }))

    expect(useAppUiStore.getState().activeView).toBe("share")
    const settings = useAppShareStore.getState().settings
    expect(settings.selectedId).toBe("all")
    expect(settings.graphStyle).toBe("donut")
    expect(settings.graphGroupBy).toBe("model")
    expect(settings.graphMetric).toBe("usage")
    expect(useAppShareStore.getState().takePendingGraphPeriod()).toBe("today")
  })

  it("hydrates persisted bar style and model grouping on mount", async () => {
    loadOverviewGraphStyleMock.mockResolvedValue("bar")
    loadOverviewGraphGroupByMock.mockResolvedValue("model")
    render(<ModelsTodayStrip plugins={[claude, codex]} />)

    expect(await screen.findByTestId("strip-bar")).toBeInTheDocument()
    expect(screen.getAllByTestId("strip-segment")).toHaveLength(3)
    expect(screen.getByRole("button", { name: "Show providers" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bar chart" })).toBeInTheDocument()
  })
})
