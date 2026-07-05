import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { AboutDialog } from "@/components/about-dialog"

const openerState = vi.hoisted(() => ({
  openUrlMock: vi.fn(() => Promise.resolve()),
}))

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: openerState.openUrlMock,
}))

describe("AboutDialog", () => {
  it("renders version without changelog or GitHub links", () => {
    render(<AboutDialog version="1.2.3" onClose={() => {}} />)
    expect(screen.getByText("UsagePal")).toBeInTheDocument()
    expect(screen.getByText("v1.2.3")).toBeInTheDocument()
    expect(screen.getByText("Built by Nicolas Demanez")).toBeInTheDocument()
    expect(screen.queryByText(/OpenUsage/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/fork/i)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "View Changelog" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "GitHub" })).not.toBeInTheDocument()
  })

  it("closes on Escape", async () => {
    const onClose = vi.fn()
    render(<AboutDialog version="1.2.3" onClose={onClose} />)
    await userEvent.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalled()
  })

  it("does not close on other keys", async () => {
    const onClose = vi.fn()
    render(<AboutDialog version="1.2.3" onClose={onClose} />)
    await userEvent.keyboard("{Enter}")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("closes on backdrop click only", async () => {
    const onClose = vi.fn()
    const { container } = render(<AboutDialog version="1.2.3" onClose={onClose} />)
    const backdrop = container.firstElementChild as HTMLElement
    await userEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)

    // Clicking inside the dialog should not close.
    onClose.mockClear()
    await userEvent.click(screen.getByText("UsagePal"))
    expect(onClose).not.toHaveBeenCalled()
  })

  it("closes when document becomes hidden", () => {
    const onClose = vi.fn()
    render(<AboutDialog version="1.2.3" onClose={onClose} />)

    const original = Object.getOwnPropertyDescriptor(document, "hidden")
    Object.defineProperty(document, "hidden", { value: true, configurable: true })
    document.dispatchEvent(new Event("visibilitychange"))
    expect(onClose).toHaveBeenCalled()

    if (original) {
      Object.defineProperty(document, "hidden", original)
    }
  })

  it("does not close on visibilitychange when document is visible", () => {
    const onClose = vi.fn()
    render(<AboutDialog version="1.2.3" onClose={onClose} />)

    const original = Object.getOwnPropertyDescriptor(document, "hidden")
    Object.defineProperty(document, "hidden", { value: false, configurable: true })
    document.dispatchEvent(new Event("visibilitychange"))
    expect(onClose).not.toHaveBeenCalled()

    if (original) {
      Object.defineProperty(document, "hidden", original)
    }
  })
})
