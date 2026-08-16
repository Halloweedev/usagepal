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

import { AddClaudeAccountDialog, AddOpenCodeGoAccountDialog } from "./add-account-dialog"

describe("AddClaudeAccountDialog", () => {
  beforeEach(() => {
    state.invokeMock.mockReset()
    state.invokeMock.mockResolvedValue({ accountId: "a1" })
  })

  it("saves the token + label and reports the new accountId", async () => {
    const onSaved = vi.fn()
    render(<AddClaudeAccountDialog onClose={() => {}} onSaved={onSaved} />)
    await userEvent.type(screen.getByLabelText(/label/i), "Work")
    await userEvent.type(screen.getByLabelText(/setup token/i), "sk-ant-oat01-XYZ")
    await userEvent.click(screen.getByRole("button", { name: /add account/i }))

    await waitFor(() =>
      expect(state.invokeMock).toHaveBeenCalledWith("save_claude_account", {
        label: "Work",
        setupToken: "sk-ant-oat01-XYZ",
      })
    )
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith("claude", { accountId: "a1", label: "Work" })
    )
  })
})

describe("AddOpenCodeGoAccountDialog", () => {
  beforeEach(() => {
    state.invokeMock.mockReset()
    state.invokeMock.mockResolvedValue({ accountId: "a2" })
  })

  it("saves the API key + label and reports the new accountId", async () => {
    const onSaved = vi.fn()
    render(<AddOpenCodeGoAccountDialog onClose={() => {}} onSaved={onSaved} />)
    await userEvent.type(screen.getByLabelText(/label/i), "Personal")
    await userEvent.type(screen.getByLabelText(/api key/i), "opck-abc123")
    await userEvent.click(screen.getByRole("button", { name: /add account/i }))

    await waitFor(() =>
      expect(state.invokeMock).toHaveBeenCalledWith("save_opencode_go_account", {
        label: "Personal",
        apiKey: "opck-abc123",
      })
    )
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith("opencode-go", { accountId: "a2", label: "Personal" })
    )
  })
})
