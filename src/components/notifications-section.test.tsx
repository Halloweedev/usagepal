import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  invokeMock: vi.fn().mockResolvedValue(undefined),
  setToggleMock: vi.fn(),
  settings: { underTenPercent: false, healthyToClose: false, closeToRunningOut: false, sessionReset: false, budgetExceeded: false },
}))

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: state.invokeMock }))
vi.mock("@/stores/app-notifications-store", () => ({
  useAppNotificationsStore: (selector: (s: unknown) => unknown) =>
    selector({
      settings: state.settings,
      setToggle: (...args: unknown[]) => state.setToggleMock(...args),
      hydrate: vi.fn().mockResolvedValue(undefined),
    }),
}))

import { NotificationsSection } from "./notifications-section"
import { useAppUiStore } from "@/stores/app-ui-store"

async function openNotificationsDialog() {
  await userEvent.click(screen.getByRole("button", { name: "Notifications" }))
}

describe("NotificationsSection", () => {
  beforeEach(() => {
    state.invokeMock.mockReset()
    state.invokeMock.mockResolvedValue(undefined)
    state.setToggleMock.mockReset()
    state.settings = { underTenPercent: false, healthyToClose: false, closeToRunningOut: false, sessionReset: false, budgetExceeded: false }
    useAppUiStore.getState().resetState()
  })

  it("does not show the dialog or checkboxes just from rendering", () => {
    render(<NotificationsSection />)
    expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
  })

  it("opens a modal with the 5 alert checkboxes on button click", async () => {
    render(<NotificationsSection />)
    await openNotificationsDialog()

    expect(screen.getByRole("dialog", { name: "Notifications" })).toHaveAttribute("aria-modal", "true")
    expect(screen.getAllByRole("checkbox")).toHaveLength(5)
  })

  it("closes the notifications dialog on Escape", async () => {
    render(<NotificationsSection />)
    await openNotificationsDialog()
    await userEvent.keyboard("{Escape}")
    expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument()
  })

  it("persists the toggle and shows the allow-notifications modal when turned on", async () => {
    render(<NotificationsSection />)
    await openNotificationsDialog()
    await userEvent.click(screen.getAllByRole("checkbox")[0])
    expect(state.setToggleMock).toHaveBeenCalledWith("underTenPercent", true)
    expect(await screen.findByText(/Allow Notifications/i)).toBeTruthy()
  })

  it("opens the macOS notification settings from the modal and closes it", async () => {
    render(<NotificationsSection />)
    await openNotificationsDialog()
    await userEvent.click(screen.getAllByRole("checkbox")[0])
    await userEvent.click(await screen.findByRole("button", { name: "Open Settings" }))
    expect(state.invokeMock).toHaveBeenCalledWith("open_notification_settings")
    expect(screen.queryByText(/Allow Notifications/i)).toBeNull()
  })

  it("dismisses with Done without opening settings", async () => {
    render(<NotificationsSection />)
    await openNotificationsDialog()
    await userEvent.click(screen.getAllByRole("checkbox")[0])
    await userEvent.click(await screen.findByRole("button", { name: "Done" }))
    expect(state.invokeMock).not.toHaveBeenCalledWith("open_notification_settings")
    expect(screen.queryByText(/Allow Notifications/i)).toBeNull()
  })

  it("keeps the notifications dialog open when Escape is pressed while the permission modal is open", async () => {
    render(<NotificationsSection />)
    await openNotificationsDialog()
    await userEvent.click(screen.getAllByRole("checkbox")[0])
    expect(await screen.findByText(/Allow Notifications/i)).toBeTruthy()

    await userEvent.keyboard("{Escape}")

    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeInTheDocument()
  })

  it("hides the Set Budgets button unless Over Budget is on", async () => {
    render(<NotificationsSection />)
    await openNotificationsDialog()
    expect(screen.queryByRole("button", { name: "Set Budgets" })).not.toBeInTheDocument()
  })

  it("jumps to the Budgets tab from Set Budgets and closes the dialog", async () => {
    state.settings = { ...state.settings, budgetExceeded: true }
    render(<NotificationsSection />)
    await openNotificationsDialog()

    await userEvent.click(screen.getByRole("button", { name: "Set Budgets" }))

    expect(useAppUiStore.getState().activeView).toBe("budgets")
    expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument()
  })
})
