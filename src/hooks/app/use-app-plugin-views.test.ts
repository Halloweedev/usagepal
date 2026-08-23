import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useAppPluginViews } from "@/hooks/app/use-app-plugin-views"
import type { PluginMeta } from "@/lib/plugin-types"
import type { PluginSettings } from "@/lib/settings"

function createPluginMeta(id: string, name: string): PluginMeta {
  return {
    id,
    name,
    iconUrl: `/${id}.svg`,
    brandColor: "#000000",
    lines: [],
    primaryCandidates: [], detected: true,
  }
}

describe("useAppPluginViews", () => {
  it("derives display and nav plugins from settings order", () => {
    const pluginSettings: PluginSettings = {
      order: ["codex", "cursor"],
      disabled: ["cursor"],
    }

    const pluginsMeta = [
      createPluginMeta("cursor", "Cursor"),
      createPluginMeta("codex", "Codex"),
    ]

    const { result } = renderHook(() =>
      useAppPluginViews({
        activeView: "home",
        setActiveView: vi.fn(),
        pluginSettings,
        pluginsMeta,
        pluginStates: {
          codex: {
            data: null,
            loading: true,
            error: null,
            lastManualRefreshAt: null,
            lastUpdatedAt: null,
          },
        },
        accountsByProvider: {},
      })
    )

    expect(result.current.displayPlugins).toHaveLength(1)
    expect(result.current.displayPlugins[0]?.meta.id).toBe("codex")
    expect(result.current.displayPlugins[0]?.loading).toBe(true)
    expect(result.current.navPlugins).toEqual([
      {
        id: "codex",
        name: "Codex",
        iconUrl: "/codex.svg",
        brandColor: "#000000",
      },
    ])
  })

  it("falls back to home when active provider becomes disabled", async () => {
    const setActiveView = vi.fn()
    const pluginSettings: PluginSettings = {
      order: ["codex"],
      disabled: ["codex"],
    }

    renderHook(() =>
      useAppPluginViews({
        activeView: "codex",
        setActiveView,
        pluginSettings,
        pluginsMeta: [createPluginMeta("codex", "Codex")],
        pluginStates: {},
        accountsByProvider: {},
      })
    )

    await waitFor(() => {
      expect(setActiveView).toHaveBeenCalledWith("home")
    })
  })

  it("does not fall back while plugin settings are still loading", async () => {
    const setActiveView = vi.fn()
    const pluginsMeta = [createPluginMeta("codex", "Codex")]
    const { rerender } = renderHook(
      ({ pluginSettings }: { pluginSettings: PluginSettings | null }) =>
        useAppPluginViews({
          activeView: "codex",
          setActiveView,
          pluginSettings,
          pluginsMeta,
          pluginStates: {},
          accountsByProvider: {},
        }),
      { initialProps: { pluginSettings: null } }
    )

    expect(setActiveView).not.toHaveBeenCalled()

    rerender({
      pluginSettings: {
        order: ["codex"],
        disabled: ["codex"],
      },
    })

    await waitFor(() => {
      expect(setActiveView).toHaveBeenCalledWith("home")
    })
  })

  it("returns selected plugin for active provider view", () => {
    const pluginSettings: PluginSettings = {
      order: ["codex"],
      disabled: [],
    }

    const { result } = renderHook(() =>
      useAppPluginViews({
        activeView: "codex",
        setActiveView: vi.fn(),
        pluginSettings,
        pluginsMeta: [createPluginMeta("codex", "Codex")],
        pluginStates: {},
        accountsByProvider: {},
      })
    )

    expect(result.current.selectedPlugin?.meta.id).toBe("codex")
  })
})

describe("useAppPluginViews — multi-account", () => {
  const pluginSettings: PluginSettings = { order: ["codex"], disabled: [] }
  const emptyState = {
    data: null,
    loading: false,
    error: null,
    lastManualRefreshAt: null,
    lastUpdatedAt: null,
  }

  function stateWith(plan: string) {
    return {
      ...emptyState,
      data: {
        providerId: "codex",
        accountId: null as string | null,
        displayName: "Codex",
        plan,
        lines: [],
        iconUrl: "",
      },
    }
  }

  it("displayPlugins carries the selected account's data, not the first account's", () => {
    const { result } = renderHook(() =>
      useAppPluginViews({
        activeView: "home",
        setActiveView: vi.fn(),
        pluginSettings,
        pluginsMeta: [createPluginMeta("codex", "Codex")],
        pluginStates: {
          codex: stateWith("Default"),
          "codex::work": { ...stateWith("Work"), data: { ...stateWith("Work").data!, accountId: "work" } },
          "codex::home": { ...stateWith("Home"), data: { ...stateWith("Home").data!, accountId: "home" } },
        },
        accountsByProvider: {
          codex: [
            { accountId: "work", label: "Work", order: 0 },
            { accountId: "home", label: "Home", order: 1 },
          ],
        },
        selectedByProvider: { codex: "home" },
      })
    )

    expect(result.current.displayPlugins[0]?.data?.plan).toBe("Home")
  })

  it("falls back to the Default (first) account when nothing is selected", () => {
    const { result } = renderHook(() =>
      useAppPluginViews({
        activeView: "home",
        setActiveView: vi.fn(),
        pluginSettings,
        pluginsMeta: [createPluginMeta("codex", "Codex")],
        pluginStates: {
          codex: stateWith("Default"),
          "codex::work": { ...stateWith("Work"), data: { ...stateWith("Work").data!, accountId: "work" } },
        },
        accountsByProvider: {
          codex: [{ accountId: "work", label: "Work", order: 0 }],
        },
      })
    )

    expect(result.current.displayPlugins[0]?.data?.plan).toBe("Default")
  })
})

describe("useAppPluginViews — default label", () => {
  it("threads the custom Default name into grouped views", () => {
    const emptyState = {
      data: null,
      loading: false,
      error: null,
      lastManualRefreshAt: null,
      lastUpdatedAt: null,
    }
    const { result } = renderHook(() =>
      useAppPluginViews({
        activeView: "home",
        setActiveView: vi.fn(),
        pluginSettings: { order: ["codex"], disabled: [] },
        pluginsMeta: [createPluginMeta("codex", "Codex")],
        pluginStates: { codex: emptyState },
        accountsByProvider: {
          codex: [{ accountId: "work", label: "Work", order: 0 }],
        },
        defaultLabels: { codex: "Personal" },
      })
    )

    expect(result.current.groupedPlugins[0]?.accounts[0]?.label).toBe("Personal")
  })
})
