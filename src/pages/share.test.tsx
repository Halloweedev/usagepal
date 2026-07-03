import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { shareCardMock, copyCardImageMock } = vi.hoisted(() => ({
  shareCardMock: vi.fn(),
  copyCardImageMock: vi.fn(),
}))

vi.mock("@/components/share-card", () => ({
  ShareCard: (props: unknown) => {
    shareCardMock(props)
    return <div data-testid="share-card-mock" />
  },
}))

vi.mock("@/lib/share-image", () => ({
  copyCardImage: copyCardImageMock,
}))

import { SharePage } from "@/pages/share"
import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"

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
      primaryCandidates: ["Session"],
    },
    data: {
      providerId: "claude",
      displayName: "Claude",
      iconUrl: "/claude.svg",
      lines: [
        { type: "progress", label: "Session", used: 40, limit: 100, format: { kind: "percent" } },
        { type: "progress", label: "Sonnet", used: 10, limit: 100, format: { kind: "percent" } },
        { type: "barChart", label: "Usage Trend", points: [{ label: "7/1", value: 5 }] },
        { type: "text", label: "claude-sonnet-5", value: "62%" },
      ],
    },
    loading: false,
    error: null,
    lastManualRefreshAt: null,
    lastUpdatedAt: null,
    ...overrides,
  }
}

describe("SharePage", () => {
  beforeEach(() => {
    shareCardMock.mockReset()
    copyCardImageMock.mockReset()
  })

  it("defaults to the first provider and pre-checks overview/barChart/model-breakdown lines", () => {
    render(<SharePage plugins={[makePlugin()]} />)

    expect(screen.getByRole("checkbox", { name: "Session" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Sonnet" })).not.toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Usage Trend" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "claude-sonnet-5" })).toBeChecked()

    const lastCall = shareCardMock.mock.calls.at(-1)?.[0] as { lines: { label: string }[] }
    expect(lastCall.lines.map((line) => line.label)).toEqual(["Session", "Usage Trend", "claude-sonnet-5"])
  })

  it("rebuilds the checklist to the new provider's defaults when switching providers", async () => {
    const user = userEvent.setup()
    const second = makePlugin({
      meta: {
        id: "codex",
        name: "Codex",
        iconUrl: "/codex.svg",
        brandColor: "#74AA9C",
        lines: [{ type: "progress", label: "Weekly", scope: "overview" }],
        primaryCandidates: ["Weekly"],
      },
      data: {
        providerId: "codex",
        displayName: "Codex",
        iconUrl: "/codex.svg",
        lines: [{ type: "progress", label: "Weekly", used: 5, limit: 100, format: { kind: "percent" } }],
      },
    })

    render(<SharePage plugins={[makePlugin(), second]} />)

    await user.click(screen.getByRole("tab", { name: "Codex" }))

    expect(screen.getByRole("checkbox", { name: "Weekly" })).toBeChecked()
    expect(screen.queryByRole("checkbox", { name: "Sonnet" })).not.toBeInTheDocument()
  })

  it("updates the lines passed to the card when a checkbox is toggled", async () => {
    const user = userEvent.setup()
    render(<SharePage plugins={[makePlugin()]} />)

    await user.click(screen.getByRole("checkbox", { name: "Sonnet" }))

    const lastCall = shareCardMock.mock.calls.at(-1)?.[0] as { lines: { label: string }[] }
    expect(lastCall.lines.map((line) => line.label)).toContain("Sonnet")
  })

  it("shows a no-data message when the selected provider has no data yet", () => {
    render(<SharePage plugins={[makePlugin({ data: null, loading: true })]} />)

    expect(screen.getByText("No data yet for this provider.")).toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
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

  it("renders checklist rows as bordered chips inside a wrapping container", () => {
    render(<SharePage plugins={[makePlugin()]} />)

    const sessionCheckbox = screen.getByRole("checkbox", { name: "Session" })
    const chip = sessionCheckbox.closest("label")
    expect(chip).toHaveClass("rounded-md", "border")

    const container = chip?.parentElement
    expect(container).toHaveClass("flex-wrap")
  })

  it("groups the checklist into Usage/Details/Models sections", () => {
    render(<SharePage plugins={[makePlugin()]} />)

    expect(screen.getByText("Usage")).toBeInTheDocument()
    expect(screen.getByText("Details")).toBeInTheDocument()
    expect(screen.getByText("Models")).toBeInTheDocument()
  })

  it("omits a section with no lines for the current provider", () => {
    const noModelsPlugin = makePlugin({
      data: {
        providerId: "claude",
        displayName: "Claude",
        iconUrl: "/claude.svg",
        lines: [
          { type: "progress", label: "Session", used: 40, limit: 100, format: { kind: "percent" } },
        ],
      },
    })
    render(<SharePage plugins={[noModelsPlugin]} />)

    expect(screen.getByText("Usage")).toBeInTheDocument()
    expect(screen.queryByText("Details")).not.toBeInTheDocument()
    expect(screen.queryByText("Models")).not.toBeInTheDocument()
  })

  it("shows the plan toggle and passes the plan to the card only when data has one", async () => {
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

    expect(screen.getByRole("checkbox", { name: "Plan" })).toBeChecked()
    let lastCall = shareCardMock.mock.calls.at(-1)?.[0] as { plan?: string }
    expect(lastCall.plan).toBe("Max 5x")

    await user.click(screen.getByRole("checkbox", { name: "Plan" }))
    lastCall = shareCardMock.mock.calls.at(-1)?.[0] as { plan?: string }
    expect(lastCall.plan).toBeUndefined()
  })

  it("hides the plan toggle when the provider has no plan", () => {
    render(<SharePage plugins={[makePlugin()]} />)
    expect(screen.queryByRole("checkbox", { name: "Plan" })).not.toBeInTheDocument()
  })

  it("renders controls on the left and the card preview on the right", () => {
    render(<SharePage plugins={[makePlugin()]} />)

    const page = screen.getByTestId("share-page")
    const controls = screen.getByTestId("share-page-controls")
    const preview = screen.getByTestId("share-page-preview")

    expect(page).toContainElement(controls)
    expect(page).toContainElement(preview)
    expect(controls.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId("share-card-mock").closest("[data-testid='share-page-preview']")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Copy Image" }).closest("[data-testid='share-page-controls']")).toBeTruthy()
  })
})
