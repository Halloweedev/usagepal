import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  invokeMock: vi.fn().mockResolvedValue(undefined),
  setToggleMock: vi.fn(),
  store: {
    settings: { underTenPercent: false, healthyToClose: false, closeToRunningOut: false },
    setToggle: (...args: unknown[]) => state.setToggleMock(...args),
    hydrate: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: state.invokeMock }))
vi.mock("@/stores/app-notifications-store", () => ({
  useAppNotificationsStore: (selector: (s: typeof state.store) => unknown) => selector(state.store),
}))

import { NotificationsSection } from "./notifications-section"

describe("NotificationsSection", () => {
  beforeEach(() => {
    state.invokeMock.mockReset()
    state.invokeMock.mockResolvedValue(undefined)
    state.setToggleMock.mockReset()
  })

  it("does not show the modal just from rendering", () => {
    render(<NotificationsSection />)
    expect(screen.queryByText(/Allow Notifications/i)).toBeNull()
  })

  it("persists the toggle and shows the allow-notifications modal when turned on", async () => {
    render(<NotificationsSection />)
    await userEvent.click(screen.getAllByRole("checkbox")[0])
    expect(state.setToggleMock).toHaveBeenCalledWith("underTenPercent", true)
    expect(await screen.findByText(/Allow Notifications/i)).toBeTruthy()
  })

  it("opens the macOS notification settings from the modal and closes it", async () => {
    render(<NotificationsSection />)
    await userEvent.click(screen.getAllByRole("checkbox")[0])
    await userEvent.click(await screen.findByRole("button", { name: "Open Settings" }))
    expect(state.invokeMock).toHaveBeenCalledWith("open_notification_settings")
    expect(screen.queryByText(/Allow Notifications/i)).toBeNull()
  })

  it("dismisses with Done without opening settings", async () => {
    render(<NotificationsSection />)
    await userEvent.click(screen.getAllByRole("checkbox")[0])
    await userEvent.click(await screen.findByRole("button", { name: "Done" }))
    expect(state.invokeMock).not.toHaveBeenCalledWith("open_notification_settings")
    expect(screen.queryByText(/Allow Notifications/i)).toBeNull()
  })
})
