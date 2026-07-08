import { render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({
    children,
    render: renderProp,
    ...props
  }: {
    children?: ReactNode
    render?: ((props: Record<string, unknown>) => ReactNode) | ReactNode
  }) => {
    if (typeof renderProp === "function") return renderProp({ ...props, children })
    if (renderProp) return renderProp
    return <div {...props}>{children}</div>
  },
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

import { TourStep } from "@/components/onboarding/steps/tour-step"

describe("TourStep", () => {
  it("starts with Continue disabled and both tasks pending", () => {
    render(<TourStep onContinue={() => {}} />)
    expect(screen.getByRole("heading", { name: "Try it for yourself" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled()
    expect(screen.getByTestId("tour-task-hover")).toHaveAttribute("data-done", "false")
    expect(screen.getByTestId("tour-task-click")).toHaveAttribute("data-done", "false")
  })

  it("completes the hover task after dwelling on the card", async () => {
    render(<TourStep onContinue={() => {}} />)
    await userEvent.hover(screen.getByTestId("tour-card"))
    await waitFor(() =>
      expect(screen.getByTestId("tour-task-hover")).toHaveAttribute("data-done", "true")
    )
  })

  it("does not complete the hover task when the pointer leaves early", async () => {
    render(<TourStep onContinue={() => {}} />)
    await userEvent.hover(screen.getByTestId("tour-card"))
    await userEvent.unhover(screen.getByTestId("tour-card"))
    // Give the (cancelled) dwell timer time to have fired if cancellation failed
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(screen.getByTestId("tour-task-hover")).toHaveAttribute("data-done", "false")
  })

  it("completes the click task by flipping the reset display through the real card", async () => {
    render(<TourStep onContinue={() => {}} />)
    const resetButton = screen.getByRole("button", { name: /^Resets in / })
    await userEvent.click(resetButton)
    expect(screen.getByTestId("tour-task-click")).toHaveAttribute("data-done", "true")
    // The card genuinely switched to the absolute label
    expect(screen.queryByRole("button", { name: /^Resets in / })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Resets / })).toBeInTheDocument()
  })

  it("enables Continue once both tasks are done", async () => {
    const onContinue = vi.fn()
    render(<TourStep onContinue={onContinue} />)
    await userEvent.hover(screen.getByTestId("tour-card"))
    await waitFor(() =>
      expect(screen.getByTestId("tour-task-hover")).toHaveAttribute("data-done", "true")
    )
    await userEvent.click(screen.getByRole("button", { name: /^Resets in / }))
    const continueButton = screen.getByRole("button", { name: "Continue" })
    expect(continueButton).toBeEnabled()
    await userEvent.click(continueButton)
    expect(onContinue).toHaveBeenCalled()
  })

  it("lets the user skip the tour", async () => {
    const onContinue = vi.fn()
    render(<TourStep onContinue={onContinue} />)
    await userEvent.click(screen.getByRole("button", { name: "Skip tour" }))
    expect(onContinue).toHaveBeenCalled()
  })
})
