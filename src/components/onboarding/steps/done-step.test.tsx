import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { DoneStep } from "@/components/onboarding/steps/done-step"

describe("DoneStep", () => {
  it("summarizes what was configured", () => {
    render(<DoneStep alertsEnabled={2} startOnLogin={true} onFinish={() => {}} busyAction={null} />)
    expect(screen.getByRole("heading", { name: "You're all set" })).toBeInTheDocument()
    expect(screen.getByText("2 alerts on · starts at login")).toBeInTheDocument()
  })

  it("summarizes a skipped setup", () => {
    render(<DoneStep alertsEnabled={0} startOnLogin={false} onFinish={() => {}} busyAction={null} />)
    expect(screen.getByText("Alerts off · manual start")).toBeInTheDocument()
  })

  it("uses singular for one alert", () => {
    render(<DoneStep alertsEnabled={1} startOnLogin={false} onFinish={() => {}} busyAction={null} />)
    expect(screen.getByText("1 alert on · manual start")).toBeInTheDocument()
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
})
