import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(() => true),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: state.invokeMock,
  isTauri: state.isTauriMock,
}))

vi.mock("@/components/ui/tooltip", () => import("@/test/tooltip-mock"))

import { WhatsNewApp } from "@/components/whats-new/whats-new-app"

const SAMPLE_NOTES = [
  {
    version: "0.7.35",
    summary: "Stable release for feature X.",
    sections: [
      { title: "New Features", items: ["Feature X by @author", "Feature Y by @author"] },
      { title: "Bug Fixes", items: ["Fix Z by @author"] },
    ],
  },
  {
    version: "0.7.34",
    summary: "Stable release for the models graph.",
    sections: [
      { title: "New Features", items: ["Models graph by @author"] },
      { title: "Improvements", items: ["Polish by @author"] },
    ],
  },
]

describe("WhatsNewApp", () => {
  beforeEach(() => {
    state.invokeMock.mockReset()
    state.isTauriMock.mockReturnValue(true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders release notes from get_release_notes", async () => {
    state.invokeMock.mockResolvedValue(SAMPLE_NOTES)

    render(<WhatsNewApp />)

    expect(await screen.findByRole("heading", { name: "v0.7.35" })).toBeInTheDocument()
    expect(screen.getByText("Stable release for feature X.")).toBeInTheDocument()
    // Category badges (spans, not headings) — one "New Features" per version.
    expect(screen.getAllByText("New Features")).toHaveLength(2)
    expect(screen.getByText("Feature X by @author")).toBeInTheDocument()
    expect(screen.getByText("Feature Y by @author")).toBeInTheDocument()
    expect(screen.getByText("Bug Fixes")).toBeInTheDocument()
    // Second version is also rendered.
    expect(screen.getByRole("heading", { name: "v0.7.34" })).toBeInTheDocument()
    expect(screen.getByText("Stable release for the models graph.")).toBeInTheDocument()
  })

  it("renders multiple versions in the scrollable list", async () => {
    state.invokeMock.mockResolvedValue(SAMPLE_NOTES)

    render(<WhatsNewApp />)

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "v0.7.35" })).toBeInTheDocument()
    )
    expect(screen.getByRole("heading", { name: "v0.7.34" })).toBeInTheDocument()
  })

  it('calls dismiss_whats_new when "Open UsagePal" is clicked', async () => {
    state.invokeMock.mockResolvedValue(SAMPLE_NOTES)

    render(<WhatsNewApp />)
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "v0.7.35" })).toBeInTheDocument()
    )

    await userEvent.click(screen.getByRole("button", { name: "Open UsagePal" }))

    await waitFor(() =>
      expect(state.invokeMock).toHaveBeenCalledWith("dismiss_whats_new")
    )
  })

  it("calls dismiss_whats_new when Escape is pressed", async () => {
    state.invokeMock.mockResolvedValue(SAMPLE_NOTES)

    render(<WhatsNewApp />)
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "v0.7.35" })).toBeInTheDocument()
    )

    fireEvent.keyDown(document, { key: "Escape" })

    await waitFor(() =>
      expect(state.invokeMock).toHaveBeenCalledWith("dismiss_whats_new")
    )
  })

  it("renders empty state when no notes are available", async () => {
    state.invokeMock.mockResolvedValue([])

    render(<WhatsNewApp />)

    expect(await screen.findByText("No release notes available.")).toBeInTheDocument()
  })
})
