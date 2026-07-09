import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PanelFooter } from "@/components/panel-footer"
import type { UpdateStatus } from "@/hooks/use-app-update"

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}))

const idle: UpdateStatus = { status: "idle" }
const noop = () => {}
const footerProps = { showAbout: false, onShowAbout: noop, onCloseAbout: noop, onUpdateCheck: noop, onUpdateChoice: noop }

describe("PanelFooter", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("shows countdown in minutes when >= 60 seconds", () => {
    const futureTime = Date.now() + 5 * 60 * 1000 // 5 minutes from now
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={futureTime}
        updateStatus={idle}
        onUpdateInstall={noop}
        {...footerProps}
      />
    )
    expect(screen.getByText("Next update in 5m")).toBeTruthy()
  })

  it("shows countdown in seconds when < 60 seconds", () => {
    const futureTime = Date.now() + 30 * 1000 // 30 seconds from now
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={futureTime}
        updateStatus={idle}
        onUpdateInstall={noop}
        {...footerProps}
      />
    )
    expect(screen.getByText("Next update in 30s")).toBeTruthy()
  })

  it("triggers refresh when clicking countdown label", async () => {
    const futureTime = Date.now() + 5 * 60 * 1000 // 5 minutes from now
    const onRefreshAll = vi.fn()
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={futureTime}
        updateStatus={idle}
        onUpdateInstall={noop}
        onRefreshAll={onRefreshAll}
        {...footerProps}
      />
    )
    const button = screen.getByRole("button", { name: /Next update in/i })
    await userEvent.click(button)
    expect(onRefreshAll).toHaveBeenCalledTimes(1)
  })

  it("does not add onboarding tip cards inside the footer", () => {
    const futureTime = Date.now() + 5 * 60 * 1000
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={futureTime}
        updateStatus={idle}
        onUpdateInstall={noop}
        onRefreshAll={noop}
        {...footerProps}
      />
    )

    expect(screen.queryByRole("note", { name: "Refresh Anytime" })).not.toBeInTheDocument()
  })

  it("automatically refreshes once when the countdown becomes overdue", () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const onRefreshAll = vi.fn()

    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={11_000}
        updateStatus={idle}
        onUpdateInstall={noop}
        onRefreshAll={onRefreshAll}
        {...footerProps}
      />
    )

    expect(onRefreshAll).not.toHaveBeenCalled()

    act(() => {
      vi.setSystemTime(11_000)
      vi.advanceTimersByTime(1000)
    })

    expect(onRefreshAll).toHaveBeenCalledTimes(1)

    act(() => {
      vi.setSystemTime(12_000)
      vi.advanceTimersByTime(1000)
    })

    expect(onRefreshAll).toHaveBeenCalledTimes(1)
  })

  it("shows Paused when autoUpdateNextAt is null", () => {
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={null}
        updateStatus={idle}
        onUpdateInstall={noop}
        {...footerProps}
      />
    )
    expect(screen.getByText("Paused")).toBeTruthy()
  })

  it("shows downloading state", () => {
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={null}
        updateStatus={{ status: "downloading", progress: 42 }}
        onUpdateInstall={noop}
        {...footerProps}
      />
    )
    expect(screen.getByText("Downloading update 42%")).toBeTruthy()
  })

  it("shows downloading state without percentage when progress is unknown", () => {
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={null}
        updateStatus={{ status: "downloading", progress: -1 }}
        onUpdateInstall={noop}
        {...footerProps}
      />
    )
    expect(screen.getByText("Downloading update...")).toBeTruthy()
  })

  it("shows restart button when ready", async () => {
    const onInstall = vi.fn()
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={null}
        updateStatus={{ status: "ready", channel: "stable", version: "0.7.29" }}
        onUpdateInstall={onInstall}
        {...footerProps}
      />
    )
    const button = screen.getByText("Restart to update")
    expect(button).toBeTruthy()
    await userEvent.click(button)
    expect(onInstall).toHaveBeenCalledTimes(1)
  })

  it("shows beta restart button when a beta update is ready", () => {
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={null}
        updateStatus={{ status: "ready", channel: "beta", version: "0.7.30-beta.1" }}
        onUpdateInstall={noop}
        {...footerProps}
      />
    )
    expect(screen.getByRole("button", { name: "Restart to update beta" })).toBeTruthy()
  })

  it("opens update choices when stable and beta updates are available", async () => {
    const onUpdateChoice = vi.fn()
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={null}
        updateStatus={{ status: "choice", stableVersion: "0.7.29", betaVersion: "0.7.30-beta.1" }}
        onUpdateInstall={noop}
        {...footerProps}
        onUpdateChoice={onUpdateChoice}
      />
    )

    await userEvent.click(screen.getByRole("button", { name: "Update available" }))
    await userEvent.click(screen.getByRole("button", { name: "Update to Stable v0.7.29" }))
    expect(onUpdateChoice).toHaveBeenCalledWith("stable")

    await userEvent.click(screen.getByRole("button", { name: "Update available" }))
    await userEvent.click(screen.getByRole("button", { name: "Update to Beta v0.7.30-beta.1" }))
    expect(onUpdateChoice).toHaveBeenCalledWith("beta")
  })

  it("shows retryable updates soon state for update check failures", async () => {
    const onUpdateCheck = vi.fn()
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={null}
        updateStatus={{ status: "error", message: "Update check failed" }}
        onUpdateInstall={noop}
        showAbout={false}
        onShowAbout={noop}
        onCloseAbout={noop}
        onUpdateCheck={onUpdateCheck}
      />
    )

    const retryButton = screen.getByRole("button", { name: "Updates soon" })
    expect(retryButton).toBeTruthy()
    await userEvent.click(retryButton)
    expect(onUpdateCheck).toHaveBeenCalledTimes(1)
  })

  it("shows error state for non-check failures", () => {
    const { container } = render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={null}
        updateStatus={{ status: "error", message: "Download failed" }}
        onUpdateInstall={noop}
        {...footerProps}
      />
    )
    expect(container.textContent).toContain("Update failed")
    expect(screen.queryByRole("button", { name: "Updates soon" })).toBeNull()
  })

  it("shows installing state", () => {
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={null}
        updateStatus={{ status: "installing" }}
        onUpdateInstall={noop}
        {...footerProps}
      />
    )
    expect(screen.getByText("Installing...")).toBeTruthy()
  })

  it("opens About dialog when clicking version in idle state", async () => {
    function Harness() {
      const [showAbout, setShowAbout] = useState(false)
      return (
        <PanelFooter
          version="0.0.0"
          autoUpdateNextAt={null}
          updateStatus={idle}
          onUpdateInstall={noop}
          showAbout={showAbout}
          onShowAbout={() => setShowAbout(true)}
          onCloseAbout={() => setShowAbout(false)}
          onUpdateCheck={noop}
          onUpdateChoice={noop}
        />
      )
    }

    render(<Harness />)
    await userEvent.click(screen.getByRole("button", { name: /UsagePal/ }))
    expect(screen.getByText(/Built by/)).toBeInTheDocument()

    // Close via Escape to exercise AboutDialog onClose path.
    await userEvent.keyboard("{Escape}")
    expect(screen.queryByText(/Built by/)).not.toBeInTheDocument()
  })
})
