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
}

export function useAppPluginViews({
  activeView,
  setActiveView,
  pluginSettings,
  pluginsMeta,
  pluginStates,
  accountsByProvider,
  selectedByProvider = {},
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
    () => groupProviderViews(orderedEnabledMeta, pluginStates, accountsByProvider, selectedByProvider),
    [orderedEnabledMeta, pluginStates, accountsByProvider, selectedByProvider]
  )

  const displayPlugins = useMemo<DisplayPluginState[]>(
    () =>
      groupedPlugins.map(({ meta, accounts }) => {
        const first = accounts[0]
        return {
          meta,
          data: first.data,
          loading: first.loading,
          error: first.error,
          lastManualRefreshAt: first.lastManualRefreshAt,
          lastUpdatedAt: first.lastUpdatedAt,
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
