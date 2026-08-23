import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { storeData } = vi.hoisted(() => ({ storeData: new Map<string, unknown>() }))

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async get(key: string) {
      return storeData.get(key)
    }
    async set(key: string, value: unknown) {
      storeData.set(key, value)
    }
    async save() {}
  },
}))

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

import { useAccounts } from "@/hooks/app/use-accounts"
import { saveAccounts } from "@/lib/settings"

describe("useAccounts — default account rename", () => {
  beforeEach(() => {
    storeData.clear()
  })

  it("propagates a rename to every mounted instance", async () => {
    // The app runs two instances: one for the overview/cards, one for the
    // settings dialog. Seed a registered account so the Default page exists.
    await saveAccounts({ codex: [{ accountId: "w1", label: "Work", order: 0 }] })
    const home = renderHook(() => useAccounts())
    const settings = renderHook(() => useAccounts())

    await waitFor(() =>
      expect(settings.result.current.accountsByProvider.codex).toHaveLength(1)
    )

    act(() => {
      settings.result.current.renameDefaultAccount("codex", "Personal")
    })

    // The overview's instance must pick up the new name without any manual
    // refresh — this is the regression behind cards stuck on "Default".
    await waitFor(() => {
      expect(home.result.current.defaultLabels).toEqual({ codex: "Personal" })
    })
    expect(settings.result.current.defaultLabels).toEqual({ codex: "Personal" })
  })
})
