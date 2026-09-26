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

import { localDayKey } from "@/lib/pace-notifications"
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
    const entry = { percent: 20, day: localDayKey(), baselines: { "claude:Weekly": 0.1 }, setAt: 1 }
    loadBudgetMapMock.mockResolvedValue({ claude: { [localDayKey()]: entry } })

    await useAppBudgetsStore.getState().hydrate()

    expect(useAppBudgetsStore.getState().budgets).toEqual({ claude: { [localDayKey()]: entry } })
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

  it("sets today's budget with a snapshot and persists", () => {
    const before = Date.now()
    useAppBudgetsStore.getState().setBudget("claude", 20, { "claude:Weekly": 0.1 })

    const budgets = useAppBudgetsStore.getState().budgets
    expect(budgets.claude?.[localDayKey()]).toMatchObject({
      percent: 20,
      day: localDayKey(),
      baselines: { "claude:Weekly": 0.1 },
    })
    expect(budgets.claude?.[localDayKey()]?.setAt).toBeGreaterThanOrEqual(before)
    expect(saveBudgetMapMock).toHaveBeenCalledWith(budgets)
  })

  it("sets a future day's budget without a snapshot", () => {
    const tomorrow = localDayKey(new Date(Date.now() + 24 * 60 * 60 * 1000))
    useAppBudgetsStore.getState().setBudget("claude", 10, undefined, tomorrow)

    expect(useAppBudgetsStore.getState().budgets).toEqual({
      claude: {
        [tomorrow]: {
          percent: 10,
          day: tomorrow,
          baselines: {},
          setAt: expect.any(Number),
        },
      },
    })
  })

  it("clears one day without touching the others", () => {
    const tomorrow = localDayKey(new Date(Date.now() + 24 * 60 * 60 * 1000))
    useAppBudgetsStore.getState().setBudget("claude", 20)
    useAppBudgetsStore.getState().setBudget("claude", 10, undefined, tomorrow)
    useAppBudgetsStore.getState().setBudget("claude", null)

    const budgets = useAppBudgetsStore.getState().budgets
    expect(budgets.claude?.[localDayKey()]).toBeUndefined()
    expect(budgets.claude?.[tomorrow]?.percent).toBe(10)
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
