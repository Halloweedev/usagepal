import { useMemo } from "react"
import { ADD_ACCOUNT_PROVIDERS } from "@/components/add-account-dialog"
import { ModelsTodayStrip } from "@/components/models-today-strip"
import { ProviderCard } from "@/components/provider-card"
import type { GroupedProviderView } from "@/hooks/app/group-provider-views"
import type { DisplayMode, ResetTimerDisplayMode, TimeFormatMode } from "@/lib/settings"
import type { TodayModelsSource } from "@/lib/today-models"

interface OverviewPageProps {
  /** One entry per provider carrying its ordered account snapshots — drives the
   * paginated cards and the spend strip. */
  groupedPlugins: GroupedProviderView[]
  onRetryPlugin?: (pluginId: string) => void
  /** Persist the account a provider shows (card + tray follow it). */
  onSelectAccount?: (providerId: string, accountId: string | null) => void
  /** Open the add-account flow for a provider (shown only for capable ones). */
  onAddAccount?: (providerId: string) => void
  displayMode: DisplayMode
  resetTimerDisplayMode: ResetTimerDisplayMode
  timeFormatMode?: TimeFormatMode
  overviewSpendStripEnabled?: boolean
  onResetTimerDisplayModeToggle?: () => void
  onUsageValueToggle?: () => void
}

/** Flatten every account into a strip source so the strip counts every
 * account's stats, not just the one the card currently shows. buildModelUsage
 * merges same-provider sources into one combined entry ("all Codex in one"). */
export function buildStripSources(groupedPlugins: GroupedProviderView[]): TodayModelsSource[] {
  return groupedPlugins.flatMap((group) =>
    group.accounts.map((account) => ({
      meta: group.meta,
      data: account.data,
    }))
  )
}

export function OverviewPage({
  groupedPlugins,
  onRetryPlugin,
  onSelectAccount,
  onAddAccount,
  displayMode,
  resetTimerDisplayMode,
  timeFormatMode = "auto",
  overviewSpendStripEnabled = true,
  onResetTimerDisplayModeToggle,
  onUsageValueToggle,
}: OverviewPageProps) {
  const stripSources = useMemo(() => buildStripSources(groupedPlugins), [groupedPlugins])

  return (
    <div className="pb-3">
      {groupedPlugins.length === 0 ? (
        <div className="text-center text-muted-foreground py-8">
          No providers enabled
        </div>
      ) : (
        <>
          {overviewSpendStripEnabled && (
            <section className="mb-3 pt-2">
              <h3 className="text-lg font-semibold mb-2">Quick Usage Overview</h3>
              <ModelsTodayStrip plugins={stripSources} />
            </section>
          )}
          {groupedPlugins.map((group, index) => (
            <ProviderCard
              key={group.meta.id}
              name={group.meta.name}
              asCard
              iconUrl={group.meta.iconUrl}
              pluginId={group.meta.id}
              showSeparator={index < groupedPlugins.length - 1}
              skeletonLines={group.meta.lines}
              accounts={group.accounts}
              activeIndex={group.activeIndex}
              onActiveIndexChange={
                onSelectAccount
                  ? (i) => {
                      const accountId = group.accounts[i]?.accountId
                      if (accountId !== undefined) onSelectAccount(group.meta.id, accountId)
                    }
                  : undefined
              }
              onRetry={onRetryPlugin ? () => onRetryPlugin(group.meta.id) : undefined}
              onAddAccount={
                onAddAccount && ADD_ACCOUNT_PROVIDERS.includes(group.meta.id)
                  ? onAddAccount
                  : undefined
              }
              scopeFilter="overview"
              displayMode={displayMode}
              resetTimerDisplayMode={resetTimerDisplayMode}
              timeFormatMode={timeFormatMode}
              onResetTimerDisplayModeToggle={onResetTimerDisplayModeToggle}
              onUsageValueToggle={onUsageValueToggle}
            />
          ))}
        </>
      )}
    </div>
  )
}
