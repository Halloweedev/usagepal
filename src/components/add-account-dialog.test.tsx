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

import { AddClaudeAccountDialog } from "./add-account-dialog"

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
