import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { MacNotificationBanner } from "@/components/onboarding/mac-notification-banner"

describe("MacNotificationBanner", () => {
  it("shows the milestone title and body", () => {
    render(<MacNotificationBanner milestone="closeToRunningOut" />)
    expect(screen.getByText("Will Run Out")).toBeInTheDocument()
    expect(screen.getByText("Projected to finish before the limit resets.")).toBeInTheDocument()
    expect(screen.getByText("UsagePal")).toBeInTheDocument()
  })

  it("switches copy with the milestone", () => {
    render(<MacNotificationBanner milestone="sessionReset" />)
    expect(screen.getByText("Session Reset")).toBeInTheDocument()
    expect(screen.getByText("Back to 0% used.")).toBeInTheDocument()
  })

  it("animates in", () => {
    render(<MacNotificationBanner milestone="underTenPercent" />)
    expect(screen.getByTestId("notification-banner")).toHaveClass("animate-in")
  })
})
