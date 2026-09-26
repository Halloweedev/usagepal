import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"

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

import { BudgetsPage } from "./budgets"
import { addDaysKey, localDayKey } from "@/lib/pace-notifications"
import { useAppBudgetsStore } from "@/stores/app-budgets-store"
import { useAppNotificationsStore } from "@/stores/app-notifications-store"

function pluginWithMeters(
  id: string,
  name: string,
  meters: { label: string; used: number; limit: number }[]
): DisplayPluginState {
  return {
    meta: {
      id,
      name,
      iconUrl: "",
      brandColor: null,
      lines: [],
      links: [],
      detected: true,
    } as unknown as DisplayPluginState["meta"],
    data: {
      providerId: id,
      accountId: null,
      displayName: name,
      plan: null,
      iconUrl: "",
      lines: meters.map((m) => ({
        type: "progress",
        label: m.label,
        used: m.used,
        limit: m.limit,
        format: { kind: "percent" },
      })),
    } as unknown as DisplayPluginState["data"],
    loading: false,
    error: null,
    lastManualRefreshAt: null,
    lastUpdatedAt: null,
  }
}

function entry(percent: number, day: string, baselines: Record<string, number> = {}) {
  return { percent, day, baselines, setAt: 1 }
}

describe("BudgetsPage", () => {
  beforeEach(() => {
    fakeStoreData.clear()
    useAppBudgetsStore.getState().resetState()
    useAppNotificationsStore.getState().resetState()
  })

  it("explains planning and lists each provider with its meters", async () => {
    render(
      <BudgetsPage
        plugins={[pluginWithMeters("claude", "Claude", [{ label: "Weekly", used: 12, limit: 100 }])]}
      />
    )

    expect(await screen.findByRole("heading", { name: "Budgets" })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Budget day" })).toBeInTheDocument()
    expect(screen.getByText("Claude")).toBeInTheDocument()
    expect(screen.getByText("Weekly")).toBeInTheDocument()
    expect(screen.getByText("12% used")).toBeInTheDocument()
  })

  it("measures today's growth from the set-time snapshot", async () => {
    fakeStoreData.set("budgets", {
      claude: { [localDayKey()]: entry(20, localDayKey(), { "claude:Weekly": 0.1 }) },
    })
    render(
      <BudgetsPage
        plugins={[pluginWithMeters("claude", "Claude", [{ label: "Weekly", used: 34, limit: 100 }])]}
      />
    )

    expect(await screen.findByText("Over budget — 24% of 20% today")).toBeInTheDocument()
  })

  it("shows the on-track state below the budget", async () => {
    fakeStoreData.set("budgets", {
      claude: { [localDayKey()]: entry(20, localDayKey(), { "claude:Weekly": 0.1 }) },
    })
    render(
      <BudgetsPage
        plugins={[pluginWithMeters("claude", "Claude", [{ label: "Weekly", used: 22, limit: 100 }])]}
      />
    )

    expect(await screen.findByText("12% of 20% today")).toBeInTheDocument()
  })

  it("treats yesterday's budget as expired", async () => {
    fakeStoreData.set("budgets", {
      claude: { "2000-01-01": entry(20, "2000-01-01", { "claude:Weekly": 0.1 }) },
    })
    render(
      <BudgetsPage
        plugins={[pluginWithMeters("claude", "Claude", [{ label: "Weekly", used: 90, limit: 100 }])]}
      />
    )

    expect(await screen.findByText("90% used")).toBeInTheDocument()
    expect(screen.getByLabelText("Claude budget percent")).toHaveValue(null)
  })

  it("plans a future day without disturbing today", async () => {
    const tomorrow = addDaysKey(new Date(), 1)
    render(
      <BudgetsPage
        plugins={[pluginWithMeters("claude", "Claude", [{ label: "Weekly", used: 12, limit: 100 }])]}
      />
    )

    // Switch to tomorrow: empty input, meters shown for context.
    const dayGroup = await screen.findByRole("group", { name: "Budget day" })
    await userEvent.click(within(dayGroup).getAllByRole("button")[1])
    expect(screen.getByLabelText("Claude budget percent")).toHaveValue(null)
    expect(screen.getByText("12% used")).toBeInTheDocument()

    // Set tomorrow's budget: stored under tomorrow with no snapshot yet.
    const input = screen.getByLabelText("Claude budget percent")
    await userEvent.clear(input)
    await userEvent.type(input, "10")
    input.blur()

    await waitFor(() => {
      expect(useAppBudgetsStore.getState().budgets.claude?.[tomorrow]).toMatchObject({
        percent: 10,
        day: tomorrow,
        baselines: {},
      })
    })
    // Today stays untouched.
    expect(useAppBudgetsStore.getState().budgets.claude?.[localDayKey()]).toBeUndefined()
    expect(await screen.findByText(/Planned for/)).toBeInTheDocument()
  })

  it("toggles the Over Budget alerts master switch and persists it", async () => {
    render(<BudgetsPage plugins={[]} />)

    const checkbox = await screen.findByRole("checkbox", { name: /Over Budget alerts/ })
    expect(checkbox).not.toBeChecked()

    await userEvent.click(checkbox)

    await waitFor(() => {
      expect(useAppNotificationsStore.getState().settings.budgetExceeded).toBe(true)
    })
    expect(fakeStoreData.get("paceNotifications")).toMatchObject({ budgetExceeded: true })
  })

  it("commits a typed budget with a usage snapshot and persists it", async () => {
    render(
      <BudgetsPage
        plugins={[pluginWithMeters("claude", "Claude", [{ label: "Weekly", used: 12, limit: 100 }])]}
      />
    )
    const input = await screen.findByLabelText("Claude budget percent")

    await userEvent.clear(input)
    await userEvent.type(input, "20")
    input.blur()

    await waitFor(() => {
      expect(useAppBudgetsStore.getState().budgets.claude?.[localDayKey()]).toMatchObject({
        percent: 20,
        day: localDayKey(),
        baselines: { "claude:Weekly": 0.12 },
      })
    })
    expect(fakeStoreData.get("budgets")).toEqual(useAppBudgetsStore.getState().budgets)
    expect(await screen.findByText(/Set today at/)).toBeInTheDocument()
  })

  it("applies a quick preset on click", async () => {
    render(
      <BudgetsPage
        plugins={[pluginWithMeters("claude", "Claude", [{ label: "Weekly", used: 12, limit: 100 }])]}
      />
    )

    await userEvent.click(await screen.findByRole("button", { name: "Set Claude budget to 20 percent" }))

    await waitFor(() => {
      expect(useAppBudgetsStore.getState().budgets.claude?.[localDayKey()]).toMatchObject({
        percent: 20,
        day: localDayKey(),
        baselines: { "claude:Weekly": 0.12 },
      })
    })
  })

  it("steps the budget up and down in fives", async () => {
    render(
      <BudgetsPage
        plugins={[pluginWithMeters("claude", "Claude", [{ label: "Weekly", used: 12, limit: 100 }])]}
      />
    )

    // From empty, plus starts a budget; minus does nothing.
    await userEvent.click(await screen.findByRole("button", { name: "Increase Claude budget" }))
    await waitFor(() => {
      expect(useAppBudgetsStore.getState().budgets.claude?.[localDayKey()]?.percent).toBe(5)
    })

    await userEvent.click(screen.getByRole("button", { name: "Increase Claude budget" }))
    await waitFor(() => {
      expect(useAppBudgetsStore.getState().budgets.claude?.[localDayKey()]?.percent).toBe(10)
    })

    await userEvent.click(screen.getByRole("button", { name: "Decrease Claude budget" }))
    await waitFor(() => {
      expect(useAppBudgetsStore.getState().budgets.claude?.[localDayKey()]?.percent).toBe(5)
    })
  })

  it("clamps stepping to a real budget", async () => {
    fakeStoreData.set("budgets", {
      claude: { [localDayKey()]: { percent: 98, day: localDayKey(), baselines: {}, setAt: 1 } },
    })
    render(
      <BudgetsPage
        plugins={[pluginWithMeters("claude", "Claude", [{ label: "Weekly", used: 12, limit: 100 }])]}
      />
    )

    await userEvent.click(await screen.findByRole("button", { name: "Increase Claude budget" }))
    await waitFor(() => {
      expect(useAppBudgetsStore.getState().budgets.claude?.[localDayKey()]?.percent).toBe(100)
    })
  })

  it("shows a waiting state when usage has not loaded yet", async () => {
    const plugin = pluginWithMeters("claude", "Claude", [])
    render(<BudgetsPage plugins={[{ ...plugin, data: null }]} />)

    expect(await screen.findByText("Waiting for usage…")).toBeInTheDocument()
  })

  it("shows a hint when no providers are enabled", async () => {
    render(<BudgetsPage plugins={[]} />)

    expect(await screen.findByText(/No providers enabled yet/)).toBeInTheDocument()
  })
})
