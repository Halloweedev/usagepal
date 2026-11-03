
import { ADD_ACCOUNT_PROVIDERS } from "@/components/add-account-dialog"
import { ProviderCard } from "@/components/provider-card"
import { ProviderUsageStrip } from "@/components/provider-usage-strip"
import {
  flattenAccountSources,
  type GroupedProviderView,
} from "@/hooks/app/group-provider-views"
import type { DisplayMode, ResetTimerDisplayMode, TimeFormatMode } from "@/lib/settings"

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
  onResetTimerDisplayModeToggle?: () => void
  onUsageValueToggle?: () => void
}

export { flattenAccountSources as buildStripSources }

export function OverviewPage({
  groupedPlugins,
  onRetryPlugin,
  onSelectAccount,
  onAddAccount,
  displayMode,
  resetTimerDisplayMode,
  timeFormatMode = "auto",
  onResetTimerDisplayModeToggle,
  onUsageValueToggle,
}: OverviewPageProps) {
  return (
    <div className="pb-3">
      {groupedPlugins.length === 0 ? (
        <div className="text-center text-muted-foreground py-8">
          No providers enabled
        </div>
      ) : (
        <>
          <ProviderUsageStrip groupedPlugins={groupedPlugins} />
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
