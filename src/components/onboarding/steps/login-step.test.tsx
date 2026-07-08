import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { LoginStep } from "@/components/onboarding/steps/login-step"

describe("LoginStep", () => {
  it("defaults the switch to on", () => {
    render(<LoginStep onContinue={() => {}} busy={false} />)
    expect(screen.getByRole("heading", { name: "Start when you sign in" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: /Start UsagePal at login/ })).toBeChecked()
  })

  it("continues with the switch on", async () => {
    const onContinue = vi.fn()
    render(<LoginStep onContinue={onContinue} busy={false} />)
    await userEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(onContinue).toHaveBeenCalledWith(true)
  })

  it("flips the switch and continues with it off", async () => {
    const onContinue = vi.fn()
    render(<LoginStep onContinue={onContinue} busy={false} />)
    const toggle = screen.getByRole("switch", { name: /Start UsagePal at login/ })
    await userEvent.click(toggle)
    expect(toggle).not.toBeChecked()
    await userEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(onContinue).toHaveBeenCalledWith(false)
  })

  it("disables Continue while busy", () => {
    render(<LoginStep onContinue={() => {}} busy={true} />)
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled()
  })
})
