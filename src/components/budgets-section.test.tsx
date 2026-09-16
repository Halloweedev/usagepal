import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PluginMeta } from "@/lib/plugin-types"

const { fakeStoreData } = vi.hoisted(() => ({
  fakeStoreData: new Map<string, unknown>(),
}))

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async get(key: string) {
      return fakeStoreData.get(key)
    }
    async set(key: string, value: unknown) {
      fakeStoreData.set(key, value)
    }
    async save() {}
  },
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  isTauri: () => false,
}))

import { BudgetEditors } from "./budgets-section"
import { useAppBudgetsStore } from "@/stores/app-budgets-store"
import { useAppPluginStore } from "@/stores/app-plugin-store"

const CLAUDE_META = {
  id: "claude",
  name: "Claude",
  iconUrl: "",
  brandColor: null,
  lines: [],
  links: [],
  detected: true,
} as unknown as PluginMeta

function seedProviders() {
  useAppPluginStore.getState().setPluginsMeta([CLAUDE_META])
  useAppPluginStore.getState().setPluginSettings({ order: ["claude"], disabled: [] })
}

describe("BudgetEditors", () => {
  beforeEach(() => {
    fakeStoreData.clear()
    useAppBudgetsStore.getState().resetState()
    useAppPluginStore.getState().resetState()
    seedProviders()
  })

  it("lists enabled providers with empty budget inputs", async () => {
    render(<BudgetEditors />)

    expect(await screen.findByText("Usage Budgets")).toBeInTheDocument()
    expect(screen.getByLabelText("Claude budget percent")).toHaveValue(null)
  })

  it("commits a typed budget on blur and persists it", async () => {
    render(<BudgetEditors />)
    const input = await screen.findByLabelText("Claude budget percent")

    await userEvent.clear(input)
    await userEvent.type(input, "20")
    input.blur()

    await waitFor(() => {
      expect(useAppBudgetsStore.getState().budgets).toEqual({ claude: 20 })
    })
    expect(fakeStoreData.get("budgets")).toEqual({ claude: 20 })
  })

  it("applies a quick preset on click", async () => {
    render(<BudgetEditors />)

    await userEvent.click(await screen.findByRole("button", { name: "Set Claude budget to 20 percent" }))

    await waitFor(() => {
      expect(useAppBudgetsStore.getState().budgets).toEqual({ claude: 20 })
    })
  })

  it("reverts invalid input to the stored value", async () => {
    fakeStoreData.set("budgets", { claude: 20 })
    render(<BudgetEditors />)
    const input = await screen.findByLabelText("Claude budget percent")

    await waitFor(() => expect(input).toHaveValue(20))
    await userEvent.clear(input)
    await userEvent.type(input, "999")
    input.blur()

    await waitFor(() => expect(input).toHaveValue(20))
    expect(useAppBudgetsStore.getState().budgets).toEqual({ claude: 20 })
  })

  it("shows a hint when no providers are enabled", async () => {
    useAppPluginStore.getState().setPluginSettings({ order: ["claude"], disabled: ["claude"] })
    render(<BudgetEditors />)

    expect(await screen.findByText(/No providers enabled yet/)).toBeInTheDocument()
  })
})
