import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { SideNav } from "@/components/side-nav"

const darkModeState = vi.hoisted(() => ({
  useDarkModeMock: vi.fn(() => false),
}))

vi.mock("@/hooks/use-dark-mode", () => ({
  useDarkMode: darkModeState.useDarkModeMock,
}))

describe("SideNav", () => {
  it("calls onViewChange for Home and Settings", async () => {
    const onViewChange = vi.fn()
    render(<SideNav activeView="home" onViewChange={onViewChange} plugins={[]} />)

    await userEvent.click(screen.getByRole("button", { name: "Settings" }))
    expect(onViewChange).toHaveBeenCalledWith("settings")

    await userEvent.click(screen.getByRole("button", { name: "Home" }))
    expect(onViewChange).toHaveBeenCalledWith("home")
  })

  it("renders plugin icon button and uses brand color when appropriate", () => {
    const onViewChange = vi.fn()
    render(
      <SideNav
        activeView="home"
        onViewChange={onViewChange}
        plugins={[
          { id: "p1", name: "Plugin 1", iconUrl: "icon.svg", brandColor: "#ff0000" },
        ]}
      />
    )

    const btn = screen.getByRole("button", { name: "Plugin 1" })
    expect(btn).toBeInTheDocument()

    const icon = btn.querySelector('[aria-hidden="true"]')
    expect(icon).toHaveStyle({ backgroundColor: "rgb(255, 0, 0)" })
  })

  it("falls back to currentColor (light) or white (dark) for low-contrast brand colors", () => {
    const onViewChange = vi.fn()

    // Light mode + very light color => currentColor
    darkModeState.useDarkModeMock.mockReturnValueOnce(false)
    const { rerender } = render(
      <SideNav
        activeView="home"
        onViewChange={onViewChange}
        plugins={[{ id: "p", name: "P", iconUrl: "icon.svg", brandColor: "#ffffff" }]}
      />
    )
    const pStyle = screen.getByRole("button", { name: "P" }).querySelector('[aria-hidden="true"]')?.getAttribute("style") ?? ""
    expect(pStyle).toMatch(/background-color:\s*currentcolor/i)

    // Dark mode + very dark color => white
    darkModeState.useDarkModeMock.mockReturnValueOnce(true)
    rerender(
      <SideNav
        activeView="home"
        onViewChange={onViewChange}
        plugins={[{ id: "p2", name: "P2", iconUrl: "icon.svg", brandColor: "#000000" }]}
      />
    )
    const p2Style = screen.getByRole("button", { name: "P2" }).querySelector('[aria-hidden="true"]')?.getAttribute("style") ?? ""
    expect(p2Style).toContain("rgb(255, 255, 255)")
  })

  it("does not render a Help button", () => {
    const onViewChange = vi.fn()
    render(<SideNav activeView="home" onViewChange={onViewChange} plugins={[]} />)

    expect(screen.queryByRole("button", { name: "Help" })).not.toBeInTheDocument()
  })

  it("renders Share above Settings and calls onShareClick, not onViewChange", async () => {
    const onViewChange = vi.fn()
    const onShareClick = vi.fn()
    render(
      <SideNav
        activeView="home"
        onViewChange={onViewChange}
        onShareClick={onShareClick}
        plugins={[]}
      />
    )

    const buttons = screen.getAllByRole("button")
    const shareIndex = buttons.findIndex((btn) => btn.getAttribute("aria-label") === "Share")
    const settingsIndex = buttons.findIndex((btn) => btn.getAttribute("aria-label") === "Settings")
    expect(shareIndex).toBeGreaterThanOrEqual(0)
    expect(shareIndex).toBeLessThan(settingsIndex)

    await userEvent.click(screen.getByRole("button", { name: "Share" }))
    expect(onShareClick).toHaveBeenCalledTimes(1)
    expect(onViewChange).not.toHaveBeenCalledWith("share")
  })
})
