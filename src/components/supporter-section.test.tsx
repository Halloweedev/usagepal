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
    expect(screen.getByPlaceholderText("Enter Your License Key")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Secured by Keylight.dev" })).toBeInTheDocument()
  })

  it("calls activate with the entered key", async () => {
    const activate = vi.fn(async () => {})
    useAppLicenseStore.setState({ activate })
    render(<SupporterSection />)
    await userEvent.type(screen.getByPlaceholderText("Enter Your License Key"), "KEY-9")
    await userEvent.click(screen.getByRole("button", { name: "Activate" }))
    expect(activate).toHaveBeenCalledWith("KEY-9")
  })

  it("shows the active state and no input when licensed", () => {
    useAppLicenseStore.setState({ status: "active" })
    render(<SupporterSection />)
    expect(screen.getByText("Supporter — Active")).toBeInTheDocument()
    expect(screen.queryByPlaceholderText("Enter Your License Key")).not.toBeInTheDocument()
  })

  it("surfaces the error message", () => {
    useAppLicenseStore.setState({ status: "error", lastError: "This key isn't valid or has expired." })
    render(<SupporterSection />)
    expect(screen.getByText("This key isn't valid or has expired.")).toBeInTheDocument()
  })
})
