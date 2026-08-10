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
  it("opens Buy Me a Coffee so unlicensed users can find the way to support", async () => {
    render(<SupporterSection />)
    await userEvent.click(screen.getByRole("button", { name: "Buy Me a Coffee" }))
    expect(opener.openUrl).toHaveBeenCalledWith("https://buymeacoffee.com/dmzxnico")
  })

  it("keeps the Buy Me a Coffee link visible for active supporters", () => {
    useAppLicenseStore.setState({ status: "active" })
    render(<SupporterSection />)
    expect(screen.getByRole("button", { name: "Buy Me a Coffee" })).toBeInTheDocument()
  })

  it("hides the license key entry and the Keylight credit", () => {
    render(<SupporterSection />)
    expect(screen.queryByPlaceholderText("License Key")).toBeNull()
    expect(screen.queryByRole("button", { name: "Activate" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Secured by Keylight.dev" })).toBeNull()
  })

  it("hides the license error, since there is nothing to retry here", () => {
    useAppLicenseStore.setState({ status: "error", lastError: "This key isn't valid or has expired." })
    render(<SupporterSection />)
    expect(screen.queryByText("This key isn't valid or has expired.")).toBeNull()
  })

  it("uses a compact title-only layout that does not force horizontal scrolling", () => {
    render(<SupporterSection />)

    expect(screen.getByRole("heading", { level: 3, name: "Supporter" })).toBeInTheDocument()
    expect(screen.queryByText("Support UsagePal — activate your supporter license key.")).toBeNull()
    expect(screen.getByRole("button", { name: "Buy Me a Coffee" })).toHaveClass("text-sm")
  })

  it("still re-validates for someone who activated previously", () => {
    const refresh = vi.fn(async () => {})
    useAppLicenseStore.setState({ hasActivated: true, refresh })
    render(<SupporterSection />)
    expect(refresh).toHaveBeenCalled()
  })

  it("shows the active state for licensed supporters", () => {
    useAppLicenseStore.setState({ status: "active" })
    render(<SupporterSection />)
    expect(screen.getByText("Supporter — Active")).toBeInTheDocument()
  })
})
