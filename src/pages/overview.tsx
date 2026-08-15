import { ModelsTodayStrip } from "@/components/models-today-strip"
import { ProviderCard } from "@/components/provider-card"
import type { GroupedProviderView } from "@/hooks/app/group-provider-views"
import type { PluginDisplayState } from "@/lib/plugin-types"
import type { DisplayMode, ResetTimerDisplayMode, TimeFormatMode } from "@/lib/settings"

interface OverviewPageProps {
  /** Flat, first-account-per-provider state — drives the spend strip only. */
  plugins: PluginDisplayState[]
  /** One entry per provider carrying its ordered account snapshots — drives the
   * paginated cards. */
  groupedPlugins: GroupedProviderView[]
  onRetryPlugin?: (pluginId: string) => void
  /** Persist the account a provider shows (card + tray follow it). */
  onSelectAccount?: (providerId: string, accountId: string) => void
  displayMode: DisplayMode
  resetTimerDisplayMode: ResetTimerDisplayMode
  timeFormatMode?: TimeFormatMode
  overviewSpendStripEnabled?: boolean
  onResetTimerDisplayModeToggle?: () => void
  onUsageValueToggle?: () => void
}

export function OverviewPage({
  plugins,
  groupedPlugins,
  onRetryPlugin,
  onSelectAccount,
  displayMode,
  resetTimerDisplayMode,
  timeFormatMode = "auto",
  overviewSpendStripEnabled = true,
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
          {overviewSpendStripEnabled && (
            <section className="mb-3 pt-2">
              <h3 className="text-lg font-semibold mb-2">Quick Usage Overview</h3>
              <ModelsTodayStrip plugins={plugins} />
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
                      if (accountId) onSelectAccount(group.meta.id, accountId)
                    }
                  : undefined
              }
              onRetry={onRetryPlugin ? () => onRetryPlugin(group.meta.id) : undefined}
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
