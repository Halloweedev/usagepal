import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(() => false),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: state.invokeMock,
  isTauri: state.isTauriMock,
}))

import { DoneStep } from "@/components/onboarding/steps/done-step"

const plugin = (id: string, name: string, detected: boolean) => ({
  id,
  name,
  iconUrl: "",
  detected,
})

describe("DoneStep", () => {
  beforeEach(() => {
    state.invokeMock.mockReset()
    state.invokeMock.mockResolvedValue([])
    // Outside Tauri the scan settles immediately, so the summary tests below
    // see their content synchronously.
    state.isTauriMock.mockReset()
    state.isTauriMock.mockReturnValue(false)
  })

  it("summarizes what was configured", () => {
    render(<DoneStep alertsEnabled={2} startOnLogin={true} onFinish={() => {}} busyAction={null} />)
    expect(screen.getByRole("heading", { name: "You're all set" })).toBeInTheDocument()
    expect(screen.getByText("2 alerts on")).toBeInTheDocument()
    expect(screen.getByText("Starts when you sign in")).toBeInTheDocument()
  })

  it("summarizes a skipped setup", () => {
    render(<DoneStep alertsEnabled={0} startOnLogin={false} onFinish={() => {}} busyAction={null} />)
    expect(screen.getByText("Alerts off")).toBeInTheDocument()
    expect(screen.getByText("Starts only when you open it")).toBeInTheDocument()
  })

  it("uses singular for one alert", () => {
    render(<DoneStep alertsEnabled={1} startOnLogin={false} onFinish={() => {}} busyAction={null} />)
    expect(screen.getByText("1 alert on")).toBeInTheDocument()
  })

  it("finishes into the app or settings", async () => {
    const onFinish = vi.fn()
    render(<DoneStep alertsEnabled={0} startOnLogin={false} onFinish={onFinish} busyAction={null} />)
    await userEvent.click(screen.getByRole("button", { name: "Open UsagePal" }))
    expect(onFinish).toHaveBeenCalledWith(false)
    await userEvent.click(screen.getByRole("button", { name: "Open Settings" }))
    expect(onFinish).toHaveBeenCalledWith(true)
  })

  it("disables buttons while finishing", () => {
    const { rerender } = render(
      <DoneStep alertsEnabled={0} startOnLogin={false} onFinish={() => {}} busyAction="finish" />
    )
    expect(screen.getByRole("button", { name: "Open UsagePal" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeDisabled()
    rerender(
      <DoneStep alertsEnabled={0} startOnLogin={false} onFinish={() => {}} busyAction="settings" />
    )
    expect(screen.getByRole("button", { name: "Open UsagePal" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeDisabled()
  })

  describe("provider scan", () => {
    beforeEach(() => {
      state.isTauriMock.mockReturnValue(true)
    })

    it("shows the loader, then reveals detected providers one by one", async () => {
      state.invokeMock.mockResolvedValue([
        plugin("claude", "Claude", true),
        plugin("codex", "Codex", true),
        plugin("devin", "Devin", false),
        plugin("mock", "Mock (Chaos)", true),
      ])
      render(
        <DoneStep
          alertsEnabled={0}
          startOnLogin={false}
          onFinish={() => {}}
          busyAction={null}
          scanMinMs={10}
          revealStepMs={5}
        />
      )
      expect(screen.getByText("Looking for providers on this Mac…")).toBeInTheDocument()
      expect(screen.queryByText("Alerts off")).not.toBeInTheDocument()

      await waitFor(() => expect(screen.getByTestId("provider-chip-claude")).toBeInTheDocument())
      await waitFor(() => expect(screen.getByTestId("provider-chip-codex")).toBeInTheDocument())
      // Undetected, non key-managed providers never appear.
      expect(screen.queryByTestId("provider-chip-devin")).not.toBeInTheDocument()
      // Neither does the dev-only chaos plugin, even though it reports detected.
      expect(screen.queryByTestId("provider-chip-mock")).not.toBeInTheDocument()
      expect(state.invokeMock).toHaveBeenCalledWith("list_plugins")

      // Summary card arrives only after the reveal settles.
      await waitFor(() => expect(screen.getByText("Alerts off")).toBeInTheDocument())
    })

    it("appends undetected key-managed providers as needs-key chips", async () => {
      state.invokeMock.mockResolvedValue([
        plugin("claude", "Claude", true),
        plugin("openrouter", "OpenRouter", false),
        plugin("cline-pass", "ClinePass", false),
      ])
      render(
        <DoneStep
          alertsEnabled={0}
          startOnLogin={false}
          onFinish={() => {}}
          busyAction={null}
          scanMinMs={10}
          revealStepMs={5}
        />
      )
      await waitFor(() =>
        expect(screen.getByTestId("provider-chip-openrouter")).toBeInTheDocument()
      )
      expect(screen.getByTestId("provider-chip-openrouter")).toHaveAttribute(
        "title",
        "Add its key in Settings → Plugins"
      )
      expect(screen.getByTestId("provider-chip-claude")).not.toHaveAttribute("title")
      await waitFor(() =>
        expect(screen.getByTestId("provider-chip-cline-pass")).toBeInTheDocument()
      )
    })

    it("shows a hint when nothing is detected", async () => {
      state.invokeMock.mockResolvedValue([plugin("devin", "Devin", false)])
      render(
        <DoneStep
          alertsEnabled={0}
          startOnLogin={false}
          onFinish={() => {}}
          busyAction={null}
          scanMinMs={10}
          revealStepMs={5}
        />
      )
      await waitFor(() =>
        expect(screen.getByText(/No providers detected yet/)).toBeInTheDocument()
      )
      expect(screen.getByText("Alerts off")).toBeInTheDocument()
    })
  })
})
