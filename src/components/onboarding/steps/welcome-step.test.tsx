import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/components/ui/tooltip", () => import("@/test/tooltip-mock"))

import { WelcomeStep } from "@/components/onboarding/steps/welcome-step"

describe("WelcomeStep", () => {
  it("renders a sentence-case title and the miniature", async () => {
    render(<WelcomeStep onContinue={() => {}} onSkip={() => {}} skipBusy={false} />)
    expect(screen.getByRole("heading", { name: "Welcome to UsagePal" })).toBeInTheDocument()
    expect(screen.getByText("Claude")).toBeInTheDocument()
    // Lines reveal one at a time (350ms apart)
    await waitFor(() => expect(screen.getByText("Session")).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText("Weekly limit")).toBeInTheDocument())
    expect(screen.getByText("68% left")).toBeInTheDocument()
  })

  it("wires Continue and Skip setup", async () => {
    const onContinue = vi.fn()
    const onSkip = vi.fn()
    render(<WelcomeStep onContinue={onContinue} onSkip={onSkip} skipBusy={false} />)
    await userEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(onContinue).toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Skip setup" }))
    expect(onSkip).toHaveBeenCalled()
  })

  it("disables Skip setup while busy", () => {
    render(<WelcomeStep onContinue={() => {}} onSkip={() => {}} skipBusy={true} />)
    expect(screen.getByRole("button", { name: "Skip setup" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled()
  })

  it("cycles the menu-bar preview through all icon styles", async () => {
    render(
      <WelcomeStep onContinue={() => {}} onSkip={() => {}} skipBusy={false} menubarCycleMs={40} />
    )
    const preview = screen.getByTestId("menubar-preview")
    expect(preview).toHaveAttribute("data-variant", "percent")
    for (const variant of ["donut", "bars", "multi-percent", "multi-bars"]) {
      await waitFor(() => expect(preview).toHaveAttribute("data-variant", variant))
    }
    // The rotation wraps back around to the first style.
    await waitFor(() => expect(preview).toHaveAttribute("data-variant", "percent"))
  })
})
