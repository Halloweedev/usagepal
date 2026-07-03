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

function makeCostPlugin(): DisplayPluginState {
  return makePlugin({
    data: {
      providerId: "claude",
      displayName: "Claude",
      iconUrl: "/claude.svg",
      lines: [
        { type: "progress", label: "Session", used: 40, limit: 100, format: { kind: "percent" } },
        { type: "text", label: "claude-opus-4-8 · Today", value: "$3.00" },
        { type: "text", label: "claude-sonnet-4-6 · Today", value: "$2.00" },
        { type: "text", label: "claude-opus-4-8 · 7d", value: "$7.00" },
      ],
    },
  })
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

  it("shows period quick-toggle buttons only when model-cost lines exist, and bulk-toggles by period", async () => {
    const user = userEvent.setup()
    render(<SharePage plugins={[makeCostPlugin()]} />)

    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "7d" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "30d" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "All periods" })).toBeInTheDocument()

    expect(screen.getByRole("checkbox", { name: "claude-opus-4-8 · Today" })).not.toBeChecked()
    expect(screen.getByRole("checkbox", { name: "claude-sonnet-4-6 · Today" })).not.toBeChecked()

    await user.click(screen.getByRole("button", { name: "Today" }))
    expect(screen.getByRole("checkbox", { name: "claude-opus-4-8 · Today" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "claude-sonnet-4-6 · Today" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "claude-opus-4-8 · 7d" })).not.toBeChecked()

    await user.click(screen.getByRole("button", { name: "Today" }))
    expect(screen.getByRole("checkbox", { name: "claude-opus-4-8 · Today" })).not.toBeChecked()
    expect(screen.getByRole("checkbox", { name: "claude-sonnet-4-6 · Today" })).not.toBeChecked()

    await user.click(screen.getByRole("button", { name: "All periods" }))
    expect(screen.getByRole("checkbox", { name: "claude-opus-4-8 · Today" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "claude-sonnet-4-6 · Today" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "claude-opus-4-8 · 7d" })).toBeChecked()
  })

  it("hides period quick-toggle buttons when the provider has no model-cost lines", () => {
    render(<SharePage plugins={[makePlugin()]} />)

    expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "All periods" })).not.toBeInTheDocument()
  })
})
