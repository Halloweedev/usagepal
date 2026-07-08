import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { NotificationsStep } from "@/components/onboarding/steps/notifications-step"

describe("NotificationsStep", () => {
  it("pre-checks the recommended alerts and previews Will Run Out", () => {
    render(<NotificationsStep onEnable={() => {}} onSkip={() => {}} busy={false} />)
    expect(screen.getByRole("heading", { name: "Choose your alerts" })).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: /Almost Out/ })).not.toBeChecked()
    expect(screen.getByRole("checkbox", { name: /Cutting It Close/ })).not.toBeChecked()
    expect(screen.getByRole("checkbox", { name: /Will Run Out/ })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: /Session Reset/ })).toBeChecked()
    const banner = screen.getByTestId("notification-banner")
    expect(banner).toHaveTextContent("Will Run Out")
  })

  it("previews an alert when it is toggled on", async () => {
    render(<NotificationsStep onEnable={() => {}} onSkip={() => {}} busy={false} />)
    await userEvent.click(screen.getByRole("checkbox", { name: /Almost Out/ }))
    expect(screen.getByTestId("notification-banner")).toHaveTextContent("Almost Out")
  })

  it("passes the actual selection to onEnable", async () => {
    const onEnable = vi.fn()
    render(<NotificationsStep onEnable={onEnable} onSkip={() => {}} busy={false} />)
    await userEvent.click(screen.getByRole("checkbox", { name: /Almost Out/ }))
    await userEvent.click(screen.getByRole("checkbox", { name: /Session Reset/ }))
    await userEvent.click(screen.getByRole("button", { name: "Enable notifications" }))
    expect(onEnable).toHaveBeenCalledWith({
      underTenPercent: true,
      healthyToClose: false,
      closeToRunningOut: true,
      sessionReset: false,
    })
  })

  it("disables Enable notifications when nothing is selected", async () => {
    render(<NotificationsStep onEnable={() => {}} onSkip={() => {}} busy={false} />)
    await userEvent.click(screen.getByRole("checkbox", { name: /Will Run Out/ }))
    await userEvent.click(screen.getByRole("checkbox", { name: /Session Reset/ }))
    expect(screen.getByRole("button", { name: "Enable notifications" })).toBeDisabled()
  })

  it("skips without saving", async () => {
    const onSkip = vi.fn()
    render(<NotificationsStep onEnable={() => {}} onSkip={onSkip} busy={false} />)
    await userEvent.click(screen.getByRole("button", { name: "Not now" }))
    expect(onSkip).toHaveBeenCalled()
  })

  it("disables both buttons while busy", () => {
    render(<NotificationsStep onEnable={() => {}} onSkip={() => {}} busy={true} />)
    expect(screen.getByRole("button", { name: "Enable notifications" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Not now" })).toBeDisabled()
  })
})
