import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAutoProbeAccounts } from "@/hooks/app/use-auto-probe-accounts"
import type { PluginState } from "@/hooks/app/types"
import type { AccountsByProvider } from "@/lib/settings"

const emptyState = (): PluginState => ({
  data: null,
  loading: false,
  error: null,
  lastManualRefreshAt: null,
  lastUpdatedAt: null,
})

type Props = {
  accts: AccountsByProvider
  states: Record<string, PluginState>
}

function mountHook(initial: Props, startBatch = vi.fn().mockResolvedValue(undefined), setLoadingForPlugins = vi.fn()) {
  const view = renderHook(
    ({ accts, states }: Props) =>
      useAutoProbeAccounts({ accountsByProvider: accts, pluginStates: states, startBatch, setLoadingForPlugins }),
    { initialProps: initial }
  )
  return { ...view, startBatch, setLoadingForPlugins }
}

describe("useAutoProbeAccounts", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("does NOT probe accounts restored at startup, even before they have state", () => {
    // Regression: useAccounts starts {} and loads async, so accounts arrive a
    // tick after mount. They must be baselined, not treated as freshly added —
    // re-probing them on every launch is what blanked Codex cards to 0.
    const { rerender, startBatch, setLoadingForPlugins } = mountHook({ accts: {}, states: {} })

    act(() => {
      rerender({
        accts: {
          codex: [
            { accountId: "a", label: "A", order: 0 },
            { accountId: "b", label: "B", order: 1 },
          ],
        },
        states: {},
      })
    })

    expect(startBatch).not.toHaveBeenCalled()
    expect(setLoadingForPlugins).not.toHaveBeenCalled()
  })

  it("probes a provider when an account is added after the startup window", () => {
    const restored: AccountsByProvider = { codex: [{ accountId: "a", label: "A", order: 0 }] }
    const { rerender, startBatch, setLoadingForPlugins } = mountHook({
      accts: restored,
      states: { "codex::a": emptyState() },
    })

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    act(() => {
      rerender({
        accts: {
          codex: [restored.codex[0], { accountId: "b", label: "B", order: 1 }],
        },
        states: { "codex::a": emptyState() },
      })
    })

    expect(startBatch).toHaveBeenCalledWith(["codex"])
    expect(setLoadingForPlugins).toHaveBeenCalledWith(["codex::b"])
  })

  it("does NOT probe an account that already has state, even after the window", () => {
    const { rerender, startBatch, setLoadingForPlugins } = mountHook({ accts: {}, states: {} })

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    act(() => {
      rerender({
        accts: { codex: [{ accountId: "a", label: "A", order: 0 }] },
        states: { "codex::a": emptyState() },
      })
    })

    expect(startBatch).not.toHaveBeenCalled()
    expect(setLoadingForPlugins).not.toHaveBeenCalled()
  })
})
