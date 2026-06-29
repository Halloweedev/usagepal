import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

describe("Alert", () => {
  it("renders default alert structure", () => {
    render(
      <Alert>
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>Something happened</AlertDescription>
      </Alert>
    )
    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(screen.getByText("Heads up")).toBeInTheDocument()
    expect(screen.getByText("Something happened")).toBeInTheDocument()
  })

  it("renders destructive variant", () => {
    const { container } = render(<Alert variant="destructive">Boom</Alert>)
    expect(container.textContent).toContain("Boom")
    // class-variance-authority should add a destructive class
    expect(screen.getByRole("alert").className).toContain("destructive")
  })
})

