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

import { OpenRouterKeyDialog } from "./openrouter-key-dialog"

const routeInvoke = (status: { saved: boolean; fromEnv: boolean }) => {
  state.invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "openrouter_key_status") return status
    return undefined
  })
}

describe("OpenRouterKeyDialog", () => {
  beforeEach(() => {
    state.invokeMock.mockReset()
    state.openUrlMock.mockReset()
    routeInvoke({ saved: false, fromEnv: false })
  })

  it("shows the empty-state hint and no Clear button when no key is set", async () => {
    render(<OpenRouterKeyDialog onClose={vi.fn()} onSaved={vi.fn()} />)
    await waitFor(() => expect(state.invokeMock).toHaveBeenCalledWith("openrouter_key_status"))
    expect(screen.getByText(/Paste your key/i)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull()
  })

  it("notes an environment key when present but unsaved", async () => {
    routeInvoke({ saved: false, fromEnv: true })
    render(<OpenRouterKeyDialog onClose={vi.fn()} onSaved={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/from your environment/i)).toBeTruthy())
  })

  it("saves a pasted key and fires onSaved (not onClose)", async () => {
    const onClose = vi.fn()
    const onSaved = vi.fn()
    render(<OpenRouterKeyDialog onClose={onClose} onSaved={onSaved} />)
    await waitFor(() => expect(state.invokeMock).toHaveBeenCalledWith("openrouter_key_status"))

    await userEvent.type(screen.getByLabelText("OpenRouter API key"), "sk-or-v1-abc")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(state.invokeMock).toHaveBeenCalledWith("save_openrouter_key", { key: "sk-or-v1-abc" })
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
  })

  it("clears a saved key and shows a Clear button", async () => {
    routeInvoke({ saved: true, fromEnv: false })
    render(<OpenRouterKeyDialog onClose={vi.fn()} onSaved={vi.fn()} />)
    const clear = await screen.findByRole("button", { name: "Clear" })
    routeInvoke({ saved: false, fromEnv: false })
    await userEvent.click(clear)
    await waitFor(() => expect(state.invokeMock).toHaveBeenCalledWith("clear_openrouter_key"))
  })

  it("keeps Save disabled until a key is entered", async () => {
    render(<OpenRouterKeyDialog onClose={vi.fn()} onSaved={vi.fn()} />)
    const save = await screen.findByRole("button", { name: "Save" })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(screen.getByLabelText("OpenRouter API key"), "sk")
    expect((save as HTMLButtonElement).disabled).toBe(false)
  })

  it("fires onClose (dismiss) on Cancel", async () => {
    const onClose = vi.fn()
    const onSaved = vi.fn()
    render(<OpenRouterKeyDialog onClose={onClose} onSaved={onSaved} />)
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }))
    expect(onClose).toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })
})
