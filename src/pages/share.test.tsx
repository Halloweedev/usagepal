import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { shareCardMock, graphCardMock, copyCardImageMock } = vi.hoisted(() => ({
  shareCardMock: vi.fn(),
  graphCardMock: vi.fn(),
  copyCardImageMock: vi.fn(),
}))

vi.mock("@/components/share-card", () => ({
  ShareCard: (props: unknown) => {
    shareCardMock(props)
    return <div data-testid="share-card-mock" />
  },
}))

vi.mock("@/components/models-graph-card", () => ({
  ModelsGraphCard: (props: unknown) => {
    graphCardMock(props)
    return <div data-testid="models-graph-card-mock" />
  },
}))

vi.mock("@/lib/share-image", () => ({
  copyCardImage: copyCardImageMock,
}))

import { SharePage } from "@/pages/share"
import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"
import { useAppShareStore } from "@/stores/app-share-store"

function makePlugin(overrides: Partial<DisplayPluginState> = {}): DisplayPluginState {
  return {
    meta: {
      id: "claude",
      name: "Claude",
      iconUrl: "/claude.svg",
      brandColor: "#DE7356",
      lines: [
        { type: "progress", label: "Session", scope: "overview" },
        { type: "progress", label: "Sonnet", scope: "detail" },
        { type: "barChart", label: "Usage Trend", scope: "detail" },
      ],
      primaryCandidates: ["Session"], detected: true,
    },
    data: {
      providerId: "claude",
      displayName: "Claude",
      iconUrl: "/claude.svg",
      lines: [
        { type: "progress", label: "Session", used: 40, limit: 100, format: { kind: "percent" } },
        { type: "progress", label: "Sonnet", used: 10, limit: 100, format: { kind: "percent" } },
        { type: "barChart", label: "Usage Trend", points: [{ label: "7/1", value: 5 }] },
        { type: "text", label: "claude-sonnet-5", value: "62% · Today $12.40" },
      ],
    },
    loading: false,
    error: null,
    lastManualRefreshAt: null,
    lastUpdatedAt: null,
    ...overrides,
  }
}

function lastCardProps<T>(): T {
  return shareCardMock.mock.calls.at(-1)?.[0] as T
}

describe("SharePage", () => {
  beforeEach(() => {
    shareCardMock.mockReset()
    graphCardMock.mockReset()
    copyCardImageMock.mockReset()
    useAppShareStore.getState().resetState()
  })

  it("defaults to the first provider with the Summary preset (overview lines only)", () => {
    render(<SharePage plugins={[makePlugin()]} />)

    expect(screen.getByRole("radio", { name: "Summary" })).toHaveAttribute("aria-checked", "true")
    const { lines } = lastCardProps<{ lines: { label: string }[] }>()
    expect(lines.map((line) => line.label)).toEqual(["Session"])
  })

  it("applies the Detailed preset (overview + detail lines)", async () => {
    const user = userEvent.setup()
    render(<SharePage plugins={[makePlugin()]} />)

    await user.click(screen.getByRole("radio", { name: "Detailed" }))

    const { lines } = lastCardProps<{ lines: { label: string }[] }>()
    expect(lines.map((line) => line.label)).toEqual(["Session", "Sonnet", "Usage Trend"])
  })

  it("applies the Models preset (overview + model breakdown lines)", async () => {
    const user = userEvent.setup()
    render(<SharePage plugins={[makePlugin()]} />)

    await user.click(screen.getByRole("radio", { name: "Models" }))

    const { lines } = lastCardProps<{ lines: { label: string }[] }>()
    expect(lines.map((line) => line.label)).toEqual(["Session", "claude-sonnet-5"])
  })

  it("keeps the active preset when switching providers", async () => {
    const user = userEvent.setup()
    const second = makePlugin({
      meta: {
        id: "codex",
        name: "Codex",
        iconUrl: "/codex.svg",
        brandColor: "#74AA9C",
        lines: [
          { type: "progress", label: "Weekly", scope: "overview" },
          { type: "progress", label: "Daily", scope: "detail" },
        ],
        primaryCandidates: ["Weekly"], detected: true,
      },
      data: {
        providerId: "codex",
        displayName: "Codex",
        iconUrl: "/codex.svg",
        lines: [
          { type: "progress", label: "Weekly", used: 5, limit: 100, format: { kind: "percent" } },
          { type: "progress", label: "Daily", used: 2, limit: 100, format: { kind: "percent" } },
        ],
      },
    })

    render(<SharePage plugins={[makePlugin(), second]} />)

    await user.click(screen.getByRole("radio", { name: "Detailed" }))
    await user.click(screen.getByRole("radio", { name: "Codex" }))

    expect(screen.getByRole("radio", { name: "Detailed" })).toHaveAttribute("aria-checked", "true")
    const { lines } = lastCardProps<{ lines: { label: string }[] }>()
    expect(lines.map((line) => line.label)).toEqual(["Weekly", "Daily"])
  })

  it("always renders the provider radiogroup with the All tab first", () => {
    render(<SharePage plugins={[makePlugin()]} />)

    const group = screen.getByRole("radiogroup", { name: "Provider" })
    expect(group).toBeInTheDocument()
    const radios = screen.getAllByRole("radio")
    expect(radios[0]).toHaveAccessibleName("All providers")
    expect(screen.getByRole("radio", { name: "Claude" })).toBeInTheDocument()
  })

  it("switches the card theme via the Dark/Light radiogroup", async () => {
    const user = userEvent.setup()
    render(<SharePage plugins={[makePlugin()]} />)

    expect(lastCardProps<{ theme: string }>().theme).toBe("dark")

    await user.click(screen.getByRole("radio", { name: "Light" }))

    expect(lastCardProps<{ theme: string }>().theme).toBe("light")
  })

  it("hides the per-line checklist behind a collapsed Customize section", async () => {
    const user = userEvent.setup()
    render(<SharePage plugins={[makePlugin()]} />)

    expect(screen.queryByTestId("share-customize")).not.toBeInTheDocument()
    expect(screen.queryByRole("checkbox", { name: "Session" })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Customize" }))

    expect(screen.getByTestId("share-customize")).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "Session" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Sonnet" })).not.toBeChecked()
  })

  it("clears the preset selection when a line is toggled manually", async () => {
    const user = userEvent.setup()
    render(<SharePage plugins={[makePlugin()]} />)

    await user.click(screen.getByRole("button", { name: "Customize" }))
    await user.click(screen.getByRole("checkbox", { name: "Sonnet" }))

    expect(screen.getByRole("radio", { name: "Summary" })).toHaveAttribute("aria-checked", "false")
    const { lines } = lastCardProps<{ lines: { label: string }[] }>()
    expect(lines.map((line) => line.label)).toContain("Sonnet")
  })

  it("groups the customize checklist into Usage/Details/Models sections", async () => {
    const user = userEvent.setup()
    render(<SharePage plugins={[makePlugin()]} />)

    await user.click(screen.getByRole("button", { name: "Customize" }))

    expect(screen.getByText("Usage")).toBeInTheDocument()
    expect(screen.getByText("Details")).toBeInTheDocument()
    // "Models" appears both as the preset radio and the group label.
    expect(screen.getAllByText("Models").length).toBeGreaterThan(1)
  })

  it("shows Model Details toggles in Customize only when a model line is checked", async () => {
    const user = userEvent.setup()
    render(<SharePage plugins={[makePlugin()]} />)

    await user.click(screen.getByRole("radio", { name: "Models" }))
    await user.click(screen.getByRole("button", { name: "Customize" }))

    expect(screen.getByTestId("share-model-details-section")).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "Usage %" })).toBeChecked()

    await user.click(screen.getByRole("checkbox", { name: "claude-sonnet-5" }))

    expect(screen.queryByTestId("share-model-details-section")).not.toBeInTheDocument()
  })

  it("passes modelDisplay toggles to ShareCard", async () => {
    const user = userEvent.setup()
    const withMergedModel = makePlugin({
      data: {
        providerId: "claude",
        displayName: "Claude",
        iconUrl: "/claude.svg",
        lines: [
          { type: "progress", label: "Session", used: 40, limit: 100, format: { kind: "percent" } },
          {
            type: "text",
            label: "Opus 4.8",
            value: "85.2% · Today $11.44 · 7d $1431 · 30d $6539",
          },
        ],
      },
    })
    render(<SharePage plugins={[withMergedModel]} />)

    await user.click(screen.getByRole("radio", { name: "Models" }))
    await user.click(screen.getByRole("button", { name: "Customize" }))
    await user.click(screen.getByRole("checkbox", { name: "7 Days" }))

    const props = lastCardProps<{
      modelDisplay?: { showSevenDay: boolean }
      modelBreakdownLabels?: Set<string>
    }>()
    expect(props.modelDisplay?.showSevenDay).toBe(false)
    expect(props.modelBreakdownLabels?.has("Opus 4.8")).toBe(true)
  })

  it("shows the plan toggle in Customize and passes the plan to the card only when data has one", async () => {
    const user = userEvent.setup()
    const withPlan = makePlugin({
      data: {
        providerId: "claude",
        displayName: "Claude",
        iconUrl: "/claude.svg",
        plan: "Max 5x",
        lines: [
          { type: "progress", label: "Session", used: 40, limit: 100, format: { kind: "percent" } },
        ],
      },
    })
    render(<SharePage plugins={[withPlan]} />)

    expect(lastCardProps<{ plan?: string }>().plan).toBe("Max 5x")

    await user.click(screen.getByRole("button", { name: "Customize" }))
    await user.click(screen.getByRole("checkbox", { name: "Plan" }))

    expect(lastCardProps<{ plan?: string }>().plan).toBeUndefined()
  })

  it("hides the plan toggle when the provider has no plan", async () => {
    const user = userEvent.setup()
    render(<SharePage plugins={[makePlugin()]} />)

    await user.click(screen.getByRole("button", { name: "Customize" }))

    expect(screen.queryByRole("checkbox", { name: "Plan" })).not.toBeInTheDocument()
  })

  it("renders the preview above the option controls", () => {
    render(<SharePage plugins={[makePlugin()]} />)

    const preview = screen.getByTestId("share-page-preview")
    const contentControl = screen.getByRole("radio", { name: "Summary" })

    expect(preview.compareDocumentPosition(contentControl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("scales the preview down while leaving the exported card node unscaled", () => {
    render(<SharePage plugins={[makePlugin()]} />)

    const preview = screen.getByTestId("share-page-preview")
    const scaled = preview.querySelector("[style*='scale']")
    expect(scaled).toBeInTheDocument()
    const cardWrapper = screen.getByTestId("share-card-mock").parentElement
    expect(cardWrapper?.getAttribute("style") ?? "").not.toContain("scale")
  })

  it("copies the rendered card image on click and shows a success message", async () => {
    const user = userEvent.setup()
    copyCardImageMock.mockResolvedValue(undefined)
    render(<SharePage plugins={[makePlugin()]} />)

    await user.click(screen.getByRole("button", { name: "Copy Image" }))

    expect(copyCardImageMock).toHaveBeenCalledTimes(1)
    expect(await screen.findByText("Copied to clipboard.")).toBeInTheDocument()
  })

  it("shows an error message when copying fails", async () => {
    const user = userEvent.setup()
    copyCardImageMock.mockRejectedValue(new Error("clipboard denied"))
    render(<SharePage plugins={[makePlugin()]} />)

    await user.click(screen.getByRole("button", { name: "Copy Image" }))

    expect(await screen.findByText("clipboard denied")).toBeInTheDocument()
  })

  it("reserves a fixed-height status line so copy feedback does not shift the layout", async () => {
    const user = userEvent.setup()
    copyCardImageMock.mockResolvedValue(undefined)
    render(<SharePage plugins={[makePlugin()]} />)

    const statusBefore = screen.getByTestId("share-page").querySelector("p[aria-live='polite']")
    expect(statusBefore).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Copy Image" }))

    const status = await screen.findByText("Copied to clipboard.")
    expect(status).toBe(statusBefore)
  })

  it("shows a no-data message when the selected provider has no data yet", () => {
    render(<SharePage plugins={[makePlugin({ data: null, loading: true })]} />)

    expect(screen.getByText("No data yet for this provider.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Copy Image" })).not.toBeInTheDocument()
  })

  it("restores persisted options from the share store on mount", () => {
    useAppShareStore.setState({
      hydrated: true,
      settings: {
        selectedId: "claude",
        preset: "detailed",
        checkedLabels: ["Session", "Sonnet"],
        theme: "light",
        showWatermark: false,
        showPlan: false,
        modelDisplay: { showPercent: true, showToday: true, showSevenDay: true, showThirtyDay: true },
        graphStyle: "bar",
        graphShowModelPrices: false,
        graphShowProviderPrices: false,
      },
    })

    // ShareCard only receives a `plan` prop (no `showPlan`), gated by the local
    // showPlan state; use a plugin with plan data so restoring showPlan=false
    // is observable on the rendered card, matching the existing plan-toggle test.
    const withPlan = makePlugin({
      data: {
        providerId: "claude",
        displayName: "Claude",
        iconUrl: "/claude.svg",
        plan: "Max 5x",
        lines: [
          { type: "progress", label: "Session", used: 40, limit: 100, format: { kind: "percent" } },
          { type: "progress", label: "Sonnet", used: 10, limit: 100, format: { kind: "percent" } },
        ],
      },
    })

    render(<SharePage plugins={[withPlan]} />)

    // Persisted metric selection is restored, NOT re-seeded from the Summary preset.
    const { lines } = lastCardProps<{ lines: { label: string }[] }>()
    expect(lines.map((line) => line.label)).toEqual(["Session", "Sonnet"])
    // Persisted theme/toggles reach the card.
    const props = lastCardProps<{ theme: string; showWatermark: boolean; plan?: string }>()
    expect(props.theme).toBe("light")
    expect(props.showWatermark).toBe(false)
    expect(props.plan).toBeUndefined()
  })

  it("persists an option change to the share store", async () => {
    const user = userEvent.setup()
    useAppShareStore.setState({ hydrated: true })
    render(<SharePage plugins={[makePlugin()]} />)

    await user.click(screen.getByRole("radio", { name: "Detailed" }))

    expect(useAppShareStore.getState().settings.preset).toBe("detailed")
  })

  it("renders the graph card with aggregated usage on the All tab", async () => {
    const user = userEvent.setup()
    render(<SharePage plugins={[makePlugin()]} />)

    await user.click(screen.getByRole("radio", { name: "All providers" }))

    expect(screen.getByTestId("models-graph-card-mock")).toBeInTheDocument()
    const props = graphCardMock.mock.calls.at(-1)?.[0] as {
      usage: { totalCost: number; models: { name: string }[] }
      graphStyle: string
    }
    expect(props.usage.totalCost).toBeCloseTo(12.4)
    expect(props.usage.models[0].name).toBe("claude-sonnet-5")
    expect(props.graphStyle).toBe("bar")
  })

  it("switches graph style via the Bar/Donut radiogroup and persists it", async () => {
    const user = userEvent.setup()
    useAppShareStore.setState({ hydrated: true })
    render(<SharePage plugins={[makePlugin()]} />)

    await user.click(screen.getByRole("radio", { name: "All providers" }))
    await user.click(screen.getByRole("radio", { name: "Donut" }))

    expect((graphCardMock.mock.calls.at(-1)?.[0] as { graphStyle: string }).graphStyle).toBe("donut")
    expect(useAppShareStore.getState().settings.graphStyle).toBe("donut")
  })

  it("switches the graph window via the Period radiogroup", async () => {
    const user = userEvent.setup()
    const plugin = makePlugin({
      data: {
        providerId: "claude",
        displayName: "Claude",
        iconUrl: "/claude.svg",
        lines: [{ type: "text", label: "claude-sonnet-5", value: "62% · Today $12.40 · 30d $200.00" }],
      },
    })
    render(<SharePage plugins={[plugin]} />)
    await user.click(screen.getByRole("radio", { name: "All providers" }))

    // No Yesterday figure for Claude → that tab is disabled.
    expect(screen.getByRole("radio", { name: "Yesterday" })).toBeDisabled()

    const today = graphCardMock.mock.calls.at(-1)?.[0] as { usage: { totalCost: number }; periodLabel: string }
    expect(today.periodLabel).toBe("today")
    expect(today.usage.totalCost).toBeCloseTo(12.4)

    await user.click(screen.getByRole("radio", { name: "30 Days" }))

    const thirty = graphCardMock.mock.calls.at(-1)?.[0] as { usage: { totalCost: number }; periodLabel: string }
    expect(thirty.periodLabel).toBe("30 days")
    expect(thirty.usage.totalCost).toBeCloseTo(200)
  })

  it("exposes price toggles in Customize on the All tab", async () => {
    const user = userEvent.setup()
    render(<SharePage plugins={[makePlugin()]} />)

    await user.click(screen.getByRole("radio", { name: "All providers" }))
    await user.click(screen.getByRole("button", { name: "Customize" }))

    await user.click(screen.getByRole("checkbox", { name: "Price per model" }))
    await user.click(screen.getByRole("checkbox", { name: "Price per provider" }))

    const props = graphCardMock.mock.calls.at(-1)?.[0] as {
      showModelPrices: boolean
      showProviderPrices: boolean
    }
    expect(props.showModelPrices).toBe(true)
    expect(props.showProviderPrices).toBe(true)
  })

  it("shows the empty state on the All tab when no model was used today", async () => {
    const user = userEvent.setup()
    const noToday = makePlugin({
      data: {
        providerId: "claude",
        displayName: "Claude",
        iconUrl: "/claude.svg",
        lines: [
          { type: "progress", label: "Session", used: 40, limit: 100, format: { kind: "percent" } },
          { type: "text", label: "claude-sonnet-5", value: "62%" },
        ],
      },
    })
    render(<SharePage plugins={[noToday]} />)

    await user.click(screen.getByRole("radio", { name: "All providers" }))

    expect(screen.getByText("No model usage recorded.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Copy Image" })).not.toBeInTheDocument()
  })

  it("copies the graph card image from the All tab", async () => {
    const user = userEvent.setup()
    copyCardImageMock.mockResolvedValue(undefined)
    render(<SharePage plugins={[makePlugin()]} />)

    await user.click(screen.getByRole("radio", { name: "All providers" }))
    await user.click(screen.getByRole("button", { name: "Copy Image" }))

    expect(copyCardImageMock).toHaveBeenCalledTimes(1)
    expect(await screen.findByText("Copied to clipboard.")).toBeInTheDocument()
  })

  it("restores a persisted All-tab selection on mount", () => {
    useAppShareStore.setState({
      hydrated: true,
      settings: { ...useAppShareStore.getState().settings, selectedId: "all", graphStyle: "donut" },
    })
    render(<SharePage plugins={[makePlugin()]} />)

    expect(screen.getByTestId("models-graph-card-mock")).toBeInTheDocument()
    expect((graphCardMock.mock.calls.at(-1)?.[0] as { graphStyle: string }).graphStyle).toBe("donut")
  })
})
