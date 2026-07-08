import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { StepShell } from "@/components/onboarding/step-shell"

describe("StepShell", () => {
  it("renders title, description, body, and actions", () => {
    render(
      <StepShell title="Choose your alerts" description="Pick what to be told about." actions={<button>Continue</button>}>
        <p>Body content</p>
      </StepShell>
    )
    expect(screen.getByRole("heading", { name: "Choose your alerts" })).toBeInTheDocument()
    expect(screen.getByText("Pick what to be told about.")).toBeInTheDocument()
    expect(screen.getByText("Body content")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument()
  })
})
