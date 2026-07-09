// src/components/onboarding/onboarding-app.test.tsx
import { render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(() => true),
  enableMock: vi.fn(),
  saveStartOnLoginMock: vi.fn(),
  savePaceNotificationSettingsMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: state.invokeMock,
  isTauri: state.isTauriMock,
}))

vi.mock("@tauri-apps/plugin-autostart", () => ({
  enable: state.enableMock,
}))

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({
    children,
    render: renderProp,
    ...props
  }: {
    children?: ReactNode
    render?: ((props: Record<string, unknown>) => ReactNode) | ReactNode
  }) => {
    if (typeof renderProp === "function") return renderProp({ ...props, children })
    if (renderProp) return renderProp
    return <div {...props}>{children}</div>
  },
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings")
  return {
    ...actual,
    saveStartOnLogin: state.saveStartOnLoginMock,
    savePaceNotificationSettings: state.savePaceNotificationSettingsMock,
  }
})

import { OnboardingApp } from "@/components/onboarding/onboarding-app"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

async function goToNotifications() {
  await userEvent.click(screen.getByRole("button", { name: "Continue" }))
  await userEvent.click(screen.getByRole("button", { name: "Skip tour" }))
  expect(screen.getByRole("heading", { name: "Choose your alerts" })).toBeInTheDocument()
}

async function goToLogin() {
  await goToNotifications()
  await userEvent.click(screen.getByRole("button", { name: "Not now" }))
  expect(screen.getByRole("heading", { name: "Start when you sign in" })).toBeInTheDocument()
}

async function goToDone() {
  await goToLogin()
  await userEvent.click(screen.getByRole("button", { name: "Continue" }))
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "You're all set" })).toBeInTheDocument()
  )
}

describe("OnboardingApp", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    state.invokeMock.mockReset()
    state.invokeMock.mockResolvedValue(null)
    state.isTauriMock.mockReset()
    state.isTauriMock.mockReturnValue(true)
    state.enableMock.mockReset()
    state.enableMock.mockResolvedValue(undefined)
    state.saveStartOnLoginMock.mockReset()
    state.saveStartOnLoginMock.mockResolvedValue(undefined)
    state.savePaceNotificationSettingsMock.mockReset()
    state.savePaceNotificationSettingsMock.mockResolvedValue(undefined)
  })

  it("walks value-first through all five steps", async () => {
    render(<OnboardingApp />)

    expect(screen.getByRole("heading", { name: "Welcome to UsagePal" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(screen.getByRole("heading", { name: "Try it for yourself" })).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Skip tour" }))
    expect(screen.getByRole("heading", { name: "Choose your alerts" })).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Not now" }))
    expect(screen.getByRole("heading", { name: "Start when you sign in" })).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Continue" }))
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "You're all set" })).toBeInTheDocument()
    )
  })

  it("navigates back from tour to welcome", async () => {
    render(<OnboardingApp />)
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Continue" }))
    await userEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(screen.getByRole("heading", { name: "Welcome to UsagePal" })).toBeInTheDocument()
  })

  it("hides the back button on the done step", async () => {
    render(<OnboardingApp />)
    await goToDone()
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument()
  })

  it("dismisses with Escape like skip: finishes and opens the app", async () => {
    render(<OnboardingApp />)
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(state.invokeMock).toHaveBeenCalledWith("finish_onboarding", { openSettings: false })
    )
  })

  it("saves the selected alerts when permission is granted", async () => {
    state.invokeMock.mockResolvedValueOnce("granted")
    render(<OnboardingApp />)
    await goToNotifications()

    await userEvent.click(screen.getByRole("checkbox", { name: /Almost Out/ }))
    await userEvent.click(screen.getByRole("checkbox", { name: /Session Reset/ }))
    await userEvent.click(screen.getByRole("button", { name: "Enable notifications" }))

    expect(state.invokeMock).toHaveBeenCalledWith("request_notification_permission")
    await waitFor(() =>
      expect(state.savePaceNotificationSettingsMock).toHaveBeenCalledWith({
        underTenPercent: true,
        healthyToClose: false,
        closeToRunningOut: true,
        sessionReset: false,
      })
    )
    expect(screen.getByRole("heading", { name: "Start when you sign in" })).toBeInTheDocument()
  })

  it("does not save alerts when permission is denied", async () => {
    state.invokeMock.mockResolvedValueOnce("denied")
    render(<OnboardingApp />)
    await goToNotifications()

    await userEvent.click(screen.getByRole("button", { name: "Enable notifications" }))

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Start when you sign in" })).toBeInTheDocument()
    )
    expect(state.savePaceNotificationSettingsMock).not.toHaveBeenCalled()
  })

  it("logs and advances when the permission request fails", async () => {
    const error = new Error("permission failed")
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    state.invokeMock.mockRejectedValueOnce(error)
    render(<OnboardingApp />)
    await goToNotifications()

    await userEvent.click(screen.getByRole("button", { name: "Enable notifications" }))

    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith("Failed to request notification permission:", error)
    )
    expect(state.savePaceNotificationSettingsMock).not.toHaveBeenCalled()
    expect(screen.getByRole("heading", { name: "Start when you sign in" })).toBeInTheDocument()
  })

  it("applies start on login when left on", async () => {
    render(<OnboardingApp />)
    await goToLogin()

    await userEvent.click(screen.getByRole("button", { name: "Continue" }))

    await waitFor(() => expect(state.saveStartOnLoginMock).toHaveBeenCalledWith(true))
    expect(state.enableMock).toHaveBeenCalled()
    expect(screen.getByRole("heading", { name: "You're all set" })).toBeInTheDocument()
  })

  it("saves start on login off without touching autostart", async () => {
    render(<OnboardingApp />)
    await goToLogin()

    await userEvent.click(screen.getByRole("switch", { name: /Start UsagePal at login/ }))
    await userEvent.click(screen.getByRole("button", { name: "Continue" }))

    await waitFor(() => expect(state.saveStartOnLoginMock).toHaveBeenCalledWith(false))
    expect(state.enableMock).not.toHaveBeenCalled()
  })

  it("does not call native autostart outside Tauri", async () => {
    state.isTauriMock.mockReturnValue(false)
    render(<OnboardingApp />)
    await goToLogin()

    await userEvent.click(screen.getByRole("button", { name: "Continue" }))

    await waitFor(() => expect(state.saveStartOnLoginMock).toHaveBeenCalledWith(true))
    expect(state.enableMock).not.toHaveBeenCalled()
  })

  it("logs and advances when autostart fails", async () => {
    const error = new Error("autostart failed")
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    state.enableMock.mockRejectedValueOnce(error)
    render(<OnboardingApp />)
    await goToLogin()

    await userEvent.click(screen.getByRole("button", { name: "Continue" }))

    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith("Failed to apply start at login:", error)
    )
    expect(screen.getByRole("heading", { name: "You're all set" })).toBeInTheDocument()
  })

  it("hides back and disables actions while the permission request is pending", async () => {
    const permission = deferred<string>()
    state.invokeMock.mockReturnValueOnce(permission.promise)
    render(<OnboardingApp />)
    await goToNotifications()

    await userEvent.click(screen.getByRole("button", { name: "Enable notifications" }))

    expect(screen.getByRole("button", { name: "Not now" })).toBeDisabled()
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument()

    permission.resolve("granted")
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Start when you sign in" })).toBeInTheDocument()
    )
  })

  it("shows the configured summary on the done step", async () => {
    state.invokeMock.mockResolvedValueOnce("granted")
    render(<OnboardingApp />)
    await goToNotifications()

    await userEvent.click(screen.getByRole("button", { name: "Enable notifications" }))
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Start when you sign in" })).toBeInTheDocument()
    )
    await userEvent.click(screen.getByRole("button", { name: "Continue" }))

    // The done step runs its provider scan (~900ms) before the summary card shows.
    await waitFor(() => expect(screen.getByText("2 alerts on")).toBeInTheDocument(), {
      timeout: 3000,
    })
    expect(screen.getByText("Starts when you sign in")).toBeInTheDocument()
  })

  it("skips setup from the welcome step", async () => {
    render(<OnboardingApp />)
    await userEvent.click(screen.getByRole("button", { name: "Skip setup" }))
    expect(state.invokeMock).toHaveBeenCalledWith("finish_onboarding", { openSettings: false })
  })

  it("finishes into settings", async () => {
    render(<OnboardingApp />)
    await goToDone()
    await userEvent.click(screen.getByRole("button", { name: "Open Settings" }))
    expect(state.invokeMock).toHaveBeenCalledWith("finish_onboarding", { openSettings: true })
  })

  it("finishes into UsagePal", async () => {
    render(<OnboardingApp />)
    await goToDone()
    await userEvent.click(screen.getByRole("button", { name: "Open UsagePal" }))
    expect(state.invokeMock).toHaveBeenCalledWith("finish_onboarding", { openSettings: false })
  })

  it("logs when finishing onboarding fails", async () => {
    const error = new Error("finish failed")
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    state.invokeMock.mockRejectedValueOnce(error)
    render(<OnboardingApp />)

    await userEvent.click(screen.getByRole("button", { name: "Skip setup" }))

    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith("Failed to finish onboarding:", error))
    expect(screen.getByRole("button", { name: "Skip setup" })).not.toBeDisabled()
  })
})
