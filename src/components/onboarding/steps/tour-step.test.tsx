import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/components/ui/tooltip", () => import("@/test/tooltip-mock"))

import { TourStep } from "@/components/onboarding/steps/tour-step"

const TASK_IDS = [
  "tour-task-hover-reset",
  "tour-task-click-reset",
  "tour-task-hover-flame",
  "tour-task-hover-expiry",
  "tour-task-flip-usage",
] as const

// armDelayMs=0 arms detection immediately; hoverDwellMs=5 keeps dwell waits fast.
function renderArmed(onContinue: () => void = () => {}) {
  return render(<TourStep onContinue={onContinue} armDelayMs={0} hoverDwellMs={5} />)
}

function resetButton() {
  return screen.getAllByRole("button").find((button) => /^Resets/.test(button.textContent ?? ""))!
}

function usageToggle() {
  return screen.getByTestId("tour-card").querySelector("[data-usage-toggle]") as HTMLElement
}

function expiryValue() {
  return screen.getByTestId("tour-card").querySelector("[data-reset-expiry]") as HTMLElement
}

async function completeAllTasks() {
  await userEvent.hover(resetButton())
  await waitFor(() =>
    expect(screen.getByTestId("tour-task-hover-reset")).toHaveAttribute("data-done", "true")
  )
  await userEvent.click(resetButton())
  await userEvent.hover(screen.getByLabelText("Will run out"))
  await waitFor(() =>
    expect(screen.getByTestId("tour-task-hover-flame")).toHaveAttribute("data-done", "true")
  )
  await userEvent.hover(expiryValue())
  await waitFor(() =>
    expect(screen.getByTestId("tour-task-hover-expiry")).toHaveAttribute("data-done", "true")
  )
  await userEvent.click(usageToggle())
}

describe("TourStep", () => {
  it("starts with Continue disabled and all five tasks pending", () => {
    renderArmed()
    expect(screen.getByRole("heading", { name: "Try it for yourself" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled()
    for (const id of TASK_IDS) {
      expect(screen.getByTestId(id)).toHaveAttribute("data-done", "false")
    }
  })

  it("completes the reset hover task after dwelling on the reset time", async () => {
    renderArmed()
    await userEvent.hover(resetButton())
    await waitFor(() =>
      expect(screen.getByTestId("tour-task-hover-reset")).toHaveAttribute("data-done", "true")
    )
  })

  it("does not complete the hover task when the pointer leaves early", async () => {
    render(<TourStep onContinue={() => {}} armDelayMs={0} hoverDwellMs={150} />)
    await userEvent.hover(resetButton())
    await userEvent.unhover(resetButton())
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(screen.getByTestId("tour-task-hover-reset")).toHaveAttribute("data-done", "false")
  })

  it("ignores gestures while detection is still disarmed", async () => {
    render(<TourStep onContinue={() => {}} armDelayMs={100_000} hoverDwellMs={5} />)
    await userEvent.hover(resetButton())
    await userEvent.click(resetButton())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByTestId("tour-task-hover-reset")).toHaveAttribute("data-done", "false")
    expect(screen.getByTestId("tour-task-click-reset")).toHaveAttribute("data-done", "false")
  })

  it("completes the click task by genuinely flipping the reset display", async () => {
    renderArmed()
    await userEvent.click(screen.getAllByRole("button", { name: /^Resets in / })[0])
    expect(screen.getByTestId("tour-task-click-reset")).toHaveAttribute("data-done", "true")
    // Both reset labels share the display mode, so no relative label remains.
    expect(screen.queryAllByRole("button", { name: /^Resets in / })).toHaveLength(0)
    expect(screen.getAllByRole("button").some((b) => /^Resets/.test(b.textContent ?? ""))).toBe(true)
  })

  it("completes the flame hover task through the pace indicator", async () => {
    renderArmed()
    await userEvent.hover(screen.getByLabelText("Will run out"))
    await waitFor(() =>
      expect(screen.getByTestId("tour-task-hover-flame")).toHaveAttribute("data-done", "true")
    )
  })

  it("completes the expiry hover task through the resets count", async () => {
    renderArmed()
    await userEvent.hover(expiryValue())
    await waitFor(() =>
      expect(screen.getByTestId("tour-task-hover-expiry")).toHaveAttribute("data-done", "true")
    )
  })

  it("flips left to used through the usage value and updates the card", async () => {
    renderArmed()
    expect(screen.getByText("62% left")).toBeInTheDocument()
    await userEvent.click(usageToggle())
    expect(screen.getByTestId("tour-task-flip-usage")).toHaveAttribute("data-done", "true")
    expect(screen.queryByText("62% left")).not.toBeInTheDocument()
    expect(screen.getByText("38%")).toBeInTheDocument()
  })

  it("enables Continue only after all five tasks are done", async () => {
    const onContinue = vi.fn()
    renderArmed(onContinue)
    await completeAllTasks()
    const continueButton = screen.getByRole("button", { name: "Continue" })
    await waitFor(() => expect(continueButton).toBeEnabled())
    expect(screen.queryByRole("button", { name: "Skip tour" })).not.toBeInTheDocument()
    await userEvent.click(continueButton)
    expect(onContinue).toHaveBeenCalled()
  })

  it("lets the user skip the tour", async () => {
    const onContinue = vi.fn()
    renderArmed(onContinue)
    await userEvent.click(screen.getByRole("button", { name: "Skip tour" }))
    expect(onContinue).toHaveBeenCalled()
  })
})
