import { useEffect, useMemo } from "react"
import type { ActiveView, NavPlugin } from "@/components/side-nav"
import type { PluginMeta } from "@/lib/plugin-types"
import type { PluginSettings, SelectedAccounts } from "@/lib/settings"
import type { PluginState } from "@/hooks/app/types"
import {
  type AccountMeta,
  type GroupedProviderView,
  groupProviderViews,
} from "@/hooks/app/group-provider-views"

export type DisplayPluginState = { meta: PluginMeta } & PluginState

type UseAppPluginViewsArgs = {
  activeView: ActiveView
  setActiveView: (view: ActiveView) => void
  pluginSettings: PluginSettings | null
  pluginsMeta: PluginMeta[]
  pluginStates: Record<string, PluginState>
  accountsByProvider: Record<string, AccountMeta[]>
  selectedByProvider?: SelectedAccounts
  /** Custom display names for providers' implicit Default accounts. */
  defaultLabels?: Record<string, string>
}

export function useAppPluginViews({
  activeView,
  setActiveView,
  pluginSettings,
  pluginsMeta,
  pluginStates,
  accountsByProvider,
  selectedByProvider = {},
  defaultLabels = {},
}: UseAppPluginViewsArgs) {
  const orderedEnabledMeta = useMemo<PluginMeta[]>(() => {
    if (!pluginSettings) return []
    const disabledSet = new Set(pluginSettings.disabled)
    const metaById = new Map(pluginsMeta.map((plugin) => [plugin.id, plugin]))
    return pluginSettings.order
      .filter((id) => !disabledSet.has(id))
      .map((id) => metaById.get(id))
      .filter((plugin): plugin is PluginMeta => Boolean(plugin))
  }, [pluginSettings, pluginsMeta])

  const groupedPlugins = useMemo<GroupedProviderView[]>(
    () => groupProviderViews(orderedEnabledMeta, pluginStates, accountsByProvider, selectedByProvider, defaultLabels),
    [orderedEnabledMeta, pluginStates, accountsByProvider, selectedByProvider, defaultLabels]
  )

  const displayPlugins = useMemo<DisplayPluginState[]>(
    () =>
      groupedPlugins.map(({ meta, accounts, activeIndex }) => {
        // The account the provider currently shows (card + tray selection), not
        // blindly the first one — Share reads this so a shared card reflects
        // the account the user is looking at.
        const shown = accounts[activeIndex] ?? accounts[0]
        return {
          meta,
          data: shown.data,
          loading: shown.loading,
          error: shown.error,
          lastManualRefreshAt: shown.lastManualRefreshAt,
          lastUpdatedAt: shown.lastUpdatedAt,
        }
      }),
    [groupedPlugins]
  )

  const navPlugins = useMemo<NavPlugin[]>(
    () =>
      orderedEnabledMeta.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        iconUrl: plugin.iconUrl,
        brandColor: plugin.brandColor ?? undefined,
      })),
    [orderedEnabledMeta]
  )

  useEffect(() => {
    if (activeView === "home" || activeView === "settings") return
    if (!pluginSettings) return
    const isKnownPlugin = pluginsMeta.some((plugin) => plugin.id === activeView)
    if (!isKnownPlugin) return
    const isStillEnabled = navPlugins.some((plugin) => plugin.id === activeView)
    if (!isStillEnabled) {
      setActiveView("home")
    }
  }, [activeView, navPlugins, pluginSettings, pluginsMeta, setActiveView])

  const selectedPlugin = useMemo(() => {
    if (activeView === "home" || activeView === "settings") return null
    return displayPlugins.find((plugin) => plugin.meta.id === activeView) ?? null
  }, [activeView, displayPlugins])

  return {
    displayPlugins,
    groupedPlugins,
    navPlugins,
    selectedPlugin,
  }
}
