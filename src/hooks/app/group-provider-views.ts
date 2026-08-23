import type { AccountMeta, SelectedAccounts } from "@/lib/settings"
import { resolveSelectedAccountId } from "@/lib/settings"
import type { TodayModelsSource } from "@/lib/today-models"
import type { PluginState } from "@/hooks/app/types"
import type { PluginMeta } from "@/lib/plugin-types"
import { stateKey } from "@/hooks/app/use-probe-state"

export type { AccountMeta }

export type AccountSnapshot = {
  accountId: string | null
  label: string | null
  data: PluginState["data"]
  loading: boolean
  error: string | null
  lastManualRefreshAt: number | null
  lastUpdatedAt: number | null
}

export type GroupedProviderView = {
  meta: PluginMeta
  accounts: AccountSnapshot[]
  /** Index into `accounts` of the persisted selection. The implicit Default
   * account is first and is used when no managed account is selected. */
  activeIndex: number
}

const EMPTY_STATE: PluginState = {
  data: null,
  loading: false,
  error: null,
  lastManualRefreshAt: null,
  lastUpdatedAt: null,
}

function snapshot(
  accountId: string | null,
  label: string | null,
  state: PluginState
): AccountSnapshot {
  return {
    accountId,
    label,
    data: state.data,
    loading: state.loading,
    error: state.error,
    lastManualRefreshAt: state.lastManualRefreshAt,
    lastUpdatedAt: state.lastUpdatedAt,
  }
}

/** Group flat, composite-keyed plugin state into one entry per provider. The
 * implicit local account stays first when managed accounts are registered
 * (displayed as its custom name from `defaultLabels`, else "Default").
 * Providers without managed accounts keep one unnamed snapshot. */
export function groupProviderViews(
  orderedEnabledMeta: PluginMeta[],
  pluginStates: Record<string, PluginState>,
  accountsByProvider: Record<string, AccountMeta[]>,
  selectedByProvider: SelectedAccounts = {},
  defaultLabels: Record<string, string> = {}
): GroupedProviderView[] {
  return orderedEnabledMeta.map((meta) => {
    const accountsMeta = accountsByProvider[meta.id]
    if (!accountsMeta || accountsMeta.length === 0) {
      const state = pluginStates[meta.id] ?? EMPTY_STATE
      return { meta, accounts: [snapshot(null, null, state)], activeIndex: 0 }
    }
    const accounts = [
      snapshot(
        null,
        defaultLabels[meta.id]?.trim() || "Default",
        pluginStates[meta.id] ?? EMPTY_STATE
      ),
      ...[...accountsMeta]
        .sort((a, b) => a.order - b.order)
        .map((acct) => {
          const state = pluginStates[stateKey(meta.id, acct.accountId)] ?? EMPTY_STATE
          return snapshot(acct.accountId, acct.label, state)
        }),
    ]
    const selectedId = resolveSelectedAccountId(meta.id, accountsByProvider, selectedByProvider)
    const activeIndex = Math.max(
      0,
      accounts.findIndex((acct) => acct.accountId === selectedId)
    )
    return { meta, accounts, activeIndex }
  })
}

/** One source per account snapshot — the aggregation basis for surfaces that
 * must count every account's spend (Overview strip, Share graph).
 * buildModelUsage merges same-provider sources into a single combined entry
 * ("all Codex in one"). */
export function flattenAccountSources(
  groupedPlugins: GroupedProviderView[]
): TodayModelsSource[] {
  return groupedPlugins.flatMap((group) =>
    group.accounts.map((account) => ({
      meta: group.meta,
      data: account.data,
    }))
  )
}
