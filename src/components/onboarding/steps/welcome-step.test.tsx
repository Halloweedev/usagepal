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
})
