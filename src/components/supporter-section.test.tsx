import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const opener = vi.hoisted(() => ({ openUrl: vi.fn(() => Promise.resolve()) }))
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: opener.openUrl }))

import { SupporterSection } from "@/components/supporter-section"
import { useAppLicenseStore } from "@/stores/app-license-store"

beforeEach(() => {
  vi.clearAllMocks()
  useAppLicenseStore.setState({
    status: "unlicensed",
    entitlements: {},
    lastError: undefined,
    hasActivated: false,
    activate: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  })
})

describe("SupporterSection", () => {
  it("shows the key input and a Secured by Keylight link when unlicensed", () => {
    render(<SupporterSection />)
    expect(screen.getByPlaceholderText("License Key")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Secured by Keylight.dev" })).toBeInTheDocument()
  })

  it("uses a compact title-only layout that does not force horizontal scrolling", () => {
    const { container } = render(<SupporterSection />)

    expect(screen.getByRole("heading", { level: 3, name: "Supporter" })).toBeInTheDocument()
    expect(screen.queryByText("Support UsagePal — activate your supporter license key.")).toBeNull()
    expect(container.querySelector("form")).toHaveClass("min-w-0")
    expect(screen.getByPlaceholderText("License Key")).toHaveClass("min-w-0")
    expect(screen.getByRole("button", { name: "Activate" })).toHaveClass("shrink-0")
  })

  it("calls activate with the entered key", async () => {
    const activate = vi.fn(async () => {})
    useAppLicenseStore.setState({ activate })
    render(<SupporterSection />)
    await userEvent.type(screen.getByPlaceholderText("License Key"), "KEY-9")
    await userEvent.click(screen.getByRole("button", { name: "Activate" }))
    expect(activate).toHaveBeenCalledWith("KEY-9")
  })

  it("shows the active state and no input when licensed", () => {
    useAppLicenseStore.setState({ status: "active" })
    render(<SupporterSection />)
    expect(screen.getByText("Supporter — Active")).toBeInTheDocument()
    expect(screen.queryByPlaceholderText("License Key")).not.toBeInTheDocument()
  })

  it("surfaces the error message", () => {
    useAppLicenseStore.setState({ status: "error", lastError: "This key isn't valid or has expired." })
    render(<SupporterSection />)
    expect(screen.getByText("This key isn't valid or has expired.")).toBeInTheDocument()
  })
})
