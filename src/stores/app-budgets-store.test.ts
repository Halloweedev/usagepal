import { beforeEach, describe, expect, it, vi } from "vitest"

const { loadBudgetMapMock, saveBudgetMapMock } = vi.hoisted(() => ({
  loadBudgetMapMock: vi.fn(),
  saveBudgetMapMock: vi.fn(),
}))

vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings")
  return {
    ...actual,
    loadBudgetMap: loadBudgetMapMock,
    saveBudgetMap: saveBudgetMapMock,
  }
})

import { useAppBudgetsStore } from "@/stores/app-budgets-store"

describe("app budgets store", () => {
  beforeEach(() => {
    loadBudgetMapMock.mockReset()
    saveBudgetMapMock.mockReset()
    loadBudgetMapMock.mockResolvedValue({})
    saveBudgetMapMock.mockResolvedValue(undefined)
    useAppBudgetsStore.getState().resetState()
  })

  it("starts with empty budgets and unhydrated", () => {
    expect(useAppBudgetsStore.getState().budgets).toEqual({})
    expect(useAppBudgetsStore.getState().hydrated).toBe(false)
  })

  it("hydrates from persisted budgets", async () => {
    loadBudgetMapMock.mockResolvedValue({ claude: 20 })

    await useAppBudgetsStore.getState().hydrate()

    expect(useAppBudgetsStore.getState().budgets).toEqual({ claude: 20 })
    expect(useAppBudgetsStore.getState().hydrated).toBe(true)
  })

  it("hydrates once when called repeatedly", async () => {
    await useAppBudgetsStore.getState().hydrate()
    await useAppBudgetsStore.getState().hydrate()

    expect(loadBudgetMapMock).toHaveBeenCalledTimes(1)
  })

  it("marks hydrated even when load fails, without throwing", async () => {
    loadBudgetMapMock.mockRejectedValue(new Error("boom"))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await useAppBudgetsStore.getState().hydrate()

    expect(useAppBudgetsStore.getState().hydrated).toBe(true)
    expect(useAppBudgetsStore.getState().budgets).toEqual({})
    errorSpy.mockRestore()
  })

  it("sets a provider budget and persists", () => {
    useAppBudgetsStore.getState().setBudget("claude", 20)

    expect(useAppBudgetsStore.getState().budgets).toEqual({ claude: 20 })
    expect(saveBudgetMapMock).toHaveBeenCalledWith({ claude: 20 })
  })

  it("clears a provider budget with null and persists", () => {
    useAppBudgetsStore.getState().setBudget("claude", 20)
    useAppBudgetsStore.getState().setBudget("claude", null)

    expect(useAppBudgetsStore.getState().budgets).toEqual({})
    expect(saveBudgetMapMock).toHaveBeenLastCalledWith({})
  })

  it("drops out-of-range budgets instead of storing them", () => {
    useAppBudgetsStore.getState().setBudget("claude", 150)

    expect(useAppBudgetsStore.getState().budgets).toEqual({})
    expect(saveBudgetMapMock).toHaveBeenCalledWith({})
  })
})
