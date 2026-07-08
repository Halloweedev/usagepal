import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useRef, useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { FocusTrapDialog } from "./focus-trap-dialog"

function TestDialog({
  onClose,
  useInitialFocus = false,
}: {
  onClose: () => void
  useInitialFocus?: boolean
}) {
  const secondRef = useRef<HTMLButtonElement>(null)
  return (
    <FocusTrapDialog
      label="Test Dialog"
      onClose={onClose}
      initialFocusRef={useInitialFocus ? secondRef : undefined}
    >
      <h2>Test Dialog</h2>
      <button type="button" role="radio" aria-checked={false}>
        First
      </button>
      <button type="button" role="radio" aria-checked={false} ref={secondRef}>
        Second
      </button>
    </FocusTrapDialog>
  )
}

function ReRenderingTestDialog() {
  const [renderCount, setRenderCount] = useState(0)
  return (
    <FocusTrapDialog label="Test Dialog" onClose={() => {}}>
      <h2>Test Dialog</h2>
      <button type="button" role="radio" aria-checked={false}>
        First
      </button>
      <button type="button" role="radio" aria-checked={false}>
        Second
      </button>
      <button type="button" role="radio" aria-checked={false} onClick={() => setRenderCount((c) => c + 1)}>
        Trigger Re-render
      </button>
      {/* renderCount is just here to ensure the component actually re-renders */}
      <div aria-label={`render-count-${renderCount}`} />
    </FocusTrapDialog>
  )
}

describe("FocusTrapDialog", () => {
  it("renders as a modal dialog with the given label", () => {
    render(<TestDialog onClose={vi.fn()} />)
    expect(screen.getByRole("dialog", { name: "Test Dialog" })).toHaveAttribute("aria-modal", "true")
  })

  it("focuses the first focusable control by default", () => {
    render(<TestDialog onClose={vi.fn()} />)
    expect(screen.getByRole("radio", { name: "First" })).toHaveFocus()
  })

  it("focuses the initialFocusRef control when provided", () => {
    render(<TestDialog onClose={vi.fn()} useInitialFocus />)
    expect(screen.getByRole("radio", { name: "Second" })).toHaveFocus()
  })

  it("closes on Escape", async () => {
    const onClose = vi.fn()
    render(<TestDialog onClose={onClose} />)
    await userEvent.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("closes on backdrop click but not content click", async () => {
    const onClose = vi.fn()
    render(<TestDialog onClose={onClose} />)
    await userEvent.click(screen.getByRole("dialog"))
    expect(onClose).toHaveBeenCalledTimes(1)
    onClose.mockClear()
    await userEvent.click(screen.getByRole("heading", { name: "Test Dialog" }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it("traps Tab focus between first and last controls", async () => {
    const user = userEvent.setup()
    render(<TestDialog onClose={vi.fn()} />)
    expect(screen.getByRole("radio", { name: "First" })).toHaveFocus()

    await user.keyboard("{Shift>}{Tab}{/Shift}")
    expect(screen.getByRole("radio", { name: "Second" })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole("radio", { name: "First" })).toHaveFocus()
  })

  it("does not steal focus back to the first control when a re-render gives onClose a new identity", async () => {
    const user = userEvent.setup()
    render(<ReRenderingTestDialog />)

    expect(screen.getByRole("radio", { name: "First" })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole("radio", { name: "Second" })).toHaveFocus()
    await user.tab()
    const triggerButton = screen.getByRole("radio", { name: "Trigger Re-render" })
    expect(triggerButton).toHaveFocus()

    // Clicking this button triggers a re-render of the parent component, which re-creates
    // the inline onClose passed to FocusTrapDialog. Without the fix, this re-render would
    // steal focus back to "First" because the effect would re-run on onClose identity change.
    await user.click(triggerButton)

    // After the re-render, focus should still be on the Trigger Re-render button,
    // not stolen back to "First".
    expect(triggerButton).toHaveFocus()
  })
})
