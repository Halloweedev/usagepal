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

import { ApiKeysSection } from "./api-keys-section"

// Route invoke by command name; default status has no key anywhere.
const routeInvoke = (status: { saved: boolean; fromEnv: boolean }) => {
  state.invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "openrouter_key_status") return status
    return undefined
  })
}

describe("ApiKeysSection", () => {
  beforeEach(() => {
    state.invokeMock.mockReset()
    state.openUrlMock.mockReset()
    routeInvoke({ saved: false, fromEnv: false })
  })

  it("shows the empty state and no Clear button when no key is set", async () => {
    render(<ApiKeysSection />)
    await waitFor(() => expect(state.invokeMock).toHaveBeenCalledWith("openrouter_key_status"))
    expect(screen.getByText(/No key set/i)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull()
  })

  it("notes an environment key when present but unsaved", async () => {
    routeInvoke({ saved: false, fromEnv: true })
    render(<ApiKeysSection />)
    await waitFor(() => expect(screen.getByText(/from your environment/i)).toBeTruthy())
  })

  it("saves a pasted key and refreshes status", async () => {
    render(<ApiKeysSection />)
    await waitFor(() => expect(state.invokeMock).toHaveBeenCalledWith("openrouter_key_status"))

    const input = screen.getByLabelText("OpenRouter API key")
    await userEvent.type(input, "sk-or-v1-abc")
    // After saving, status reports a saved key.
    routeInvoke({ saved: true, fromEnv: false })
    await userEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(state.invokeMock).toHaveBeenCalledWith("save_openrouter_key", { key: "sk-or-v1-abc" })
    )
    await waitFor(() => expect(screen.getByText(/Key saved/i)).toBeTruthy())
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy()
  })

  it("clears a saved key", async () => {
    routeInvoke({ saved: true, fromEnv: false })
    render(<ApiKeysSection />)
    const clear = await screen.findByRole("button", { name: "Clear" })
    routeInvoke({ saved: false, fromEnv: false })
    await userEvent.click(clear)
    await waitFor(() => expect(state.invokeMock).toHaveBeenCalledWith("clear_openrouter_key"))
  })

  it("keeps Save disabled until a key is entered", async () => {
    render(<ApiKeysSection />)
    const save = await screen.findByRole("button", { name: "Save" })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(screen.getByLabelText("OpenRouter API key"), "sk")
    expect((save as HTMLButtonElement).disabled).toBe(false)
  })
})
