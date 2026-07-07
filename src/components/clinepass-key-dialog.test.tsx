import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: state.invokeMock,
  isTauri: () => true,
}))

import { ClinePassKeyDialog } from "./clinepass-key-dialog"

const routeInvoke = (status: { saved: boolean; fromEnv: boolean }) => {
  state.invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "clinepass_key_status") return status
    return undefined
  })
}

describe("ClinePassKeyDialog", () => {
  beforeEach(() => {
    state.invokeMock.mockReset()
    routeInvoke({ saved: false, fromEnv: false })
  })

  it("shows the empty-state copy and no Clear button when no key is set", async () => {
    render(<ClinePassKeyDialog onClose={vi.fn()} onSaved={vi.fn()} />)
    await waitFor(() => expect(state.invokeMock).toHaveBeenCalledWith("clinepass_key_status"))
    expect(screen.getByText(/without the Cline app installed/i)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull()
  })

  it("notes an environment key when present but unsaved", async () => {
    routeInvoke({ saved: false, fromEnv: true })
    render(<ClinePassKeyDialog onClose={vi.fn()} onSaved={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/from your environment/i)).toBeTruthy())
  })

  it("saves a pasted key and fires onSaved", async () => {
    const onClose = vi.fn()
    const onSaved = vi.fn()
    render(<ClinePassKeyDialog onClose={onClose} onSaved={onSaved} />)
    await waitFor(() => expect(state.invokeMock).toHaveBeenCalledWith("clinepass_key_status"))

    await userEvent.type(screen.getByLabelText("ClinePass API key"), "cline-key-abc")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(state.invokeMock).toHaveBeenCalledWith("save_clinepass_key", { key: "cline-key-abc" })
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
  })

  it("clears a saved key and shows a Clear button", async () => {
    routeInvoke({ saved: true, fromEnv: false })
    render(<ClinePassKeyDialog onClose={vi.fn()} onSaved={vi.fn()} />)
    const clear = await screen.findByRole("button", { name: "Clear" })
    routeInvoke({ saved: false, fromEnv: false })
    await userEvent.click(clear)
    await waitFor(() => expect(state.invokeMock).toHaveBeenCalledWith("clear_clinepass_key"))
  })

  it("keeps Save disabled until a key is entered", async () => {
    render(<ClinePassKeyDialog onClose={vi.fn()} onSaved={vi.fn()} />)
    const save = await screen.findByRole("button", { name: "Save" })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(screen.getByLabelText("ClinePass API key"), "cline-key")
    expect((save as HTMLButtonElement).disabled).toBe(false)
  })
})
