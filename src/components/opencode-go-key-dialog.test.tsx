import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openUrlMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: state.invokeMock,
  isTauri: () => true,
}))

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: state.openUrlMock,
}))

import { OpenCodeGoKeyDialog } from "./opencode-go-key-dialog"

function routeStatus(status = { saved: false, fromOpenCode: false, fromEnv: false }) {
  state.invokeMock.mockImplementation(async (command: string) => {
    if (command === "opencode_go_key_status") return status
    return undefined
  })
}

describe("OpenCodeGoKeyDialog", () => {
  beforeEach(() => {
    state.invokeMock.mockReset()
    state.openUrlMock.mockReset()
    routeStatus()
  })

  it("saves an explicit key", async () => {
    const onSaved = vi.fn()
    render(<OpenCodeGoKeyDialog onClose={vi.fn()} onSaved={onSaved} />)
    await userEvent.type(screen.getByLabelText("OpenCode Go API key"), "go-key")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      expect(state.invokeMock).toHaveBeenCalledWith("save_opencode_go_key", { key: "go-key" })
    })
    expect(onSaved).toHaveBeenCalled()
  })

  it("can use the key from an existing OpenCode login", async () => {
    const onSaved = vi.fn()
    routeStatus({ saved: false, fromOpenCode: true, fromEnv: false })
    render(<OpenCodeGoKeyDialog onClose={vi.fn()} onSaved={onSaved} />)

    expect(await screen.findByText("Using the key from your OpenCode login.")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Use Existing Key" }))
    expect(onSaved).toHaveBeenCalled()
  })

  it("clears only a UsagePal-saved key", async () => {
    routeStatus({ saved: true, fromOpenCode: true, fromEnv: false })
    render(<OpenCodeGoKeyDialog onClose={vi.fn()} onSaved={vi.fn()} />)
    await userEvent.click(await screen.findByRole("button", { name: "Clear" }))
    await waitFor(() => expect(state.invokeMock).toHaveBeenCalledWith("clear_opencode_go_key"))
  })

  it("can reuse a UsagePal-saved key when re-enabling", async () => {
    const onSaved = vi.fn()
    routeStatus({ saved: true, fromOpenCode: false, fromEnv: false })
    render(<OpenCodeGoKeyDialog onClose={vi.fn()} onSaved={onSaved} />)

    await userEvent.click(await screen.findByRole("button", { name: "Use Existing Key" }))
    expect(onSaved).toHaveBeenCalled()
  })
})
